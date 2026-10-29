// Approximate how much of a parcel each ArcGIS polygon feature covers, without a geometry engine.
// ArcGIS MapServer queries can say which polygons intersect a parcel but not how much of it each
// covers, so we sample a regular grid of points inside the parcel and count which feature holds
// each point. A ~200-point grid resolves shares to about half a percent, which is plenty for
// "mostly AG, also partly RESTRICTED RESIDENTIAL" screening. Coordinates are lon/lat (WGS84).

function cleanRing(ring) {
  return Array.isArray(ring) ? ring.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
}

// Rings from an Esri polygon ({rings}) or a GeoJSON Polygon/MultiPolygon (or Feature). Holes and
// parts are returned together; pointInRings uses the even-odd rule, which handles both.
export function ringsFromGeometry(geometry) {
  const g = geometry?.type === 'Feature' ? geometry.geometry : geometry;
  let rings = [];
  if (Array.isArray(g?.rings)) rings = g.rings;
  else if (g?.type === 'Polygon' && Array.isArray(g.coordinates)) rings = g.coordinates;
  else if (g?.type === 'MultiPolygon' && Array.isArray(g.coordinates)) rings = g.coordinates.flat();
  rings = rings.map(cleanRing).filter(r => r.length >= 3);
  return rings.length ? rings : null;
}

export function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// Points on a regular grid (cells roughly square on the ground) that fall inside the parcel.
// An irregular parcel fills less of its bounding box, so the grid is refined until about
// `target` points land inside. A parcel too thin for the grid falls back to its vertex average,
// so there is always a sample.
export function samplePoints(rings, target = 200) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sx = 0, sy = 0, n = 0;
  for (const [x, y] of rings[0]) { sx += x; sy += y; n++; }
  for (const ring of rings) for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180) || 1;
  const w = (maxX - minX) * kx, h = maxY - minY;
  let points = [];
  if (w > 0 && h > 0) {
    let cells = target;
    for (let pass = 0; pass < 3; pass++) {
      const cell = Math.sqrt((w * h) / cells);
      const cols = Math.max(1, Math.min(80, Math.round(w / cell))), rows = Math.max(1, Math.min(80, Math.round(h / cell)));
      points = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = minX + (c + 0.5) * (maxX - minX) / cols, y = minY + (r + 0.5) * (maxY - minY) / rows;
        if (pointInRings(x, y, rings)) points.push([x, y]);
      }
      if (points.length >= target / 2) break;
      cells = Math.min(6400, cells * target / Math.max(points.length, target / 20));
    }
  }
  if (!points.length) points.push([sx / n, sy / n]);
  return points;
}

// Share of the sample points covered by each key (keyOf(attributes)). Returns
// [{ key, share, attributes }] sorted by share, largest first; points no feature covers are
// reported as key null. A point in overlapping features counts for the first one. Features
// without geometry can't be placed; if none has geometry, the first feature gets the whole parcel
// (the service said it intersects, which is all we know).
export function coverageShares(samples, features, keyOf) {
  const list = Array.isArray(features) ? features : [];
  const placed = list.map(f => ({ f, rings: ringsFromGeometry(f?.geometry) })).filter(x => x.rings);
  if (!placed.length) return list.length ? [{ key: keyOf(list[0]?.attributes || {}), share: 1, attributes: list[0]?.attributes || {} }] : [];
  const counts = new Map();
  for (const [x, y] of samples) {
    const hit = placed.find(p => pointInRings(x, y, p.rings));
    const key = hit ? keyOf(hit.f.attributes || {}) : null;
    const entry = counts.get(key) || { key, count: 0, attributes: hit ? hit.f.attributes || {} : null };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].map(e => ({ key: e.key, share: e.count / samples.length, attributes: e.attributes })).sort((a, b) => b.share - a.share);
}

export const pct = share => `${Math.round(share * 100)}%`;

// " Covers about 53% of the parcel; also partly X (about 20%); about 27% has no mapped county
// zone." Empty when one zone covers (nearly) all of it, so single-zone notes stay unchanged.
export function coverageNote(top, others, uncovered, what) {
  if (!others.length && top.share >= 0.95) return '';
  const parts = [`Covers about ${pct(top.share)} of the parcel`];
  if (others.length) parts.push(`also partly ${others.map(s => `${s.key} (about ${pct(s.share)})`).join(', ')}`);
  if (uncovered >= 0.05) parts.push(`about ${pct(uncovered)} has no mapped ${what}`);
  return ` ${parts.join('; ')}.`;
}
