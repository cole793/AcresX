// Offline tests for GET /api/upstream-health (src/services/upstream-health.js). Network is stubbed.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { configureUpstream } from '../src/shared/upstream.js';
import { checkUpstreamHealth, HEALTH_TARGETS, HEALTH_TIMEOUT_MS, HEALTH_MEMO_MS, resetUpstreamHealthMemo } from '../src/services/upstream-health.js';
import worker from '../src/index.js';

const realFetch = globalThis.fetch;
let calls = [];
let restoreSettings;
function stubFetch(handler) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
}
beforeEach(() => { calls = []; resetUpstreamHealthMemo(); restoreSettings = configureUpstream({ log: () => {} }); });
afterEach(() => { restoreSettings(); globalThis.fetch = realFetch; mock.timers.reset(); });
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('upstream health: probes every target once in parallel and reports per-host results', async () => {
  stubFetch(url => {
    if (url.includes('map.kcgov.us')) return new Response('blocked', { status: 403 });
    if (url.includes('gis.idwr.idaho.gov')) return jsonResponse({ error: { code: 500, message: 'Server busy' } });
    if (url.includes('sdmdataaccess')) return jsonResponse({ Table: [['TX299']] });
    if (url.includes('epqs')) return jsonResponse({ value: 1900 });
    return jsonResponse({ currentVersion: 11.3 });
  });
  const response = await worker.fetch(new Request('https://acresx.test/api/upstream-health'), { ASSETS: { fetch: async () => new Response('') } }, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['checkedAt', 'results']);
  assert.ok(!Number.isNaN(Date.parse(body.checkedAt)));
  assert.equal(body.results.length, HEALTH_TARGETS.length);
  assert.equal(calls.length, HEALTH_TARGETS.length, 'one request per target, no retries');
  for (const r of body.results) {
    for (const key of ['host', 'ok', 'status', 'ms', 'error']) assert.ok(key in r, `${r.host} has ${key}`);
  }
  const byHost = Object.fromEntries(body.results.map(r => [r.host, r]));
  assert.deepEqual([byHost['map.kcgov.us'].ok, byHost['map.kcgov.us'].status], [false, 403]);
  assert.match(byHost['gis.idwr.idaho.gov'].error, /^arcgis: Server busy/);
  assert.equal(byHost['hazards.fema.gov'].ok, true);
  assert.equal(byHost['hazards.fema.gov'].status, 200);
  for (const host of ['hazards.fema.gov', 'sdmdataaccess.sc.egov.usda.gov', 'elevation.nationalmap.gov', 'fwspublicservices.wim.usgs.gov',
    'services3.arcgis.com', 'map.kcgov.us', 'gis.idwr.idaho.gov', 'gis.stevenscountywa.gov', 'gismo.spokanecounty.org', 'gis.cdaid.org',
    'gis.postfalls.gov', 'services.arcgis.com', 'gis.dnrc.mt.gov', 'services1.arcgis.com']) assert.ok(byHost[host], `probes ${host}`);
  // Read-only: GETs, plus the one-row SDA catalog query; no secrets in any request.
  for (const call of calls) {
    assert.ok(call.init.method === 'GET' || call.url.includes('sdmdataaccess'), call.url);
    assert.ok(!/key=|token=|secret/i.test(call.url));
  }
});

test('upstream health: a hanging host is reported as a timeout at 10 s and does not hold up the answer', async () => {
  assert.equal(HEALTH_TIMEOUT_MS, 10000);
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  stubFetch(url => (url.includes('map.kcgov.us') ? new Promise(() => {}) : jsonResponse({ currentVersion: 11 })));
  let settled = null;
  const pending = checkUpstreamHealth().then(value => { settled = value; });
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, null, 'still waiting on the hanging host');
  mock.timers.tick(9999);
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, null, 'not before 10 s');
  mock.timers.tick(1);
  await pending;
  const kc = settled.results.find(r => r.host === 'map.kcgov.us');
  assert.equal(kc.ok, false);
  assert.match(kc.error, /^timeout: /);
  assert.equal(kc.ms, 10000);
  assert.ok(settled.results.filter(r => r.host !== 'map.kcgov.us').every(r => r.ok));
});

test('upstream health: repeated GETs within 60 s reuse one answer instead of probing again', async () => {
  assert.equal(HEALTH_MEMO_MS, 60000);
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  stubFetch(() => jsonResponse({ currentVersion: 11 }));
  const get = async () => (await worker.fetch(new Request('https://acresx.test/api/upstream-health'), { ASSETS: { fetch: async () => new Response('') } }, { waitUntil() {} })).json();
  const [a, b] = await Promise.all([get(), get()]);
  const c = await get();
  assert.equal(calls.length, HEALTH_TARGETS.length, 'one probe per target for three GETs');
  assert.deepEqual(b, a); assert.deepEqual(c, a);
  mock.timers.tick(HEALTH_MEMO_MS);
  await get();
  assert.equal(calls.length, 2 * HEALTH_TARGETS.length, 'probes again after 60 s');
});

test('upstream health: a run with a failed probe is not reused', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  stubFetch(url => (url.includes('map.kcgov.us') ? new Response('blocked', { status: 403 }) : jsonResponse({ currentVersion: 11 })));
  const get = async () => (await worker.fetch(new Request('https://acresx.test/api/upstream-health'), { ASSETS: { fetch: async () => new Response('') } }, { waitUntil() {} })).json();
  const [a, b] = await Promise.all([get(), get()]);
  assert.deepEqual(b, a, 'concurrent GETs share the run');
  assert.equal(calls.length, HEALTH_TARGETS.length);
  await new Promise(resolve => setImmediate(resolve));
  const c = await get();
  assert.equal(calls.length, 2 * HEALTH_TARGETS.length, 'the next GET probes again');
  assert.equal(c.results.find(r => r.host === 'map.kcgov.us').ok, false);
});
