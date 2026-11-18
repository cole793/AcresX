import { json } from '../shared/http.js';
import { upstreamJson } from '../shared/upstream.js';
import { openGeometryCache, readCachedJson, writeCachedJson } from '../shared/edge-cache.js';
import { soilAt } from './soils.js';
import {
  elevationSamplesFt, getSamplesWithRetry, spreadPick, POINT_FALLBACK_TIMEOUT_MS, TERRAIN_TILES_SOURCE
} from './elevation.js';
import { slopeRaster, terrainFromRaster } from './slope-raster.js';

// v2 (2026-11-02): every terrain answer carries elevationSources; v1 entries are left to expire.
// v3 (2026-11-17): gradePct is the per-pixel slope raster's parcel mean (slope-raster.js) when the
// terrain tiles answer; v2 entries (9-point average) are left to expire.
export const TERRAIN_CACHE_PREFIX = 'https://acresx.internal/cache/terrain/v3/';
export const CANOPY_CACHE_PREFIX = 'https://acresx.internal/cache/canopy/v1/';
export const CANOPY_FALLBACK_MAX_POINTS = 12;
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
// A terrain-tile answer is kept one day only, so a later lookup can get the live USGS answer.
export const TILE_ANSWER_TTL_SECONDS = 24 * 60 * 60;
export const USGS_ELEVATION_LABEL = 'USGS 3DEP / EPQS elevation';
export const TILE_ELEVATION_LABEL = 'USGS 3DEP elevation (AWS Terrain Tiles copy)';

function geometryBounds(geometry) {
  if (!geometry?.coordinates) throw new Error('Parcel geometry is invalid.');

  const coords = [];
  const walk = value => Array.isArray(value?.[0]) ? value.forEach(walk) : coords.push(value);
  walk(geometry.coordinates);

  const xs = coords.map(point => Number(point[0])).filter(Number.isFinite);
  const ys = coords.map(point => Number(point[1])).filter(Number.isFinite);
  if (!xs.length || !ys.length) throw new Error('Parcel geometry is invalid.');

  return {
    minLon: Math.min(...xs),
    maxLon: Math.max(...xs),
    minLat: Math.min(...ys),
    maxLat: Math.max(...ys)
  };
}

function distanceFeet(a, b) {
  const earthRadiusFeet = 20902231;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * Math.PI / 180;
  const deltaLon = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusFeet * Math.asin(Math.sqrt(h));
}

const TCC_YEAR = 2025;
export const TCC_SERVICE = 'https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_NLCD_TCC_CONUS/ImageServer';

// Per-point identify: only used as the capped fallback when getSamples fails twice.
async function treeCanopyAt(point) {
  const url = new URL(TCC_SERVICE + '/identify');
  url.searchParams.set('geometry', JSON.stringify({
    x: point.lon,
    y: point.lat,
    spatialReference: { wkid: 4326 }
  }));
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('sr', '4326');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('returnCatalogItems', 'false');
  url.searchParams.set('f', 'json');

  // One attempt per point, as before. The fallback already caps the points, and they run in
  // parallel (a federal service), so the per-host cap is raised to that cap.
  const data = await upstreamJson(url, {
    timeoutMs: POINT_FALLBACK_TIMEOUT_MS, retries: 0, arcgis: true, label: 'usfs-canopy-identify',
    maxPerHost: CANOPY_FALLBACK_MAX_POINTS,
    agency: 'USFS tree-canopy service', arcgisMessage: 'USFS tree-canopy service error'
  });

  const raw = Number(data.value ?? data.properties?.Value ?? data.properties?.value);
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
    throw new Error('USFS tree-canopy sample unavailable');
  }
  return raw;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]), yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]), yj = Number(ring[j][1]);
    if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lon, lat, geometry) {
  const polygons = geometry?.type === 'MultiPolygon' ? geometry.coordinates : [geometry?.coordinates];
  return polygons.some(poly => {
    if (!poly?.[0] || !pointInRing(lon, lat, poly[0])) return false;
    return !poly.slice(1).some(hole => pointInRing(lon, lat, hole));
  });
}

function landCoverSamplePoints(geometry) {
  const b = geometryBounds(geometry);
  const points = [];
  const size = 7;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const lon = b.minLon + (col + 0.5) / size * (b.maxLon - b.minLon);
      const lat = b.minLat + (row + 0.5) / size * (b.maxLat - b.minLat);
      if (pointInGeometry(lon, lat, geometry)) points.push({ lon, lat });
    }
  }
  if (!points.length) points.push({
    lon: (b.minLon + b.maxLon) / 2,
    lat: (b.minLat + b.maxLat) / 2
  });
  return points.slice(0, 36);
}

const validCanopy = value => value !== null && Number.isFinite(value) && value >= 0 && value <= 100;

async function landCoverAnalysis(geometry) {
  let points = landCoverSamplePoints(geometry);
  let samples;
  let fallback = false;

  try {
    samples = (await getSamplesWithRetry(TCC_SERVICE, points)).filter(validCanopy);
  } catch (error) {
    console.warn('Tree-canopy getSamples failed; using capped per-point fallback', error?.message);
    fallback = true;
    points = spreadPick(points, CANOPY_FALLBACK_MAX_POINTS);
    const results = await Promise.allSettled(points.map(treeCanopyAt));
    samples = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  }

  if (samples.length < Math.min(6, points.length)) {
    throw new Error('Not enough USFS tree-canopy samples were returned.');
  }

  const canopyPct = Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
  // Only a complete getSamples answer is cached: never fallback or partial answers.
  const cacheable = !fallback && samples.length === points.length;
  return { cacheable, result: {
    available: true,
    year: TCC_YEAR,
    woodedPct: canopyPct,
    openPct: Math.max(0, 100 - canopyPct),
    otherPct: 0,
    sampleCount: samples.length,
    requestedSamples: points.length,
    topClasses: [],
    source: 'USDA Forest Service NLCD Tree Canopy Cover',
    note: 'Preliminary 30 m satellite tree-canopy estimate; not a tree survey or clearing plan.'
  } };
}

// Terrain: the 9 elevation points below (centre, corners, edge midpoints of the bounding box) and,
// beside them, the per-pixel slope raster (slope-raster.js, AWS Terrain Tiles). When the raster
// answers, gradePct is its area-weighted mean over the parcel (was the mean of the 8 grades from
// the centre point, which a draw or bank between the points never touched), maxGradePct its
// steepest pixel and minFt / maxFt / reliefFt its range inside the parcel; p90GradePct
// (steepest 10% of the parcel) and slopeClasses are added; pointGradePct keeps the 9-point figure.
// Without a raster answer the 9-point answer is unchanged (no gradeMethod field). Without the
// points, a raster answer alone still makes terrain available (centerFt is then null).
// The raster starts with the points; once the points have settled it gets at most this much more
// time (tiles normally answer in under a second), so it never holds the terrain answer up long.
export const RASTER_GRACE_MS = 1500;

async function terrainAnalysis(geometry, ctx) {
  const points = terrainPoints(geometry).then(value => ({ value }), error => ({ error }));
  const rasterJob = slopeRaster(geometry, { ctx });
  let timer;
  const grace = points.then(() => new Promise(resolve => { timer = setTimeout(() => resolve({ available: false, error: `Slope raster took more than ${RASTER_GRACE_MS} ms after the elevation points` }), RASTER_GRACE_MS); }));
  const [pointsResult, raster] = await Promise.all([points, Promise.race([rasterJob, grace]).finally(() => clearTimeout(timer))]);
  if (pointsResult.error && !raster?.available) throw pointsResult.error;
  if (pointsResult.error) {
    console.warn('Terrain points failed; using the slope raster alone', pointsResult.error?.message);
    return { cacheable: true, ttlSeconds: TILE_ANSWER_TTL_SECONDS, result: {
      available: true, centerFt: null, sampleCount: 0, pointGradePct: null,
      ...terrainFromRaster(raster), source: TILE_ELEVATION_LABEL, elevationSources: [TERRAIN_TILES_SOURCE]
    } };
  }
  const answer = pointsResult.value;
  if (!raster?.available) {
    if (raster?.error) console.warn('Slope raster unavailable; terrain keeps the 9-point grade', raster.error);
    return answer;
  }
  answer.result = { ...answer.result, pointGradePct: answer.result.gradePct, ...terrainFromRaster(raster) };
  return answer;
}

async function terrainPoints(geometry) {
  const bounds = geometryBounds(geometry);
  const center = {
    lon: (bounds.minLon + bounds.maxLon) / 2,
    lat: (bounds.minLat + bounds.maxLat) / 2
  };

  const points = [
    center,
    { lon: bounds.minLon, lat: bounds.minLat },
    { lon: bounds.minLon, lat: bounds.maxLat },
    { lon: bounds.maxLon, lat: bounds.minLat },
    { lon: bounds.maxLon, lat: bounds.maxLat },
    { lon: center.lon, lat: bounds.minLat },
    { lon: center.lon, lat: bounds.maxLat },
    { lon: bounds.minLon, lat: center.lat },
    { lon: bounds.maxLon, lat: center.lat }
  ];

  // getSamples, then 3DEP identify, then EPQS, against one deadline, with the terrain tiles beside
  // them (see elevation.js).
  const { values: elevations, sources, errors, tiles } = await elevationSamplesFt(points);
  if (Object.keys(errors).length) console.warn('Terrain elevation source errors', JSON.stringify(errors));
  // As before, terrain needs every point (the old code failed on any missing elevation).
  const missing = elevations.filter(value => value === null).length;
  if (missing) {
    const backup = errors[TERRAIN_TILES_SOURCE] ? ' The AWS Terrain Tiles backup was unavailable too.' : '';
    throw new Error(`USGS elevation was unavailable for ${missing} of ${points.length} terrain points.${backup}`);
  }
  const samples = points.map((point, i) => ({ ...point, elevation: elevations[i] }));

  const minFt = Math.min(...elevations);
  const maxFt = Math.max(...elevations);
  const reliefFt = maxFt - minFt;
  const centerSample = samples[0];
  const grades = samples.slice(1).map(sample =>
    Math.abs(sample.elevation - centerSample.elevation) / Math.max(distanceFeet(centerSample, sample), 1) * 100
  );

  // Complete getSamples answers are cached for 30 days, terrain-tile answers for one day; other
  // fallback answers are not cached, so they are replaced on the next lookup.
  const ttlSeconds = tiles ? TILE_ANSWER_TTL_SECONDS : (sources.length === 1 && sources[0] === 'getSamples' ? CACHE_TTL_SECONDS : 0);
  return { cacheable: ttlSeconds > 0, ttlSeconds, result: {
    available: true,
    gradePct: grades.reduce((sum, grade) => sum + grade, 0) / grades.length,
    maxGradePct: Math.max(...grades),
    minFt,
    maxFt,
    centerFt: centerSample.elevation,
    reliefFt,
    sampleCount: samples.length,
    source: tiles ? TILE_ELEVATION_LABEL : USGS_ELEVATION_LABEL,
    // Additive: which elevation services supplied the values ('getSamples', 'identify', 'epqs',
    // or 'terrain-tiles', never mixed with the others).
    elevationSources: sources
  } };
}

// Serves a layer from caches.default when it holds a successful answer; stores successes only.
async function cachedLayer(prefix, geometry, ctx, compute) {
  const slot = await openGeometryCache(prefix, geometry);
  const hit = await readCachedJson(slot);
  if (hit?.available === true) return hit;
  const { result, cacheable, ttlSeconds = CACHE_TTL_SECONDS } = await compute(geometry, ctx);
  if (cacheable && result?.available === true) await writeCachedJson(slot, result, ttlSeconds, ctx);
  return result;
}

export async function handleLandAnalysis(request, env, ctx) {
  const { geometry } = await request.json();
  if (!geometry) return json({ error: 'Parcel geometry is required.' }, 400, 'no-store');

  const bounds = geometryBounds(geometry);
  const center = {
    lon: (bounds.minLon + bounds.maxLon) / 2,
    lat: (bounds.minLat + bounds.maxLat) / 2
  };

  const [soilResult, terrainResult, landCoverResult] = await Promise.allSettled([
    soilAt(center.lon, center.lat, { ctx }),
    cachedLayer(TERRAIN_CACHE_PREFIX, geometry, ctx, terrainAnalysis),
    cachedLayer(CANOPY_CACHE_PREFIX, geometry, ctx, landCoverAnalysis)
  ]);

  const soil = soilResult.status === 'fulfilled'
    ? soilResult.value
    : { available: false, error: soilResult.reason?.message || 'Soil data unavailable' };

  const terrain = terrainResult.status === 'fulfilled'
    ? terrainResult.value
    : { available: false, error: terrainResult.reason?.message || 'Elevation unavailable' };

  const landCover = landCoverResult.status === 'fulfilled'
    ? landCoverResult.value
    : { available: false, error: landCoverResult.reason?.message || 'USDA land-cover data unavailable' };

  return json(
    { available: Boolean(soil.available || terrain.available || landCover.available), soil, terrain, landCover },
    200,
    'public, max-age=3600, s-maxage=2592000'
  );
}
