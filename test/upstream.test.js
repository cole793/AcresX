// Offline tests for the shared upstream client (src/shared/upstream.js) and its Cache API
// wrapper. Network is stubbed.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  upstreamJson, arcgisQuery, arcgisJson, upstreamFetch, cachedJson, configureUpstream, buildUpstreamRequest,
  UPSTREAM_DEFAULTS, UpstreamError, inFlight
} from '../src/shared/upstream.js';
import { fetchWithTimeout } from '../src/shared/http.js';

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls = [];
let logs = [];
let restoreSettings;

function stubFetch(handler) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
}
beforeEach(() => {
  calls = []; logs = [];
  restoreSettings = configureUpstream({ backoffMs: 0, log: line => logs.push(JSON.parse(line)) });
  globalThis.fetch = async () => { throw new Error('network disabled in tests'); };
});
afterEach(() => {
  restoreSettings();
  globalThis.fetch = realFetch;
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const LAYER = 'https://gis.example.gov/arcgis/rest/services/Test/MapServer/0';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A response whose headers arrive at once but whose body never finishes.
function hangingBody() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('{"features":[')); } });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ---- timeouts

test('timeout covers the body, not just the headers', async () => {
  stubFetch(() => hangingBody());
  const started = Date.now();
  await assert.rejects(upstreamJson(LAYER, { timeoutMs: 150, retries: 0, agency: 'Test GIS' }), error => {
    assert.equal(error.kind, 'timeout');
    assert.equal(error.message, 'Test GIS timed out after 0.2s');
    return true;
  });
  assert.ok(Date.now() - started < 1000, 'bounded by the timeout');
  assert.equal(inFlight('gis.example.gov'), 0, 'the host slot is released');
});

test('fetchWithTimeout (shared/http.js) also bounds the body and still rejects with AbortError', async () => {
  stubFetch(() => hangingBody());
  await assert.rejects(fetchWithTimeout(LAYER, {}, 150), error => error.name === 'AbortError');
});

test('a fetch that ignores the abort signal is still bounded', async () => {
  stubFetch(() => new Promise(() => {}));
  await assert.rejects(upstreamJson(LAYER, { timeoutMs: 100, retries: 0 }), error => error.kind === 'timeout');
});

test('fetchWithTimeout returns a readable buffered Response for non-2xx answers, as before', async () => {
  stubFetch(() => new Response('busy', { status: 503, statusText: 'Service Unavailable' }));
  const response = await fetchWithTimeout(LAYER, {}, 1000);
  assert.equal(response.status, 503);
  assert.equal(response.ok, false);
  assert.equal(await response.text(), 'busy');
});

test('fetchWithTimeout passes a network error through unchanged', async () => {
  stubFetch(() => { throw new Error('connect ECONNREFUSED'); });
  await assert.rejects(fetchWithTimeout(LAYER, {}, 1000), /connect ECONNREFUSED/);
});

// ---- retry rules

const retryCases = [
  ['HTTP 500', () => new Response('x', { status: 500 }), true, 'http'],
  ['HTTP 503', () => new Response('x', { status: 503 }), true, 'http'],
  ['HTTP 404', () => new Response('x', { status: 404 }), false, 'http'],
  ['HTTP 429', () => new Response('x', { status: 429 }), false, 'http'],
  ['network error', () => { throw new Error('socket hang up'); }, true, 'network'],
  ['invalid JSON', () => new Response('<html>', { status: 200 }), true, 'json'],
  ['ArcGIS error 500 in a 200 body', () => jsonResponse({ error: { code: 500, message: 'Error performing query operation' } }), true, 'arcgis'],
  ['ArcGIS error 400 in a 200 body', () => jsonResponse({ error: { code: 400, message: 'Invalid query' } }), false, 'arcgis'],
  ['ArcGIS error 498 (token) in a 200 body', () => jsonResponse({ error: { code: 498, message: 'Invalid token' } }), false, 'arcgis'],
  ['ArcGIS error without a code', () => jsonResponse({ error: { message: 'Failed' } }), true, 'arcgis']
];
for (const [name, failure, retried, kind] of retryCases) {
  test(`retry rules: ${name} is ${retried ? 'retried once' : 'not retried'}`, async () => {
    stubFetch((url, init, n) => (n === 1 ? failure() : jsonResponse({ features: [{ attributes: { A: 1 } }] })));
    const attempt = arcgisQuery(LAYER, { where: '1=1' }, { agency: 'Test GIS' });
    if (retried) {
      assert.deepEqual(await attempt, [{ attributes: { A: 1 } }]);
      assert.equal(calls.length, 2);
    } else {
      await assert.rejects(attempt, error => error instanceof UpstreamError && error.kind === kind);
      assert.equal(calls.length, 1);
    }
  });
}

test('retry rules: a timeout is retried once, with retryTimeoutMs for the second attempt', async () => {
  stubFetch((url, init, n) => (n === 1 ? new Promise(() => {}) : jsonResponse({ ok: 1 })));
  const started = Date.now();
  assert.deepEqual(await upstreamJson(LAYER, { timeoutMs: 80, retryTimeoutMs: 1000 }), { ok: 1 });
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - started < 1000);
});

test('retry rules: at most one retry by default, and the last error is thrown', async () => {
  assert.equal(UPSTREAM_DEFAULTS.retries, 1);
  stubFetch(() => new Response('x', { status: 502 }));
  await assert.rejects(upstreamJson(LAYER, { agency: 'Test GIS' }), { message: 'Test GIS returned 502' });
  assert.equal(calls.length, 2);
});

test('retry rules: retries: 0 asks once; retryOn can narrow the rules', async () => {
  stubFetch(() => new Response('x', { status: 500 }));
  await assert.rejects(upstreamJson(LAYER, { retries: 0 }));
  assert.equal(calls.length, 1);
  calls = [];
  await assert.rejects(upstreamJson(LAYER, { retryOn: ['timeout'] }));
  assert.equal(calls.length, 1);
  calls = [];
  await assert.rejects(upstreamJson(LAYER, { retryOn: ['5xx'] }));
  assert.equal(calls.length, 2);
});

test('retry rules: a cancelled request is not retried and is never sent once cancelled', async () => {
  const cancel = new AbortController();
  cancel.abort();
  stubFetch(() => jsonResponse({}));
  await assert.rejects(upstreamJson(LAYER, { signal: cancel.signal }), error => error.kind === 'cancelled');
  assert.equal(calls.length, 0);
});

// ---- ArcGIS error bodies and messages

test('ArcGIS {error} in an HTTP 200 body is an error, with the old message rules', async () => {
  stubFetch(() => jsonResponse({ error: { code: 400, message: 'Invalid where clause', details: [] } }));
  await assert.rejects(arcgisQuery(LAYER, { where: 'x' }), error => {
    assert.equal(error.kind, 'arcgis');
    assert.equal(error.arcgisError, true, 'same flag as src/shared/arcgis.js (PR #21)');
    assert.equal(error.code, 400);
    assert.equal(error.status, 200);
    assert.equal(error.message, 'Invalid where clause');
    return true;
  });
  stubFetch(() => jsonResponse({ error: { code: 400 } }));
  await assert.rejects(arcgisQuery(LAYER, {}, { agency: 'Test GIS' }), { message: 'Test GIS query failed' });
  await assert.rejects(arcgisQuery(LAYER, {}, { arcgisMessage: 'Lookup failed' }), { message: 'Lookup failed' });
  await assert.rejects(arcgisQuery(LAYER, {}, { arcgisMessage: m => `Layer 5: ${m || 'query failed'}` }), { message: 'Layer 5: query failed' });
});

test('a JSON {error} body is only an error in ArcGIS mode', async () => {
  stubFetch(() => jsonResponse({ error: 'not arcgis', value: 1 }));
  assert.deepEqual(await upstreamJson('https://api.example.gov/x'), { error: 'not arcgis', value: 1 });
  await assert.rejects(arcgisJson('https://api.example.gov/x'), error => error.kind === 'arcgis');
});

test('arcgisQuery queries <layer>/query with f=json and returns the features', async () => {
  stubFetch(() => jsonResponse({ features: [{ attributes: { ZONE: 'A-1' } }] }));
  assert.deepEqual(await arcgisQuery(`${LAYER}/`, { where: '1=1', outFields: 'ZONE' }), [{ attributes: { ZONE: 'A-1' } }]);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/arcgis/rest/services/Test/MapServer/0/query');
  assert.equal(url.searchParams.get('f'), 'json');
  assert.equal(url.searchParams.get('outFields'), 'ZONE');
  stubFetch(() => jsonResponse({}));
  assert.deepEqual(await arcgisQuery(LAYER, {}), []);
});

test('an HTTP error keeps the parsed error body for callers that need it', async () => {
  stubFetch(() => jsonResponse({ Message: 'Invalid query' }, 400));
  await assert.rejects(upstreamJson('https://sda.example.gov/post.rest', { method: 'POST', body: '{}' }), error => {
    assert.equal(error.kind, 'http');
    assert.deepEqual(error.body, { Message: 'Invalid query' });
    return true;
  });
});

// ---- GET -> POST switch

test('a GET longer than ~3,500 characters is sent as a form-encoded POST', async () => {
  assert.equal(UPSTREAM_DEFAULTS.maxGetUrlLength, 3500);
  stubFetch(() => jsonResponse({ features: [] }));
  const ring = Array.from({ length: 400 }, (_, i) => [-117 + i / 1000, 47 + i / 1000]);
  await arcgisQuery(LAYER, { geometry: JSON.stringify({ rings: [ring] }), where: '1=1' });
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].url, `${LAYER}/query`);
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('f'), 'json');
  assert.equal(JSON.parse(form.get('geometry')).rings[0].length, 400);

  calls = [];
  await arcgisQuery(LAYER, { where: '1=1' });
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
});

test('a long URL built by the caller is switched to POST too', () => {
  const url = new URL(`${LAYER}/query`);
  url.searchParams.set('geometry', 'x'.repeat(4000));
  const request = buildUpstreamRequest(url);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.url, `${LAYER}/query`);
  assert.equal(new URLSearchParams(request.init.body).get('geometry').length, 4000);
});

test('POST with params sends them as the form body; a raw body is sent as is', () => {
  const form = buildUpstreamRequest(LAYER, { method: 'POST', params: { f: 'json', where: '1=1' } });
  assert.equal(form.url, LAYER);
  assert.equal(form.init.body, 'f=json&where=1%3D1');
  const raw = buildUpstreamRequest('https://sda.example.gov/post.rest', { method: 'POST', body: '{"q":1}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(raw.init.body, '{"q":1}');
  assert.deepEqual(raw.init.headers, { 'Content-Type': 'application/json' });
});

// ---- per-host concurrency cap

test('per-host cap: never more than 4 requests in flight to one host', async () => {
  assert.equal(UPSTREAM_DEFAULTS.maxPerHost, 4);
  const active = {}; const peak = {};
  stubFetch(async url => {
    const host = new URL(url).hostname;
    active[host] = (active[host] || 0) + 1;
    peak[host] = Math.max(peak[host] || 0, active[host]);
    await sleep(25);
    active[host]--;
    return jsonResponse({ features: [] });
  });
  const a = Array.from({ length: 11 }, (_, i) => arcgisQuery(`https://a.example.gov/MapServer/${i}`, {}));
  const b = Array.from({ length: 6 }, (_, i) => arcgisQuery(`https://b.example.gov/MapServer/${i}`, {}));
  await Promise.all([...a, ...b]);
  assert.equal(calls.length, 17, 'every request was eventually sent');
  assert.equal(peak['a.example.gov'], 4);
  assert.equal(peak['b.example.gov'], 4, 'hosts are capped separately');
  assert.equal(inFlight('a.example.gov'), 0);
});

test('per-host cap: requests wait in order, and the wait counts toward the timeout', async () => {
  const order = [];
  stubFetch(async url => { order.push(Number(url.split('/').pop().split('?')[0])); await sleep(60); return jsonResponse({}); });
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => upstreamJson(`https://c.example.gov/x/${i}`, { timeoutMs: 90, retries: 0, maxPerHost: 2 })));
  assert.deepEqual(order.slice(0, 2), [0, 1]);
  // 0,1 answer at ~60 ms; 2,3 start then and would answer at ~120 ms > 90 ms; 4,5 never start.
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'fulfilled', 'rejected', 'rejected', 'rejected', 'rejected']);
  assert.ok(results.slice(2).every(r => r.reason.kind === 'timeout'));
  assert.ok(!order.includes(4) && !order.includes(5), 'requests that timed out while waiting were never sent');
});

// ---- logging

test('one structured log line per attempt, without the query string', async () => {
  stubFetch((url, init, n) => (n === 1 ? new Response('x', { status: 500 }) : jsonResponse({ features: [] })));
  await arcgisQuery(LAYER, { where: "PIN='SECRET-ISH'", token: 'abc' }, { label: 'test-layer' });
  assert.equal(logs.length, 2);
  for (const line of logs) {
    assert.deepEqual(Object.keys(line).sort(), ['attempt', 'err', 'evt', 'host', 'label', 'ms', 'ok', 'status'].sort());
    assert.equal(line.evt, 'upstream');
    assert.equal(line.host, 'gis.example.gov');
    assert.equal(line.label, 'test-layer');
    assert.equal(typeof line.ms, 'number');
    assert.ok(!JSON.stringify(line).includes('SECRET') && !JSON.stringify(line).includes('abc'));
  }
  assert.deepEqual(logs.map(l => [l.attempt, l.ok, l.status]), [[1, false, 500], [2, true, 200]]);
  assert.match(logs[0].err, /^http: /);
  assert.equal(logs[1].err, null);
});

test('the default label is the URL path, never the query; fetchWithTimeout logs too', async () => {
  stubFetch(() => jsonResponse({}));
  await fetchWithTimeout('https://www.googleapis.com/customsearch/v1?key=KEY123&q=x', {}, 1000);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].label, '/customsearch/v1');
  assert.ok(!JSON.stringify(logs[0]).includes('KEY123'));
});

// ---- no `cf` edge caching

test('no request carries cf edge-cache options, even when a caller passes them', async () => {
  stubFetch(() => jsonResponse({}));
  await fetchWithTimeout(LAYER, { cf: { cacheTtl: 86400, cacheEverything: true } }, 1000);
  await upstreamFetch(LAYER, { cf: { cacheTtl: 900 }, timeoutMs: 1000 });
  await upstreamJson(LAYER, { cf: { cacheTtl: 900 } });
  assert.equal(calls.length, 3);
  for (const call of calls) assert.equal('cf' in call.init, false);
});

// ---- Cache API wrapper

function fakeCache() {
  const store = new Map();
  const puts = [];
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { puts.push(req.url); store.set(req.url, res.clone()); }
  } };
  return { store, puts };
}
const PREFIX = 'https://acresx.internal/cache/test/v1/';

test('cachedJson stores only validated answers and serves them back', async () => {
  const { puts } = fakeCache();
  let produced = 0;
  const produce = value => async () => { produced++; return value; };
  assert.deepEqual(await cachedJson(PREFIX, 'bad', 60, produce({ status: 'error' }), { isValid: v => v.status === 'found' }), { status: 'error' });
  assert.deepEqual(await cachedJson(PREFIX, 'bad', 60, produce({ status: 'error' }), { isValid: v => v.status === 'found' }), { status: 'error' });
  assert.equal(puts.length, 0, 'an invalid answer is never stored');
  assert.equal(produced, 2);
  assert.deepEqual(await cachedJson(PREFIX, 'good', 60, produce({ status: 'found' }), { isValid: v => v.status === 'found' }), { status: 'found' });
  assert.deepEqual(await cachedJson(PREFIX, 'good', 60, produce({ status: 'other' }), { isValid: () => true }), { status: 'found' }, 'served from cache');
  assert.equal(produced, 3);
  assert.equal(puts.length, 1);
});

test('cachedJson needs an isValid check, does not cache thrown errors, and works without caches', async () => {
  fakeCache();
  await assert.rejects(cachedJson(PREFIX, 'x', 60, async () => 1), /isValid/);
  await assert.rejects(cachedJson(PREFIX, 'y', 60, async () => { throw new Error('upstream down'); }, { isValid: () => true }), /upstream down/);
  delete globalThis.caches;
  assert.equal(await cachedJson(PREFIX, 'z', 60, async () => 5, { isValid: () => true }), 5);
});

