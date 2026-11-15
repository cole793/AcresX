// Straight-line distance, in feet, from a parcel (outline, or its point when there is no outline)
// to mapped lines and points: power lines from OpenStreetMap, HIFLD and utility-published maps
// (src/utilities/osm-power.js, hifld-transmission.js, published-lines.js).
//
// A line that crosses the parcel, or a point inside it, is 0 ft away. Otherwise the distance is
// the shortest segment-to-segment distance between the line and the parcel edge. Coordinates are
// projected onto a local flat plane around the parcel (feet), accurate to well under 1% over a few
// miles. Copied in public/browser-fallback.js (kind 'osm-power'); test/power-distance.test.js
// checks both give the same answers. Change both together.

const FT_PER_DEG_LAT = 364000;
const MAX_PARCEL_VERTICES = 4000;

export function projector(lat0) {
  const kx = FT_PER_DEG_LAT * Math.cos(lat0 * Math.PI / 180);
  return ([lon, lat]) => [lon * kx, lat * FT_PER_DEG_LAT];
}

const finitePair = p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

// Polygon / MultiPolygon (or a Feature of one) -> rings of [lon, lat].
export function parcelRings(geometry) {
  const g = geometry?.type === 'Feature' ? geometry.geometry : geometry;
  let rings = [];
  if (g?.type === 'Polygon' && Array.isArray(g.coordinates)) rings = g.coordinates;
  else if (g?.type === 'MultiPolygon' && Array.isArray(g.coordinates)) rings = g.coordinates.flat();
  const out = [];
  let n = 0;
  for (const ring of rings) {
    if (!Array.isArray(ring)) continue;
    const clean = ring.filter(finitePair);
    if (clean.length < 3 || n + clean.length > MAX_PARCEL_VERTICES) continue;
    n += clean.length;
    out.push(clean);
  }
  return out;
}

function pointSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function segmentsCross(a, b, c, d) {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function segmentDistance(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}

// Even-odd rule over every ring (holes included).
function insideRings(p, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// Distance from segment a-b to an axis-aligned box (0 when it touches or enters the box). The
// parcel lies inside its bounding box, so this is a lower bound of the distance to the parcel and
// lets most segments be skipped without measuring against every parcel edge.
function segmentBoxDistance(a, b, r) {
  const inBox = p => p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minY && p[1] <= r.maxY;
  if (inBox(a) || inBox(b)) return 0;
  const c = [[r.minX, r.minY], [r.maxX, r.minY], [r.maxX, r.maxY], [r.minX, r.maxY]];
  return Math.min(segmentDistance(a, b, c[0], c[1]), segmentDistance(a, b, c[1], c[2]), segmentDistance(a, b, c[2], c[3]), segmentDistance(a, b, c[3], c[0]));
}

// A measurer for one parcel: the projection, edges and bounding box are built once and reused for
// every line. measurer.bound(path) is a cheap lower bound (distance to the parcel's bounding box);
// measurer.exact(path, below) the exact distance (stops early, returning a value >= below, once
// the line cannot be nearer than `below`). Both return feet, or Infinity for an empty path.
// Returns null when there is neither a usable outline nor a point.
export function parcelMeasurer({ lat, lon, geometry } = {}) {
  lat = Number(lat); lon = Number(lon);
  const rings = parcelRings(geometry);
  const lat0 = Number.isFinite(lat) ? lat : rings[0]?.[0]?.[1];
  if (!Number.isFinite(lat0)) return null;
  const project = projector(lat0);
  const projRings = rings.map(ring => ring.map(project));
  const edges = [];
  for (const ring of projRings) for (let i = 0; i < ring.length - 1; i++) edges.push([ring[i], ring[i + 1]]);
  const origin = Number.isFinite(lat) && Number.isFinite(lon) ? project([lon, lat]) : null;
  if (!edges.length && !origin) return null;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of edges.length ? projRings.flat() : [origin]) {
    box.minX = Math.min(box.minX, x); box.minY = Math.min(box.minY, y); box.maxX = Math.max(box.maxX, x); box.maxY = Math.max(box.maxY, y);
  }
  const segmentsOf = path => {
    const pts = (Array.isArray(path) ? path : []).filter(finitePair).map(project);
    return pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((b, i) => [pts[i], b]);
  };
  function bound(path) {
    let best = Infinity;
    for (const [a, b] of segmentsOf(path)) { best = Math.min(best, segmentBoxDistance(a, b, box)); if (best === 0) break; }
    return best;
  }
  function exact(path, below = Infinity) {
    let best = below;
    let found = Infinity;
    // Nearest-looking segments first; stop once the lower bound reaches the best so far.
    const ranked = segmentsOf(path).map(([a, b]) => ({ a, b, lb: segmentBoxDistance(a, b, box) })).sort((x, y) => x.lb - y.lb);
    for (const { a, b, lb } of ranked) {
      if (lb >= best) break;
      if (!edges.length) { const dist = pointSegment(origin, a, b); if (dist < best) best = found = dist; continue; }
      if (lb === 0 && (insideRings(a, projRings) || insideRings(b, projRings))) return 0;
      for (const [c, d] of edges) {
        const dist = segmentDistance(a, b, c, d);
        if (dist < best) best = found = dist;
        if (best === 0) return 0;
      }
    }
    return Number.isFinite(found) ? found : (ranked.length ? Math.max(below, ranked[0].lb) : Infinity);
  }
  return { bound, exact };
}

// paths: [[[lon, lat], ...], ...]; a single point is a path of one vertex.
// Returns the distance in feet (0 when touching or inside), or Infinity when there is nothing to
// measure.
export function distanceToParcelFt(paths, where = {}) {
  const m = parcelMeasurer(where);
  if (!m) return Infinity;
  let best = Infinity;
  for (const path of paths || []) best = Math.min(best, m.exact(path, best));
  return best;
}
