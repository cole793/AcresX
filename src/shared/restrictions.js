// Shared helpers for the recorded-restrictions adapters (src/services/recorded-restrictions.js,
// src/counties/*-restrictions.js, src/states/montana/restrictions.js).
//
// - restrictionQuery(): every request goes through the shared upstream client
//   (src/shared/upstream.js) with one budget for all of these layers: 8 s, one retry at 5 s, the
//   body capped at RESTRICTIONS_MAX_BYTES (an oversized answer fails as kind 'too_large' and only
//   that source degrades), GET switching to a form POST past 1,800 characters.
// - Plats and surveys are matched by parcel ID where the layer has one, otherwise by ONE interior
//   point of the parcel (interiorPoint()). Intersecting the whole parcel polygon also returns the
//   neighbours' plats and surveys that only touch the boundary (seen live for Gallatin COS
//   1103B/H/L and Yellowstone's neighbouring lots), so polygon queries are used only for layers
//   whose overlap is measured (conservation easements, Spokane development agreements), and a
//   feature that covers no sample point of the parcel (it only touches an edge) is dropped there.
import { arcgisQuery } from './upstream.js';
import { ringsFromGeometry, pointInRings, samplePoints } from './polygon-coverage.js';

export const RESTRICTIONS_MAX_BYTES = 2_000_000;
export const RESTRICTIONS_TIMEOUT_MS = 8000;
export const RESTRICTIONS_RETRY_TIMEOUT_MS = 5000;
// Parcel outlines with more vertices than this are not used for polygon queries (the request
// would be too large); the adapters fall back to the interior point.
export const MAX_PARCEL_VERTICES = 4000;
// A feature must cover at least this share of the parcel's sample points to count as overlapping.
export const MIN_OVERLAP_SHARE = 0.01;

export function restrictionQuery(layerUrl, params, { agency, label, signal, timeoutMs = RESTRICTIONS_TIMEOUT_MS, retryTimeoutMs = RESTRICTIONS_RETRY_TIMEOUT_MS, maxBytes = RESTRICTIONS_MAX_BYTES } = {}) {
  return arcgisQuery(layerUrl, { returnGeometry: 'false', ...params }, {
    agency, label, signal, timeoutMs, retryTimeoutMs, maxBytes, maxGetUrlLength: 1800, retries: 1
  });
}

// Lon/lat rings of the parcel (GeoJSON Polygon/MultiPolygon/Feature or Esri rings), or null.
// Coordinates outside lon/lat ranges or outlines past MAX_PARCEL_VERTICES give null.
export function parcelRings(geometry) {
  const rings = ringsFromGeometry(geometry);
  if (!rings) return null;
  let count = 0;
  for (const ring of rings) {
    count += ring.length;
    for (const [x, y] of ring) if (Math.abs(x) > 180 || Math.abs(y) > 90) return null;
  }
  return count <= MAX_PARCEL_VERTICES ? rings : null;
}

// Squared distance from (px, py) to segment a-b, in a frame where x is scaled by kx.
function segmentDistance2(px, py, ax, ay, bx, by, kx) {
  const x = (px - ax) * kx, y = py - ay, dx = (bx - ax) * kx, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.max(0, Math.min(1, (x * dx + y * dy) / len)) : 0;
  const ex = x - t * dx, ey = y - t * dy;
  return ex * ex + ey * ey;
}

// One point well inside the parcel: of a grid of sample points inside it, the one farthest from
// every edge. A point near the middle of the widest part, never on a shared boundary, so a point
// query cannot pick up the neighbour's plat. Returns { lon, lat } or null.
export function interiorPoint(rings) {
  if (!rings) return null;
  const samples = samplePoints(rings, 150).filter(([x, y]) => pointInRings(x, y, rings));
  if (!samples.length) return null;
  const lat0 = samples.reduce((s, p) => s + p[1], 0) / samples.length;
  const kx = Math.cos(lat0 * Math.PI / 180) || 1;
  let best = null, bestD = -1;
  for (const [x, y] of samples) {
    let d = Infinity;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        d = Math.min(d, segmentDistance2(x, y, ring[j][0], ring[j][1], ring[i][0], ring[i][1], kx));
      }
    }
    if (d > bestD) { bestD = d; best = [x, y]; }
  }
  return best ? { lon: best[0], lat: best[1] } : null;
}

export function pointParams({ lon, lat }) {
  return {
    where: '1=1',
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false'
  };
}

// Polygon query that returns generalized outlines in lon/lat, so the overlap can be measured.
export function polygonParams(rings, { offset = '0.00002' } = {}) {
  return {
    where: '1=1',
    geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'true', outSR: '4326', maxAllowableOffset: offset, geometryPrecision: '6'
  };
}

// Share (0..1) of the parcel each feature covers, from ~300 sample points inside the parcel. A
// feature without geometry gets null (the server said it intersects; the share is unknown).
export function featureShares(rings, features) {
  const samples = rings ? samplePoints(rings, 300).filter(([x, y]) => pointInRings(x, y, rings)) : [];
  return (Array.isArray(features) ? features : []).map(feature => {
    const fr = ringsFromGeometry(feature?.geometry);
    if (!fr || !samples.length) return { feature, share: null };
    const hits = samples.filter(([x, y]) => pointInRings(x, y, fr)).length;
    return { feature, share: hits / samples.length };
  });
}

// Overlapping features only: share >= MIN_OVERLAP_SHARE, or unknown share (no geometry).
export function overlapping(rings, features) {
  return featureShares(rings, features).filter(x => x.share === null || x.share >= MIN_OVERLAP_SHARE);
}

export const sharePct = share => (typeof share === 'number' && Number.isFinite(share) ? Math.max(1, Math.round(share * 100)) : null);

// Trimmed single-line text, or null for blanks (" ", "<Null>", "0" placeholders) and long values.
export function text(value, max = 160) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (!s || /^(<null>|null|n\/a|none|0)$/i.test(s) || s.length > max) return null;
  return s;
}

// Epoch milliseconds (ArcGIS date) or "MM/DD/YYYY" / "YYYY/MM/DD" -> "YYYY-MM-DD", else null.
export function isoDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = text(value, 40);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

// https URL on one of `hosts`, without user info or port; else null.
export function httpsOn(value, hosts) {
  try {
    const u = new URL(String(value ?? '').trim());
    return u.protocol === 'https:' && hosts.includes(u.hostname) && !u.username && !u.password && !u.port ? u.href : null;
  } catch { return null; }
}

// A source's status line for the answer: { key, name, url, status: 'ok' | 'unavailable' }.
export function sourceStatus(key, name, url, error) {
  return error ? { key, name, url, status: 'unavailable' } : { key, name, url, status: 'ok' };
}

// Runs `task` and returns { value } or { error } (never throws), so one source failing degrades
// only itself.
export async function settle(task) {
  try { return { value: await task() }; } catch (error) { return { error: error || new Error('failed') }; }
}
