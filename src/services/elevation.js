// Batched raster sampling for terrain, slope grid and tree canopy.
//
// One ArcGIS ImageServer `getSamples` request (multipoint, POST form-encoded) replaces the old
// one-request-per-point calls, which hit Cloudflare's per-invocation subrequest cap and timed out
// on Kootenai parcels (validation run 40391761739). Verified live on 2026-10-27:
//   - The response is { samples: [{ locationId, value, ... }] }. `value` is a string, samples are
//     not in request order (match on locationId), and NoData points are left out entirely.
//   - 3DEP values are meters. RSP_NearestNeighbor returns exactly the `identify` pixel value and
//     agrees with EPQS (feet) to ~0.001 ft; bilinear differs by up to ~0.3 ft, so nearest
//     neighbour is used to keep the old numbers.
//   - 3DEP returns at most 1000 samples per call (more points are silently dropped); the USFS
//     tree-canopy service reports maxRecordCount 1000. Our lookups send at most 49 points.
//
// Retry policy: getSamples once more after a short backoff. If both attempts fail, callers fall
// back to a capped per-point path (single attempt per point, short timeout) so a lookup stays
// well under Cloudflare's 50-subrequest limit and ~15 s.
import { fetchWithTimeout } from '../shared/http.js';

export const ELEVATION_IMAGE_SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
export const EPQS_URL = 'https://epqs.nationalmap.gov/v1/json';
export const SAMPLE_INTERPOLATION = 'RSP_NearestNeighbor';
export const GET_SAMPLES_MAX_POINTS = 1000;
export const GET_SAMPLES_TIMEOUT_MS = 6000;
export const GET_SAMPLES_RETRY_TIMEOUT_MS = 4000;
export const GET_SAMPLES_RETRY_BACKOFF_MS = 250;
export const POINT_FALLBACK_MAX_POINTS = 9;
export const POINT_FALLBACK_TIMEOUT_MS = 4000;

const METERS_TO_FEET = 3.280839895;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// points: [{ lon, lat }]. Resolves an array aligned with points: a number, or null for NoData.
export async function getSamples(serviceUrl, points, timeoutMs = GET_SAMPLES_TIMEOUT_MS) {
  if (!points.length) return [];
  if (points.length > GET_SAMPLES_MAX_POINTS) throw new Error(`getSamples accepts at most ${GET_SAMPLES_MAX_POINTS} points.`);
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points: points.map(p => [p.lon, p.lat]), spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryMultipoint',
    returnFirstValueOnly: 'true',
    interpolation: SAMPLE_INTERPOLATION,
    f: 'json'
  });
  const response = await fetchWithTimeout(`${serviceUrl}/getSamples`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  }, timeoutMs);
  if (!response.ok) throw new Error(`getSamples returned ${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw new Error('getSamples returned an invalid response'); }
  if (data?.error) throw new Error(`getSamples error: ${data.error.message || data.error.code || 'unknown'}`);
  if (!Array.isArray(data?.samples)) throw new Error('getSamples returned no samples array');

  const values = points.map(() => null);
  for (const sample of data.samples) {
    const index = Number(sample?.locationId);
    const value = Number(sample?.value);
    if (Number.isInteger(index) && index >= 0 && index < values.length && sample?.value !== null && sample?.value !== '' && Number.isFinite(value)) {
      values[index] = value;
    }
  }
  return values;
}

// getSamples with one retry. Throws with both failure reasons.
export async function getSamplesWithRetry(serviceUrl, points) {
  try {
    return await getSamples(serviceUrl, points, GET_SAMPLES_TIMEOUT_MS);
  } catch (error) {
    await sleep(GET_SAMPLES_RETRY_BACKOFF_MS);
    try {
      return await getSamples(serviceUrl, points, GET_SAMPLES_RETRY_TIMEOUT_MS);
    } catch (retryError) {
      throw new Error(`${error?.message || 'getSamples failed'}; retry ${retryError?.message || 'failed'}`);
    }
  }
}

// 3DEP elevations in feet via one getSamples call (plus one retry). null = NoData.
export async function sampleElevationsFt(points) {
  const meters = await getSamplesWithRetry(ELEVATION_IMAGE_SERVICE, points);
  return meters.map(m => (m !== null && m >= -4000 ? m * METERS_TO_FEET : null));
}

async function epqsFeet(point) {
  const url = new URL(EPQS_URL);
  url.searchParams.set('x', String(point.lon));
  url.searchParams.set('y', String(point.lat));
  url.searchParams.set('wkid', '4326');
  url.searchParams.set('units', 'Feet');
  url.searchParams.set('includeDate', 'false');
  // The capped per-point fallback runs in parallel: allow all of its points past the per-host cap.
  const response = await fetchWithTimeout(url, { maxPerHost: POINT_FALLBACK_MAX_POINTS }, POINT_FALLBACK_TIMEOUT_MS);
  if (!response.ok) throw new Error(`USGS EPQS returned ${response.status}`);
  const data = await response.json();
  const feet = Number(data?.value ?? data?.USGS_Elevation_Point_Query_Service?.Elevation_Query?.Elevation);
  if (Number.isFinite(feet) && feet > -10000) return feet;
  throw new Error('USGS EPQS elevation was unavailable.');
}

// Last-resort per-point EPQS path: at most POINT_FALLBACK_MAX_POINTS points (the rest are null),
// one attempt each, in parallel. null = failed or NoData.
export async function epqsElevationsFt(points) {
  const capped = points.slice(0, POINT_FALLBACK_MAX_POINTS);
  const results = await Promise.allSettled(capped.map(epqsFeet));
  return points.map((_, i) => (results[i]?.status === 'fulfilled' ? results[i].value : null));
}

// Picks `count` evenly spread items from a list (all of them when the list is short enough).
export function spreadPick(items, count) {
  if (items.length <= count) return items.slice();
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * items.length / count)]);
}
