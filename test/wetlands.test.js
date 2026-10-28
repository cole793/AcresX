// Offline tests for the wetlands layer (src/services/wetlands.js) routed through src/index.js.
// fetch is stubbed per test; no live NWI or GeometryServer calls. The 015270010070 fixtures are
// the live NWI answer and GeometryServer clip for that Kootenai parcel, recorded 2026-10-27.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import {
  NWI_LAYER, GEOMETRY_SERVER, NWI_TIMEOUT_MS, NWI_RETRY_TIMEOUT_MS, INTERSECT_TIMEOUT_MS, INTERSECT_RETRY_TIMEOUT_MS,
  RETRY_BACKOFF_MS, MAX_GET_URL_LENGTH, CACHE_KEY_PREFIX, PRESENT_MIN_ACRES, PRESENT_MIN_PCT, PRESENT_FLOOR_ACRES,
  WETLAND_CATEGORIES, wetlandCategory, esriParcel, buildNwiRequest, buildIntersectRequest
} from '../src/services/wetlands.js';
import { FEMA_NFHL_FLOOD_LAYER } from '../src/services/flood.js';

const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const nwiSample = fixture('wetlands-nwi-015270010070.json');
const clipSample = fixture('wetlands-intersect-015270010070.json');
const parcel015 = fixture('wetlands-parcel-015270010070.json');

// ~1 ac square (GeoJSON order: counter-clockwise outer ring).
const geometry = { type: 'Polygon', coordinates: [[[-116.8, 47.7], [-116.79866, 47.7], [-116.79866, 47.7009], [-116.8, 47.7009], [-116.8, 47.7]]] };
// A detailed boundary (400 vertices) whose GET URL is far over the limit.
const bigGeometry = { type: 'Polygon', coordinates: [Array.from({ length: 401 }, (_, i) => {
  const a = (i % 400) / 400 * 2 * Math.PI;
  return [-116.8 + 0.01 * Math.cos(a) + i * 1e-7, 47.7 + 0.01 * Math.sin(a)];
})] };
bigGeometry.coordinates[0][400] = bigGeometry.coordinates[0][0];

const LEGACY_KEYS = ['available', 'intersects', 'count', 'types', 'coveragePct', 'wetlandAcres', 'parcelAcres', 'coverageMethod'];
const ADDED_KEYS = ['category', 'overlapAcres', 'nearby', 'overlapCount'];

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const status = code => () => new Response('', { status: code });
const abort = () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
const isNwi = url => url.startsWith(`${NWI_LAYER}/query`);
const isClip = url => url === GEOMETRY_SERVER;
const nwi = features => () => jsonResponse({ features });
const nwiEmpty = nwi([]);
const square = (x, y, d) => [[[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]]]; // Esri clockwise
const oneFeature = nwi([{ attributes: { WETLAND_TYPE: 'Freshwater Emergent Wetland', ATTRIBUTE: 'PEM1C' }, geometry: { rings: square(-116.801, 47.6995, 0.002) } }]);
const clip = geometries => () => jsonResponse({ geometryType: 'esriGeometryPolygon', geometries });

function stubFetch(...handlers) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, method: init.method || 'GET', body: init.body, headers: init.headers || {}, cf: init.cf });
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

async function hazardsCall(body, ctx = { waitUntil() {} }) {
  const request = new Request('https://acresx.test/api/hazards', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const response = await worker.fetch(request, {}, ctx);
  return { response, body: await response.json() };
}
const wetlandsCall = (g = geometry, ctx) => hazardsCall({ kind: 'wetlands', geometry: g }, ctx);
const close = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} vs ${expected}`);

// --- Categories from real and synthetic overlaps ---------------------------------------------

test('wetlands: recorded 015270010070 overlap is present with the measured coverage', async () => {
  stubFetch(url => { assert.ok(isNwi(url)); return jsonResponse(nwiSample); }, url => { assert.ok(isClip(url)); return jsonResponse(clipSample); });
  const { response, body } = await wetlandsCall(parcel015);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600, s-maxage=86400');
  assert.deepEqual(Object.keys(body).filter(k => LEGACY_KEYS.includes(k)), LEGACY_KEYS);
  for (const k of ADDED_KEYS) assert.ok(k in body, k);
  assert.equal(body.available, true);
  assert.equal(body.intersects, true);
  assert.equal(body.count, 1);
  assert.deepEqual(body.types, ['Riverine']);
  assert.equal(body.category, 'present');
  assert.equal(body.nearby, false);
  assert.equal(body.overlapCount, 1);
  close(body.coveragePct, 4.738, 0.01, 'coveragePct');
  close(body.wetlandAcres, 0.4733, 0.001, 'wetlandAcres');
  assert.equal(body.overlapAcres, body.wetlandAcres);
  close(body.parcelAcres, 9.989, 0.01, 'parcelAcres');
  assert.equal(body.coverageMethod, 'NWI polygons clipped to parcel');
  assert.equal(body.coverageEstimated, false);
  assert.equal('error' in body, false, 'index.html treats any `error` key as a failure');
  assert.equal(calls.length, 2);
});

test('wetlands: GeometryServer gets the parcel wrapped as { geometryType, geometry } (the 2026-10-27 bug)', async () => {
  stubFetch(() => jsonResponse(nwiSample), () => jsonResponse(clipSample));
  await wetlandsCall(parcel015);
  const params = new URLSearchParams(calls[1].body);
  assert.equal(calls[1].method, 'POST');
  const g = JSON.parse(params.get('geometry'));
  assert.equal(g.geometryType, 'esriGeometryPolygon');
  assert.ok(Array.isArray(g.geometry.rings) && g.geometry.rings.length === 1);
  const gs = JSON.parse(params.get('geometries'));
  assert.equal(gs.geometryType, 'esriGeometryPolygon');
  assert.equal(gs.geometries.length, 1);
  assert.equal(params.get('sr'), '4326');
});

test('wetlands: polygon that only touches the boundary (empty clip) is nearby, not present', async () => {
  stubFetch(oneFeature, clip([{ rings: [] }]));
  const { response, body } = await wetlandsCall();
  assert.equal(response.status, 200);
  assert.equal(body.intersects, true, 'intersects keeps its meaning: an NWI polygon intersects or touches');
  assert.equal(body.count, 1);
  assert.equal(body.category, 'nearby');
  assert.equal(body.nearby, true);
  assert.equal(body.coveragePct, 0);
  assert.equal(body.wetlandAcres, 0);
  assert.equal(body.overlapCount, 0);
});

test('wetlands: a boundary sliver (about 1 sq m) is nearby', async () => {
  stubFetch(oneFeature, clip([{ rings: square(-116.8, 47.7, 0.00001) }]));
  const { body } = await wetlandsCall();
  assert.equal(body.category, 'nearby');
  assert.ok(body.wetlandAcres > 0 && body.wetlandAcres < 0.001, String(body.wetlandAcres));
  assert.equal(body.overlapCount, 1);
});

test('wetlands: a real overlap on a small lot is present', async () => {
  // ~0.08 ac of a ~1 ac parcel.
  stubFetch(oneFeature, clip([{ rings: square(-116.8, 47.7, 0.0004) }]));
  const { body } = await wetlandsCall();
  assert.equal(body.category, 'present');
  assert.ok(body.wetlandAcres > PRESENT_MIN_ACRES);
});

test('wetlands: no NWI polygon is none, one request, no clip call', async () => {
  stubFetch(nwiEmpty);
  const { response, body } = await wetlandsCall();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).filter(k => LEGACY_KEYS.includes(k)), LEGACY_KEYS);
  assert.equal(body.intersects, false);
  assert.equal(body.count, 0);
  assert.equal(body.coveragePct, 0);
  assert.equal(body.category, 'none');
  assert.equal(body.nearby, false);
  assert.equal(calls.length, 1);
});

test('wetlands: wetlandCategory thresholds', () => {
  assert.equal(PRESENT_MIN_ACRES, 0.05);
  assert.equal(PRESENT_MIN_PCT, 0.5);
  assert.equal(PRESENT_FLOOR_ACRES, 0.01);
  assert.deepEqual(WETLAND_CATEGORIES, ['present', 'unmeasured', 'nearby', 'none']);
  const c = (overlapAcres, coveragePct, intersects = true) => wetlandCategory({ intersects, overlapAcres, coveragePct });
  assert.equal(c(0, 0, false), 'none');
  assert.equal(c(null, null), 'unmeasured');
  assert.equal(c(0, 0), 'nearby');
  assert.equal(c(0.0003, 0.01), 'nearby');
  assert.equal(c(0.049, 0.1), 'nearby');
  assert.equal(c(0.05, 0.01), 'present');
  assert.equal(c(0.013, 0.66), 'present', '47N03W052200 second strip alone: 0.013 ac, 0.66%');
  assert.equal(c(0.009, 4), 'nearby', 'below the 0.01 ac floor even at 4%');
  assert.equal(c(0.02, 0.4), 'nearby');
  assert.equal(c(0.02, 0.5), 'present');
  assert.equal(c(0.4733, 4.74), 'present');
});

// --- Retry, failure, timing ------------------------------------------------------------------

test('wetlands: NWI 503 then retry success', async () => {
  stubFetch(status(503), nwiEmpty);
  const { response, body } = await wetlandsCall();
  assert.equal(response.status, 200);
  assert.equal(body.category, 'none');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => isNwi(c.url)));
});

test('wetlands: NWI timeout, network error and invalid JSON are retried', async () => {
  for (const first of [abort, () => { throw new TypeError('fetch failed'); }, () => new Response('<html>busy</html>', { status: 200 }), () => jsonResponse({ error: { code: 500, message: 'busy' } })]) {
    calls = [];
    stubFetch(first, nwiEmpty);
    const { body } = await wetlandsCall();
    assert.equal(body.available, true);
    assert.equal(calls.length, 2);
  }
});

test('wetlands: NWI fails twice: 502 unavailable shape, no-store, no legacy fallthrough', async () => {
  stubFetch(status(503), abort);
  const { response, body } = await wetlandsCall();
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(body.available, false);
  assert.equal(body.intersects, false);
  assert.equal(body.count, 0);
  assert.deepEqual(body.types, []);
  assert.equal(body.category, 'unavailable');
  assert.match(body.error, /USFWS NWI returned 503; retry timeout after 6s/);
  assert.equal(calls.length, 2, 'the legacy worker.js NWI query must not run');
});

test('wetlands: NWI 4xx and ArcGIS 400 errors are not retried', async () => {
  for (const first of [status(404), () => jsonResponse({ error: { code: 400, message: 'Invalid query' } })]) {
    calls = [];
    stubFetch(first);
    const { response, body } = await wetlandsCall();
    assert.equal(response.status, 502);
    assert.equal(body.available, false);
    assert.equal(calls.length, 1);
  }
});

test('wetlands: clip 500 then retry success', async () => {
  stubFetch(() => jsonResponse(nwiSample), status(500), () => jsonResponse(clipSample));
  const { body } = await wetlandsCall(parcel015);
  assert.equal(body.category, 'present');
  assert.equal(calls.length, 3);
});

test('wetlands: clip fails twice: unmeasured, coverage null, no-store', async () => {
  stubFetch(oneFeature, status(502), abort);
  const { response, body } = await wetlandsCall();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(body.available, true);
  assert.equal(body.intersects, true);
  assert.equal(body.category, 'unmeasured');
  assert.equal(body.coveragePct, null);
  assert.equal(body.wetlandAcres, null);
  assert.equal(body.overlapAcres, null);
  assert.equal(body.coverageEstimated, true);
  assert.equal(body.coverageMethod, 'NWI intersection presence only');
  assert.equal(calls.length, 3);
});

test('wetlands: a clip ArcGIS 400 (the old "Syntax error in JSON geometry") is not retried', async () => {
  const syntaxError = () => jsonResponse({ error: { code: 400, extendedCode: -2147188869, message: 'Unable to complete operation.', details: ['Syntax error in JSON geometry representation'] } });
  stubFetch(oneFeature, syntaxError);
  const { body } = await wetlandsCall();
  assert.equal(body.category, 'unmeasured');
  assert.equal(calls.length, 2);
});

test('wetlands: never more than 4 upstream requests', async () => {
  stubFetch(status(503), oneFeature, status(503), status(503));
  const { body } = await wetlandsCall();
  assert.equal(body.category, 'unmeasured');
  assert.equal(calls.length, 4);
  calls = [];
  globalThis.fetch = async input => { calls.push({ url: String(input) }); throw new TypeError('fetch failed'); };
  await wetlandsCall();
  assert.equal(calls.length, 2);
});

test('wetlands: worst-case time budget is under 25 s', () => {
  const worst = NWI_TIMEOUT_MS + RETRY_BACKOFF_MS + NWI_RETRY_TIMEOUT_MS + INTERSECT_TIMEOUT_MS + RETRY_BACKOFF_MS + INTERSECT_RETRY_TIMEOUT_MS;
  assert.ok(worst <= 25000, String(worst));
});

test('wetlands: no upstream request carries cf edge-cache options', async () => {
  stubFetch(() => jsonResponse(nwiSample), () => jsonResponse(clipSample));
  await wetlandsCall(parcel015);
  assert.equal(calls.length, 2);
  for (const c of calls) assert.equal(c.cf, undefined, c.url);
});

// --- Request building ------------------------------------------------------------------------

test('wetlands: short NWI queries use GET with the params in the URL', async () => {
  stubFetch(nwiEmpty);
  await wetlandsCall();
  assert.equal(calls[0].method, 'GET');
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('spatialRel'), 'esriSpatialRelIntersects');
  assert.equal(url.searchParams.get('returnGeometry'), 'true');
  assert.equal(url.searchParams.get('outFields'), 'WETLAND_TYPE,ATTRIBUTE');
  assert.ok(calls[0].url.length <= MAX_GET_URL_LENGTH);
});

test('wetlands: long NWI queries use a form-encoded POST', async () => {
  assert.equal(buildNwiRequest(bigGeometry).init.method, 'POST');
  stubFetch(nwiEmpty);
  const { body } = await wetlandsCall(bigGeometry);
  assert.equal(body.category, 'none');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, `${NWI_LAYER}/query`);
  assert.match(calls[0].headers['Content-Type'], /application\/x-www-form-urlencoded/);
  const params = new URLSearchParams(calls[0].body);
  assert.equal(JSON.parse(params.get('geometry')).rings[0].length, 401);
  assert.equal(params.get('f'), 'json');
  assert.equal(buildNwiRequest(geometry).init.method, 'GET');
});

test('wetlands: GeoJSON rings are sent in Esri orientation (outer clockwise, holes counter-clockwise)', () => {
  const signed = ring => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const hole = [[-116.7995, 47.7002], [-116.7990, 47.7002], [-116.7990, 47.7006], [-116.7995, 47.7006], [-116.7995, 47.7002]];
  const withHole = { type: 'Polygon', coordinates: [geometry.coordinates[0], hole] };
  const rings = esriParcel(withHole).rings;
  assert.ok(signed(rings[0]) < 0, 'outer ring clockwise');
  assert.ok(signed(rings[1]) > 0, 'hole counter-clockwise');
  const multi = esriParcel({ type: 'MultiPolygon', coordinates: [[geometry.coordinates[0]], [[...geometry.coordinates[0]].reverse()]] }).rings;
  assert.ok(multi.every(r => signed(r) < 0), 'each MultiPolygon outer ring clockwise');
  const sent = JSON.parse(new URLSearchParams(buildIntersectRequest([], withHole).init.body).get('geometry'));
  assert.deepEqual(sent.geometry.rings, rings);
});

test('wetlands: missing or non-polygon geometry answers 400 JSON without upstream calls', async () => {
  stubFetch();
  for (const body of [{ kind: 'wetlands' }, { kind: 'wetlands', geometry: { type: 'Point', coordinates: [-116.8, 47.7] } }]) {
    const { response, body: result } = await hazardsCall(body);
    assert.equal(response.status, 400);
    assert.equal(result.available, false);
    assert.equal(result.error, 'Parcel geometry is required.');
  }
  assert.equal(calls.length, 0);
});

// --- Cache -----------------------------------------------------------------------------------

test('wetlands: works when caches is undefined (Node)', async () => {
  assert.equal(typeof globalThis.caches, 'undefined');
  stubFetch(nwiEmpty);
  const { body } = await wetlandsCall();
  assert.equal(body.category, 'none');
});

test('wetlands: caches.default stores measured answers and serves repeat calls', async () => {
  const store = fakeCache();
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  stubFetch(() => jsonResponse(nwiSample), () => jsonResponse(clipSample));
  const first = await wetlandsCall(parcel015, ctx);
  await Promise.all(pending);
  assert.equal(store.size, 1);
  assert.ok([...store.keys()][0].startsWith(CACHE_KEY_PREFIX));
  const second = await wetlandsCall(parcel015, ctx);
  assert.equal(calls.length, 2, 'second call served from cache');
  assert.deepEqual(second.body, first.body);
});

test('wetlands: unmeasured answers and failures are never cached', async () => {
  const store = fakeCache();
  stubFetch(oneFeature, status(503), status(503));
  assert.equal((await wetlandsCall()).body.category, 'unmeasured');
  calls = [];
  stubFetch(status(503), status(503));
  assert.equal((await wetlandsCall()).response.status, 502);
  assert.equal(store.size, 0);
});

test('wetlands: cached entries that are unmeasured, unavailable or broken are ignored', async () => {
  const store = fakeCache();
  stubFetch(nwiEmpty);
  await wetlandsCall();
  const key = [...store.keys()][0];
  for (const bad of [{ available: true, intersects: true, category: 'unmeasured' }, { available: false, category: 'unavailable' }, { available: true }, 'not json']) {
    store.set(key, new Response(typeof bad === 'string' ? bad : JSON.stringify(bad)));
    calls = [];
    stubFetch(nwiEmpty);
    const { body } = await wetlandsCall();
    assert.equal(body.category, 'none');
    assert.equal(calls.length, 1, `refetched over ${JSON.stringify(bad)}`);
  }
});

test('wetlands: a throwing caches.default or cache.put does not break the answer', async () => {
  Object.defineProperty(globalThis, 'caches', { configurable: true, get() { throw new Error('no cache here'); } });
  stubFetch(nwiEmpty);
  assert.equal((await wetlandsCall()).body.category, 'none');
  delete globalThis.caches;
  globalThis.caches = { default: { async match() { throw new Error('match failed'); }, async put() { throw new Error('put failed'); } } };
  calls = [];
  stubFetch(nwiEmpty);
  assert.equal((await wetlandsCall(geometry, {})).body.category, 'none');
});

// --- Routing of the other hazards is unchanged ------------------------------------------------

test('hazards routing: flood still goes to the flood service', async () => {
  stubFetch(url => { assert.ok(url.startsWith(`${FEMA_NFHL_FLOOD_LAYER}/query`), url); return jsonResponse({ features: [] }); });
  const { response, body } = await hazardsCall({ kind: 'flood', geometry });
  assert.equal(response.status, 200);
  assert.equal(body.category, 'not_mapped');
  assert.equal(calls.length, 1);
});

test('hazards routing: an unknown kind still gets the legacy 400', async () => {
  stubFetch();
  const { response, body } = await hazardsCall({ kind: 'volcano', geometry });
  assert.equal(response.status, 400);
  assert.equal(body.error, 'Unknown hazard type.');
  assert.equal(calls.length, 0);
});
