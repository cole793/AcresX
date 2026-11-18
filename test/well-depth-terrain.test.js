// Offline tests for the terrain-aware nearby well depth (2026-11-17 broker feedback on Yellowstone
// 03092732390050000: the closest wells sat in the Blue Creek drainage far below the upland parcel
// and the report said "Shallow wells nearby — about 53 ft").
//   src/services/well-depth-terrain.js  candidates + elevations + estimateWellDepth()
//   src/services/point-elevations.js    terrain tiles (budgeted) then 3DEP getSamples
//   public/well-terrain.js              attaches the answer to findWells' result (wells.terrain)
//   public/screening-inputs.js          AcresXWellDepth reads it (and falls back without it)
// The Yellowstone fixture is recorded GWIC Boreholes features (no site names) and 3DEP getSamples
// elevations for the homesite and each well, 2026-11-18. No live calls.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker from '../src/index.js';
import { WELL_TERRAIN, estimateWellDepth, wellDepthTerrain, candidateOf, WELL_TERRAIN_RULES_VERSION, WELL_TERRAIN_CACHE_PREFIX, wellTerrainCacheKey } from '../src/services/well-depth-terrain.js';
import { valueCacheKey } from '../src/shared/edge-cache.js';
import { pointElevationsFt, POINT_SOURCES } from '../src/services/point-elevations.js';
import { TERRAIN_TILES_URL, clearTerrainTileMemo } from '../src/services/terrain-tiles.js';
import { ELEVATION_IMAGE_SERVICE } from '../src/services/elevation.js';
import { makeLazyContext, readPublic } from './ui-harness.js';

const fixture = JSON.parse(readFileSync(new URL('fixtures/well-depth-terrain-yellowstone-03092732390050000.json', import.meta.url), 'utf8'));
const TILE_PNG = readFileSync(new URL('fixtures/terrarium-14-2878-5726.png', import.meta.url));
const HOME = fixture.home;
const GWIC = 'https://mbmgmap.mtech.edu/server/rest/services/Water_Resources/GWIC_Database/FeatureServer/4/query';
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const urlOf = input => (typeof input === 'string' ? input : input.url ?? String(input));
const pointsOf = body => JSON.parse(new URLSearchParams(String(body)).get('geometry')).points;
const key = ([lon, lat]) => `${Number(lon).toFixed(5)},${Number(lat).toFixed(5)}`;
// getSamples answered from the recorded meters; points not recorded are NoData (left out).
const recordedSamples = body => ({ samples: pointsOf(body).map((p, i) => ({ locationId: i, value: fixture.elevationMeters[key(p)] })).filter(s => s.value != null).map(s => ({ ...s, value: String(s.value) })) });

function stub(handlers) {
  calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = urlOf(input);
    const body = init.body ?? (typeof input === 'object' && input.body ? await input.clone().text() : undefined);
    calls.push({ url, body });
    for (const [prefix, answer] of handlers) if (url.startsWith(prefix)) return answer(url, body);
    return new Response('not stubbed', { status: 404 });
  };
}
const yellowstone = (elevation = 'recorded') => stub([
  [GWIC, () => jsonResponse(structuredClone(fixture.gwic))],
  [TERRAIN_TILES_URL, () => new Response('', { status: 404 })],
  [`${ELEVATION_IMAGE_SERVICE}/getSamples`, (url, body) => (elevation === 'recorded' ? jsonResponse(recordedSamples(body)) : new Response('<html>502</html>', { status: 502 }))]
]);

beforeEach(() => { clearTerrainTileMemo(); delete globalThis.caches; });
afterEach(() => { globalThis.fetch = realFetch; if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches; });

// ---- The service

test('upland parcel with valley wells: drainage wells flagged, deeper range, low confidence', async () => {
  yellowstone();
  const a = await wellDepthTerrain({ state: 'MT', lat: HOME.lat, lon: HOME.lon });
  assert.equal(a.available, true, JSON.stringify(a).slice(0, 300));
  const e = a.estimate;
  assert.equal(e.confidence, 'low');
  assert.ok(e.comparableCount < WELL_TERRAIN.minComparable, `comparable ${e.comparableCount}`);
  assert.equal(e.drainage.mostly, true, 'the nearest wells are mostly in the drainage');
  assert.ok(e.drainage.medianDropFt >= 150, `drainage about ${e.drainage.medianDropFt} ft lower`);
  // Today's closest-five median was 53 ft; the homesite needs far more.
  assert.ok(e.depthFt >= 150, `low end ${e.depthFt}`);
  // No comparable well, and one deep (1,365 ft flowing artesian) well on higher ground: it sets
  // the top of the range (owner decision 2026-11-18).
  assert.equal(e.comparableCount, 0);
  assert.equal(e.deepWells.count, 1);
  assert.equal(e.deepWells.raisedHigh, true);
  assert.equal(e.highFt, 1370);
  assert.equal(e.deepWells.single.depthFt, 1365);
  assert.equal(e.deepWells.single.id, '218511');
  assert.ok(e.deepWells.single.dzFt > WELL_TERRAIN.similarFt, 'on higher ground');
  assert.equal(e.deepWells.single.flowing, true, 'negative static level');
  assert.equal(e.deepWells.single.approximateLocation, true, 'GWIC TRS-SEC: section centre');
  assert.equal(e.planningDepthFt, e.highFt);
  assert.equal(e.scoreDepthFt, e.highFt, 'low confidence grades by the high end');
  assert.ok(e.waterLevelDepthFt > 100, `static water about ${e.waterLevelDepthFt} ft below the homesite`);
  // GWIC's own land-surface altitude is used where the record has one; else 3DEP (tiles 404 here).
  assert.ok(e.wells.some(w => w.elevationSource === 'record'));
  assert.ok(e.wells.some(w => w.elevationSource === POINT_SOURCES.usgs));
  assert.equal(a.parcelElevationSource, POINT_SOURCES.usgs);
  // Requests: GWIC asks for altitude and location method, never the owner-name site_name.
  const gwic = calls.filter(c => c.url.startsWith(GWIC));
  assert.ok(gwic.length >= 1 && gwic.length <= WELL_TERRAIN.radiiMiles.length);
  const fields = new URL(gwic[0].url).searchParams.get('outFields');
  assert.match(fields, /altitude_ft_amsl/);
  assert.match(fields, /geomethod/);
  assert.doesNotMatch(fields, /site_name/);
  assert.ok(calls.filter(c => c.url.includes('/getSamples')).length <= Math.ceil(WELL_TERRAIN.maxSampled / WELL_TERRAIN.sampleBatch));
});

test('section-centre GWIC locations are not given a terrain elevation; the record altitude is kept', () => {
  const home = { lat: 45.7, lon: -108.5 };
  const f = (props, coords = [-108.5, 45.701]) => ({ geometry: { coordinates: coords }, properties: { CompletedDepth: 100, ...props } });
  assert.equal(candidateOf(f({ LocationMethod: 'TRS-SEC' }), home).coarseLocation, true);
  assert.equal(candidateOf(f({ LocationMethod: 'NAV-GPS' }), home).coarseLocation, false);
  assert.equal(candidateOf(f({ LocationMethod: 'TRS-SEC', LandSurfaceElevFt: 3650 }), home).recordElevationFt, 3650);
  assert.equal(candidateOf(f({ StaticWaterLvl: 0 }), home).staticFt, null, 'a missing GWIC level arrives as 0');
  assert.equal(candidateOf(f({ WellProjectType: 'Irrigation' }), home).residential, false);
  assert.equal(candidateOf(f({ Status: 'ABANDONED' }), home).inactive, true);
});

test('similar-elevation wells: moderate confidence, median and quartile range', () => {
  const wells = [120, 140, 100, 160, 130].map((depthFt, i) => ({ id: String(i), distanceMi: 0.2 + i * 0.1, depthFt, staticFt: 60, elevationFt: 2400 + (i % 2 ? 20 : -15) }));
  const e = estimateWellDepth({ parcelElevationFt: 2400, wells });
  assert.equal(e.confidence, 'moderate');
  assert.equal(e.comparableCount, 5);
  assert.equal(e.depthFt, 130);
  assert.equal(e.lowFt, 120);
  assert.equal(e.highFt, 140);
  assert.equal(e.scoreDepthFt, 130, 'moderate grades by the median');
  assert.equal(e.drainage.count, 0);
  // Static water 60 ft below each well: 75 ft below the homesite at the wells 15 ft lower, 40 ft
  // at those 20 ft higher; median 75, rounded to 80.
  assert.equal(e.waterLevelDepthFt, 80);
});

// Deep-well rules (owner decisions 2026-11-18; rules version 4): with 0-2 comparable wells one deep
// well at similar or higher ground (anywhere in the search) sets the top of the range; with 3 or
// more comparable wells two are needed and a single one is a note only.
const comparableWells = n => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, distanceMi: 0.15 + i * 0.1, depthFt: 60 + i * 10, staticFt: null, elevationFt: 2400 + (i % 2 ? 10 : -10) }));
const valleyWells = n => Array.from({ length: n }, (_, i) => ({ id: `v${i}`, distanceMi: 0.12 + i * 0.1, depthFt: 40, staticFt: null, elevationFt: 2250 }));
const deepWells = (n, at = 0.42) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, distanceMi: at + i * 0.01, depthFt: 900 + i * 100, staticFt: null, elevationFt: 2480 }));
const byDistance = list => list.sort((a, b) => a.distanceMi - b.distanceMi);

for (const n of [0, 1, 2]) {
  test(`deep wells: ${n} comparable + one deep well -> it sets the top of the range (low confidence)`, () => {
    const e = estimateWellDepth({ parcelElevationFt: 2400, wells: byDistance([...valleyWells(8), ...comparableWells(n), ...deepWells(1, 3.5)]) });
    assert.equal(e.comparableCount, n);
    assert.equal(e.confidence, 'low');
    assert.equal(e.highFt, 900, 'even beyond the wells used (3.5 mi)');
    assert.equal(e.deepWells.raisedHigh, true);
    assert.equal(e.deepWells.single.depthFt, 900);
  });
}

test('deep wells: 3 comparable + one deep well -> note only; two deep wells raise the high end', () => {
  const base = [120, 140, 100, 160, 130].slice(0, 3).map((depthFt, i) => ({ id: String(i), distanceMi: 0.2 + i * 0.1, depthFt, staticFt: null, elevationFt: 2400 }));
  const one = estimateWellDepth({ parcelElevationFt: 2400, wells: byDistance([...base, ...deepWells(1, 0.25)]) });
  assert.equal(one.comparableCount, 3);
  assert.equal(one.confidence, 'moderate');
  assert.equal(one.highFt, 130, 'p75 of the three comparable; the deep well does not move it');
  assert.equal(one.deepWells.raisedHigh, false);
  assert.deepEqual({ ...one.deepWells.single }, { id: 'd0', depthFt: 900, dzFt: 80, distanceMi: 0.25, flowing: false, approximateLocation: false });
  const two = estimateWellDepth({ parcelElevationFt: 2400, wells: byDistance([...base, ...deepWells(2, 0.25)]) });
  assert.equal(two.highFt, 950, 'two deep wells: their median');
  assert.equal(two.deepWells.raisedHigh, true);
  assert.equal(two.depthFt, one.depthFt, 'the central estimate is unchanged');
  // Three comparable wells but mostly drainage (low confidence): still the two-well rule.
  const drained = estimateWellDepth({ parcelElevationFt: 2400, wells: byDistance([...valleyWells(8), ...comparableWells(3).map(w => ({ ...w, distanceMi: w.distanceMi + 0.9 })), ...deepWells(1, 0.3)]) });
  assert.equal(drained.comparableCount, 3);
  assert.equal(drained.confidence, 'low');
  assert.equal(drained.deepWells.raisedHigh, false);

  const h = makeLazyContext();
  h.run(readPublic('screening-inputs.js'));
  const WD = h.context.AcresXWellDepth;
  const wells = [{ properties: { CompletedDepth: 120 } }];
  wells.terrain = { available: true, estimate: one };
  assert.equal(WD.deepText(WD.stats({ wells })), 'One nearby well on higher ground went to 900 ft; deeper wells are possible.');
  wells.terrain = { available: true, estimate: two };
  assert.equal(WD.deepText(WD.stats({ wells })), '');
  const raised = estimateWellDepth({ parcelElevationFt: 2400, wells: byDistance([...valleyWells(10), { id: 'far', distanceMi: 3.5, depthFt: 1200, staticFt: -20, elevationFt: 2500, coarseLocation: true }]) });
  wells.terrain = { available: true, estimate: raised };
  const z = WD.stats({ wells });
  assert.equal(WD.deepText(z), 'Top of the range: one well 3.5 mi away on ground about 100 ft higher went to 1,200 ft (flowing artesian; location approximate (section centre)); ask a local driller.');
  assert.equal(WD.value(z), `${raised.lowFt}–1,200 ft`);
});

test('mostly drainage wells keep confidence low even with three comparable wells', () => {
  const near = [{ depthFt: 60, elevationFt: 2400 }, { depthFt: 70, elevationFt: 2410 }, { depthFt: 65, elevationFt: 2390 }];
  const valley = Array.from({ length: 7 }, () => ({ depthFt: 40, elevationFt: 2200 }));
  const wells = [...valley, ...near].map((w, i) => ({ id: String(i), distanceMi: 0.1 * (i + 1), staticFt: null, ...w }));
  const e = estimateWellDepth({ parcelElevationFt: 2400, wells });
  assert.equal(e.comparableCount, 3);
  assert.equal(e.drainage.mostly, true);
  assert.equal(e.confidence, 'low');
  assert.ok(e.depthFt > 70, 'valley wells count at their elevation-adjusted depth (40 + 200 ft)');
});

test('no elevation data: the service says so and the browser falls back, labelled low confidence', async () => {
  yellowstone('down');
  const a = await wellDepthTerrain({ state: 'MT', lat: HOME.lat, lon: HOME.lon }, { budgetMs: 4000 });
  assert.equal(a.available, false);
  assert.equal(a.status, 'elevation_unavailable');

  const h = makeLazyContext();
  h.run(readPublic('screening-inputs.js'));
  const WD = h.context.AcresXWellDepth;
  const wells = [40, 53, 45, 60, 200].map(d => ({ properties: { CompletedDepth: d, WellProjectType: 'Groundwater well' } }));
  wells.terrain = a;
  const s = WD.stats({ wells });
  assert.equal(s.method, 'nearest');
  assert.equal(s.confidence, 'low');
  assert.equal(s.feet, 53, "today's closest-five median");
  assert.equal(s.highFt, 80, 'widened: 1.5x the median');
  assert.equal(s.planningDepth, 80);
  assert.match(WD.label(s), /elevation not checked, low confidence/);
  assert.equal(WD.value(s), '53–80 ft');
  assert.equal(WD.grade(s).label, 'Uncertain', 'never "Shallow" at low confidence');
  assert.equal(WD.caution(s), WD.NOT_CHECKED);
  // Without any terrain answer at all (older callers): the same fallback.
  const plain = wells.slice();
  assert.equal(WD.stats({ wells: plain }).terrainStatus, 'not_checked');
  assert.equal(WD.grade(WD.stats({ wells: plain })).key, 'uncertain');
});

test('POST /api/well-depth-terrain: an estimate is cacheable, a failed one is not', async () => {
  yellowstone();
  // Tiles answer 404 here and getSamples fills every point: still a complete, cacheable answer.
  const post = body => worker.fetch(new Request('https://acresx.test/api/well-depth-terrain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), {}, { waitUntil() {} });
  const ok = await post({ state: 'MT', lat: HOME.lat, lon: HOME.lon });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('Cache-Control'), /max-age=3600/);
  assert.equal((await ok.json()).estimate.confidence, 'low');
  yellowstone('down');
  const failed = await post({ state: 'MT', lat: HOME.lat + 0.01, lon: HOME.lon });
  assert.equal(failed.headers.get('Cache-Control'), 'no-store');
  assert.equal((await failed.json()).available, false);
  const other = await post({ state: 'OR', lat: 45, lon: -120 });
  assert.equal((await other.json()).status, 'not_supported');
  assert.equal((await post({ state: 'MT' })).status, 400);
});

// ---- Point elevations

const tileLonLat = (x, y, z = 14) => {
  const n = 2 ** z;
  return { lon: x / n * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI };
};

test('point elevations: terrain tiles first within the tile budget, 3DEP getSamples for the rest', async () => {
  const inTile = [tileLonLat(2878.3, 5726.4), tileLonLat(2878.7, 5726.6)];
  const far = { lon: inTile[0].lon + 1, lat: inTile[0].lat };
  stub([
    [`${TERRAIN_TILES_URL}/14/2878/5726.png`, () => new Response(TILE_PNG, { status: 200, headers: { 'Content-Type': 'image/png' } })],
    [TERRAIN_TILES_URL, () => new Response('', { status: 404 })],
    [`${ELEVATION_IMAGE_SERVICE}/getSamples`, (url, body) => jsonResponse({ samples: pointsOf(body).map((p, i) => ({ locationId: i, value: '1000' })) })]
  ]);
  const r = await pointElevationsFt([...inTile, far], { tileBudget: 1 });
  assert.deepEqual(r.from, [POINT_SOURCES.tiles, POINT_SOURCES.tiles, POINT_SOURCES.usgs]);
  assert.ok(r.values[0] > 1000 && r.values[0] < 10000, `tile value ${r.values[0]} ft`);
  assert.ok(Math.abs(r.values[2] - 3280.84) < 0.1, '1000 m from 3DEP');
  assert.equal(calls.filter(c => c.url.startsWith(TERRAIN_TILES_URL)).length, 1, 'the far group was over the tile budget');
  assert.equal(pointsOf(calls.find(c => c.url.includes('/getSamples')).body).length, 1, 'only the missing point');
  // Everything down: nulls, never a rejection.
  stub([]);
  clearTerrainTileMemo();
  const down = await pointElevationsFt([far], { budgetMs: 2000 });
  assert.deepEqual(down.values, [null]);
  assert.ok(down.errors[POINT_SOURCES.usgs]);
});

// ---- The browser wrapper (public/well-terrain.js)

const SQUARE = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-108.546, 45.701], [-108.544, 45.701], [-108.544, 45.703], [-108.546, 45.703], [-108.546, 45.701]]] } };

test('homesite point: the area centroid when inside; a true interior point for a concave parcel', () => {
  const { ctx } = wrapperContext({ terrainAnswer: {}, wells: () => [] });
  const H = ctx.AcresXWellTerrain.homesite;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  // A trapezoid: the vertex average (turf.centroid) and the area centroid differ.
  const trap = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [3, 1], [1, 1], [0, 0]]] };
  const [tx, ty] = H({ geometry: trap });
  assert.ok(near(tx, 2) && near(ty, 4 / 9), `area centroid (2, 0.444), got (${tx}, ${ty}); the vertex average would be (2, 0.5)`);
  // A C-shaped parcel whose area centroid falls in the notch, outside the parcel.
  const c = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 1], [1, 1], [1, 2], [3, 2], [3, 3], [0, 3], [0, 0]]] };
  const [cx, cy] = H({ geometry: c });
  const insideC = (x, y) => x > 0 && x < 3 && y > 0 && y < 3 && !(x > 1 && y > 1 && y < 2);
  assert.ok(insideC(cx, cy), `interior point (${cx}, ${cy})`);
  assert.ok(cx > 0 && cx < 1, 'in the spine of the C, the only inside span at that latitude');
  // MultiPolygon: the largest part.
  const multi = { type: 'MultiPolygon', coordinates: [[[[10, 10], [10.1, 10], [10.1, 10.1], [10, 10.1], [10, 10]]], trap.coordinates] };
  const [mx, my] = H({ geometry: multi });
  assert.ok(near(mx, 2) && near(my, 4 / 9));
  assert.equal(H({ properties: {} }), null, 'no geometry: no point (no request)');
});

function wrapperContext({ terrainAnswer, terrainDelayMs = 0, wells }) {
  const fetches = [];
  const ctx = {
    console, AbortController, setTimeout, clearTimeout, Promise, JSON, Number, String,
    turf: { centroid: () => ({ geometry: { coordinates: [-108.545, 45.702] } }), booleanPointInPolygon: () => true },
    document: { getElementById: id => (id === 'state' ? { value: 'MT' } : null) },
    fetch: async (url, init) => {
      fetches.push({ url, body: JSON.parse(init.body) });
      if (terrainDelayMs) await new Promise((resolve, reject) => { const t = setTimeout(resolve, terrainDelayMs); init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }); });
      return { json: async () => terrainAnswer };
    },
    findWells: async () => wells()
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readPublic('well-terrain.js'), ctx);
  return { ctx, fetches };
}

test('well-terrain.js attaches the terrain answer to the wells list; failures and lookups that failed pass through', async () => {
  const answer = { available: true, estimate: { confidence: 'low', depthFt: 250 } };
  const { ctx, fetches } = wrapperContext({ terrainAnswer: answer, wells: () => [{ properties: { CompletedDepth: 53 } }] });
  const wells = await ctx.findWells(SQUARE);
  assert.equal(wells.length, 1);
  assert.equal(wells.terrain.estimate.depthFt, 250);
  assert.equal(fetches[0].url, '/api/well-depth-terrain');
  assert.deepEqual(fetches[0].body, { state: 'MT', lat: 45.702, lon: -108.545 }, 'the square parcel\'s centre');
  assert.equal(ctx.findWells.__terrain, true);

  const failedList = () => { const f = []; f.lookupFailed = true; return f; };
  const failed = await wrapperContext({ terrainAnswer: answer, wells: failedList }).ctx.findWells(SQUARE);
  assert.equal(failed.lookupFailed, true);
  assert.equal(failed.terrain, undefined, 'a failed well lookup stays a failure');
});

test('well-terrain.js: a slow terrain answer is dropped at the wait limit (fallback, not a timeout)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctx } = wrapperContext({ terrainAnswer: { available: true }, terrainDelayMs: 60000, wells: () => [{ properties: { CompletedDepth: 53 } }] });
  const pending = ctx.findWells(SQUARE);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  t.mock.timers.tick(12500);
  const wells = await pending;
  assert.equal(wells.terrain.status, 'timeout');
  assert.equal(wells.length, 1);
});

// ---- Cache key

test('cache key: a valid Cache API URL that includes the rules version', async () => {
  // The old bare 'well-depth-terrain-v1' prefix could not form a Request URL, so nothing was cached.
  assert.match(WELL_TERRAIN_CACHE_PREFIX, /^https:\/\/acresx\.internal\/cache\/well-depth-terrain\/v\d+\/$/);
  assert.ok(Number.isInteger(WELL_TERRAIN_RULES_VERSION) && WELL_TERRAIN_RULES_VERSION >= 3);
  const key = wellTerrainCacheKey('MT', 45.701312, -108.546631);
  assert.deepEqual({ ...key }, { rules: WELL_TERRAIN_RULES_VERSION, state: 'MT', lat: 45.7013, lon: -108.5466 });
  const url = (await valueCacheKey(WELL_TERRAIN_CACHE_PREFIX, key)).url;
  assert.ok(url.startsWith(WELL_TERRAIN_CACHE_PREFIX));
  const older = (await valueCacheKey(WELL_TERRAIN_CACHE_PREFIX, { ...key, rules: WELL_TERRAIN_RULES_VERSION - 1 })).url;
  assert.notEqual(url, older, 'answers cached under older rules are never read');

  // The route stores and reads under that key.
  yellowstone();
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? new Response(hit) : undefined; },
    async put(req, res) { store.set(req.url, await res.text()); }
  } };
  const post = () => worker.fetch(new Request('https://acresx.test/api/well-depth-terrain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'MT', lat: HOME.lat, lon: HOME.lon }) }), {}, { waitUntil() {} });
  const first = await (await post()).json();
  const expected = (await valueCacheKey(WELL_TERRAIN_CACHE_PREFIX, wellTerrainCacheKey('MT', HOME.lat, HOME.lon))).url;
  assert.deepEqual([...store.keys()], [expected]);
  const upstream = calls.length;
  const second = await (await post()).json();
  assert.equal(calls.length, upstream, 'served from the cache');
  assert.deepEqual(second, first);
});
