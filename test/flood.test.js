// Offline tests for the flood layer (src/services/flood.js) routed through src/index.js.
// fetch is stubbed per test; no live FEMA or Esri calls.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { FEMA_NFHL_FLOOD_LAYER, ESRI_USA_FLOOD_HAZARD_LAYER, FEMA_PROVIDER, ESRI_PROVIDER } from '../src/services/flood.js';

const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const femaSample = fixture('fema-nfhl-flood.json');
const legacySnapshot = fixture('flood-legacy-snapshot.json');

const geometry = { type: 'Polygon', coordinates: [[[-116.8, 47.7], [-116.79, 47.7], [-116.79, 47.71], [-116.8, 47.71], [-116.8, 47.7]]] };
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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

test('flood: no features means available, not intersecting', async () => {
  stubFetch(() => jsonResponse({ features: [] }));
  const { body } = await floodCall();
  assert.deepEqual({ ...body, source: undefined }, { available: true, intersects: false, high: false, zones: [], source: undefined });
});

test('flood: FEMA 525 then retry success', async () => {
  stubFetch(() => new Response('ssl handshake failed', { status: 525 }), () => jsonResponse(femaSample));
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

test('flood: FEMA fails twice, Esri fallback maps lowercase fields and missing SFHA_TF', async () => {
  stubFetch(
    () => new Response('bad gateway', { status: 525 }),
    () => { throw new TypeError('fetch failed'); },
    url => {
      assert.ok(isEsri(url));
      return jsonResponse({ features: [
        { attributes: { fld_zone: 'A', zone_subty: null, esri_symbology: '1% Annual Chance Flood Hazard' } },
        { attributes: { Fld_Zone: 'X', esri_symbology: '0.2% Annual Chance Flood Hazard' } }
      ] });
    }
  );
  const { response, body } = await floodCall();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { available: true, intersects: true, high: true, zones: ['A', 'X'], source: { provider: ESRI_PROVIDER, url: ESRI_USA_FLOOD_HAZARD_LAYER } });
  assert.equal(calls.length, 3);
});

test('flood: fallback X-only zones without SFHA_TF are not high risk', async () => {
  stubFetch(() => new Response('', { status: 503 }), () => new Response('', { status: 503 }),
    () => jsonResponse({ features: [{ attributes: { flood_zone_x: 1, FLD_ZONE: 'X' } }] }));
  const { body } = await floodCall();
  assert.deepEqual([body.high, body.intersects, body.zones], [false, true, ['X']]);
});

test('flood: FEMA 4xx skips the retry and goes to the fallback', async () => {
  stubFetch(() => new Response('', { status: 400 }), url => { assert.ok(isEsri(url)); return jsonResponse({ features: [] }); });
  const { body } = await floodCall();
  assert.equal(body.source.provider, ESRI_PROVIDER);
  assert.equal(calls.length, 2);
});

test('flood: both sources fail returns the unavailable shape naming both sources', async () => {
  stubFetch(() => new Response('', { status: 525 }), () => new Response('', { status: 525 }), () => jsonResponse({ error: { code: 499, message: 'Token Required' } }));
  const { response, body } = await floodCall();
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(body.available, false);
  assert.equal(body.intersects, false);
  assert.equal(body.high, false);
  assert.deepEqual(body.zones, []);
  assert.match(body.error, /FEMA NFHL/);
  assert.match(body.error, /Esri USA Flood Hazard Areas/);
  assert.equal(calls.length, 3);
});

test('flood: never more than 3 upstream requests when everything fails', async () => {
  globalThis.fetch = async input => { calls.push(String(input)); throw new TypeError('fetch failed'); };
  const { body } = await floodCall();
  assert.equal(body.available, false);
  assert.equal(calls.length, 3);
});

test('flood: missing geometry answers JSON without upstream calls', async () => {
  stubFetch();
  const { response, body } = await floodCall({ kind: 'flood', lat: 47.7, lon: -116.8 });
  assert.equal(response.status, 400);
  assert.equal(body.available, false);
  assert.equal(calls.length, 0);
});

test('flood: works when caches is undefined (Node)', async () => {
  assert.equal(typeof globalThis.caches, 'undefined');
  stubFetch(() => jsonResponse(femaSample), () => jsonResponse(femaSample));
  assert.equal((await floodCall()).body.available, true);
  assert.equal((await floodCall()).body.available, true);
  assert.equal(calls.length, 2, 'no cache, so each call goes upstream');
});

test('flood: caches.default stores successes and serves repeat calls', async () => {
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); }
  } };
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  stubFetch(() => jsonResponse(femaSample));
  const first = await floodCall(undefined, ctx);
  await Promise.all(pending);
  assert.equal(store.size, 1);
  assert.match([...store.keys()][0], /^https:\/\/acresx\.internal\/cache\/flood\/v1\/[0-9a-f]{64}$/);
  // Tiny coordinate noise below the rounding precision hits the same key.
  const jittered = { type: 'Polygon', coordinates: [geometry.coordinates[0].map(([x, y]) => [x + 1e-9, y])] };
  const second = await floodCall({ kind: 'flood', geometry: jittered }, ctx);
  assert.deepEqual(second.body, first.body);
  assert.equal(calls.length, 1);
});

test('flood: failures are not cached', async () => {
  const store = new Map();
  globalThis.caches = { default: { async match(req) { return store.get(req.url); }, async put(req, res) { store.set(req.url, res); } } };
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
