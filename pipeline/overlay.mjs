// Local spatial overlays for the inclusion rule (docs/explore-index.md sections 1-2): the county's
// city-limits polygons and the PAD-US Fee polygons are downloaded once per run, then each parcel
// is tested here with the report's own sample points (src/shared/polygon-coverage.js samplePoints:
// ~200 grid points inside the parcel) and the majority rule the adapters use.
//
// The point test is the even-odd rule of polygon-coverage.js pointInRings, indexed: each ring keeps
// its bbox and its edges bucketed by latitude, because the downloaded polygons are large (City of
// Spokane ~15,600 vertices; PAD-US state trust land as multipart features) and are tested against
// tens of thousands of parcels. A ring whose bbox does not hold the point cannot change the
// even-odd count, so it is skipped. test/index-pipeline.test.js checks it against pointInRings.
import { ringsFromGeometry, samplePoints } from '../src/shared/polygon-coverage.js';

const BUCKETS = 64;

function bboxOf(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return [minX, minY, maxX, maxY];
}
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// One ring: bbox plus edges (as pointInRings walks them: i, j = i - 1) bucketed by y.
function indexRing(ring) {
  const bbox = bboxOf([ring]);
  const n = ring.length;
  const buckets = Array.from({ length: BUCKETS }, () => []);
  const h = (bbox[3] - bbox[1]) || 1;
  const slot = y => Math.min(BUCKETS - 1, Math.max(0, Math.floor((y - bbox[1]) / h * BUCKETS)));
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = ring[i][1], yj = ring[j][1];
    for (let b = slot(Math.min(yi, yj)); b <= slot(Math.max(yi, yj)); b++) buckets[b].push(i);
  }
  return { ring, bbox, buckets, slot };
}

// The even-odd test of polygon-coverage.js pointInRings over indexed rings.
export function pointInIndexed(x, y, indexed) {
  let inside = false;
  for (const r of indexed) {
    const [x0, y0, x1, y1] = r.bbox;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const { ring } = r, n = ring.length;
    for (const i of r.buckets[r.slot(y)]) {
      const j = i === 0 ? n - 1 : i - 1;
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// [{ attributes, geometry }] (Esri JSON or GeoJSON) -> prepared polygons with a bbox and ring index.
export function preparePolygons(features) {
  return (Array.isArray(features) ? features : []).map(f => {
    const rings = ringsFromGeometry(f?.geometry);
    return rings ? { attributes: f.attributes || f.properties || {}, rings, bbox: bboxOf(rings), indexed: rings.map(indexRing) } : null;
  }).filter(Boolean);
}

// The parcel's sample points and bbox, computed once per parcel.
export function parcelSamples(geometry) {
  const rings = ringsFromGeometry(geometry);
  if (!rings) return null;
  return { rings, bbox: bboxOf(rings), samples: samplePoints(rings) };
}

const near = (prepared, parcel) => prepared.filter(p => overlaps(p.bbox, parcel.bbox));

// Shares of the parcel per key, as polygon-coverage.js coverageShares computes them
// ([{ key, share, attributes }], largest first; key null for uncovered points; a point in
// overlapping polygons counts for the first one). Only polygons whose bbox meets the parcel's.
export function sharesByKey(parcel, prepared, keyOf) {
  const candidates = near(prepared, parcel);
  if (!candidates.length) return [{ key: null, share: 1, attributes: null }];
  const counts = new Map();
  for (const [x, y] of parcel.samples) {
    const hit = candidates.find(p => pointInIndexed(x, y, p.indexed));
    const key = hit ? keyOf(hit.attributes || {}) : null;
    const entry = counts.get(key) || { key, count: 0, attributes: hit ? hit.attributes || {} : null };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].map(e => ({ key: e.key, share: e.count / parcel.samples.length, attributes: e.attributes })).sort((a, b) => b.share - a.share);
}

// Fraction of the parcel inside any of the polygons, and whether any touches it (a sample point
// or a parcel vertex inside one).
export function coverOf(parcel, prepared, accept = () => true) {
  const candidates = near(prepared, parcel).filter(p => accept(p.attributes));
  if (!candidates.length) return { share: 0, touches: false };
  const hits = parcel.samples.filter(([x, y]) => candidates.some(p => pointInIndexed(x, y, p.indexed))).length;
  const touches = hits > 0 || parcel.rings.some(ring => ring.some(([x, y]) => candidates.some(p => pointInIndexed(x, y, p.indexed))));
  return { share: hits / Math.max(1, parcel.samples.length), touches };
}
