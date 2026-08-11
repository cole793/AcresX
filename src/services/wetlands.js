import { fetchWithTimeout, json } from '../shared/http.js';

const NWI_LAYER = 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0';
const GEOMETRY_SERVER = 'https://utility.arcgisonline.com/ArcGIS/rest/services/Geometry/GeometryServer/intersect';
const EARTH_RADIUS_M = 6378137;
const SQM_PER_ACRE = 4046.8564224;

function esriParcel(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) throw new Error('Wetland analysis requires parcel polygon geometry.');
  return {
    rings: geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat(),
    spatialReference: { wkid: 4326 }
  };
}

function signedRingAreaSqM(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    const lon1 = Number(p1?.[0]) * Math.PI / 180;
    const lon2 = Number(p2?.[0]) * Math.PI / 180;
    const lat1 = Number(p1?.[1]) * Math.PI / 180;
    const lat2 = Number(p2?.[1]) * Math.PI / 180;
    if (![lon1, lon2, lat1, lat2].every(Number.isFinite)) continue;
    let dLon = lon2 - lon1;
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    if (dLon < -Math.PI) dLon += 2 * Math.PI;
    total += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2;
}

function esriPolygonAreaSqM(polygon) {
  const signed = (polygon?.rings || []).reduce((sum, ring) => sum + signedRingAreaSqM(ring), 0);
  return Math.abs(signed);
}

function geoJsonAreaSqM(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  let total = 0;
  for (const polygon of polygons) {
    if (!polygon?.length) continue;
    total += Math.abs(signedRingAreaSqM(polygon[0]));
    for (const hole of polygon.slice(1)) total -= Math.abs(signedRingAreaSqM(hole));
  }
  return Math.max(0, total);
}

async function queryNwi(geometry) {
  const url = new URL(`${NWI_LAYER}/query`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', '1=1');
  url.searchParams.set('geometry', JSON.stringify(esriParcel(geometry)));
  url.searchParams.set('geometryType', 'esriGeometryPolygon');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('outFields', 'WETLAND_TYPE,ATTRIBUTE');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('resultRecordCount', '500');

  const response = await fetchWithTimeout(url, { cf: { cacheTtl: 86400, cacheEverything: true } }, 20000);
  if (!response.ok) throw new Error(`NWI service returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'NWI query failed');
  return data.features || [];
}

async function intersectWithParcel(features, geometry) {
  const geometries = features.map(f => f.geometry).filter(g => Array.isArray(g?.rings));
  if (!geometries.length) return [];

  const params = new URLSearchParams();
  params.set('f', 'json');
  params.set('sr', '4326');
  params.set('geometries', JSON.stringify({ geometryType: 'esriGeometryPolygon', geometries }));
  params.set('geometry', JSON.stringify(esriParcel(geometry)));

  const response = await fetchWithTimeout(GEOMETRY_SERVER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: params.toString(),
    cf: { cacheTtl: 86400, cacheEverything: true }
  }, 25000);
  if (!response.ok) throw new Error(`Wetland intersection service returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Wetland intersection failed');
  return Array.isArray(data.geometries) ? data.geometries : [];
}

export async function handleWetlands(request) {
  const body = await request.json();
  const geometry = body.geometry;
  if (!geometry) return json({ error: 'Parcel geometry is required.' }, 400, 'no-store');

  const features = await queryNwi(geometry);
  const types = [...new Set(features.map(f => f.attributes?.WETLAND_TYPE || f.attributes?.ATTRIBUTE).filter(Boolean))];
  const parcelSqM = geoJsonAreaSqM(geometry);

  if (!features.length) {
    return json({
      available: true,
      intersects: false,
      count: 0,
      types: [],
      coveragePct: 0,
      wetlandAcres: 0,
      parcelAcres: parcelSqM / SQM_PER_ACRE,
      coverageMethod: 'NWI polygon intersection'
    }, 200, 'public, max-age=3600, s-maxage=86400');
  }

  let intersections = [];
  let coverageEstimated = false;
  try {
    intersections = await intersectWithParcel(features, geometry);
  } catch (error) {
    console.warn('Exact NWI parcel intersection failed; returning presence without percent.', error);
    coverageEstimated = true;
  }

  const wetlandSqM = intersections.reduce((sum, polygon) => sum + esriPolygonAreaSqM(polygon), 0);
  const coveragePct = parcelSqM > 0 && intersections.length ? Math.min(100, wetlandSqM / parcelSqM * 100) : null;

  return json({
    available: true,
    intersects: true,
    count: features.length,
    types,
    coveragePct,
    wetlandAcres: intersections.length ? wetlandSqM / SQM_PER_ACRE : null,
    parcelAcres: parcelSqM / SQM_PER_ACRE,
    coverageMethod: intersections.length ? 'NWI polygons clipped to parcel' : 'NWI intersection presence only',
    coverageEstimated
  }, 200, 'public, max-age=3600, s-maxage=86400');
}
