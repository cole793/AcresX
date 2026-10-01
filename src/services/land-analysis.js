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
  // Use USGS EPQS first: it is designed specifically for point elevations.
  // Fall back to the 3DEP ImageServer when EPQS is temporarily unavailable.
  const epqs = new URL('https://epqs.nationalmap.gov/v1/json');
  epqs.searchParams.set('x', String(lon));
  epqs.searchParams.set('y', String(lat));
  epqs.searchParams.set('wkid', '4326');
  epqs.searchParams.set('units', 'Feet');
  epqs.searchParams.set('includeDate', 'false');

  const image = new URL('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/identify');
  image.searchParams.set('geometry', JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
  image.searchParams.set('geometryType', 'esriGeometryPoint');
  image.searchParams.set('sr', '4326');
  image.searchParams.set('returnGeometry', 'false');
  image.searchParams.set('returnCatalogItems', 'false');
  image.searchParams.set('f', 'json');

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const source of ['epqs', 'image']) {
      try {
        const response = await fetchWithTimeout(source === 'epqs' ? epqs : image, {
          cf: { cacheTtl: 2592000, cacheEverything: true }
        }, 15000);
        if (!response.ok) throw new Error(`USGS elevation service returned ${response.status}`);
        const data = await response.json();
        if (data?.error) throw new Error(data.error.message || 'USGS elevation service error');

        if (source === 'epqs') {
          const feet = Number(data?.value ?? data?.USGS_Elevation_Point_Query_Service?.Elevation_Query?.Elevation);
          if (Number.isFinite(feet) && feet > -10000) return feet;
          throw new Error('USGS EPQS elevation was unavailable.');
        }

        const meters = Number(data.value ?? data.properties?.Value ?? data.properties?.value);
        if (Number.isFinite(meters) && meters >= -4000) return meters * 3.280839895;
        throw new Error('USGS 3DEP elevation was unavailable.');
      } catch (error) {
        lastError = error;
      }
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
  }
  throw lastError || new Error('USGS elevation unavailable.');
}

const CDL_YEAR = 2025;
const CDL_FOREST_CODES = new Set([63, 141, 142, 143, 190]);
const CDL_OPEN_CODES = new Set([36, 37, 60, 61, 62, 65, 81, 82, 87, 88, 111, 112, 121, 122, 123, 124, 131, 152, 176, 195]);

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
  if (!points.length) points.push({ lon: (b.minLon + b.maxLon) / 2, lat: (b.minLat + b.maxLat) / 2 });
  return points.slice(0, 36);
}

async function cdlValueAt(point) {
  // USDA CDL GetCDLValue accepts WGS84 longitude/latitude when wkid=4326.
  // Querying it directly avoids the previous ArcGIS projection dependency.
  const url = new URL('https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue');
  url.searchParams.set('year', String(CDL_YEAR));
  url.searchParams.set('x', String(point.lon));
  url.searchParams.set('y', String(point.lat));
  url.searchParams.set('wkid', '4326');
  const response = await fetchWithTimeout(url, { cf: { cacheTtl: 2592000, cacheEverything: true } }, 12000);
  if (!response.ok) throw new Error(`USDA CDL returned ${response.status}`);
  const text = await response.text();
  const valueMatch = text.match(/<(?:\\w+:)?value\\b[^>]*\\bvalue=["'](\\d+)["']/i) ||
    text.match(/<(?:\\w+:)?value[^>]*>\\s*(\\d+)\\s*<\\//i);
  const categoryAttribute = text.match(/<(?:\\w+:)?value\\b[^>]*\\bcategory=["']([^"']+)["']/i);
  const categoryMatch = categoryAttribute ||
    text.match(/<(?:\\w+:)?category[^>]*>\\s*([^<]+)\\s*<\\//i) ||
    text.match(/<(?:\\w+:)?name[^>]*>\\s*([^<]+)\\s*<\\//i);
  const code = Number(valueMatch?.[1]);
  if (!Number.isFinite(code) || code === 0) throw new Error('USDA CDL sample could not be read');
  return { code, category: categoryMatch?.[1]?.trim() || null };
}

async function landCoverAnalysis(geometry) {
  const geographic = landCoverSamplePoints(geometry);
  const sampled = [];
  for (let i = 0; i < geographic.length; i += 6) {
    const batch = await Promise.allSettled(geographic.slice(i, i + 6).map(cdlValueAt));
    for (const result of batch) if (result.status === 'fulfilled') sampled.push(result.value);
  }
  if (sampled.length < Math.min(6, geographic.length)) {
    throw new Error('Not enough USDA land-cover samples were returned.');
  }
  let wooded = 0, open = 0, other = 0;
  const classes = new Map();
  for (const sample of sampled) {
    if (CDL_FOREST_CODES.has(sample.code)) wooded++;
    else if (CDL_OPEN_CODES.has(sample.code)) open++;
    else other++;
    const label = sample.category || `CDL class ${sample.code}`;
    classes.set(label, (classes.get(label) || 0) + 1);
  }
  const total = sampled.length;
  const topClasses = [...classes.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([label, count]) => ({ label, pct: Math.round(count / total * 100) }));
  return {
    available: true,
    year: CDL_YEAR,
    woodedPct: Math.round(wooded / total * 100),
    openPct: Math.round(open / total * 100),
    otherPct: Math.max(0, 100 - Math.round(wooded / total * 100) - Math.round(open / total * 100)),
    sampleCount: total,
    requestedSamples: geographic.length,
    topClasses,
    source: 'USDA NASS Cropland Data Layer',
    note: 'Preliminary satellite land-cover estimate; not a tree survey or clearing plan.'
  };
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
    source: 'USGS 3DEP / EPQS elevation'
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

  const [soilResult, terrainResult, landCoverResult] = await Promise.allSettled([
    soilAt(center.lon, center.lat),
    terrainAnalysis(geometry),
    landCoverAnalysis(geometry)
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
