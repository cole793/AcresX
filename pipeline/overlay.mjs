// Local spatial overlays for the inclusion rule (docs/explore-index.md sections 1-2): the county's
// city-limits polygons and the PAD-US Fee polygons are downloaded once per run, then each parcel
// is tested here with the report's own sampling code (src/shared/polygon-coverage.js: ~200 grid
// points inside the parcel) and the majority rule the adapters use.
import { ringsFromGeometry, samplePoints, coverageShares, pointInRings } from '../src/shared/polygon-coverage.js';

function bboxOf(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return [minX, minY, maxX, maxY];
}
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// [{ attributes, geometry }] (Esri JSON or GeoJSON) -> prepared polygons with a bbox each.
export function preparePolygons(features) {
  return (Array.isArray(features) ? features : []).map(f => {
    const rings = ringsFromGeometry(f?.geometry);
    return rings ? { attributes: f.attributes || f.properties || {}, rings, bbox: bboxOf(rings) } : null;
  }).filter(Boolean);
}

// The parcel's sample points and bbox, computed once per parcel.
export function parcelSamples(geometry) {
  const rings = ringsFromGeometry(geometry);
  if (!rings) return null;
  return { rings, bbox: bboxOf(rings), samples: samplePoints(rings) };
}

const near = (prepared, parcel) => prepared.filter(p => overlaps(p.bbox, parcel.bbox));

// Shares of the parcel per key (coverageShares: [{ key, share, attributes }], largest first;
// key null for uncovered points). Only polygons whose bbox meets the parcel's are tested.
export function sharesByKey(parcel, prepared, keyOf) {
  const candidates = near(prepared, parcel).map(p => ({ attributes: p.attributes, geometry: { rings: p.rings } }));
  if (!candidates.length) return [{ key: null, share: 1, attributes: null }];
  return coverageShares(parcel.samples, candidates, keyOf);
}

// Fraction of the parcel inside any of the polygons, and whether any touches it (a sample point
// or a parcel vertex inside one).
export function coverOf(parcel, prepared, accept = () => true) {
  const candidates = near(prepared, parcel).filter(p => accept(p.attributes));
  if (!candidates.length) return { share: 0, touches: false, attributes: [] };
  const hits = parcel.samples.filter(([x, y]) => candidates.some(p => pointInRings(x, y, p.rings))).length;
  const vertexHit = !hits && parcel.rings.some(ring => ring.some(([x, y]) => candidates.some(p => pointInRings(x, y, p.rings))));
  const touching = candidates.filter(p => parcel.samples.some(([x, y]) => pointInRings(x, y, p.rings)) || parcel.rings.some(ring => ring.some(([x, y]) => pointInRings(x, y, p.rings))));
  return { share: hits / Math.max(1, parcel.samples.length), touches: hits > 0 || vertexHit, attributes: touching.map(p => p.attributes) };
}
