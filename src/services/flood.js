// Flood hazard screening for POST /api/hazards { kind: 'flood', geometry }.
//
// Response shape (unchanged from the legacy src/worker.js handler, plus `source`):
//   { available, intersects, high, zones, zoneDetails, category, source: { provider, url, coverage?, emptyResult? } }
// zoneDetails: deduped [{ zone, subtype, sfha }] (sfha: SFHA_TF as true/false, null when absent).
// category: the parcel's worst intersecting zone (see floodCategory()), or 'limited' for an empty
// Esri-fallback answer; one of FLOOD_CATEGORIES.
// `high` keeps its legacy meaning (some row is a Special Flood Hazard Area), except that FEMA's
// 'AREA NOT INCLUDED' no longer counts as an A zone. The same rules live in public/flood-status.js.
// On failure of every source: HTTP 502 with
//   { available: false, intersects: false, high: false, zones: [], error, source: null }
//
// Request plan (at most 3 upstream requests per call, worst case 22.5 s):
//   1. FEMA NFHL layer 28 (Flood Hazard Zones). Any answer it gives, including no features, is
//      authoritative and cacheable.
//   2. One FEMA retry if (1) failed with 5xx / network error / timeout. FEMA is intermittently
//      unreachable (Cloudflare 525, TLS errors, timeouts) but correct when it answers.
//   3. Esri Living Atlas "USA Flood Hazard Areas" if FEMA gave no answer. That layer only holds
//      high- and moderate-risk areas, so its answers carry coverage 'high-and-moderate-risk-only',
//      and an empty Esri answer is flagged emptyResult and never cached.
// Queries go as GET, or as a form-encoded POST when the URL would be too long (large parcels).
// Cacheable answers go in the Workers Cache API for 7 days, keyed by a hash of the rounded
// parcel geometry. The cache is skipped where `caches` does not exist (Node tests).
// Browser fallback (src/shared/fallback.js): when FEMA failed with a network error, a timeout or
// a 403/429/5xx, the answer (Esri backup or 502) gains `fallback: { mode: 'browser', kind:
// 'fema-flood', input: { geometry } }` so public/browser-fallback.js can ask FEMA from the
// user's browser. The hint is never cached.
import { fetchWithTimeout, json } from '../shared/http.js';
import { FALLBACK_KINDS, fallbackHint, hintGeometry } from '../shared/fallback.js';

export const FEMA_NFHL_FLOOD_LAYER = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28';

// Esri's official "USA Flood Hazard Areas" view (owner esri_landscapes, last edit April 2026),
// checked live by the lead on 2026-10-26: FEMA fields (FLD_ZONE, ZONE_SUBTY, SFHA_TF,
// esri_symbology); 48N03W312100 returns AE / SFHA_TF T, matching FEMA. It contains only
// high- and moderate-risk areas (A*, V*, shaded X, D is rare); there is no unshaded
// "AREA OF MINIMAL FLOOD HAZARD" X, so an empty answer is not "no flood zone".
// (The earlier guess, services.arcgis.com/P3ePLMYs2RVChkJx/.../USA_Flood_Hazard_Reduced_Set_gdb,
// returned no features where FEMA has zone D, and 404 for a long GET URL.)
export const ESRI_USA_FLOOD_HAZARD_LAYER = 'https://services5.arcgis.com/7weheFjxuNkGGiZi/arcgis/rest/services/USA_Flood_Hazard_Areas_view/FeatureServer/0';
export const ESRI_FALLBACK_ENABLED = true;
export const ESRI_COVERAGE = 'high-and-moderate-risk-only';

export const FEMA_PROVIDER = 'FEMA NFHL';
export const ESRI_PROVIDER = 'Esri USA Flood Hazard Areas';

// Worst case: 8 s + 0.5 s backoff + 6 s + 8 s = 22.5 s, under the 30 s client/validator timeout.
export const FEMA_TIMEOUT_MS = 8000;
export const FEMA_RETRY_TIMEOUT_MS = 6000;
export const FEMA_RETRY_BACKOFF_MS = 500;
export const FALLBACK_TIMEOUT_MS = 8000;

// Longer query URLs are sent as POST; ArcGIS Online rejected a long GET (404) for a 65-acre parcel.
export const MAX_GET_URL_LENGTH = 3500;

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
// v3: earlier entries may hold answers from the wrong Esri layer.
// v4: answers gained zoneDetails and category, and 'AREA NOT INCLUDED' is no longer high.
export const CACHE_KEY_PREFIX = 'https://acresx.internal/cache/flood/v4/';
const COORD_DECIMALS = 6;

// browserFallback: a failure a browser might get past (network, timeout, 403/429/5xx).
class UpstreamError extends Error {
  constructor(message, retryable, browserFallback = false) {
    super(message);
    this.retryable = retryable;
    this.browserFallback = browserFallback;
  }
}
const browserEligibleStatus = status => status === 403 || status === 429 || (status >= 500 && status <= 599);

function esriPolygon(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) throw new Error('A parcel Polygon or MultiPolygon is required.');
  return { rings: geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat(), spatialReference: { wkid: 4326 } };
}

// GET for short queries, form-encoded POST when the URL is too long. No request carries `cf`
// edge-cache options: ArcGIS sends errors as HTTP 200 bodies, which an edge cache would keep.
// The Cache API layer below stores only validated answers.
export function buildQueryRequest(layerUrl, geometry, outFields) {
  const params = new URLSearchParams({
    f: 'json', where: '1=1', geometry: JSON.stringify(esriPolygon(geometry)), geometryType: 'esriGeometryPolygon',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: 'false', resultRecordCount: '100'
  });
  const headers = { 'User-Agent': 'AcresX/0.5.2' };
  const getUrl = `${layerUrl}/query?${params}`;
  if (getUrl.length <= MAX_GET_URL_LENGTH) {
    return { url: getUrl, init: { method: 'GET', headers } };
  }
  return {
    url: `${layerUrl}/query`,
    init: { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function queryLayer(layerUrl, geometry, outFields, timeoutMs) {
  const { url, init } = buildQueryRequest(layerUrl, geometry, outFields);
  let response;
  try {
    response = await fetchWithTimeout(url, init, timeoutMs);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    throw new UpstreamError(timedOut ? `timeout after ${Math.round(timeoutMs / 1000)}s` : (error?.message || 'network error'), true, true);
  }
  if (!response.ok) throw new UpstreamError(`returned ${response.status}`, response.status >= 500, browserEligibleStatus(response.status));
  let data;
  try { data = await response.json(); } catch { throw new UpstreamError('returned invalid JSON', true); }
  if (data?.error) {
    const code = Number(data.error.code);
    throw new UpstreamError(`ArcGIS error${Number.isFinite(code) ? ` ${code}` : ''}: ${data.error.message || 'query failed'}`, !(code >= 400 && code < 500), browserEligibleStatus(code));
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

// FEMA FLD_ZONE values that mean "no flood map here", not a flood zone. 'AREA NOT INCLUDED'
// starts with A but is not an A zone.
const NOT_MAPPED_ZONES = new Set(['AREA NOT INCLUDED', 'OPEN WATER']);

// Zone categories, worst first: ranked by the page's flood score (lowest wins), and on a tie a
// known hazard (moderate) beats not_mapped. A parcel's category is the worst of its rows.
// high 20 > undetermined 55 > moderate 70 > not_mapped 70 > minimal 96.
export const FLOOD_RANK = ['high', 'undetermined', 'moderate', 'not_mapped', 'minimal'];
// Every `category` value an answer can carry. 'limited' is only the Esri-empty answer
// (source.emptyResult): not in a mapped high/moderate-risk area, which is not "no flood zone".
export const FLOOD_CATEGORIES = [...FLOOD_RANK, 'limited'];

const zoneOf = row => String(field(row, 'FLD_ZONE') ?? '').trim().toUpperCase();

function sfhaFlag(row) {
  const flag = field(row, 'SFHA_TF');
  if (flag === true || flag === false) return flag;
  const text = String(flag ?? '').trim();
  if (/^(T|TRUE|Y|YES|1)$/i.test(text)) return true;
  if (/^(F|FALSE|N|NO|0)$/i.test(text)) return false;
  return null;
}

function isSfha(row) {
  const zone = zoneOf(row);
  if (NOT_MAPPED_ZONES.has(zone)) return false;
  if (sfhaFlag(row) === true) return true;
  // Same zone-code rule as the legacy handler: A* and V* zones are Special Flood Hazard Areas.
  if (/^(A|V)/.test(zone)) return true;
  // Esri rows may carry only a symbology label ("1% Annual Chance Flood Hazard", "Regulatory Floodway").
  return /1%\s*annual|floodway/i.test(String(field(row, 'ESRI_SYMBOLOGY') || ''));
}

// One row's category. Shaded X (any subtype other than minimal: 0.2 PCT, levee, 1 PCT depth or
// drainage area, future conditions) and B are moderate; unshaded X and C are minimal. With
// options.backup (the Esri layer, which has no minimal X), an X row with no subtype or symbology
// is moderate too. A zone code this list does not know is undetermined, never safe. A row
// without a zone is ignored (null).
export function rowCategory(row, options = {}) {
  const zone = zoneOf(row);
  if (NOT_MAPPED_ZONES.has(zone)) return 'not_mapped';
  if (isSfha(row)) return 'high';
  if (zone === 'B') return 'moderate';
  if (zone === 'C') return 'minimal';
  if (zone === 'D') return 'undetermined';
  if (zone === 'X') {
    const subtype = String(field(row, 'ZONE_SUBTY') ?? '').trim();
    if (subtype) return /AREA OF MINIMAL FLOOD HAZARD/i.test(subtype) ? 'minimal' : 'moderate';
    if (options.backup) return 'moderate';
    return /0\.2\s*(%|PCT|PERCENT)/i.test(String(field(row, 'ESRI_SYMBOLOGY') ?? '')) ? 'moderate' : 'minimal';
  }
  return zone ? 'undetermined' : null;
}

// Worst category over all rows (FLOOD_RANK). No rows, or no row with a zone, is not_mapped.
export function floodCategory(rows, options = {}) {
  let worst = FLOOD_RANK.indexOf('not_mapped');
  let found = false;
  for (const row of rows) {
    const index = FLOOD_RANK.indexOf(rowCategory(row, options));
    if (index < 0) continue;
    if (!found || index < worst) worst = index;
    found = true;
  }
  return FLOOD_RANK[worst];
}

function zoneDetails(rows) {
  const seen = new Map();
  for (const row of rows) {
    const zone = String(field(row, 'FLD_ZONE') ?? '').trim();
    if (!zone) continue;
    const detail = { zone, subtype: String(field(row, 'ZONE_SUBTY') ?? '').trim() || null, sfha: sfhaFlag(row) };
    const key = JSON.stringify(detail);
    if (!seen.has(key)) seen.set(key, detail);
  }
  return [...seen.values()];
}

// options.backup: rows come from the Esri fallback (see rowCategory).
export function summarizeFloodRows(rows, options = {}) {
  const zones = [...new Set(rows.map(r => field(r, 'FLD_ZONE')).filter(Boolean).map(z => String(z).trim()).filter(Boolean))];
  return {
    available: true, intersects: rows.length > 0, high: rows.some(isSfha), zones,
    zoneDetails: zoneDetails(rows), category: floodCategory(rows, options)
  };
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

// FEMA with one retry on retryable errors. Resolves rows (possibly empty: authoritative).
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
      throw new UpstreamError(`${error.message}; retry ${retryError.message}`, false, Boolean(retryError.browserFallback));
    }
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

  const answer = async (body, cacheable) => {
    if (cacheable && key) await writeCache(cache, key, body, ctx);
    return { status: 200, body };
  };

  const failures = [];
  let fallback = null;
  try {
    const rows = await fromFema(geometry);
    return await answer({ ...summarizeFloodRows(rows), source: { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER } }, true);
  } catch (error) {
    failures.push(`${FEMA_PROVIDER} ${error?.message || 'failed'}`);
    console.warn(`Flood source failed: ${FEMA_PROVIDER}`, error?.message);
    if (error?.browserFallback) fallback = { fallback: fallbackHint(FALLBACK_KINDS.femaFlood, { geometry: hintGeometry(geometry) }) };
  }
  // The hint is added after the cache write, so a cached answer never carries it.
  const withHint = async promise => { const result = await promise; return fallback ? { ...result, body: { ...result.body, ...fallback } } : result; };

  if (esriFallback) {
    try {
      const rows = await queryLayer(ESRI_USA_FLOOD_HAZARD_LAYER, geometry, '*', FALLBACK_TIMEOUT_MS);
      const source = { provider: ESRI_PROVIDER, url: ESRI_USA_FLOOD_HAZARD_LAYER, coverage: ESRI_COVERAGE };
      // Empty here means "not in a mapped high- or moderate-risk area", not "no flood zone":
      // keep the no-intersection shape for the frontend, flag it and never cache it.
      if (!rows.length) return await withHint(answer({ ...summarizeFloodRows(rows, { backup: true }), category: 'limited', source: { ...source, emptyResult: true } }, false));
      return await withHint(answer({ ...summarizeFloodRows(rows, { backup: true }), source }, true));
    } catch (error) {
      failures.push(`${ESRI_PROVIDER} ${error?.message || 'failed'}`);
      console.warn(`Flood source failed: ${ESRI_PROVIDER}`, error?.message);
    }
  }

  return { status: 502, body: { ...unavailableBody(`Flood data unavailable: ${failures.join('; ')}`), ...(fallback || {}) } };
}

export async function handleFlood(request, env, ctx) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const { status, body: result } = await floodScreening(body?.geometry, ctx);
  // emptyResult answers are partial-coverage: don't let the browser or edge hold on to them.
  if (status === 200 && result.source?.emptyResult) return json(result, 200, 'no-store');
  return status === 200 ? json(result) : json(result, status, 'no-store');
}
