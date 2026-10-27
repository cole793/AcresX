import { json } from '../shared/http.js';
import { openGeometryCache, readCachedJson, writeCachedJson } from '../shared/edge-cache.js';
import { epqsElevationsFt, sampleElevationsFt } from './elevation.js';

export const SLOPE_CACHE_PREFIX = 'https://acresx.internal/cache/slope-grid/v1/';
export const GRID_SIZE = 5;
export const FALLBACK_GRID_SIZE = 3;
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

function geometryBounds(geometry) {
  const coords = [];
  const walk = value => Array.isArray(value?.[0]) ? value.forEach(walk) : coords.push(value);
  walk(geometry?.coordinates || []);
  const xs = coords.map(p => Number(p[0])).filter(Number.isFinite);
  const ys = coords.map(p => Number(p[1])).filter(Number.isFinite);
  if (!xs.length || !ys.length) throw new Error('Parcel geometry is invalid.');
  return { minLon: Math.min(...xs), maxLon: Math.max(...xs), minLat: Math.min(...ys), maxLat: Math.max(...ys) };
}

function distanceFeet(a, b) {
  const R = 20902231;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function band(grade) {
  if (grade < 5) return 'flat';
  if (grade < 10) return 'moderate';
  if (grade < 20) return 'steep';
  return 'very_steep';
}

function buildGrid(b, size) {
  let lonStep = (b.maxLon - b.minLon) / (size - 1);
  let latStep = (b.maxLat - b.minLat) / (size - 1);

  if (!Number.isFinite(lonStep) || lonStep === 0) lonStep = 0.00005;
  if (!Number.isFinite(latStep) || latStep === 0) latStep = 0.00005;

  const grid = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      grid.push({ row, col, lon: b.minLon + col * lonStep, lat: b.minLat + row * latStep });
    }
  }
  return grid;
}

const withElevations = (grid, values) => grid.map((point, i) => (
  values[i] === null
    ? { ...point, elevationFt: null, error: 'Elevation unavailable' }
    : { ...point, elevationFt: values[i] }
));

// Normal path: one getSamples request (plus one retry) for the 5 x 5 grid. If that fails twice,
// a coarser 3 x 3 grid is sampled point by point from EPQS (9 requests, one attempt each).
async function sampleGrid(b) {
  const grid = buildGrid(b, GRID_SIZE);
  try {
    return { size: GRID_SIZE, grid, sampled: withElevations(grid, await sampleElevationsFt(grid)), fallback: false };
  } catch (error) {
    console.warn('Slope grid getSamples failed; using capped EPQS fallback', error?.message);
    const coarse = buildGrid(b, FALLBACK_GRID_SIZE);
    return { size: FALLBACK_GRID_SIZE, grid: coarse, sampled: withElevations(coarse, await epqsElevationsFt(coarse)), fallback: true };
  }
}

export async function handleSlopeGrid(request, env, ctx) {
  const { geometry } = await request.json();
  if (!geometry) return json({ error: 'Parcel geometry is required.' }, 400, 'no-store');

  const b = geometryBounds(geometry);
  const slot = await openGeometryCache(SLOPE_CACHE_PREFIX, geometry);
  const hit = await readCachedJson(slot);
  if (hit?.available === true && hit.partial === false) return json(hit, 200, 'public, max-age=3600, s-maxage=2592000');

  const { size, grid, sampled, fallback } = await sampleGrid(b);
  const validSamples = sampled.filter(p => Number.isFinite(p.elevationFt));
  // 9 of 25 on the normal grid (unchanged); the coarse fallback grid needs one full cell.
  if (validSamples.length < (fallback ? 4 : 9)) {
    return json({
      available: false,
      error: 'Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly.',
      source: 'USGS 3DEP / EPQS elevation',
      sampleCount: validSamples.length,
      requestedSamples: grid.length
    }, 200, 'no-store');
  }

  const byKey = new Map(sampled.map(p => [`${p.row}:${p.col}`, p]));
  const cells = [];

  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const sw = byKey.get(`${row}:${col}`);
      const se = byKey.get(`${row}:${col + 1}`);
      const nw = byKey.get(`${row + 1}:${col}`);
      const ne = byKey.get(`${row + 1}:${col + 1}`);
      if (![sw, se, nw, ne].every(p => Number.isFinite(p?.elevationFt))) continue;

      const westMid = { lon: sw.lon, lat: (sw.lat + nw.lat) / 2 };
      const eastMid = { lon: se.lon, lat: (se.lat + ne.lat) / 2 };
      const southMid = { lon: (sw.lon + se.lon) / 2, lat: sw.lat };
      const northMid = { lon: (nw.lon + ne.lon) / 2, lat: nw.lat };
      const westElev = (sw.elevationFt + nw.elevationFt) / 2;
      const eastElev = (se.elevationFt + ne.elevationFt) / 2;
      const southElev = (sw.elevationFt + se.elevationFt) / 2;
      const northElev = (nw.elevationFt + ne.elevationFt) / 2;
      const dx = Math.max(distanceFeet(westMid, eastMid), 1);
      const dy = Math.max(distanceFeet(southMid, northMid), 1);
      const gx = (eastElev - westElev) / dx;
      const gy = (northElev - southElev) / dy;
      const gradePct = Math.sqrt(gx * gx + gy * gy) * 100;
      const centerLon = (sw.lon + ne.lon) / 2;
      const centerLat = (sw.lat + ne.lat) / 2;

      cells.push({
        row,
        col,
        center: [centerLon, centerLat],
        bounds: [[sw.lat, sw.lon], [ne.lat, ne.lon]],
        elevationFt: (sw.elevationFt + se.elevationFt + nw.elevationFt + ne.elevationFt) / 4,
        gradePct,
        band: band(gradePct)
      });
    }
  }

  if (!cells.length) {
    return json({
      available: false,
      error: 'Elevation samples were returned, but not enough adjacent samples were available to calculate slope cells.',
      source: 'USGS 3DEP / EPQS elevation'
    }, 200, 'no-store');
  }

  const body = {
    available: true,
    source: 'USGS 3DEP / EPQS elevation',
    resolution: `${size - 1} x ${size - 1} parcel grid`,
    sampleCount: validSamples.length,
    requestedSamples: grid.length,
    // The coarse fallback grid counts as partial, so it is never cached.
    partial: fallback || validSamples.length < grid.length,
    cells
  };
  if (!body.partial) await writeCachedJson(slot, body, CACHE_TTL_SECONDS, ctx);
  return json(body, 200, 'public, max-age=3600, s-maxage=2592000');
}
