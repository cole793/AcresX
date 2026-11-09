// Raster sampling for terrain, slope grid and tree canopy.
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
// Elevation (terrain and slope grid) uses three USGS sources against one deadline:
//   1. 3DEP ImageServer getSamples, all points in one request (one retry on a quick failure);
//   2. 3DEP ImageServer identify, one request per point;
//   3. EPQS (epqs.nationalmap.gov), one request per point.
// Measured live on 2026-11-02, every source answered but slowly: getSamples 3-14 s (one 502),
// identify 4-15 s, EPQS 1-17 s per point. The old fixed timeouts (getSamples 6 s + a 4 s retry,
// then EPQS 4 s per point) failed nearly every lookup ("unavailable for 9 of 9 terrain points"),
// and trying the sources one after another cannot fit the browser's 20 s land-analysis limit.
// So each request may use what is left of the shared budget, and the per-point sources start as
// hedges: identify once getSamples has not answered within identifyAfterMs, EPQS after
// epqsAfterMs, or each at once when every earlier source has finished without the points. A
// per-point source only asks for points still missing (at most POINT_FALLBACK_MAX_POINTS, chosen
// by the caller). The lookup ends as soon as the needed points have values, and cancels whatever
// is still in flight. A point a source answered as NoData is not asked again (it is the same
// 3DEP raster). Worst case per lookup: 2 + 9 + 9 = 20 USGS subrequests, plus the terrain tiles
// below (at most TERRAIN_TILE_MAX_TILES = 4, usually 1).
//
// A fourth, independent source runs beside them from the start: the AWS Terrain Tiles copy of
// 3DEP (src/services/terrain-tiles.js; S3, 1-4 tile requests, ~0.1-0.5 s measured 2026-11-07,
// when the three USGS sources above took 3-23 s and errored on 3 of 12 Stevens parcels that day).
// USGS is preferred: a complete USGS answer always wins. The tile answer is used once USGS is
// late (the identify hedge is due, or tilesAfterMs passed), or every USGS source has finished
// without the points, or at the deadline. Values from the tiles and from USGS are never mixed in
// one answer: the tile copy is from 2017 and can sit up to ~15 ft off the live raster where 3DEP
// has newer lidar (measured 2026-11-07), which would read as false slope between points from
// different sources.
// When the tiles answer, the per-point hedges are never started.
//
// Canopy keeps getSamplesWithRetry() (USFS host) with its own capped per-point fallback.
import { fetchWithTimeout } from '../shared/http.js';
import { terrainTileSamplesFt } from './terrain-tiles.js';

export const ELEVATION_IMAGE_SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
export const EPQS_URL = 'https://epqs.nationalmap.gov/v1/json';
export const SAMPLE_INTERPOLATION = 'RSP_NearestNeighbor';
export const GET_SAMPLES_MAX_POINTS = 1000;
export const GET_SAMPLES_TIMEOUT_MS = 6000;
export const GET_SAMPLES_RETRY_TIMEOUT_MS = 4000;
export const GET_SAMPLES_RETRY_BACKOFF_MS = 250;
export const POINT_FALLBACK_MAX_POINTS = 9;
export const POINT_FALLBACK_TIMEOUT_MS = 4000;
// The per-point sources run in parallel: let all of them, plus a getSamples, past the per-host cap.
export const ELEVATION_MAX_PER_HOST = POINT_FALLBACK_MAX_POINTS + 1;
export const ELEVATION_SOURCES = Object.freeze(['getSamples', 'identify', 'epqs', 'terrain-tiles']);
export const USGS_ELEVATION_SOURCES = Object.freeze(['getSamples', 'identify', 'epqs']);
export const TERRAIN_TILES_SOURCE = 'terrain-tiles';

export const ELEVATION_TIMING = Object.freeze({
  budgetMs: 17000,        // whole elevation lookup; the browser waits 20 s for land analysis
  identifyAfterMs: 6000,  // start identify if getSamples has not answered by then
  epqsAfterMs: 9000,      // start EPQS if the points are still missing by then
  tilesAfterMs: 6000,     // accept the terrain-tile answer if USGS is not complete by then
  tiles: true,            // run the terrain-tile source (tests turn it off to isolate USGS paths)
  retryMinMs: 3000,       // retry a failed getSamples only with at least this much budget left
  minStageMs: 1500,       // never start a source with less budget than this
  backoffMs: GET_SAMPLES_RETRY_BACKOFF_MS
});
let timing = { ...ELEVATION_TIMING };

// Tests only: override ELEVATION_TIMING. Returns a restore function.
export function configureElevation(overrides = {}) {
  const previous = timing;
  timing = { ...timing, ...overrides };
  return () => { timing = previous; };
}

const METERS_TO_FEET = 3.280839895;
const NO_DATA = Symbol('NoData');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const metersToFeet = m => (m !== null && Number.isFinite(m) && m >= -4000 ? m * METERS_TO_FEET : NO_DATA);

// points: [{ lon, lat }]. Resolves an array aligned with points: a number, or null for NoData.
// opts: { signal, maxPerHost } for the shared upstream client.
export async function getSamples(serviceUrl, points, timeoutMs = GET_SAMPLES_TIMEOUT_MS, opts = {}) {
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
    body,
    ...opts
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

// getSamples with one retry. Throws with both failure reasons. (Canopy.)
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

// 3DEP identify for one point: feet, or NO_DATA. Same raster and pixel as getSamples.
async function identifyFeet(point, { timeoutMs, signal }) {
  const url = new URL(`${ELEVATION_IMAGE_SERVICE}/identify`);
  url.searchParams.set('geometry', JSON.stringify({ x: point.lon, y: point.lat, spatialReference: { wkid: 4326 } }));
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('returnCatalogItems', 'false');
  url.searchParams.set('f', 'json');
  const response = await fetchWithTimeout(url, { signal, maxPerHost: ELEVATION_MAX_PER_HOST, label: '3dep-identify' }, timeoutMs);
  if (!response.ok) throw new Error(`USGS 3DEP identify returned ${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw new Error('USGS 3DEP identify returned an invalid response'); }
  if (data?.error) throw new Error(`USGS 3DEP identify error: ${data.error.message || data.error.code || 'unknown'}`);
  if (data?.value === undefined) throw new Error('USGS 3DEP identify returned no value');
  if (data.value === null || data.value === '' || data.value === 'NoData') return NO_DATA;
  return metersToFeet(Number(data.value));
}

// EPQS for one point: feet, or NO_DATA (EPQS answers -1000000 outside coverage).
async function epqsFeet(point, { timeoutMs, signal }) {
  const url = new URL(EPQS_URL);
  url.searchParams.set('x', String(point.lon));
  url.searchParams.set('y', String(point.lat));
  url.searchParams.set('wkid', '4326');
  url.searchParams.set('units', 'Feet');
  url.searchParams.set('includeDate', 'false');
  const response = await fetchWithTimeout(url, { signal, maxPerHost: ELEVATION_MAX_PER_HOST, label: 'epqs' }, timeoutMs);
  if (!response.ok) throw new Error(`USGS EPQS returned ${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw new Error('USGS EPQS returned an invalid response'); }
  const raw = data?.value ?? data?.USGS_Elevation_Point_Query_Service?.Elevation_Query?.Elevation;
  const feet = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(feet)) throw new Error('USGS EPQS elevation was unavailable.');
  return feet > -10000 ? feet : NO_DATA;
}

// Elevations in feet for `points` from the first sources that answer (see the header).
// opts.fallbackIndices: the points the per-point sources may ask for (default: all of them),
// capped at POINT_FALLBACK_MAX_POINTS. The lookup is complete when every point, or every fallback
// point, has a value or a NoData answer.
// Resolves { values: (number|null)[], from: (source|null)[], sources: source[] that gave values,
//            batch: getSamples answered, complete: every point has a value or a NoData answer,
//            tiles: the terrain-tile answer was used, errors: { [source]: first message } }.
// Never rejects. A tile answer is all tiles ('terrain-tiles' for every point), never mixed.
export async function elevationSamplesFt(points, { fallbackIndices } = {}) {
  const t = timing;
  const deadline = Date.now() + t.budgetMs;
  const remaining = () => deadline - Date.now();
  const values = points.map(() => null);
  const from = points.map(() => null);
  const noData = points.map(() => false);
  const fallback = (fallbackIndices ?? points.map((_, i) => i)).slice(0, POINT_FALLBACK_MAX_POINTS);
  const errors = {};
  let batch = false;
  const controller = new AbortController();
  const signal = controller.signal;
  const rank = source => ELEVATION_SOURCES.indexOf(source);
  const resolved = i => values[i] !== null || noData[i];
  const usgsComplete = () => !points.length || points.every((_, i) => resolved(i)) || fallback.every(resolved);
  // Terrain-tile answer: values for every point, or null until (unless) it arrives.
  let tileValues = null;
  let tilesDue = false;

  const put = (i, value, source) => {
    if (value === NO_DATA || value === null) {
      if (values[i] === null) noData[i] = true;
    } else if (values[i] === null || rank(source) < rank(from[i])) {
      values[i] = value;
      from[i] = source;
      noData[i] = false;
    }
  };
  const note = (source, error) => { if (!errors[source]) errors[source] = error?.message || String(error); };

  let done = false;
  let resolveFinished;
  const finished = new Promise(resolve => { resolveFinished = resolve; });
  let useTiles = false;
  const finish = (tiles = false) => { if (done) return; useTiles = tiles; done = true; resolveFinished(); };
  // USGS late: its tiles timer fired, or a per-point hedge became due (so none starts needlessly).
  const usgsLate = () => tilesDue || stages.slice(1).some(s => s.due);
  const usgsFinished = () => stages.every(s => s.state === 'settled' || s.state === 'skipped');
  const check = () => {
    if (done) return;
    if (usgsComplete()) finish();
    else if (tileValues && (usgsLate() || usgsFinished())) finish(true);
  };

  async function runGetSamples() {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const meters = await getSamples(ELEVATION_IMAGE_SERVICE, points, remaining(), { signal, maxPerHost: ELEVATION_MAX_PER_HOST, label: '3dep-getsamples' });
        batch = true;
        meters.forEach((m, i) => put(i, metersToFeet(m), 'getSamples'));
        return;
      } catch (error) {
        if (signal.aborted) return;
        note('getSamples', attempt === 1 ? error : new Error(`retry ${error?.message || 'failed'}`));
        if (attempt === 2 || remaining() - t.backoffMs < t.retryMinMs) return;
        await sleep(t.backoffMs);
        if (signal.aborted) return;
      }
    }
  }

  const perPoint = (source, lookup) => async () => {
    const wanted = fallback.filter(i => !resolved(i));
    await Promise.all(wanted.map(async i => {
      try {
        put(i, await lookup(points[i], { timeoutMs: remaining(), signal }), source);
        check();
      } catch (error) {
        if (!signal.aborted) note(source, error);
      }
    }));
  };

  // `due` is set by the stage's own timer, never by comparing clocks: a Node timer can fire with
  // Date.now() a millisecond short of its delay, which used to leave a hedge unstarted.
  const stages = [
    { at: 0, run: runGetSamples, state: 'waiting', due: true },
    { at: t.identifyAfterMs, run: perPoint('identify', identifyFeet), state: 'waiting', due: false },
    { at: t.epqsAfterMs, run: perPoint('epqs', epqsFeet), state: 'waiting', due: false }
  ];
  const timers = [];

  async function runTiles() {
    try {
      const { values: feet } = await terrainTileSamplesFt(points, { signal, timeoutMs: remaining() });
      // Only a complete tile answer is usable: the tiles are one source, never mixed with USGS.
      if (feet.every(v => v !== null)) tileValues = feet;
      else note(TERRAIN_TILES_SOURCE, new Error('AWS Terrain Tiles had no value for some points'));
    } catch (error) {
      if (!signal.aborted) note(TERRAIN_TILES_SOURCE, error);
    }
  }

  function advance() {
    if (done) return;
    check();
    if (done) return;
    for (let k = 0; k < stages.length; k++) {
      const stage = stages[k];
      if (stage.state !== 'waiting') continue;
      const earlierFinished = stages.slice(0, k).every(s => s.state === 'settled' || s.state === 'skipped');
      if (!stage.due && !earlierFinished) continue;
      const needed = k === 0 ? points.length > 0 : fallback.some(i => !resolved(i));
      if (!needed || remaining() < t.minStageMs) { stage.state = 'skipped'; continue; }
      stage.state = 'running';
      stage.run().catch(error => note(ELEVATION_SOURCES[k], error)).finally(() => { stage.state = 'settled'; advance(); });
    }
    // Every USGS source is done without the points: wait for the tiles while they still run.
    if (usgsFinished() && !tilesRunning) finish(Boolean(tileValues));
  }

  let tilesRunning = Boolean(t.tiles && points.length);
  if (tilesRunning) runTiles().finally(() => { tilesRunning = false; advance(); });
  for (const stage of stages) {
    if (!stage.due) timers.push(setTimeout(() => { stage.due = true; advance(); }, stage.at));
  }
  timers.push(setTimeout(() => { tilesDue = true; advance(); }, t.tilesAfterMs));
  timers.push(setTimeout(() => finish(!usgsComplete() && Boolean(tileValues)), t.budgetMs + 250));
  advance();
  await finished;
  timers.forEach(clearTimeout);
  const result = useTiles
    ? {
      values: tileValues.slice(),
      from: points.map(() => TERRAIN_TILES_SOURCE),
      sources: [TERRAIN_TILES_SOURCE],
      batch: false,
      complete: true,
      tiles: true,
      errors: { ...errors }
    }
    : {
      values: values.slice(),
      from: from.slice(),
      sources: USGS_ELEVATION_SOURCES.filter(source => from.includes(source)),
      batch,
      complete: points.every((_, i) => resolved(i)),
      tiles: false,
      errors: { ...errors }
    };
  controller.abort(new Error('elevation lookup complete'));
  return result;
}

// Picks `count` evenly spread items from a list (all of them when the list is short enough).
export function spreadPick(items, count) {
  if (items.length <= count) return items.slice();
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * items.length / count)]);
}
