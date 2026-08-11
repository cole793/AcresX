import { fetchWithTimeout, json } from '../shared/http.js';

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

async function elevationAt(lon, lat) {
  const url = new URL('https://epqs.nationalmap.gov/v1/json');
  url.searchParams.set('x', String(lon));
  url.searchParams.set('y', String(lat));
  url.searchParams.set('wkid', '4326');
  url.searchParams.set('units', 'Feet');
  url.searchParams.set('includeDate', 'false');

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        cf: { cacheTtl: 2592000, cacheEverything: true }
      }, 10000);
      if (!response.ok) throw new Error(`USGS elevation service returned ${response.status}`);
      const data = await response.json();
      const value = Number(data.value ?? data.USGS_Elevation_Point_Query_Service?.Elevation_Query?.Elevation);
      if (!Number.isFinite(value) || value < -10000) throw new Error('USGS elevation unavailable.');
      return value;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  throw lastError || new Error('USGS elevation unavailable.');
}

function band(grade) {
  if (grade < 5) return 'flat';
  if (grade < 10) return 'moderate';
  if (grade < 20) return 'steep';
  return 'very_steep';
}

async function sampleInBatches(points, batchSize = 5) {
  const sampled = [];
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(async point => ({
      ...point,
      elevationFt: await elevationAt(point.lon, point.lat)
    })));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') sampled.push(result.value);
      else sampled.push({ ...batch[index], elevationFt: null, error: result.reason?.message || 'Elevation unavailable' });
    });
  }
  return sampled;
}

export async function handleSlopeGrid(request) {
  const { geometry } = await request.json();
  if (!geometry) return json({ error: 'Parcel geometry is required.' }, 400, 'no-store');

  const b = geometryBounds(geometry);
  const size = 5;
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

  const sampled = await sampleInBatches(grid, 5);
  const validSamples = sampled.filter(p => Number.isFinite(p.elevationFt));
  if (validSamples.length < 9) {
    return json({
      available: false,
      error: 'Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly.',
      source: 'USGS Elevation Point Query Service',
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
      source: 'USGS Elevation Point Query Service'
    }, 200, 'no-store');
  }

  return json({
    available: true,
    source: 'USGS Elevation Point Query Service',
    resolution: `${size - 1} x ${size - 1} parcel grid`,
    sampleCount: validSamples.length,
    requestedSamples: grid.length,
    partial: validSamples.length < grid.length,
    cells
  }, 200, 'public, max-age=3600, s-maxage=2592000');
}
