// Parcel minus constraint polygons, without a geometry engine (for src/services/buildable-area.js).
//
// Same horizontal-strip method as stripAreas() in polygon-coverage.js: on each strip's centre line
// the parcel and every constraint polygon become x-intervals (even-odd rule, so holes and
// multi-part shapes work). Here the constraint groups are also unioned with each other, so an
// area that is both flood zone and wetland is removed once, and what is left on each line is the
// buildable part. Area uses the same spherical scale as stripAreas (good to about 0.5% for a
// parcel), so parcelSqM matches the flood share's parcelAcres.
//
// groups: { name: [rings, rings, ...] } (rings from ringsFromGeometry), in attribution order.
// options.setbackM > 0 adds a group named 'setback': every point within that distance of the
// parcel line (each edge swept by a disc, measured in a local metre frame).
//
// maskAreas() -> { parcelSqM, removedSqM, groups: { name: sqM in parcel }, added: { name: sqM
//   not already removed by an earlier group } }.
// maskGeometry() -> { buildable: MultiPolygon coordinates, removed: MultiPolygon coordinates,
//   strips, rects }: one rectangle per run of strips whose interval stays put (within ~0.75 m),
//   so a rectangular parcel is one rectangle and a diagonal edge is a fine staircase. Capped at
//   maxRects rectangles (fewer strips when over).
import { stripCrossings, intervalsOf, unionIntervals, DEFAULT_STRIPS } from './polygon-coverage.js';

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;
const M_PER_DEG = EARTH_RADIUS_M * DEG;
export const SETBACK_GROUP = 'setback';
export const MAX_GEOMETRY_RECTS = 1500;

export function intersectIntervals(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]), hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}

// a minus b; both sorted and disjoint.
export function subtractIntervals(a, b) {
  const out = [];
  let j = 0;
  for (const [a0, a1] of a) {
    let start = a0;
    while (j < b.length && b[j][1] <= start) j++;
    let k = j;
    while (k < b.length && b[k][0] < a1) {
      if (b[k][0] > start) out.push([start, b[k][0]]);
      start = Math.max(start, b[k][1]);
      if (start >= a1) break;
      k++;
    }
    if (start < a1) out.push([start, a1]);
  }
  return out;
}

const length = list => list.reduce((sum, [a, b]) => sum + (b - a), 0);

function boundsOf(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings || []) for (const [x, y] of ring) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

// The x-interval (metres) where the line y = c crosses the capsule of radius d around segment AB.
// The capsule is convex, so it is one interval: the two end discs plus the band along the segment.
export function capsuleLine(ax, ay, bx, by, d, c) {
  let lo = Infinity, hi = -Infinity;
  const disc = (px, py) => {
    const t = d * d - (c - py) * (c - py);
    if (t >= 0) { const w = Math.sqrt(t); lo = Math.min(lo, px - w); hi = Math.max(hi, px + w); }
  };
  disc(ax, ay); disc(bx, by);
  const len = Math.hypot(bx - ax, by - ay);
  if (len > 0) {
    const nx = -(by - ay) / len * d, ny = (bx - ax) / len * d;
    const quad = [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = quad[i], [x2, y2] = quad[(i + 1) % 4];
      if (c < Math.min(y1, y2) || c > Math.max(y1, y2)) continue;
      if (y1 === y2) { lo = Math.min(lo, x1, x2); hi = Math.max(hi, x1, x2); continue; }
      const x = x1 + (c - y1) * (x2 - x1) / (y2 - y1);
      lo = Math.min(lo, x); hi = Math.max(hi, x);
    }
  }
  return lo < hi ? [lo, hi] : null;
}

// Setback band on the line at latitude y (degrees), as longitude intervals.
function setbackSampler(parcelRings, setbackM) {
  const b = boundsOf(parcelRings);
  const lat0 = (b.minY + b.maxY) / 2, lon0 = (b.minX + b.maxX) / 2;
  const kx = M_PER_DEG * Math.cos(lat0 * DEG), ky = M_PER_DEG;
  const edges = [];
  for (const ring of parcelRings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = (ring[j][0] - lon0) * kx, ay = (ring[j][1] - lat0) * ky;
      const bx = (ring[i][0] - lon0) * kx, by = (ring[i][1] - lat0) * ky;
      edges.push([ax, ay, bx, by, Math.min(ay, by) - setbackM, Math.max(ay, by) + setbackM]);
    }
  }
  return y => {
    const c = (y - lat0) * ky;
    const parts = [];
    for (const [ax, ay, bx, by, lo, hi] of edges) {
      if (c < lo || c > hi) continue;
      const hit = capsuleLine(ax, ay, bx, by, setbackM, c);
      if (hit) parts.push([lon0 + hit[0] / kx, lon0 + hit[1] / kx]);
    }
    return unionIntervals([parts]);
  };
}

// Calls visit({ y, y0, y1, dy, parcel, covered }) for every strip that crosses the parcel;
// covered[g] is group g's union, clipped to the parcel. Returns the group names in order.
function scan(parcelRings, groups, { strips, setbackM = 0 }, visit) {
  const names = Object.keys(groups || {});
  const { minY, maxY } = boundsOf(parcelRings);
  if (!(maxY > minY)) return names;
  const count = Math.max(1, Math.round(strips));
  const dy = (maxY - minY) / count;
  const parcelLines = stripCrossings(parcelRings, minY, dy, count);
  const groupLines = names.map(name => (groups[name] || []).filter(Boolean).map(rings => stripCrossings(rings, minY, dy, count)));
  const setback = setbackM > 0 ? setbackSampler(parcelRings, setbackM) : null;
  for (let s = 0; s < count; s++) {
    const parcel = intervalsOf(parcelLines[s]);
    if (!parcel.length) continue;
    const y = minY + (s + 0.5) * dy;
    const covered = groupLines.map(lines => intersectIntervals(parcel, unionIntervals(lines.map(l => intervalsOf(l[s])))));
    if (setback) covered.push(intersectIntervals(parcel, setback(y)));
    visit({ y, y0: minY + s * dy, y1: minY + (s + 1) * dy, dy, parcel, covered });
  }
  return setback ? [...names, SETBACK_GROUP] : names;
}

export function maskAreas(parcelRings, groups = {}, { strips = DEFAULT_STRIPS, setbackM = 0 } = {}) {
  const names = [...Object.keys(groups), ...(setbackM > 0 ? [SETBACK_GROUP] : [])];
  const result = { parcelSqM: 0, removedSqM: 0, groups: Object.fromEntries(names.map(n => [n, 0])), added: Object.fromEntries(names.map(n => [n, 0])) };
  scan(parcelRings, groups, { strips, setbackM }, ({ y, dy, parcel, covered }) => {
    const scale = M_PER_DEG * Math.cos(y * DEG) * M_PER_DEG * dy;
    result.parcelSqM += length(parcel) * scale;
    let sofar = [];
    covered.forEach((list, g) => {
      result.groups[names[g]] += length(list) * scale;
      result.added[names[g]] += length(subtractIntervals(list, sofar)) * scale;
      sofar = unionIntervals([sofar, list]);
    });
    result.removedSqM += length(sofar) * scale;
  });
  return result;
}

const r6 = n => Math.round(n * 1e6) / 1e6;
const rectRing = ({ x0, x1, y0, y1 }) => [[[r6(x0), r6(y0)], [r6(x1), r6(y0)], [r6(x1), r6(y1)], [r6(x0), r6(y1)], [r6(x0), r6(y0)]]];

// Runs of strips with (nearly) the same interval become one rectangle.
function rectangles() {
  const done = [];
  let open = [];
  return {
    add(intervals, y0, y1, tol) {
      const next = [];
      for (const [a, b] of intervals) {
        const i = open.findIndex(r => Math.abs(r.x0 - a) <= tol && Math.abs(r.x1 - b) <= tol);
        if (i >= 0) { const r = open.splice(i, 1)[0]; r.y1 = y1; next.push(r); }
        else next.push({ x0: a, x1: b, y0, y1 });
      }
      done.push(...open);
      open = next;
    },
    finish() { done.push(...open); open = []; return done; }
  };
}

export function maskGeometry(parcelRings, groups = {}, { setbackM = 0, stripM = 1.5, minStrips = 30, maxStrips = 150, maxRects = MAX_GEOMETRY_RECTS } = {}) {
  const b = boundsOf(parcelRings);
  const heightM = (b.maxY - b.minY) * M_PER_DEG;
  const tol = 0.75 / (M_PER_DEG * Math.cos(((b.minY + b.maxY) / 2) * DEG) || 1);
  let strips = Math.max(minStrips, Math.min(maxStrips, Math.ceil(heightM / stripM)));
  for (;;) {
    const keep = rectangles(), cut = rectangles();
    scan(parcelRings, groups, { strips, setbackM }, ({ y0, y1, parcel, covered }) => {
      const removed = unionIntervals(covered);
      keep.add(subtractIntervals(parcel, removed), y0, y1, tol);
      cut.add(removed, y0, y1, tol);
    });
    const buildable = keep.finish(), removed = cut.finish();
    if (buildable.length + removed.length <= maxRects || strips <= 10) {
      return { buildable: buildable.map(rectRing), removed: removed.map(rectRing), strips, rects: buildable.length + removed.length };
    }
    strips = Math.max(10, Math.floor(strips / 2));
  }
}
