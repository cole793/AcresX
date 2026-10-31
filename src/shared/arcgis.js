// ArcGIS helpers for parcel-area (polygon) queries. Requests go through the shared upstream
// client (src/shared/upstream.js): the timeout covers the body, one retry on a timeout, network
// error, 5xx or non-4xx ArcGIS error, per-host cap, a log line per attempt, and no `cf` edge
// caching. This file only adds the defaults the polygon callers rely on.
import { arcgisQuery as upstreamArcgisQuery } from './upstream.js';

// GET while the URL stays short; a parcel polygon can make it too long for some servers, so
// longer queries go as a form POST (every ArcGIS REST query endpoint accepts both). Lower than
// the shared client's default (3,500) on purpose: this is what PR #21 checked live.
export const ARCGIS_MAX_GET_URL = 1800;

// Was one 20 s attempt; now 12 s + one retry at 8 s (body included), like the other county layers.
// Same signature and result (features[]) as before; an ArcGIS {error} body still throws an error
// with arcgisError: true and the server's message (else `${agency} query failed`), and an HTTP
// error still reads `${agency} returned ${status}`. Any other shared-client option (label, retries,
// signal, ...) can be passed through.
export function arcgisQuery(base, params, { agency = 'ArcGIS service', timeoutMs = 12000, retryTimeoutMs = 8000, ...opts } = {}) {
  return upstreamArcgisQuery(base, params, { maxGetUrlLength: ARCGIS_MAX_GET_URL, ...opts, agency, timeoutMs, retryTimeoutMs });
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
