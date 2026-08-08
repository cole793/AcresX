import { fetchWithTimeout, json } from '../shared/http.js';
import { soilAt } from './soils.js';

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

async function elevationAt(lon, lat) {
  const url = new URL('https://epqs.nationalmap.gov/v1/json');
  url.searchParams.set('x', String(lon));
  url.searchParams.set('y', String(lat));
  url.searchParams.set('wkid', '4326');
  url.searchParams.set('units', 'Feet');
  url.searchParams.set('includeDate', 'false');

  const response = await fetchWithTimeout(url, {
    cf: { cacheTtl: 2592000, cacheEverything: true }
  }, 15000);

  if (!response.ok) throw new Error(`USGS elevation service returned ${response.status}`);

  const data = await response.json();
  const elevation = Number(data.value ?? data.USGS_Elevation_Point_Query_Service?.Elevation_Query?.Elevation);
  if (!Number.isFinite(elevation) || elevation < -10000) throw new Error('USGS elevation was unavailable.');
  return elevation;
}

async function terrainAnalysis(geometry) {
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

  const samples = await Promise.all(points.map(async point => ({
    ...point,
    elevation: await elevationAt(point.lon, point.lat)
  })));

  const elevations = samples.map(sample => sample.elevation);
  const minFt = Math.min(...elevations);
  const maxFt = Math.max(...elevations);
  const reliefFt = maxFt - minFt;
  const centerSample = samples[0];
  const grades = samples.slice(1).map(sample =>
    Math.abs(sample.elevation - centerSample.elevation) / Math.max(distanceFeet(centerSample, sample), 1) * 100
  );

  return {
    available: true,
    gradePct: grades.reduce((sum, grade) => sum + grade, 0) / grades.length,
    maxGradePct: Math.max(...grades),
    minFt,
    maxFt,
    centerFt: centerSample.elevation,
    reliefFt,
    sampleCount: samples.length,
    source: 'USGS Elevation Point Query Service'
  };
}

export async function handleLandAnalysis(request) {
  const { geometry } = await request.json();
  if (!geometry) return json({ error: 'Parcel geometry is required.' }, 400, 'no-store');

  const bounds = geometryBounds(geometry);
  const center = {
    lon: (bounds.minLon + bounds.maxLon) / 2,
    lat: (bounds.minLat + bounds.maxLat) / 2
  };

  const [soilResult, terrainResult] = await Promise.allSettled([
    soilAt(center.lon, center.lat),
    terrainAnalysis(geometry)
  ]);

  const soil = soilResult.status === 'fulfilled'
    ? soilResult.value
    : { available: false, error: soilResult.reason?.message || 'Soil data unavailable' };

  const terrain = terrainResult.status === 'fulfilled'
    ? terrainResult.value
    : { available: false, error: terrainResult.reason?.message || 'Elevation unavailable' };

  return json(
    { available: Boolean(soil.available || terrain.available), soil, terrain },
    200,
    'public, max-age=3600, s-maxage=2592000'
  );
}
