// Offline tests for batched elevation / tree-canopy sampling (src/services/elevation.js) behind
// /api/land-analysis and /api/slope-grid. fetch is stubbed with responses recorded live on
// 2026-10-27; no live USGS, USFS or USDA calls.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import {
  ELEVATION_IMAGE_SERVICE, EPQS_URL, SAMPLE_INTERPOLATION, POINT_FALLBACK_MAX_POINTS, getSamples
} from '../src/services/elevation.js';
import { TCC_SERVICE, CANOPY_FALLBACK_MAX_POINTS, TERRAIN_CACHE_PREFIX, CANOPY_CACHE_PREFIX } from '../src/services/land-analysis.js';
import { SLOPE_CACHE_PREFIX } from '../src/services/slope-grid.js';

const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const recorded = fixture('elevation-getsamples.json');
const legacy = fixture('elevation-legacy-snapshot.json');
const batched = fixture('elevation-batched-snapshot.json');
const geometry = recorded.geometry;

const SOIL_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
const soilBody = { Table: [['mukey', 'muname', 'compname', 'comppct_r', 'drainagecl', 'hydgrp', 'slope_r'], ['1', 'Test loam', 'Test', '85', 'Well drained', 'B', '12']] };

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const kind = url => {
  if (url.startsWith(`${ELEVATION_IMAGE_SERVICE}/getSamples`)) return '3dep';
  if (url.startsWith(`${TCC_SERVICE}/getSamples`)) return 'tcc';
  if (url.startsWith(`${TCC_SERVICE}/identify`)) return 'tccIdentify';
  if (url.startsWith(EPQS_URL)) return 'epqs';
  if (url.startsWith(SOIL_URL)) return 'soil';
  if (url.startsWith(ELEVATION_IMAGE_SERVICE)) return '3depOther';
  return 'other';
};
const pointsOf = body => JSON.parse(new URLSearchParams(String(body)).get('geometry')).points;

// The recorded answer for a getSamples request, after checking the request matches the recording.
function recordedSamples(service, body) {
  const points = pointsOf(body);
  const entry = recorded.getSamples[`${service}:${points.length}`];
  assert.ok(entry, `no recorded ${service} getSamples for ${points.length} points`);
  assert.deepEqual(points, JSON.parse(entry.request.geometry).points);
  return structuredClone(entry.response);
}
// Deterministic EPQS answer in the recorded EPQS shape (feet), sloping east and north.
const epqsAnswer = url => {
  const u = new URL(url);
  const x = Number(u.searchParams.get('x')), y = Number(u.searchParams.get('y'));
  return jsonResponse({ ...legacy.samples.epqs, location: { x, y, spatialReference: { wkid: 4326 } }, value: 2500 + (x + 116.76) * 20000 + (y - 47.5446) * 30000 });
};
const identifyAnswer = () => jsonResponse(legacy.samples.tccIdentify);

// handlers: { [kind]: (call, nthOfKind) => Response | throws }. Default: recorded success.
function stubFetch(handlers = {}) {
  const seen = {};
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const k = kind(url);
    seen[k] = (seen[k] || 0) + 1;
    const call = { url, kind: k, method: init.method || 'GET', body: init.body == null ? null : String(init.body), headers: init.headers || {}, cf: init.cf };
    calls.push(call);
    if (handlers[k]) return handlers[k](call, seen[k]);
    if (k === '3dep' || k === 'tcc') return jsonResponse(recordedSamples(k, call.body));
    if (k === 'soil') return jsonResponse(soilBody);
    if (k === 'epqs') return epqsAnswer(url);
    if (k === 'tccIdentify') return identifyAnswer();
    throw new Error(`unexpected upstream call: ${url}`);
  };
}
const count = k => calls.filter(c => c.kind === k).length;
const fail = () => { throw new Error('network down'); };

function fakeCache({ throws = false } = {}) {
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { if (throws) throw new Error('cache down'); const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { if (throws) throw new Error('cache down'); store.set(req.url, res.clone()); }
  } };
  return store;
}

beforeEach(() => { calls = []; delete globalThis.caches; });
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

async function post(route, body = { geometry }) {
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  const response = await worker.fetch(new Request(`https://acresx.test${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }), {}, ctx);
  await Promise.all(pending);
  return { response, body: await response.json() };
}
const landAnalysis = () => post('/api/land-analysis');
const slopeGrid = () => post('/api/slope-grid');

// Same keys and types everywhere, same strings/booleans, numbers within `tolerance`.
function assertSameShape(actual, expected, tolerance, path = '$') {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', `${path} type`);
    assert.ok(Math.abs(actual - expected) <= tolerance, `${path}: ${actual} vs ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path} array`);
    assert.equal(actual.length, expected.length, `${path} length`);
    expected.forEach((v, i) => assertSameShape(actual[i], v, tolerance, `${path}[${i}]`));
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path} keys`);
    for (const key of Object.keys(expected)) assertSameShape(actual[key], expected[key], tolerance, `${path}.${key}`);
  } else {
    assert.equal(actual, expected, path);
  }
}

// --- normal path -----------------------------------------------------------------------------

test('land-analysis: terrain and canopy come from one getSamples request each', async () => {
  stubFetch();
  const { response, body } = await landAnalysis();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), legacy.landAnalysis.cacheControl);
  assert.deepEqual(body.terrain, batched.landAnalysis.terrain);
  assert.deepEqual(body.landCover, batched.landAnalysis.landCover);
  assert.equal(body.soil.available, true);
  assert.equal(count('3dep'), 1);
  assert.equal(count('tcc'), 1);
  assert.equal(calls.length, 3, 'soil + terrain + canopy');

  for (const call of calls.filter(c => c.kind === '3dep' || c.kind === 'tcc')) {
    assert.equal(call.method, 'POST');
    assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const params = new URLSearchParams(call.body);
    assert.equal(params.get('geometryType'), 'esriGeometryMultipoint');
    assert.equal(params.get('returnFirstValueOnly'), 'true');
    assert.equal(params.get('interpolation'), SAMPLE_INTERPOLATION);
    assert.equal(params.get('f'), 'json');
    assert.deepEqual(JSON.parse(params.get('geometry')).spatialReference, { wkid: 4326 });
    assert.equal(call.cf, undefined, 'no edge caching of upstream bodies (errors arrive as HTTP 200)');
  }
});

test('slope grid: 25 points in one getSamples request', async () => {
  stubFetch();
  const { response, body } = await slopeGrid();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), legacy.slopeGrid.cacheControl);
  assert.deepEqual(body, batched.slopeGrid);
  assert.equal(body.cells.length, 16);
  assert.equal(calls.length, 1);
  assert.equal(pointsOf(calls[0].body).length, 25);
});

test('shape snapshot: batched answers match the legacy per-point answers for the same parcel', async () => {
  stubFetch();
  const land = (await landAnalysis()).body;
  // Legacy values came from EPQS (feet); getSamples nearest-neighbour meters x 3.2808 agree to
  // ~0.0015 ft. Canopy values are identical.
  assertSameShape(land.terrain, legacy.landAnalysis.terrain, 0.01);
  assert.deepEqual(land.landCover, legacy.landAnalysis.landCover);
  calls = [];
  const slope = (await slopeGrid()).body;
  assertSameShape(slope, legacy.slopeGrid.body, 0.01);
  assert.deepEqual(slope.cells.map(c => c.band), legacy.slopeGrid.body.cells.map(c => c.band));
});

test('getSamples maps samples by locationId, not response order', async () => {
  stubFetch({ '3dep': call => {
    const answer = recordedSamples('3dep', call.body);
    answer.samples.reverse();
    return jsonResponse(answer);
  } });
  const { body } = await slopeGrid();
  assert.deepEqual(body, batched.slopeGrid);
});

// --- retry and fallback ----------------------------------------------------------------------

test('getSamples fails once, the retry succeeds', async () => {
  stubFetch({
    '3dep': (call, n) => n === 1 ? new Response('busy', { status: 503 }) : jsonResponse(recordedSamples('3dep', call.body)),
    tcc: (call, n) => n === 1 ? jsonResponse({ error: { code: 500, message: 'Error performing getSamples' } }) : jsonResponse(recordedSamples('tcc', call.body))
  });
  const { body } = await landAnalysis();
  assert.deepEqual(body.terrain, batched.landAnalysis.terrain);
  assert.deepEqual(body.landCover, batched.landAnalysis.landCover);
  assert.equal(count('3dep'), 2);
  assert.equal(count('tcc'), 2);
  assert.equal(count('epqs'), 0);
  assert.equal(count('tccIdentify'), 0);
});

test('getSamples fails twice: terrain and canopy use the capped per-point fallback', async () => {
  stubFetch({ '3dep': fail, tcc: () => new Response('down', { status: 502 }) });
  const { body } = await landAnalysis();
  assert.equal(count('3dep'), 2);
  assert.equal(count('tcc'), 2);
  assert.equal(count('epqs'), 9);
  assert.equal(count('tccIdentify'), CANOPY_FALLBACK_MAX_POINTS);
  assert.equal(body.terrain.available, true);
  assert.equal(body.terrain.sampleCount, 9);
  assertSameShape(body.terrain, batched.landAnalysis.terrain, Infinity);
  assert.equal(body.landCover.available, true);
  assert.equal(body.landCover.requestedSamples, CANOPY_FALLBACK_MAX_POINTS);
  assert.equal(body.landCover.sampleCount, CANOPY_FALLBACK_MAX_POINTS);
  assert.equal(body.landCover.woodedPct, Number(legacy.samples.tccIdentify.value));
  for (const call of calls.filter(c => c.kind === 'epqs')) {
    assert.equal(new URL(call.url).searchParams.get('units'), 'Feet');
  }
});

test('getSamples fails twice: slope grid falls back to a 3 x 3 EPQS grid (partial)', async () => {
  stubFetch({ '3dep': fail });
  const { response, body } = await slopeGrid();
  assert.equal(count('3dep'), 2);
  assert.equal(count('epqs'), POINT_FALLBACK_MAX_POINTS);
  assert.equal(calls.length, 11);
  assert.equal(response.status, 200);
  assert.equal(body.available, true);
  assert.equal(body.resolution, '2 x 2 parcel grid');
  assert.equal(body.requestedSamples, 9);
  assert.equal(body.sampleCount, 9);
  assert.equal(body.partial, true);
  assert.equal(body.cells.length, 4);
  assert.deepEqual(Object.keys(body).sort(), Object.keys(batched.slopeGrid).sort());
  assert.deepEqual(Object.keys(body.cells[0]).sort(), Object.keys(batched.slopeGrid.cells[0]).sort());
});

test('slope grid fallback with too few EPQS answers is unavailable, not an error', async () => {
  stubFetch({ '3dep': fail, epqs: (call, n) => n <= 6 ? fail() : epqsAnswer(call.url) });
  const { response, body } = await slopeGrid();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(body.available, false);
  assert.equal(body.sampleCount, 3);
  assert.equal(body.requestedSamples, 9);
});

// --- NoData ----------------------------------------------------------------------------------

test('NoData points: slope grid drops them and reports partial', async () => {
  stubFetch({ '3dep': call => {
    const answer = recordedSamples('3dep', call.body);
    answer.samples = answer.samples.filter(s => s.locationId !== 0 && s.locationId !== 12);
    return jsonResponse(answer);
  } });
  const { body } = await slopeGrid();
  assert.equal(body.available, true);
  assert.equal(body.sampleCount, 23);
  assert.equal(body.requestedSamples, 25);
  assert.equal(body.partial, true);
  assert.equal(body.cells.length, 16 - 1 - 4, 'cells touching a missing corner are skipped');
});

test('NoData points: terrain degrades alone; canopy drops out-of-range values', async () => {
  stubFetch({
    '3dep': call => {
      const answer = recordedSamples('3dep', call.body);
      answer.samples = answer.samples.filter(s => s.locationId !== 4);
      return jsonResponse(answer);
    },
    tcc: call => {
      const answer = recordedSamples('tcc', call.body);
      answer.samples.slice(0, 5).forEach(s => { s.value = '255'; });
      return jsonResponse(answer);
    }
  });
  const { body } = await landAnalysis();
  assert.equal(body.available, true);
  assert.equal(body.terrain.available, false);
  assert.match(body.terrain.error, /unavailable for 1 of 9/);
  assert.equal(body.landCover.available, true);
  assert.equal(body.landCover.sampleCount, 31);
  assert.equal(body.landCover.requestedSamples, 36);
  assert.equal(body.soil.available, true);
});

test('getSamples treats an empty or non-numeric value as NoData', async () => {
  stubFetch({ '3dep': () => jsonResponse({ samples: [
    { locationId: 0, value: '701.5' }, { locationId: 1, value: '' }, { locationId: 2, value: 'NoData' }, { locationId: 9, value: '1' }
  ] }) });
  const values = await getSamples(ELEVATION_IMAGE_SERVICE, [{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }, { lon: 5, lat: 6 }]);
  assert.deepEqual(values, [701.5, null, null]);
});

// --- request budget --------------------------------------------------------------------------

test('request budget: normal path is 1 request per layer; worst case stays under 40', async () => {
  stubFetch();
  await landAnalysis();
  assert.ok(count('3dep') <= 3 && count('tcc') <= 3);
  assert.equal(calls.length, 3);

  calls = [];
  stubFetch();
  await slopeGrid();
  assert.ok(calls.length <= 3);

  // Everything down: every layer degrades, the route still answers.
  calls = [];
  stubFetch({ soil: fail, '3dep': fail, tcc: fail, epqs: fail, tccIdentify: fail });
  const { response, body } = await landAnalysis();
  assert.equal(response.status, 200);
  assert.equal(body.available, false);
  assert.equal(body.terrain.available, false);
  assert.equal(body.landCover.available, false);
  assert.equal(body.soil.available, false);
  assert.equal(calls.length, 1 + (2 + 9) + (2 + CANOPY_FALLBACK_MAX_POINTS));
  assert.ok(calls.length < 40, `land-analysis worst case made ${calls.length} requests`);

  calls = [];
  stubFetch({ '3dep': fail, epqs: fail });
  const slope = await slopeGrid();
  assert.equal(slope.body.available, false);
  assert.equal(calls.length, 2 + 9);
});

// --- cache -----------------------------------------------------------------------------------

test('cache: successes are reused, keyed per layer by rounded geometry', async () => {
  const store = fakeCache();
  stubFetch();
  await landAnalysis();
  await slopeGrid();
  const keys = [...store.keys()];
  assert.equal(keys.length, 3);
  assert.ok(keys.some(k => k.startsWith(TERRAIN_CACHE_PREFIX)));
  assert.ok(keys.some(k => k.startsWith(CANOPY_CACHE_PREFIX)));
  assert.ok(keys.some(k => k.startsWith(SLOPE_CACHE_PREFIX)));

  calls = [];
  stubFetch();
  const land = (await landAnalysis()).body;
  const slope = (await slopeGrid()).body;
  assert.deepEqual(calls.map(c => c.kind), ['soil'], 'only soil goes upstream on a cache hit');
  assert.deepEqual(land.terrain, batched.landAnalysis.terrain);
  assert.deepEqual(land.landCover, batched.landAnalysis.landCover);
  assert.deepEqual(slope, batched.slopeGrid);

  // A geometry differing only past 6 decimals shares the key.
  calls = [];
  const nudged = structuredClone(geometry);
  nudged.coordinates[0][0][0] += 1e-9;
  await post('/api/slope-grid', { geometry: nudged });
  assert.equal(calls.length, 0);
});

test('cache: failures, fallbacks and partial answers are never stored', async () => {
  const store = fakeCache();
  stubFetch({ '3dep': fail, tcc: fail });
  await landAnalysis();
  await slopeGrid();
  assert.equal(store.size, 0, 'fallback answers are not cached');

  stubFetch({ '3dep': call => {
    const answer = recordedSamples('3dep', call.body);
    answer.samples = answer.samples.slice(1);
    return jsonResponse(answer);
  }, tcc: call => {
    const answer = recordedSamples('tcc', call.body);
    answer.samples = answer.samples.slice(1);
    return jsonResponse(answer);
  } });
  await landAnalysis();
  await slopeGrid();
  assert.equal(store.size, 0, 'terrain failure and partial canopy/slope answers are not cached');
});

test('cache guard: works without caches and when the cache throws', async () => {
  stubFetch();
  assert.equal(typeof globalThis.caches, 'undefined');
  assert.deepEqual((await slopeGrid()).body, batched.slopeGrid);

  fakeCache({ throws: true });
  calls = [];
  stubFetch();
  const land = (await landAnalysis()).body;
  assert.deepEqual(land.terrain, batched.landAnalysis.terrain);
  assert.deepEqual((await slopeGrid()).body, batched.slopeGrid);
});
