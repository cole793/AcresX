// Flood hazard screening for POST /api/hazards { kind: 'flood', geometry }.
//
// Response shape (unchanged from the legacy src/worker.js handler, plus `source`):
//   { available, intersects, high, zones, source: { provider, url, emptyResult? } }
// On failure of every source: HTTP 502 with
//   { available: false, intersects: false, high: false, zones: [], error, source: null }
//
// Request plan (at most 3 upstream requests per call, worst case 22.5 s):
//   1. FEMA NFHL layer 28 (Flood Hazard Zones).
//   2. One FEMA retry if (1) failed with 5xx / network error / timeout, OR returned 0 features.
//      Under load FEMA has answered 200 with no features for parcels that do intersect zones
//      (preview validation run 40396618433), so an empty answer is not trusted on its own.
//   3. Esri Living Atlas "USA Flood Hazard Areas" — only when ESRI_FALLBACK_ENABLED (off).
// If FEMA's final answer is empty, the response is the usual no-intersection shape with
// `source.emptyResult: true`, and it is never cached.
// Non-empty answers are cached with the Workers Cache API for 7 days, keyed by a hash of the
// rounded parcel geometry. The cache is skipped where `caches` does not exist (Node tests).
import { fetchWithTimeout, json } from '../shared/http.js';

export const FEMA_NFHL_FLOOD_LAYER = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28';

// WRONG / UNVERIFIED: this URL returned HTTP 404 in preview validation run 40396618433
// (2026-10-26, "Esri USA Flood Hazard Areas returned 404"). Find the correct layer URL, verify
// it in a preview run, then set ESRI_FALLBACK_ENABLED to true.
export const ESRI_USA_FLOOD_HAZARD_LAYER = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0';
export const ESRI_FALLBACK_ENABLED = false;

export const FEMA_PROVIDER = 'FEMA NFHL';
export const ESRI_PROVIDER = 'Esri USA Flood Hazard Areas';

// Worst case: 8 s + 0.5 s backoff + 6 s + 8 s = 22.5 s, under the 30 s client/validator timeout.
export const FEMA_TIMEOUT_MS = 8000;
export const FEMA_RETRY_TIMEOUT_MS = 6000;
export const FEMA_RETRY_BACKOFF_MS = 500;
export const FALLBACK_TIMEOUT_MS = 8000;

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
// v2: v1 entries from the first preview may hold unconfirmed empty answers.
const CACHE_KEY_PREFIX = 'https://acresx.internal/cache/flood/v2/';
const COORD_DECIMALS = 6;

class UpstreamError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

function esriPolygon(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) throw new Error('A parcel Polygon or MultiPolygon is required.');
  return { rings: geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat(), spatialReference: { wkid: 4326 } };
}

function queryUrl(layerUrl, geometry, outFields) {
  const params = new URLSearchParams({
    f: 'json', where: '1=1', geometry: JSON.stringify(esriPolygon(geometry)), geometryType: 'esriGeometryPolygon',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: 'false', resultRecordCount: '100'
  });
  return `${layerUrl}/query?${params}`;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function queryLayer(layerUrl, geometry, outFields, timeoutMs) {
  let response;
  try {
    response = await fetchWithTimeout(queryUrl(layerUrl, geometry, outFields), {
      headers: { 'User-Agent': 'AcresX/0.5.2' },
      cf: { cacheTtl: 86400, cacheEverything: true }
    }, timeoutMs);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    throw new UpstreamError(timedOut ? `timeout after ${Math.round(timeoutMs / 1000)}s` : (error?.message || 'network error'), true);
  }
  if (!response.ok) throw new UpstreamError(`returned ${response.status}`, response.status >= 500);
  let data;
  try { data = await response.json(); } catch { throw new UpstreamError('returned invalid JSON', true); }
  if (data?.error) {
    const code = Number(data.error.code);
    throw new UpstreamError(`ArcGIS error${Number.isFinite(code) ? ` ${code}` : ''}: ${data.error.message || 'query failed'}`, !(code >= 400 && code < 500));
  }
  return (data?.features || []).map(f => f?.attributes || {});
}

// Case-insensitive field lookup that also accepts table-qualified names ("S_FLD_HAZ_AR.FLD_ZONE").
function field(attributes, name) {
  const wanted = name.toUpperCase();
  const key = Object.keys(attributes || {}).find(k => {
    const upper = k.toUpperCase();
    return upper === wanted || upper.endsWith(`.${wanted}`);
  });
  return key === undefined ? undefined : attributes[key];
}

function isSfha(row) {
  const flag = field(row, 'SFHA_TF');
  if (flag === true || /^(T|TRUE|Y|YES|1)$/i.test(String(flag ?? '').trim())) return true;
  // Same zone-code rule as the legacy handler: A* and V* zones are Special Flood Hazard Areas.
  if (/^(A|V)/.test(String(field(row, 'FLD_ZONE') || '').toUpperCase())) return true;
  // Esri layer may carry only a symbology label ("1% Annual Chance Flood Hazard", "Regulatory Floodway").
  return /1%\s*annual|floodway/i.test(String(field(row, 'ESRI_SYMBOLOGY') || ''));
}

export function summarizeFloodRows(rows) {
  const zones = [...new Set(rows.map(r => field(r, 'FLD_ZONE')).filter(Boolean).map(z => String(z).trim()).filter(Boolean))];
  return { available: true, intersects: rows.length > 0, high: rows.some(isSfha), zones };
}

function roundCoords(value) {
  if (Array.isArray(value)) return value.map(roundCoords);
  return typeof value === 'number' ? Number(value.toFixed(COORD_DECIMALS)) : value;
}

async function cacheKey(geometry) {
  const text = JSON.stringify({ type: geometry.type, coordinates: roundCoords(geometry.coordinates) });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request(`${CACHE_KEY_PREFIX}${hex}`);
}

function edgeCache() {
  try { return typeof caches !== 'undefined' && caches?.default ? caches.default : null; } catch { return null; }
}

async function readCache(cache, key) {
  if (!cache) return null;
  try {
    const hit = await cache.match(key);
    if (!hit) return null;
    const body = await hit.json();
    return body?.available === true && !body.source?.emptyResult ? body : null;
  } catch { return null; }
}

async function writeCache(cache, key, body, ctx) {
  if (!cache) return;
  const response = new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` }
  });
  const put = Promise.resolve().then(() => cache.put(key, response)).catch(error => console.warn('Flood cache write failed', error));
  if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(put); else await put;
}

// FEMA with one retry. Resolves { rows } (non-empty), { rows: [], empty: true } (FEMA's final
// answer was empty), or throws when FEMA gave no usable answer at all.
async function fromFema(geometry) {
  const outFields = 'FLD_ZONE,ZONE_SUBTY,SFHA_TF';
  let first;
  try {
    const rows = await queryLayer(FEMA_NFHL_FLOOD_LAYER, geometry, outFields, FEMA_TIMEOUT_MS);
    if (rows.length) return { rows };
    first = { empty: true };
  } catch (error) {
    if (!error.retryable) throw error;
    first = { error };
  }
  await sleep(FEMA_RETRY_BACKOFF_MS);
  try {
    const rows = await queryLayer(FEMA_NFHL_FLOOD_LAYER, geometry, outFields, FEMA_RETRY_TIMEOUT_MS);
    return rows.length ? { rows } : { rows: [], empty: true };
  } catch (retryError) {
    // Empty, then an error on the retry: FEMA did answer, so report its (unconfirmed) empty
    // result rather than an outage. It is flagged emptyResult and not cached.
    if (first.empty) return { rows: [], empty: true };
    throw new UpstreamError(`${first.error.message}; retry ${retryError.message}`, false);
  }
}

const unavailableBody = error => ({ available: false, intersects: false, high: false, zones: [], error, source: null });

// Returns { status, body } and never throws, so src/index.js never falls through to legacy code.
// options.esriFallback overrides ESRI_FALLBACK_ENABLED (used by tests).
export async function floodScreening(geometry, ctx, options = {}) {
  const esriFallback = options.esriFallback ?? ESRI_FALLBACK_ENABLED;
  try { esriPolygon(geometry); } catch (error) {
    return { status: 400, body: unavailableBody(error.message) };
  }
  const cache = edgeCache();
  let key = null;
  if (cache) { try { key = await cacheKey(geometry); } catch { key = null; } }
  const cached = key ? await readCache(cache, key) : null;
  if (cached) return { status: 200, body: cached };

  const success = async (rows, provider, url) => {
    const body = { ...summarizeFloodRows(rows), source: { provider, url } };
    if (key) await writeCache(cache, key, body, ctx);
    return { status: 200, body };
  };

  const failures = [];
  let femaEmpty = false;
  try {
    const fema = await fromFema(geometry);
    if (!fema.empty) return await success(fema.rows, FEMA_PROVIDER, FEMA_NFHL_FLOOD_LAYER);
    femaEmpty = true;
  } catch (error) {
    failures.push(`${FEMA_PROVIDER} ${error?.message || 'failed'}`);
    console.warn(`Flood source failed: ${FEMA_PROVIDER}`, error?.message);
  }

  if (esriFallback) {
    try {
      const rows = await queryLayer(ESRI_USA_FLOOD_HAZARD_LAYER, geometry, '*', FALLBACK_TIMEOUT_MS);
      // An empty Esri answer only stands in for a FEMA outage; it never overrides a FEMA empty.
      if (rows.length || !femaEmpty) return await success(rows, ESRI_PROVIDER, ESRI_USA_FLOOD_HAZARD_LAYER);
    } catch (error) {
      failures.push(`${ESRI_PROVIDER} ${error?.message || 'failed'}`);
      console.warn(`Flood source failed: ${ESRI_PROVIDER}`, error?.message);
    }
  }

  if (femaEmpty) {
    // Same shape as a real no-intersection answer (frontend unchanged), flagged and not cached.
    return { status: 200, body: { ...summarizeFloodRows([]), source: { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER, emptyResult: true } } };
  }
  return { status: 502, body: unavailableBody(`Flood data unavailable: ${failures.join('; ')}`) };
}

export async function handleFlood(request, env, ctx) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const { status, body: result } = await floodScreening(body?.geometry, ctx);
  // emptyResult answers are unconfirmed: don't let the browser or edge hold on to them.
  if (status === 200 && result.source?.emptyResult) return json(result, 200, 'no-store');
  return status === 200 ? json(result) : json(result, status, 'no-store');
}
