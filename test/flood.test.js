// Offline tests for the flood layer (src/services/flood.js) routed through src/index.js.
// fetch is stubbed per test; no live FEMA or Esri calls.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import {
  FEMA_NFHL_FLOOD_LAYER, ESRI_USA_FLOOD_HAZARD_LAYER, FEMA_PROVIDER, ESRI_PROVIDER, ESRI_FALLBACK_ENABLED,
  FEMA_TIMEOUT_MS, FEMA_RETRY_TIMEOUT_MS, FEMA_RETRY_BACKOFF_MS, FALLBACK_TIMEOUT_MS, floodScreening
} from '../src/services/flood.js';

const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const femaSample = fixture('fema-nfhl-flood.json');
const legacySnapshot = fixture('flood-legacy-snapshot.json');

const geometry = { type: 'Polygon', coordinates: [[[-116.8, 47.7], [-116.79, 47.7], [-116.79, 47.71], [-116.8, 47.71], [-116.8, 47.7]]] };
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const empty = () => jsonResponse({ features: [] });
const status = code => () => new Response('', { status: code });
const isFema = url => url.startsWith(`${FEMA_NFHL_FLOOD_LAYER}/query`);
const isEsri = url => url.startsWith(`${ESRI_USA_FLOOD_HAZARD_LAYER}/query`);

// Each handler gets the URL and returns a Response or throws. Handlers are used in call order.
function stubFetch(...handlers) {
  globalThis.fetch = async input => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const handler = handlers[calls.length - 1];
    if (!handler) throw new Error(`unexpected upstream call #${calls.length}: ${url}`);
    return handler(url);
  };
}

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

// Direct service call with the Esri fallback switched on (it is off in production).
const withFallback = () => floodScreening(geometry, {}, { esriFallback: true });

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

test('flood: FEMA 525 then retry success', async () => {
  stubFetch(status(525), () => jsonResponse(femaSample));
  const { response, body } = await floodCall();
  assert.equal(response.status, 200);
  assert.equal(body.source.provider, FEMA_PROVIDER);
  assert.deepEqual(body.zones, ['AE', 'X']);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(isFema));
});

test('flood: FEMA timeout then retry success', async () => {
  const abort = () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  stubFetch(abort, () => jsonResponse(femaSample));
  const { body } = await floodCall();
  assert.equal(body.available, true);
  assert.equal(calls.length, 2);
});

// --- empty-answer protection -----------------------------------------------------------------

test('flood: FEMA empty then retry with features uses the features', async () => {
  stubFetch(empty, () => jsonResponse({ features: [{ attributes: { FLD_ZONE: 'D', SFHA_TF: 'F' } }] }));
  const { response, body } = await floodCall();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { available: true, intersects: true, high: false, zones: ['D'], source: { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER } });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(isFema));
});

test('flood: FEMA empty twice gives the no-intersection shape, flagged emptyResult, not cached', async () => {
  const store = fakeCache();
  const pending = [];
  stubFetch(empty, empty);
  const { response, body } = await floodCall(undefined, { waitUntil(p) { pending.push(p); } });
  await Promise.all(pending);
  assert.equal(response.status, 200);
  const { source, ...rest } = body;
  assert.deepEqual(rest, { available: true, intersects: false, high: false, zones: [] });
  assert.deepEqual(source, { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER, emptyResult: true });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(store.size, 0, 'empty results must never be cached');
  assert.equal(calls.length, 2);
});

test('flood: FEMA empty then 525 is treated as an unconfirmed empty answer, not cached', async () => {
  const store = fakeCache();
  stubFetch(empty, status(525));
  const { response, body } = await floodCall(undefined, {});
  assert.equal(response.status, 200);
  assert.equal(body.available, true);
  assert.equal(body.intersects, false);
  assert.equal(body.source.emptyResult, true);
  assert.equal(store.size, 0);
  assert.equal(calls.length, 2);
});

test('flood: FEMA 525 then empty is also flagged emptyResult', async () => {
  stubFetch(status(525), empty);
  const { body } = await floodCall();
  assert.equal(body.intersects, false);
  assert.equal(body.source.emptyResult, true);
});

test('flood: a later call after an empty result goes upstream again', async () => {
  fakeCache();
  stubFetch(empty, empty, () => jsonResponse(femaSample));
  await floodCall(undefined, {});
  const { body } = await floodCall(undefined, {});
  assert.deepEqual(body.zones, ['AE', 'X']);
  assert.equal(calls.length, 3);
});

// --- Esri fallback (off by default) ------------------------------------------------------------

test('flood: Esri fallback is off by default; both-fail error names only FEMA', async () => {
  assert.equal(ESRI_FALLBACK_ENABLED, false);
  stubFetch(status(525), status(525));
  const { response, body } = await floodCall();
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual({ ...body, error: undefined }, { available: false, intersects: false, high: false, zones: [], error: undefined, source: null });
  assert.match(body.error, /FEMA NFHL/);
  assert.doesNotMatch(body.error, /Esri/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(isFema));
});

test('flood (fallback on): FEMA fails twice, Esri maps lowercase fields and missing SFHA_TF', async () => {
  stubFetch(
    status(525),
    () => { throw new TypeError('fetch failed'); },
    url => {
      assert.ok(isEsri(url));
      return jsonResponse({ features: [
        { attributes: { fld_zone: 'A', zone_subty: null, esri_symbology: '1% Annual Chance Flood Hazard' } },
        { attributes: { Fld_Zone: 'X', esri_symbology: '0.2% Annual Chance Flood Hazard' } }
      ] });
    }
  );
  const { status: code, body } = await withFallback();
  assert.equal(code, 200);
  assert.deepEqual(body, { available: true, intersects: true, high: true, zones: ['A', 'X'], source: { provider: ESRI_PROVIDER, url: ESRI_USA_FLOOD_HAZARD_LAYER } });
  assert.equal(calls.length, 3);
});

test('flood (fallback on): X-only zones without SFHA_TF are not high risk', async () => {
  stubFetch(status(503), status(503), () => jsonResponse({ features: [{ attributes: { FLD_ZONE: 'X' } }] }));
  const { body } = await withFallback();
  assert.deepEqual([body.high, body.intersects, body.zones], [false, true, ['X']]);
});

test('flood (fallback on): FEMA 4xx skips the retry and goes to the fallback', async () => {
  stubFetch(status(400), url => { assert.ok(isEsri(url)); return jsonResponse({ features: [] }); });
  const { body } = await withFallback();
  assert.equal(body.source.provider, ESRI_PROVIDER);
  assert.equal(calls.length, 2);
});

test('flood (fallback on): FEMA empty twice, Esri features win', async () => {
  stubFetch(empty, empty, () => jsonResponse({ features: [{ attributes: { FLD_ZONE: 'AE' } }] }));
  const { body } = await withFallback();
  assert.deepEqual([body.high, body.zones, body.source.provider], [true, ['AE'], ESRI_PROVIDER]);
  assert.equal(calls.length, 3);
});

test('flood (fallback on): FEMA empty twice and Esri empty keeps the FEMA emptyResult', async () => {
  stubFetch(empty, empty, empty);
  const { body } = await withFallback();
  assert.equal(body.source.provider, FEMA_PROVIDER);
  assert.equal(body.source.emptyResult, true);
});

test('flood (fallback on): both sources fail names both sources', async () => {
  stubFetch(status(525), status(525), () => jsonResponse({ error: { code: 499, message: 'Token Required' } }));
  const { status: code, body } = await withFallback();
  assert.equal(code, 502);
  assert.equal(body.available, false);
  assert.deepEqual(body.zones, []);
  assert.match(body.error, /FEMA NFHL/);
  assert.match(body.error, /Esri USA Flood Hazard Areas/);
  assert.equal(calls.length, 3);
});

// --- budget ------------------------------------------------------------------------------------

test('flood: never more than 3 upstream requests (2 with the fallback off)', async () => {
  globalThis.fetch = async input => { calls.push(String(input)); throw new TypeError('fetch failed'); };
  assert.equal((await floodCall()).body.available, false);
  assert.equal(calls.length, 2);
  calls = [];
  assert.equal((await withFallback()).body.available, false);
  assert.equal(calls.length, 3);
  calls = [];
  globalThis.fetch = async input => { calls.push(String(input)); return empty(); };
  await withFallback();
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

test('flood: caches.default stores non-empty successes and serves repeat calls', async () => {
  const store = fakeCache();
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  stubFetch(() => jsonResponse(femaSample));
  const first = await floodCall(undefined, ctx);
  await Promise.all(pending);
  assert.equal(store.size, 1);
  assert.match([...store.keys()][0], /^https:\/\/acresx\.internal\/cache\/flood\/v2\/[0-9a-f]{64}$/);
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
  store.set(key, jsonResponse({ available: true, intersects: false, high: false, zones: [], source: { provider: FEMA_PROVIDER, emptyResult: true } }));
  stubFetch(() => jsonResponse(femaSample));
  calls = [];
  const { body } = await floodCall(undefined, {});
  assert.deepEqual(body.zones, ['AE', 'X']);
  assert.equal(calls.length, 1);
});

test('flood: failures are not cached', async () => {
  const store = fakeCache();
  globalThis.fetch = async input => { calls.push(String(input)); throw new TypeError('fetch failed'); };
  await floodCall();
  assert.equal(store.size, 0);
});

test('flood: a broken cache does not break the layer', async () => {
  globalThis.caches = { default: { async match() { throw new Error('cache down'); }, async put() { throw new Error('cache down'); } } };
  stubFetch(() => jsonResponse(femaSample));
  const { body } = await floodCall(undefined, {});
  assert.equal(body.available, true);
});
