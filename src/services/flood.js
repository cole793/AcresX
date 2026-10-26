// Flood hazard screening for POST /api/hazards { kind: 'flood', geometry }.
//
// Response shape (unchanged from the legacy src/worker.js handler, plus `source`):
//   { available, intersects, high, zones, source: { provider, url } }
// On failure of every source: HTTP 502 with
//   { available: false, intersects: false, high: false, zones: [], error, source: null }
//
// Sources, in order (at most 3 upstream requests per call):
//   1. FEMA NFHL layer 28 (Flood Hazard Zones), retried once on 5xx / network error / timeout.
//   2. Esri Living Atlas "USA Flood Hazard Areas" (derived from FEMA NFHL), one attempt.
// Successful answers are cached with the Workers Cache API for 7 days, keyed by a hash of the
// rounded parcel geometry. The cache is skipped where `caches` does not exist (Node tests).
import { fetchWithTimeout, json } from '../shared/http.js';

export const FEMA_NFHL_FLOOD_LAYER = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28';

// UNVERIFIED: written from memory without internet access. Confirm it answers (and check its
// field names) in the PR preview validation run before relying on it. If it is wrong, the
// fallback simply fails and the response degrades to the FEMA error, as before this change.
export const ESRI_USA_FLOOD_HAZARD_LAYER = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0';

export const FEMA_PROVIDER = 'FEMA NFHL';
export const ESRI_PROVIDER = 'Esri USA Flood Hazard Areas';

// Worst case: 8 s + 0.5 s backoff + 6 s + 8 s = 22.5 s, under the 30 s client/validator timeout.
export const FEMA_TIMEOUT_MS = 8000;
export const FEMA_RETRY_TIMEOUT_MS = 6000;
export const FEMA_RETRY_BACKOFF_MS = 500;
export const FALLBACK_TIMEOUT_MS = 8000;

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const CACHE_KEY_PREFIX = 'https://acresx.internal/cache/flood/v1/';
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
    return body?.available === true ? body : null;
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

async function fromFema(geometry) {
  const outFields = 'FLD_ZONE,ZONE_SUBTY,SFHA_TF';
  try {
    return await queryLayer(FEMA_NFHL_FLOOD_LAYER, geometry, outFields, FEMA_TIMEOUT_MS);
  } catch (error) {
    if (!error.retryable) throw error;
    await sleep(FEMA_RETRY_BACKOFF_MS);
    try {
      return await queryLayer(FEMA_NFHL_FLOOD_LAYER, geometry, outFields, FEMA_RETRY_TIMEOUT_MS);
    } catch (retryError) {
      throw new UpstreamError(`${error.message}; retry ${retryError.message}`, false);
    }
  }
}

// Returns { status, body } and never throws, so src/index.js never falls through to legacy code.
export async function floodScreening(geometry, ctx) {
  try { esriPolygon(geometry); } catch (error) {
    return { status: 400, body: { available: false, intersects: false, high: false, zones: [], error: error.message, source: null } };
  }
  const cache = edgeCache();
  let key = null;
  if (cache) { try { key = await cacheKey(geometry); } catch { key = null; } }
  const cached = key ? await readCache(cache, key) : null;
  if (cached) return { status: 200, body: cached };

  const failures = [];
  const attempts = [
    { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER, run: () => fromFema(geometry) },
    { provider: ESRI_PROVIDER, url: ESRI_USA_FLOOD_HAZARD_LAYER, run: () => queryLayer(ESRI_USA_FLOOD_HAZARD_LAYER, geometry, '*', FALLBACK_TIMEOUT_MS) }
  ];
  for (const attempt of attempts) {
    try {
      const rows = await attempt.run();
      const body = { ...summarizeFloodRows(rows), source: { provider: attempt.provider, url: attempt.url } };
      if (key) await writeCache(cache, key, body, ctx);
      return { status: 200, body };
    } catch (error) {
      failures.push(`${attempt.provider} ${error?.message || 'failed'}`);
      console.warn(`Flood source failed: ${attempt.provider}`, error?.message);
    }
  }
  return {
    status: 502,
    body: { available: false, intersects: false, high: false, zones: [], error: `Flood data unavailable: ${failures.join('; ')}`, source: null }
  };
}

export async function handleFlood(request, env, ctx) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const { status, body: result } = await floodScreening(body?.geometry, ctx);
  return status === 200 ? json(result) : json(result, status, 'no-store');
}
