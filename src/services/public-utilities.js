// Public water and sewer screening for POST /api/public-utilities { state, county, lat, lon, geometry }.
//
// Owner decision (2026-11-09, "Swap to hookups"): when a parcel is in a public water and/or sewer
// service area, the report says "Public water/sewer likely available — verify with the
// city/district", swaps the well and/or septic cost line for a connection-fee planning range, and
// scores that factor as favorable (public/public-utilities.js). Water and sewer are independent.
//
// Answer (always HTTP 200 for a well-formed request):
//   { available, state, county,
//     water: Finding, sewer: Finding,
//     sources: [{ id, name, url, services, ok, error? }],   // every layer asked, in order
//     note, checkedAt }
//   Finding = { status, provider, basis, source: { name, url }, distanceM?, asOf?, others? }
//   status:
//     served       inside an official service-area / district polygon, or an official main within
//                  SERVED_MAX_M of the parcel outline
//     likely       a main SERVED_MAX_M..LIKELY_MAX_M from the outline, inside city/town limits
//                  where that city publishes no map for that utility, or a planning-only or stale
//                  layer (Gallatin's planning areas, Spokane County's 2021 sewer mains)
//     not_found    every layer for that service answered and none matched
//     unavailable  nothing matched and at least one layer for that service failed, or the county
//                  has no sources configured
//   A served/likely answer stays served/likely even when another layer failed (it carries
//   `incomplete: true` then, and the answer is not cached).
//
// Thresholds (checked live on 2026-11-09 against the 60 validation parcels, nearest main measured
// from the parcel outline): every in-town lot with a mapped main in the fronting street had one
// within 3.3-12.8 m (City of Spokane 9.1 sewer / 6.6 water, Cheney 9.5 / 6.2, Spokane County
// sewer 4.7 in Spokane Valley, Coeur d'Alene 6.9 and 11.4 sewer / 12.8 and 4.2 water, Bozeman
// 3.3 and 12.6 sewer / 12.0 and 8.5 water), and no rural parcel had any main within 300 m. A
// main in the street a lot fronts sits about half the right-of-way width from the lot line
// (60 ft ROW ~9 m, 100 ft arterial ~15 m), so 30 m is more than twice the largest observed
// value and still covers wide arterials plus a few metres of GIS offset. 30-100 m is a main at
// the end of the block or across an intersection: a connection is plausible but may need a line
// extension, so "likely". Past 100 m an extension is a project of its own (City of Spokane mains
// were 233 m from the Spokane Valley test lot, across the city line), so it does not count.
//
// Requests: one query per configured layer, all in parallel, through the shared upstream client
// (src/shared/arcgis.js: per-host cap, one retry, log line per attempt, no `cf` caching), named
// outFields only (never contact, owner or address fields), and the answer still passes through
// withoutPersonalFields(). At most 8 layers per county (Spokane), so at most 16 subrequests with
// retries. Main queries ask the server for mains within MAINS_QUERY_M of the outline (more than
// LIKELY_MAX_M, because some servers buffer in Web Mercator, where 100 "metres" is about 67 m on
// the ground at 48 N), then measure the real distance here. Answers where every layer answered
// are cached for a day (Cache API, keyed by the rounded request); others are not.
import { json } from '../shared/http.js';
import { arcgisQuery } from '../shared/arcgis.js';
import { cachedJson } from '../shared/upstream.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { ringsFromGeometry, pointInRings } from '../shared/polygon-coverage.js';
import { SPOKANE_UTILITIES } from '../counties/spokane-utilities.js';
import { STEVENS_UTILITIES } from '../counties/stevens-utilities.js';
import { KOOTENAI_UTILITIES } from '../counties/kootenai-utilities.js';
import { GALLATIN_UTILITIES } from '../counties/gallatin-utilities.js';
import { YELLOWSTONE_UTILITIES } from '../counties/yellowstone-utilities.js';

export const SERVED_MAX_M = 30;
export const LIKELY_MAX_M = 100;
export const MAINS_QUERY_M = 160;
export const SERVICES = Object.freeze(['water', 'sewer']);
export const PUBLIC_UTILITIES_CACHE_PREFIX = 'https://acresx.internal/cache/public-utilities/v1/';
const CACHE_TTL_SECONDS = 86400;
const QUERY_TIMEOUTS = { timeoutMs: 8000, retryTimeoutMs: 6000 };
const MAINS_RECORD_LIMIT = 200;

export const COUNTY_UTILITIES = {
  'WA:SPOKANE': SPOKANE_UTILITIES,
  'WA:STEVENS': STEVENS_UTILITIES,
  'ID:KOOTENAI': KOOTENAI_UTILITIES,
  'MT:GALLATIN': GALLATIN_UTILITIES,
  'MT:YELLOWSTONE': YELLOWSTONE_UTILITIES
};

export const SCREENING_NOTE = 'Public water/sewer screening from official service-area, district and main maps. Public water/sewer likely available where shown — verify availability, capacity and connection fees with the city or district.';

const text = value => (value == null ? '' : String(value).replace(/\s+/g, ' ').trim());
const RANK = { served: 2, likely: 1 };

// ---- Distance from a main (polyline) to the parcel outline, in metres.

function projector(lat0) {
  const k = Math.cos(lat0 * Math.PI / 180);
  return ([x, y]) => [x * 111320 * k, y * 110540];
}

function pointSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function segmentsCross(a, b, c, d) {
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// paths: Esri polyline paths ([[lon, lat], ...] lists). target: { rings } (parcel outline) or
// { point: [lon, lat] }. 0 when the main crosses or lies inside the parcel.
export function distanceToParcelM(paths, target) {
  const lat0 = target.point ? target.point[1] : target.rings[0][0][1];
  const P = projector(lat0);
  const lines = (paths || []).map(path => (path || []).filter(p => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])).map(P)).filter(path => path.length);
  if (!lines.length) return null;
  if (target.point) {
    const q = P(target.point);
    let best = Infinity;
    for (const path of lines) {
      if (path.length === 1) best = Math.min(best, Math.hypot(path[0][0] - q[0], path[0][1] - q[1]));
      for (let i = 1; i < path.length; i++) best = Math.min(best, pointSegment(q, path[i - 1], path[i]));
    }
    return best;
  }
  const rings = target.rings.map(ring => ring.map(P));
  let best = Infinity;
  for (const path of lines) {
    for (const p of path) {
      if (pointInRings(p[0], p[1], rings)) return 0;
      for (const ring of rings) for (let i = 1; i < ring.length; i++) best = Math.min(best, pointSegment(p, ring[i - 1], ring[i]));
    }
    for (let i = 1; i < path.length; i++) {
      for (const ring of rings) {
        for (let j = 1; j < ring.length; j++) {
          if (segmentsCross(path[i - 1], path[i], ring[j - 1], ring[j])) return 0;
        }
        for (const v of ring) best = Math.min(best, pointSegment(v, path[i - 1], path[i]));
      }
    }
  }
  return Number.isFinite(best) ? best : null;
}

// ---- Queries

function pointParams({ lon, lat }) {
  return {
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPoint',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false'
  };
}

function mainsParams(target) {
  const geometry = target.rings
    ? { geometry: JSON.stringify({ rings: target.rings, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPolygon' }
    : { geometry: JSON.stringify({ x: target.point[0], y: target.point[1], spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPoint' };
  return {
    ...geometry, inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: String(MAINS_QUERY_M), units: 'esriSRUnit_Meter',
    returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', resultRecordCount: String(MAINS_RECORD_LIMIT)
  };
}

const sourceRef = source => ({ name: source.name, url: source.url });

// One finding for a mains layer: the nearest main within LIKELY_MAX_M, or none.
export function mainsFinding(source, features, target) {
  let nearest = null;
  for (const f of features || []) {
    const d = distanceToParcelM(f?.geometry?.paths, target);
    if (d != null && (nearest == null || d < nearest)) nearest = d;
  }
  if (nearest == null || nearest > LIKELY_MAX_M) return [];
  const distanceM = Math.round(nearest);
  let status = nearest <= SERVED_MAX_M ? 'served' : 'likely';
  if (source.maxStatus === 'likely') status = 'likely';
  const where = distanceM === 0 ? 'crosses or touches the parcel' : `${distanceM} m from the parcel${target.rings ? '' : ' point'}`;
  const basis = `${source.mainLabel} ${where}${source.asOf ? ` (map as of ${source.asOf}${source.maxStatus === 'likely' ? '; older map, so not counted as served' : ''})` : ''}`;
  return [{ service: source.services[0], status, provider: source.provider, basis, source: sourceRef(source), distanceM, ...(source.asOf ? { asOf: source.asOf } : {}) }];
}

async function runSource(source, ctx) {
  const opts = { ...QUERY_TIMEOUTS, agency: source.agency, label: `utilities:${source.id}` };
  if (source.kind === 'mains') {
    const features = await arcgisQuery(source.url, { where: source.where || '1=1', outFields: source.outFields, ...mainsParams(ctx.target) }, opts);
    return mainsFinding(source, withoutPersonalFields(features), ctx.target);
  }
  const features = await arcgisQuery(source.url, { where: source.where || '1=1', outFields: source.outFields, ...pointParams(ctx) }, opts);
  const attrs = withoutPersonalFields(features).map(f => f?.attributes || {});
  return (source.read(attrs, ctx) || []).map(f => ({ source: sourceRef(source), ...f }));
}

// Best finding per service: served over likely; then the nearest main (a measured main says more
// than an area polygon); then a current map over a dated one (asOf).
export function decideService(service, findings, sources, results) {
  const relevant = sources.map((s, i) => ({ s, r: results[i] })).filter(x => x.s.services.includes(service));
  const failed = relevant.filter(x => x.r.status !== 'fulfilled');
  const hits = findings.filter(f => f.service === service && RANK[f.status]);
  if (hits.length) {
    const dist = f => (f.distanceM == null ? Infinity : f.distanceM);
    hits.sort((a, b) => RANK[b.status] - RANK[a.status] || dist(a) - dist(b) || Number(Boolean(a.asOf)) - Number(Boolean(b.asOf)));
    const [best, ...rest] = hits;
    const { service: _s, ...finding } = best;
    const others = rest.filter(o => o.provider && o.provider !== best.provider).map(o => ({ status: o.status, provider: o.provider, basis: o.basis }));
    return { ...finding, ...(others.length ? { others } : {}), ...(failed.length ? { incomplete: true } : {}) };
  }
  if (!relevant.length) return { status: 'unavailable', provider: null, basis: `No public ${service} source is configured for this county.`, source: null };
  if (failed.length) {
    return {
      status: 'unavailable', provider: null,
      basis: `${failed.map(x => x.s.name).join(', ')} did not answer, so public ${service} could not be checked.`,
      source: sourceRef(failed[0].s)
    };
  }
  return {
    status: 'not_found', provider: null,
    basis: `No public ${service} service area, district or main found near the parcel (checked: ${relevant.map(x => x.s.name).join('; ')}).`,
    source: sourceRef(relevant[0].s)
  };
}

export function countyConfig(state, county) {
  return COUNTY_UTILITIES[`${text(state).toUpperCase()}:${text(county).replace(/\s+County$/i, '').toUpperCase()}`] || null;
}

function targetOf(geometry, lon, lat) {
  const rings = ringsFromGeometry(geometry);
  return rings ? { rings } : { point: [lon, lat] };
}

export async function lookupPublicUtilities({ state, county, lat, lon, geometry }, { config = countyConfig(state, county), now = Date.now() } = {}) {
  const base = { state: text(state).toUpperCase(), county: text(county).replace(/\s+County$/i, '') };
  if (!config) {
    const none = service => ({ status: 'unavailable', provider: null, basis: `Public ${service} screening is not configured for this county yet.`, source: null });
    return { available: false, ...base, water: none('water'), sewer: none('sewer'), sources: [], note: SCREENING_NOTE, checkedAt: new Date(now).toISOString() };
  }
  const ctx = { lat, lon, target: targetOf(geometry, lon, lat), now };
  const results = await Promise.allSettled(config.sources.map(source => runSource(source, ctx)));
  const findings = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
  const sources = config.sources.map((s, i) => ({
    id: s.id, name: s.name, url: s.url, services: s.services, ok: results[i].status === 'fulfilled',
    ...(results[i].status === 'fulfilled' ? {} : { error: text(results[i].reason?.message) || 'request failed' })
  }));
  return withoutPersonalFields({
    available: true, ...base, county: config.county,
    water: decideService('water', findings, config.sources, results),
    sewer: decideService('sewer', findings, config.sources, results),
    sources, note: SCREENING_NOTE, checkedAt: new Date(now).toISOString()
  });
}

export const isComplete = answer => Boolean(answer?.available) && Array.isArray(answer.sources) && answer.sources.every(s => s.ok);

export async function handlePublicUtilities(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'A JSON body is required.' }, 400, 'no-store'); }
  const lat = Number(body?.lat), lon = Number(body?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'lat and lon are required.' }, 400, 'no-store');
  const input = { state: body.state, county: body.county, lat, lon, geometry: body.geometry || null };
  const config = countyConfig(input.state, input.county);
  if (!config) return json(await lookupPublicUtilities(input, { config: null }), 200, 'no-store');
  const key = { state: config.state, county: config.county, lat, lon, geometry: input.geometry };
  const answer = await cachedJson(PUBLIC_UTILITIES_CACHE_PREFIX, key, CACHE_TTL_SECONDS, () => lookupPublicUtilities(input, { config }), { isValid: isComplete, ctx });
  return json(answer, 200, isComplete(answer) ? 'public, max-age=3600' : 'no-store');
}
