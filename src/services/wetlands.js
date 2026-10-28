// Wetland screening for POST /api/hazards { kind: 'wetlands', geometry }.
//
// Response shape (keys and meanings unchanged; category, overlapAcres, nearby and overlapCount added):
//   { available, intersects, count, types, coveragePct, wetlandAcres, parcelAcres, coverageMethod,
//     coverageEstimated?, category, overlapAcres, nearby, overlapCount }
// intersects/count/types: USFWS NWI polygons that intersect the parcel polygon (touching counts).
// coveragePct/wetlandAcres: NWI area clipped to the parcel; null when it could not be measured.
// category (see wetlandCategory()):
//   present     the clipped overlap is meaningful: >= PRESENT_MIN_ACRES, or >= PRESENT_MIN_PCT of
//               the parcel and >= PRESENT_FLOOR_ACRES
//   nearby      NWI polygons touch the parcel, but the overlap is below that (boundary slivers)
//   none        no NWI polygon intersects the parcel
//   unmeasured  NWI polygons intersect, but the clip service failed, so the overlap is unknown
// overlapAcres: same number as wetlandAcres. nearby: category === 'nearby'.
// overlapCount: NWI polygons with any clipped area inside the parcel (null when unmeasured).
// On NWI failure: HTTP 502 with
//   { available: false, intersects: false, count: 0, types: [], error, category: 'unavailable' }
//
// Request plan (at most 4 upstream requests, worst case 8 + 0.5 + 6 + 5 + 0.5 + 4 = 24 s):
//   1. NWI layer 0 query (exact parcel polygon, esriSpatialRelIntersects), one retry on
//      5xx / network error / timeout / invalid JSON / ArcGIS non-4xx error.
//   2. If any feature intersects: Esri GeometryServer intersect to clip the NWI polygons to the
//      parcel, with the same single retry. If it still fails, the answer is 'unmeasured'.
// Queries go as GET, or as a form-encoded POST when the URL would be too long. No request carries
// `cf` edge-cache options (ArcGIS errors arrive as HTTP 200 bodies). Measured answers (present,
// nearby, none) are kept in the Workers Cache API for 7 days, keyed by a hash of the rounded
// parcel geometry; 'unmeasured' and failures never are. The cache is skipped where `caches` does
// not exist (Node tests).
import { fetchWithTimeout, json } from '../shared/http.js';
import { openGeometryCache, readCachedJson, writeCachedJson } from '../shared/edge-cache.js';

export const NWI_LAYER = 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0';
export const GEOMETRY_SERVER = 'https://utility.arcgisonline.com/ArcGIS/rest/services/Geometry/GeometryServer/intersect';
const EARTH_RADIUS_M = 6378137;
const SQM_PER_ACRE = 4046.8564224;

export const NWI_TIMEOUT_MS = 8000;
export const NWI_RETRY_TIMEOUT_MS = 6000;
export const INTERSECT_TIMEOUT_MS = 5000;
export const INTERSECT_RETRY_TIMEOUT_MS = 4000;
export const RETRY_BACKOFF_MS = 500;
export const MAX_GET_URL_LENGTH = 3500;

// "Present" needs a meaningful overlap. NWI is mapped from imagery at about 1:24,000, so a few
// square metres along a parcel line is digitizing noise, not a wetland on the parcel.
export const PRESENT_MIN_ACRES = 0.05; // ~2,180 sq ft
export const PRESENT_MIN_PCT = 0.5; // percent of the parcel ...
export const PRESENT_FLOOR_ACRES = 0.01; // ... but never less than ~435 sq ft
export const WETLAND_CATEGORIES = ['present', 'unmeasured', 'nearby', 'none'];

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const CACHE_KEY_PREFIX = 'https://acresx.internal/cache/wetlands/v1/';
const HEADERS = { 'User-Agent': 'AcresX/0.5.2' };

class UpstreamError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

// Planar shoelace on lon/lat: > 0 means counter-clockwise. Only the sign is used.
function planarSignedArea(ring) {
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    total += x1 * y2 - x2 * y1;
  }
  return total;
}

const oriented = (ring, clockwise) => ((planarSignedArea(ring) < 0) === clockwise ? ring : [...ring].reverse());

// Esri polygon from GeoJSON: outer rings clockwise, holes counter-clockwise (the Esri rule;
// GeoJSON outer rings are usually counter-clockwise and would otherwise read as holes).
export function esriParcel(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type) || !Array.isArray(geometry.coordinates)) {
    throw new Error('Wetland analysis requires parcel polygon geometry.');
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings = polygons.flatMap(polygon => (polygon || []).filter(r => Array.isArray(r) && r.length >= 3).map((ring, i) => oriented(ring, i === 0)));
  if (!rings.length) throw new Error('Wetland analysis requires parcel polygon geometry.');
  return { rings, spatialReference: { wkid: 4326 } };
}

function signedRingAreaSqM(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    const lon1 = Number(p1?.[0]) * Math.PI / 180;
    const lon2 = Number(p2?.[0]) * Math.PI / 180;
    const lat1 = Number(p1?.[1]) * Math.PI / 180;
    const lat2 = Number(p2?.[1]) * Math.PI / 180;
    if (![lon1, lon2, lat1, lat2].every(Number.isFinite)) continue;
    let dLon = lon2 - lon1;
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    if (dLon < -Math.PI) dLon += 2 * Math.PI;
    total += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2;
}

function esriPolygonAreaSqM(polygon) {
  const signed = (polygon?.rings || []).reduce((sum, ring) => sum + signedRingAreaSqM(ring), 0);
  return Math.abs(signed);
}

function geoJsonAreaSqM(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  let total = 0;
  for (const polygon of polygons) {
    if (!polygon?.length) continue;
    total += Math.abs(signedRingAreaSqM(polygon[0]));
    for (const hole of polygon.slice(1)) total -= Math.abs(signedRingAreaSqM(hole));
  }
  return Math.max(0, total);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// GET for short NWI queries, form-encoded POST when the URL would be too long.
export function buildNwiRequest(geometry) {
  const params = new URLSearchParams({
    f: 'json', where: '1=1', geometry: JSON.stringify(esriParcel(geometry)), geometryType: 'esriGeometryPolygon',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outSR: '4326', outFields: 'WETLAND_TYPE,ATTRIBUTE',
    returnGeometry: 'true', resultRecordCount: '500'
  });
  const getUrl = `${NWI_LAYER}/query?${params}`;
  if (getUrl.length <= MAX_GET_URL_LENGTH) return { url: getUrl, init: { method: 'GET', headers: HEADERS } };
  return {
    url: `${NWI_LAYER}/query`,
    init: { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }
  };
}

// The GeometryServer `geometry` parameter must be wrapped as { geometryType, geometry }. A bare
// Esri polygon (what this module sent before 2026-10-27) fails with "Syntax error in JSON
// geometry representation", so every clip failed and coverage was always null.
export function buildIntersectRequest(nwiGeometries, geometry) {
  const { rings } = esriParcel(geometry);
  const params = new URLSearchParams({
    f: 'json', sr: '4326',
    geometries: JSON.stringify({ geometryType: 'esriGeometryPolygon', geometries: nwiGeometries }),
    geometry: JSON.stringify({ geometryType: 'esriGeometryPolygon', geometry: { rings } })
  });
  return {
    url: GEOMETRY_SERVER,
    init: { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }
  };
}

async function arcgisJson({ url, init }, timeoutMs) {
  let response;
  try {
    response = await fetchWithTimeout(url, init, timeoutMs);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    throw new UpstreamError(timedOut ? `timeout after ${Math.round(timeoutMs / 1000)}s` : (error?.message || 'network error'), true);
  }
  if (!response.ok) throw new UpstreamError(`returned ${response.status}`, response.status >= 500);
  let data;
  try { data = await response.json(); } catch { throw new UpstreamError('returned invalid JSON', true); }
  if (data?.error) {
    const code = Number(data.error.code);
    throw new UpstreamError(`ArcGIS error${Number.isFinite(code) ? ` ${code}` : ''}: ${data.error.message || 'request failed'}`, !(code >= 400 && code < 500));
  }
  return data;
}

// One attempt, then one retry after a short pause if the failure was retryable.
async function withRetry(makeRequest, timeoutMs, retryTimeoutMs) {
  try {
    return await arcgisJson(makeRequest(), timeoutMs);
  } catch (error) {
    if (!error.retryable) throw error;
    await sleep(RETRY_BACKOFF_MS);
    try {
      return await arcgisJson(makeRequest(), retryTimeoutMs);
    } catch (retryError) {
      throw new UpstreamError(`${error.message}; retry ${retryError.message}`, false);
    }
  }
}

async function queryNwi(geometry) {
  const data = await withRetry(() => buildNwiRequest(geometry), NWI_TIMEOUT_MS, NWI_RETRY_TIMEOUT_MS);
  if (!Array.isArray(data?.features)) throw new UpstreamError('NWI answer had no features list', false);
  return data.features;
}

// Clipped polygons, one per input geometry (empty rings where a polygon only touches the parcel).
async function intersectWithParcel(nwiGeometries, geometry) {
  const data = await withRetry(() => buildIntersectRequest(nwiGeometries, geometry), INTERSECT_TIMEOUT_MS, INTERSECT_RETRY_TIMEOUT_MS);
  if (!Array.isArray(data?.geometries)) throw new UpstreamError('intersect answer had no geometries', false);
  return data.geometries;
}

// The category for a measured overlap (acres and percent of the parcel).
export function wetlandCategory({ intersects, overlapAcres, coveragePct }) {
  if (!intersects) return 'none';
  const acres = Number(overlapAcres);
  const pct = Number(coveragePct);
  if (overlapAcres == null || !Number.isFinite(acres)) return 'unmeasured';
  if (acres >= PRESENT_MIN_ACRES) return 'present';
  if (coveragePct != null && Number.isFinite(pct) && pct >= PRESENT_MIN_PCT && acres >= PRESENT_FLOOR_ACRES) return 'present';
  return 'nearby';
}

const cacheable = body => body?.available === true && ['present', 'nearby', 'none'].includes(body.category);

const unavailableBody = error => ({ available: false, intersects: false, count: 0, types: [], error, category: 'unavailable' });

async function measure(geometry) {
  const features = await queryNwi(geometry);
  const types = [...new Set(features.map(f => f.attributes?.WETLAND_TYPE || f.attributes?.ATTRIBUTE).filter(Boolean))];
  const parcelSqM = geoJsonAreaSqM(geometry);
  const parcelAcres = parcelSqM / SQM_PER_ACRE;

  if (!features.length) {
    return {
      available: true, intersects: false, count: 0, types: [], coveragePct: 0, wetlandAcres: 0, parcelAcres,
      coverageMethod: 'NWI polygon intersection', category: 'none', overlapAcres: 0, nearby: false, overlapCount: 0
    };
  }

  const nwiGeometries = features.map(f => f.geometry).filter(g => Array.isArray(g?.rings));
  let clipped = null;
  if (nwiGeometries.length) {
    try {
      clipped = await intersectWithParcel(nwiGeometries, geometry);
    } catch (error) {
      console.warn('NWI parcel intersection failed; returning presence without coverage.', error?.message);
    }
  }

  if (!clipped) {
    return {
      available: true, intersects: true, count: features.length, types, coveragePct: null, wetlandAcres: null, parcelAcres,
      coverageMethod: 'NWI intersection presence only', coverageEstimated: true,
      category: 'unmeasured', overlapAcres: null, nearby: false, overlapCount: null
    };
  }

  const areas = clipped.map(esriPolygonAreaSqM);
  const wetlandSqM = areas.reduce((sum, a) => sum + a, 0);
  const wetlandAcres = wetlandSqM / SQM_PER_ACRE;
  const coveragePct = parcelSqM > 0 ? Math.min(100, wetlandSqM / parcelSqM * 100) : null;
  const category = wetlandCategory({ intersects: true, overlapAcres: wetlandAcres, coveragePct });
  return {
    available: true, intersects: true, count: features.length, types, coveragePct, wetlandAcres, parcelAcres,
    coverageMethod: 'NWI polygons clipped to parcel', coverageEstimated: false,
    category, overlapAcres: wetlandAcres, nearby: category === 'nearby', overlapCount: areas.filter(a => a > 0).length
  };
}

// Returns { status, body } and never throws, so src/index.js never falls through to legacy code.
export async function wetlandsScreening(geometry, ctx) {
  try { esriParcel(geometry); } catch (error) {
    return { status: 400, body: { ...unavailableBody(error.message), error: 'Parcel geometry is required.' } };
  }
  const slot = await openGeometryCache(CACHE_KEY_PREFIX, geometry);
  const cached = await readCachedJson(slot);
  if (cacheable(cached)) return { status: 200, body: cached };

  try {
    const body = await measure(geometry);
    if (cacheable(body)) await writeCachedJson(slot, body, CACHE_TTL_SECONDS, ctx);
    return { status: 200, body };
  } catch (error) {
    console.warn('Wetlands source failed: USFWS NWI', error?.message);
    return { status: 502, body: unavailableBody(`Wetland data unavailable: USFWS NWI ${error?.message || 'failed'}`) };
  }
}

export async function handleWetlands(request, env, ctx) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const { status, body: result } = await wetlandsScreening(body?.geometry, ctx);
  if (status !== 200) return json(result, status, 'no-store');
  // An unmeasured answer may measure on the next try: don't let the browser or edge keep it.
  return json(result, 200, result.category === 'unmeasured' ? 'no-store' : 'public, max-age=3600, s-maxage=86400');
}
