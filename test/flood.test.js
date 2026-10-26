// Offline tests for the flood layer (src/services/flood.js) routed through src/index.js.
// fetch is stubbed per test; no live FEMA or Esri calls.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import {
  FEMA_NFHL_FLOOD_LAYER, ESRI_USA_FLOOD_HAZARD_LAYER, FEMA_PROVIDER, ESRI_PROVIDER, ESRI_FALLBACK_ENABLED, ESRI_COVERAGE,
  FEMA_TIMEOUT_MS, FEMA_RETRY_TIMEOUT_MS, FEMA_RETRY_BACKOFF_MS, FALLBACK_TIMEOUT_MS, MAX_GET_URL_LENGTH,
  floodScreening, buildQueryRequest
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
  assert.deepEqual(body, { available: true, intersects: true, high: true, zones: ['AE', 'X'], source: { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER } });
  assert.equal(calls.length, 1);
});

test('flood: success keys and values match the legacy snapshot (only source added)', async () => {
  stubFetch(() => jsonResponse(femaSample));
  const { response, body } = await floodCall();
  assert.equal(response.status, legacySnapshot.status);
  assert.equal(response.headers.get('Cache-Control'), legacySnapshot.cacheControl);
  const { source, ...rest } = body;
  assert.ok(source);
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
  assert.deepEqual(body, { available: true, intersects: false, high: false, zones: [], source: { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER } });
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

test('flood: FEMA GETs edge-cache 2xx only; the Esri request has no cf cache options', async () => {
  stubFetch(status(525), status(525), esriAE);
  await floodCall();
  for (const call of calls.slice(0, 2)) {
    assert.deepEqual(call.cf, { cacheTtlByStatus: { '200-299': 86400, '400-599': 0 }, cacheEverything: true });
    assert.equal('cacheTtl' in call.cf, false);
  }
  assert.ok(isEsri(calls[2].url));
  assert.equal(calls[2].method, 'GET');
  assert.equal(calls[2].cf, undefined, 'an Esri answer (possibly empty) must not be edge-cached');
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
  assert.deepEqual(body, { available: true, intersects: true, high: true, zones: ['AE'], source: { provider: ESRI_PROVIDER, url: ESRI_USA_FLOOD_HAZARD_LAYER, coverage: ESRI_COVERAGE } });
  assert.equal(calls.length, 3);
  assert.equal(store.size, 1);
});

test('flood: Esri empty answer keeps the no-intersection shape, flagged, no-store, not cached', async () => {
  const store = fakeCache();
  const pending = [];
  stubFetch(status(525), status(525), empty);
  const { response, body } = await floodCall(undefined, { waitUntil(p) { pending.push(p); } });
  await Promise.all(pending);
  assert.equal(response.status, 200);
  const { source, ...rest } = body;
  assert.deepEqual(rest, { available: true, intersects: false, high: false, zones: [] });
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
  assert.deepEqual([body.high, body.intersects, body.zones], [false, true, ['X']]);
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
  assert.deepEqual({ ...body, error: undefined }, { available: false, intersects: false, high: false, zones: [], error: undefined, source: null });
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
  assert.match([...store.keys()][0], /^https:\/\/acresx\.internal\/cache\/flood\/v3\/[0-9a-f]{64}$/);
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
