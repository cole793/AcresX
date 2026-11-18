// Ground elevation at scattered points (a homesite and the wells around it), for the
// terrain-aware well depth estimate (src/services/well-depth-terrain.js). Kept small and separate
// from the parcel terrain / slope-grid lookups (elevation.js), which sample a dense grid inside
// one parcel; any later lookup of scattered points can reuse it.
//
// Sources, in order, against one budget:
//   1. AWS Terrain Tiles (src/services/terrain-tiles.js, the 2017 S3 copy of USGS 3DEP 1/3"),
//      fetched and decoded by terrainTileSamplesFt and shared through its per-isolate tile memo.
//      Wells spread over miles, so the points are grouped by the zoom-12 tile they fall in
//      (~6.8 km wide at 46 deg N); each group is one terrainTileSamplesFt call (1-4 tiles, zoom
//      13-14). Groups are taken in point order (the caller puts the homesite first, then the
//      wells nearest first) until POINT_TILE_BUDGET tiles are used.
//   2. USGS 3DEP ImageServer getSamples (elevation.js getSamples), one request for every point
//      the tiles did not answer (a group over the tile budget, a failed tile, a NoData pixel).
// The two sources hold the same 3DEP raster (the tiles can sit up to ~15 ft off where 3DEP has
// newer lidar, measured 2026-11-07); `from` names the source of each value. Never rejects.
import { ELEVATION_IMAGE_SERVICE, ELEVATION_MAX_PER_HOST, getSamples } from './elevation.js';
import { pixelAt, terrainTileSamplesFt, tileZoomFor, TERRAIN_TILE_SIZE } from './terrain-tiles.js';

export const POINT_TILE_GROUP_ZOOM = 12;
export const POINT_TILE_BUDGET = 8;
export const POINT_ELEVATION_BUDGET_MS = 7000;
export const POINT_GET_SAMPLES_MAX_MS = 6000;
export const POINT_SOURCES = Object.freeze({ tiles: 'terrain-tiles', usgs: '3dep-getsamples' });
const METERS_TO_FEET = 3.280839895;

const tileOf = (p, z) => {
  const { x, y } = pixelAt(p.lon, p.lat, z);
  return `${Math.floor(x / TERRAIN_TILE_SIZE)}/${Math.floor(y / TERRAIN_TILE_SIZE)}`;
};
const tilesAt = (points, z) => new Set(points.map(p => tileOf(p, z))).size;

// points: [{ lon, lat }]. Resolves { values: (feet|null)[], from: (source|null)[], tiles: tiles
// requested, errors: { [source]: first message } }.
export async function pointElevationsFt(points, { budgetMs = POINT_ELEVATION_BUDGET_MS, tileBudget = POINT_TILE_BUDGET, signal } = {}) {
  const deadline = Date.now() + budgetMs;
  const remaining = () => deadline - Date.now();
  const values = points.map(() => null);
  const from = points.map(() => null);
  const errors = {};
  const note = (source, error) => { if (!errors[source]) errors[source] = error?.message || String(error); };
  if (!points.length) return { values, from, tiles: 0, errors };

  // 1. Terrain tiles, grouped by zoom-12 tile, within the tile budget.
  const groups = new Map();
  points.forEach((p, i) => {
    const key = tileOf(p, POINT_TILE_GROUP_ZOOM);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  let used = 0;
  const runs = [];
  for (const indices of groups.values()) {
    const pts = indices.map(i => points[i]);
    const z = tileZoomFor(pts);
    if (z === null) continue;
    const cost = tilesAt(pts, z);
    if (used + cost > tileBudget) continue;
    used += cost;
    runs.push(terrainTileSamplesFt(pts, { signal, timeoutMs: Math.max(1000, remaining()) })
      .then(({ values: feet }) => feet.forEach((v, k) => {
        if (v !== null && Number.isFinite(v)) { values[indices[k]] = v; from[indices[k]] = POINT_SOURCES.tiles; }
      }))
      .catch(error => note(POINT_SOURCES.tiles, error)));
  }
  await Promise.all(runs);

  // 2. 3DEP getSamples for whatever is still missing, one request.
  const missing = points.map((_, i) => i).filter(i => values[i] === null);
  const timeoutMs = Math.min(POINT_GET_SAMPLES_MAX_MS, remaining());
  if (missing.length && timeoutMs >= 1000) {
    try {
      const meters = await getSamples(ELEVATION_IMAGE_SERVICE, missing.map(i => points[i]), timeoutMs, { signal, maxPerHost: ELEVATION_MAX_PER_HOST, label: '3dep-getsamples-points' });
      meters.forEach((m, k) => {
        if (m !== null && Number.isFinite(m) && m > -500) { values[missing[k]] = m * METERS_TO_FEET; from[missing[k]] = POINT_SOURCES.usgs; }
      });
    } catch (error) {
      note(POINT_SOURCES.usgs, error);
    }
  } else if (missing.length) {
    note(POINT_SOURCES.usgs, new Error('no time left for USGS 3DEP'));
  }
  return { values, from, tiles: used, errors };
}
