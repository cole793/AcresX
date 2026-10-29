// Offline tests for the flood layer (src/services/flood.js) routed through src/index.js.
// fetch is stubbed per test; no live FEMA or Esri calls.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import {
  FEMA_NFHL_FLOOD_LAYER, ESRI_USA_FLOOD_HAZARD_LAYER, FEMA_PROVIDER, ESRI_PROVIDER, ESRI_FALLBACK_ENABLED, ESRI_COVERAGE,
  FEMA_TIMEOUT_MS, FEMA_RETRY_TIMEOUT_MS, FEMA_RETRY_BACKOFF_MS, FALLBACK_TIMEOUT_MS, MAX_GET_URL_LENGTH,
  CACHE_KEY_PREFIX, FLOOD_CATEGORIES, floodScreening, buildQueryRequest, summarizeFloodRows
} from '../src/services/flood.js';

const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const femaSample = fixture('fema-nfhl-flood.json');
const legacySnapshot = fixture('flood-legacy-snapshot.json');

const geometry = { type: 'Polygon', coordinates: [[[-116.8, 47.7], [-116.79, 47.7], [-116.79, 47.71], [-116.8, 47.71], [-116.8, 47.7]]] };
// A detailed boundary (400 vertices) whose GET URL is far over the limit.
const bigGeometry = { type: 'Polygon', coordinates: [Array.from({ length: 401 }, (_, i) => {
  const a = (i % 400) / 400 * 2 * Math.PI;
  return [-116.8 + 0.01 * Math.cos(a) + i * 1e-7, 47.7 + 0.01 * Math.sin(a)];
})] };
bigGeometry.coordinates[0][400] = bigGeometry.coordinates[0][0];

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const empty = () => jsonResponse({ features: [] });
const status = code => () => new Response('', { status: code });
const isFema = url => url.startsWith(`${FEMA_NFHL_FLOOD_LAYER}/query`);
const isEsri = url => url.startsWith(`${ESRI_USA_FLOOD_HAZARD_LAYER}/query`);
const esriAE = () => jsonResponse({ features: [{ attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T', esri_symbology: '1% Annual Chance Flood Hazard' } }] });

// Each handler gets the URL and returns a Response or throws. Handlers are used in call order.
function stubFetch(...handlers) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, method: init.method || 'GET', body: init.body, headers: init.headers || {}, cf: init.cf });
    const handler = handlers[calls.length - 1];
    if (!handler) throw new Error(`unexpected upstream call #${calls.length}: ${url}`);
    return handler(url);
  };
}
const urls = () => calls.map(c => c.url);
// What a failed FEMA call adds to the answer (src/shared/fallback.js; public/browser-fallback.js).
const femaHint = { mode: 'browser', kind: 'fema-flood', input: { geometry } };

function fakeCache() {
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); }
  } };
  return store;
}

beforeEach(() => { calls = []; delete globalThis.caches; });
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

async function floodCall(body = { kind: 'flood', geometry }, ctx = { waitUntil() {} }) {
  const request = new Request('https://acresx.test/api/hazards', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const response = await worker.fetch(request, {}, ctx);
  return { response, body: await response.json() };
}

// --- FEMA primary ----------------------------------------------------------------------------

test('flood: FEMA success returns the legacy shape plus source', async () => {
  stubFetch(url => { assert.ok(isFema(url)); return jsonResponse(femaSample); });
  const { response, body } = await floodCall();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    available: true, intersects: true, high: true, zones: ['AE', 'X'],
    zoneDetails: [{ zone: 'AE', subtype: null, sfha: true }, { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false }],
    category: 'high', source: { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER }
  });
  assert.equal(calls.length, 1);
});

test('flood: success keys and values match the legacy snapshot (only source, zoneDetails, category added)', async () => {
  stubFetch(() => jsonResponse(femaSample));
  const { response, body } = await floodCall();
  assert.equal(response.status, legacySnapshot.status);
  assert.equal(response.headers.get('Cache-Control'), legacySnapshot.cacheControl);
  const { source, zoneDetails, category, ...rest } = body;
  assert.ok(source);
  assert.ok(Array.isArray(zoneDetails));
  assert.ok(FLOOD_CATEGORIES.includes(category));
  assert.deepEqual(Object.keys(rest), Object.keys(legacySnapshot.body));
  assert.deepEqual(rest, legacySnapshot.body);
});

test('flood: FEMA empty answer is authoritative: one request, no flag, cached', async () => {
  const store = fakeCache();
  const pending = [];
  stubFetch(empty);
  const { response, body } = await floodCall(undefined, { waitUntil(p) { pending.push(p); } });
  await Promise.all(pending);
  assert.equal(response.status, 200);
  assert.deepEqual(body, { available: true, intersects: false, high: false, zones: [], zoneDetails: [], category: 'not_mapped', source: { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER } });
  assert.equal(response.headers.get('Cache-Control'), legacySnapshot.cacheControl);
  assert.equal(calls.length, 1, 'no retry on an empty FEMA answer');
  assert.equal(store.size, 1);
});

test('flood: FEMA 525 then retry success', async () => {
  stubFetch(status(525), () => jsonResponse(femaSample));
  const { response, body } = await floodCall();
  assert.equal(response.status, 200);
  assert.equal(body.source.provider, FEMA_PROVIDER);
  assert.deepEqual(body.zones, ['AE', 'X']);
  assert.equal(calls.length, 2);
  assert.ok(urls().every(isFema));
});

test('flood: FEMA timeout then retry success', async () => {
  const abort = () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  stubFetch(abort, () => jsonResponse(femaSample));
  const { body } = await floodCall();
  assert.equal(body.available, true);
  assert.equal(calls.length, 2);
});

test('flood: FEMA 525 then empty retry is an authoritative empty answer', async () => {
  stubFetch(status(525), empty);
  const { body } = await floodCall();
  assert.deepEqual(body.source, { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER });
  assert.equal(body.intersects, false);
  assert.equal(calls.length, 2);
});

test('flood: FEMA invalid JSON then retry success', async () => {
  stubFetch(() => new Response('<html>busy</html>', { status: 200 }), () => jsonResponse(femaSample));
  const { body } = await floodCall();
  assert.deepEqual(body.zones, ['AE', 'X']);
  assert.equal(body.source.provider, FEMA_PROVIDER);
  assert.equal(calls.length, 2);
  assert.ok(urls().every(isFema));
});

test('flood: no upstream request carries cf edge-cache options (HTTP-200 error bodies must not be edge-cached)', async () => {
  stubFetch(status(525), status(525), esriAE);
  await floodCall();
  assert.equal(calls.length, 3);
  for (const call of calls) assert.equal(call.cf, undefined, call.url);
  assert.ok(isEsri(calls[2].url));
  assert.equal(calls[2].method, 'GET');
  calls = [];
  stubFetch(() => jsonResponse(femaSample));
  await floodCall();
  assert.equal(calls[0].cf, undefined);
  assert.equal('cf' in buildQueryRequest(FEMA_NFHL_FLOOD_LAYER, geometry, 'FLD_ZONE').init, false);
  assert.equal('cf' in buildQueryRequest(FEMA_NFHL_FLOOD_LAYER, bigGeometry, 'FLD_ZONE').init, false);
});

// --- Esri fallback ---------------------------------------------------------------------------

test('flood: Esri fallback points at the official esri_landscapes layer and is on', () => {
  assert.equal(ESRI_USA_FLOOD_HAZARD_LAYER, 'https://services5.arcgis.com/7weheFjxuNkGGiZi/arcgis/rest/services/USA_Flood_Hazard_Areas_view/FeatureServer/0');
  assert.equal(ESRI_FALLBACK_ENABLED, true);
  assert.equal(ESRI_COVERAGE, 'high-and-moderate-risk-only');
});

test('flood: FEMA fails twice, Esri AE is high risk, carries coverage, and is cached', async () => {
  const store = fakeCache();
  const pending = [];
  stubFetch(status(525), () => { throw new TypeError('fetch failed'); }, url => { assert.ok(isEsri(url)); return esriAE(); });
  const { response, body } = await floodCall(undefined, { waitUntil(p) { pending.push(p); } });
  await Promise.all(pending);
  assert.equal(response.status, 200);
  const { fallback, ...rest } = body;
  const esriBody = {
    available: true, intersects: true, high: true, zones: ['AE'], zoneDetails: [{ zone: 'AE', subtype: null, sfha: true }], category: 'high',
    source: { provider: ESRI_PROVIDER, url: ESRI_USA_FLOOD_HAZARD_LAYER, coverage: ESRI_COVERAGE }
  };
  assert.deepEqual(rest, esriBody);
  assert.deepEqual(fallback, femaHint, 'FEMA failed (525, network), so the browser may ask FEMA itself');
  assert.equal(calls.length, 3);
  assert.equal(store.size, 1);
  assert.deepEqual(await [...store.values()][0].clone().json(), esriBody, 'the cached answer never carries the hint');
});

test('flood: Esri empty answer keeps the no-intersection shape, flagged, no-store, not cached', async () => {
  const store = fakeCache();
  const pending = [];
  stubFetch(status(525), status(525), empty);
  const { response, body } = await floodCall(undefined, { waitUntil(p) { pending.push(p); } });
  await Promise.all(pending);
  assert.equal(response.status, 200);
  const { source, fallback, ...rest } = body;
  assert.deepEqual(rest, { available: true, intersects: false, high: false, zones: [], zoneDetails: [], category: 'limited' });
  assert.deepEqual(fallback, femaHint);
  assert.deepEqual(source, { provider: ESRI_PROVIDER, url: ESRI_USA_FLOOD_HAZARD_LAYER, coverage: ESRI_COVERAGE, emptyResult: true });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(store.size, 0, 'Esri empty answers must never be cached');
});

test('flood: Esri maps lowercase fields and missing SFHA_TF', async () => {
  stubFetch(status(503), status(503), () => jsonResponse({ features: [
    { attributes: { fld_zone: 'A', zone_subty: null, esri_symbology: '1% Annual Chance Flood Hazard' } },
    { attributes: { Fld_Zone: 'X', esri_symbology: '0.2% Annual Chance Flood Hazard' } }
  ] }));
  const { body } = await floodCall();
  assert.deepEqual([body.high, body.intersects, body.zones], [true, true, ['A', 'X']]);
});

test('flood: Esri shaded X only, without SFHA_TF, is not high risk', async () => {
  stubFetch(status(503), status(503), () => jsonResponse({ features: [{ attributes: { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD' } }] }));
  const { body } = await floodCall();
  assert.deepEqual([body.high, body.intersects, body.zones, body.category], [false, true, ['X'], 'moderate']);
  assert.deepEqual(body.zoneDetails, [{ zone: 'X', subtype: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', sfha: null }]);
});

test('flood: an Esri X row with no subtype is moderate (that layer has no minimal X)', async () => {
  stubFetch(status(503), status(503), () => jsonResponse({ features: [{ attributes: { FLD_ZONE: 'X' } }] }));
  const { body } = await floodCall();
  assert.deepEqual([body.high, body.category], [false, 'moderate']);
});

// --- zone categories (owner-approved table, 2026-10-26) ---------------------------------------

const femaRows = (...attributes) => () => jsonResponse({ features: attributes.map(a => ({ attributes: a })) });

const CATEGORY_CASES = [
  ['X minimal', [{ FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' }], 'minimal', false],
  ['X no subtype', [{ FLD_ZONE: 'X', ZONE_SUBTY: null, SFHA_TF: 'F' }], 'minimal', false],
  ['C', [{ FLD_ZONE: 'C', ZONE_SUBTY: null, SFHA_TF: 'F' }], 'minimal', false],
  ['X 0.2 PCT', [{ FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F' }], 'moderate', false],
  ['X levee', [{ FLD_ZONE: 'X', ZONE_SUBTY: 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE', SFHA_TF: 'F' }], 'moderate', false],
  ['B', [{ FLD_ZONE: 'B', ZONE_SUBTY: null, SFHA_TF: 'F' }], 'moderate', false],
  ['D', [{ FLD_ZONE: 'D', ZONE_SUBTY: null, SFHA_TF: 'F' }], 'undetermined', false],
  ['AE', [{ FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T' }], 'high', true],
  ['VE', [{ FLD_ZONE: 'VE', ZONE_SUBTY: null, SFHA_TF: 'T' }], 'high', true],
  ['A99 without SFHA_TF', [{ FLD_ZONE: 'A99' }], 'high', true],
  ['AE + X minimal (worst wins)', [{ FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' }, { FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T' }], 'high', true],
  ['X 0.2 + X minimal', [{ FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' }, { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F' }], 'moderate', false],
  ['D + X minimal', [{ FLD_ZONE: 'D', SFHA_TF: 'F' }, { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' }], 'undetermined', false],
  ['AREA NOT INCLUDED', [{ FLD_ZONE: 'AREA NOT INCLUDED', ZONE_SUBTY: null, SFHA_TF: 'F' }], 'not_mapped', false],
  ['AREA NOT INCLUDED without SFHA_TF', [{ FLD_ZONE: 'AREA NOT INCLUDED' }], 'not_mapped', false],
  ['OPEN WATER', [{ FLD_ZONE: 'OPEN WATER', SFHA_TF: 'F' }], 'not_mapped', false],
  ['AREA NOT INCLUDED + X minimal (not mapped outranks minimal)', [{ FLD_ZONE: 'AREA NOT INCLUDED' }, { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' }], 'not_mapped', false],
  ['D + X 0.2 PCT (undetermined 55 outranks moderate 70)', [{ FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F' }, { FLD_ZONE: 'D', SFHA_TF: 'F' }], 'undetermined', false],
  ['A + D', [{ FLD_ZONE: 'D', SFHA_TF: 'F' }, { FLD_ZONE: 'A', SFHA_TF: 'T' }], 'high', true],
  ['X 0.2 PCT + AREA NOT INCLUDED (known hazard wins the tie)', [{ FLD_ZONE: 'AREA NOT INCLUDED' }, { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F' }], 'moderate', false],
  ['rows without a zone', [{ FLD_ZONE: null }], 'not_mapped', false],
  ['empty', [], 'not_mapped', false]
];

for (const [name, rows, category, high] of CATEGORY_CASES) {
  test(`flood: category for FEMA ${name} is ${category} (high ${high})`, async () => {
    stubFetch(femaRows(...rows));
    const { body } = await floodCall();
    assert.equal(body.category, category);
    assert.equal(body.high, high);
    assert.equal(body.intersects, rows.length > 0, 'intersects keeps its meaning: any row');
    assert.equal(body.source.provider, FEMA_PROVIDER);
  });
}

test('flood: FLOOD_CATEGORIES ranks by score and includes limited', () => {
  assert.deepEqual(FLOOD_CATEGORIES, ['high', 'undetermined', 'moderate', 'not_mapped', 'minimal', 'limited']);
});

test('flood: zoneDetails are deduped and keep zone, subtype and SFHA flag', () => {
  const summary = summarizeFloodRows([
    { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' },
    { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' },
    { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F' },
    { 'S_FLD_HAZ_AR.FLD_ZONE': 'AE', 'S_FLD_HAZ_AR.SFHA_TF': 'T' },
    { FLD_ZONE: '' }
  ]);
  assert.deepEqual(summary.zones, ['X', 'AE']);
  assert.deepEqual(summary.zoneDetails, [
    { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false },
    { zone: 'X', subtype: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', sfha: false },
    { zone: 'AE', subtype: null, sfha: true }
  ]);
  assert.equal(summary.category, 'high');
});

test('flood: FEMA requests ask for FLD_ZONE, ZONE_SUBTY and SFHA_TF; cache key is v4', async () => {
  stubFetch(() => jsonResponse(femaSample));
  await floodCall();
  assert.equal(new URL(calls[0].url).searchParams.get('outFields'), 'FLD_ZONE,ZONE_SUBTY,SFHA_TF');
  assert.equal(CACHE_KEY_PREFIX, 'https://acresx.internal/cache/flood/v4/');
});

test('flood: FEMA 4xx skips the retry and goes to Esri', async () => {
  stubFetch(status(400), url => { assert.ok(isEsri(url)); return esriAE(); });
  const { body } = await floodCall();
  assert.equal(body.source.provider, ESRI_PROVIDER);
  assert.equal(calls.length, 2);
});

test('flood: both sources fail returns the unavailable shape naming both sources', async () => {
  stubFetch(status(525), status(525), () => jsonResponse({ error: { code: 499, message: 'Token Required' } }));
  const { response, body } = await floodCall();
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const { fallback, ...rest } = body;
  assert.deepEqual({ ...rest, error: undefined }, { available: false, intersects: false, high: false, zones: [], error: undefined, source: null });
  assert.deepEqual(fallback, femaHint);
  assert.match(body.error, /FEMA NFHL/);
  assert.match(body.error, /Esri USA Flood Hazard Areas/);
  assert.equal(calls.length, 3);
});

test('flood: with the fallback switched off, the error names only FEMA', async () => {
  stubFetch(status(525), status(525));
  const { status: code, body } = await floodScreening(geometry, {}, { esriFallback: false });
  assert.equal(code, 502);
  assert.doesNotMatch(body.error, /Esri/);
  assert.equal(calls.length, 2);
});

// --- GET vs POST -----------------------------------------------------------------------------

test('flood: short queries use GET with the params in the URL', async () => {
  const req = buildQueryRequest(FEMA_NFHL_FLOOD_LAYER, geometry, 'FLD_ZONE');
  assert.equal(req.init.method, 'GET');
  assert.ok(req.url.length <= MAX_GET_URL_LENGTH);
  stubFetch(() => jsonResponse(femaSample));
  await floodCall();
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/query\?f=json&/);
  assert.equal(calls[0].body, undefined);
});

test('flood: long queries use a form-encoded POST for FEMA and Esri', async () => {
  const getLength = `${FEMA_NFHL_FLOOD_LAYER}/query?${new URLSearchParams({ geometry: JSON.stringify(bigGeometry.coordinates) })}`.length;
  assert.ok(getLength > MAX_GET_URL_LENGTH, `test geometry must be long (${getLength})`);
  stubFetch(status(525), status(525), esriAE);
  const { body } = await floodCall({ kind: 'flood', geometry: bigGeometry });
  assert.equal(body.available, true);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.method, 'POST');
    assert.ok(call.url.endsWith('/query'), call.url);
    assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const params = new URLSearchParams(call.body);
    assert.equal(params.get('f'), 'json');
    assert.equal(params.get('geometryType'), 'esriGeometryPolygon');
    assert.equal(params.get('returnGeometry'), 'false');
    assert.equal(JSON.parse(params.get('geometry')).rings[0].length, 401);
  }
  assert.ok(isFema(calls[0].url) && isEsri(calls[2].url));
});

// --- budget ------------------------------------------------------------------------------------

test('flood: never more than 3 upstream requests', async () => {
  globalThis.fetch = async input => { calls.push({ url: String(input) }); throw new TypeError('fetch failed'); };
  assert.equal((await floodCall()).body.available, false);
  assert.equal(calls.length, 3);
});

test('flood: worst-case time budget is well under 30 s', () => {
  assert.ok(FEMA_TIMEOUT_MS + FEMA_RETRY_BACKOFF_MS + FEMA_RETRY_TIMEOUT_MS + FALLBACK_TIMEOUT_MS <= 25000);
});

test('flood: missing geometry answers JSON without upstream calls', async () => {
  stubFetch();
  const { response, body } = await floodCall({ kind: 'flood', lat: 47.7, lon: -116.8 });
  assert.equal(response.status, 400);
  assert.equal(body.available, false);
  assert.equal(calls.length, 0);
});

// --- cache -------------------------------------------------------------------------------------

test('flood: works when caches is undefined (Node)', async () => {
  assert.equal(typeof globalThis.caches, 'undefined');
  stubFetch(() => jsonResponse(femaSample), () => jsonResponse(femaSample));
  assert.equal((await floodCall()).body.available, true);
  assert.equal((await floodCall()).body.available, true);
  assert.equal(calls.length, 2, 'no cache, so each call goes upstream');
});

test('flood: caches.default stores successes and serves repeat calls', async () => {
  const store = fakeCache();
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  stubFetch(() => jsonResponse(femaSample));
  const first = await floodCall(undefined, ctx);
  await Promise.all(pending);
  assert.equal(store.size, 1);
  assert.match([...store.keys()][0], /^https:\/\/acresx\.internal\/cache\/flood\/v4\/[0-9a-f]{64}$/);
  // Tiny coordinate noise below the rounding precision hits the same key.
  const jittered = { type: 'Polygon', coordinates: [geometry.coordinates[0].map(([x, y]) => [x + 1e-9, y])] };
  const second = await floodCall({ kind: 'flood', geometry: jittered }, ctx);
  assert.deepEqual(second.body, first.body);
  assert.equal(calls.length, 1);
});

test('flood: a cached emptyResult entry is ignored', async () => {
  const store = fakeCache();
  stubFetch(() => jsonResponse(femaSample));
  await floodCall(undefined, {});
  const key = [...store.keys()][0];
  store.set(key, jsonResponse({ available: true, intersects: false, high: false, zones: [], source: { provider: ESRI_PROVIDER, emptyResult: true } }));
  calls = [];
  stubFetch(() => jsonResponse(femaSample));
  const { body } = await floodCall(undefined, {});
  assert.deepEqual(body.zones, ['AE', 'X']);
  assert.equal(calls.length, 1);
});

test('flood: failures are not cached', async () => {
  const store = fakeCache();
  globalThis.fetch = async input => { calls.push({ url: String(input) }); throw new TypeError('fetch failed'); };
  await floodCall();
  assert.equal(store.size, 0);
});

test('flood: a broken cache does not break the layer', async () => {
  globalThis.caches = { default: { async match() { throw new Error('cache down'); }, async put() { throw new Error('cache down'); } } };
  stubFetch(() => jsonResponse(femaSample));
  const { body } = await floodCall(undefined, {});
  assert.equal(body.available, true);
});
