import { fetchWithTimeout } from './http.js';

// GET while the URL stays short; a parcel polygon can make it too long for some servers, so
// longer queries go as a form POST (every ArcGIS REST query endpoint accepts both).
const MAX_GET_URL = 1800;

export async function arcgisQuery(base, params, { agency = 'ArcGIS service', timeoutMs = 20000 } = {}) {
  const url = new URL(`${base}/query`);
  url.searchParams.set('f', 'json');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const cache = { cf: { cacheTtl: 900, cacheEverything: true } };
  const response = url.href.length > MAX_GET_URL
    ? await fetchWithTimeout(`${base}/query`, { ...cache, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: url.searchParams.toString() }, timeoutMs)
    : await fetchWithTimeout(url, cache, timeoutMs);
  if (!response.ok) throw new Error(`${agency} returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw Object.assign(new Error(data.error.message || `${agency} query failed`), { arcgisError: true });
  return data.features || [];
}

// Spatial filter params for a parcel polygon (rings, lon/lat) or, without one, a point.
export function spatialParams({ rings, lon, lat }) {
  const geometry = rings
    ? { geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPolygon' }
    : { geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPoint' };
  // Polygon queries return feature outlines (generalized to ~1 m) so coverage can be sampled.
  const output = rings ? { returnGeometry: 'true', outSR: '4326', maxAllowableOffset: '0.00001', geometryPrecision: '6' } : { returnGeometry: 'false' };
  return { where: '1=1', ...geometry, inSR: '4326', spatialRel: 'esriSpatialRelIntersects', ...output };
}
