// Offline tests for /api/property-assessment (src/services/property-tax-test.js).
// Network is stubbed: upstream county/state answers are canned objects or recorded fixtures.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import worker from '../src/index.js';
import { getKootenaiAssessment, KC_ASSESSOR_LAYERS } from '../src/counties/kootenai-assessor.js';
import { inFlight, queued } from '../src/shared/upstream.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const env = { ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
const ctx = { waitUntil() {} };

const realFetch = globalThis.fetch;
let requested = [];
function stubFetch(handler) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    requested.push(url);
    return handler(url, init);
  };
}
beforeEach(() => { requested = []; globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; });
afterEach(() => { globalThis.fetch = realFetch; mock.timers.reset(); });

const arcgisJson = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const features = list => arcgisJson({ features: list.map(attributes => ({ attributes })) });

async function assess(body) {
  const response = await worker.fetch(new Request('https://acresx.test/api/property-assessment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }), env, ctx);
  return { status: response.status, body: await response.json() };
}

// ---- Existing counties: responses must not change (snapshot recorded before the Kootenai change).

function legacyUpstream(url) {
  if (url.hostname === 'gismo.spokanecounty.org') return features([{ PID_NUM: '47174.9017', tax_year: 2026, asmt_year: 2025, land_value: 120000, exmp_amt: 0, asmt_year_exmp_amt: 0, acreage: 5.1, site_address: '123 TEST RD', prop_use_desc: '91 Undeveloped Land' }]);
  if (url.hostname === 'gis.dnrc.mt.gov') return features([{ ParcelID: '03-1033-23-1-01-01-0000', TotalValue: 410000, TotalLandValue: 150000, TotalBuildingValue: 260000, TaxYear: 2025 }]);
  if (url.hostname === 'gis.yellowstonecountymt.gov') return features([{ GEOCODE: '03-1033-23-1-01-01-0000', TAX_ID: 'A12345', FULLADD: '1 TEST LN' }]);
  if (url.hostname === 'services1.arcgis.com') return features([{ PARCEL_ID: 'RP0001', County: 'BONNER', VAL_LAND: 80000, VAL_IMPVTS: 0, VAL_TOTAL: 80000, UPDATED: 1767225600000 }]);
  throw new Error(`unexpected upstream ${url.hostname}`);
}
const legacyCases = {
  spokane: { state: 'WA', county: 'Spokane', parcelId: '47174.9017' },
  yellowstone: { state: 'MT', county: 'Yellowstone', parcelId: '03103323101010000' },
  gallatin: { state: 'MT', county: 'Gallatin', parcelId: '06079821101010000' },
  idahoStatewide: { state: 'ID', county: 'Bonner', parcelId: 'RP0001' },
  unsupported: { state: 'OR', county: 'Lane', parcelId: '1' },
  missingParcel: { state: 'WA', county: 'Spokane', parcelId: '' }
};

test('existing counties: assessment responses match the pre-Kootenai snapshot', async () => {
  stubFetch(legacyUpstream);
  const actual = {};
  for (const [name, body] of Object.entries(legacyCases)) actual[name] = await assess(body);
  if (process.env.UPDATE_SNAPSHOT) writeFileSync(new URL('./fixtures/property-assessment-legacy-snapshot.json', import.meta.url), `${JSON.stringify(actual, null, 2)}\n`);
  assert.deepEqual(actual, fixture('property-assessment-legacy-snapshot.json'));
});

// ---- Kootenai County Assessor (src/counties/kootenai-assessor.js). Fixtures are real answers for
// PIN 47N03W052200 recorded 2026-10-26; owner/mailing values replaced by PLACEHOLDER_* strings.

const recorded = fixture('kootenai-assessor-47N03W052200.json');
const allFields = fixture('kootenai-assessor-47N03W052200-all-fields.json');
const PERSONAL_KEY = /^(Owner_|LastName_|FirstName_|MiddleName_|OwnSfx_|LegalPartyType_|Recipient_|AttentionLine_|DeliveryAddr_|LastLine_|City_Primary|State_Primary|PostalCd_Primary|Country_Primary)/i;

function allKeys(value, keys = []) {
  if (Array.isArray(value)) value.forEach(v => allKeys(v, keys));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.push(k); allKeys(v, keys); }
  return keys;
}
function assertNoPersonalData(body) {
  const leaked = allKeys(body).filter(k => PERSONAL_KEY.test(k));
  assert.deepEqual(leaked, [], `personal fields leaked: ${leaked.join(', ')}`);
  assert.ok(!JSON.stringify(body).includes('PLACEHOLDER'), 'placeholder owner strings leaked');
}
const layerOf = url => Number(/MapServer\/(\d+)\/query/.exec(url.pathname)?.[1]);
// Answers like the live county server: the hit layer returns `hitBody`, every other layer misses.
function kootenaiUpstream({ hitLayer = 10, hitBody = recorded.hit, other = () => arcgisJson(recorded.miss) } = {}) {
  return (url, init) => {
    if (url.hostname !== 'map.kcgov.us') throw new Error(`unexpected upstream ${url.hostname}`);
    return layerOf(url) === hitLayer ? arcgisJson(hitBody) : other(url, init);
  };
}
const kootenai = parcelId => assess({ state: 'ID', county: 'Kootenai', parcelId });

test('kootenai assessment: maps values and property class from the recorded answer', async () => {
  stubFetch(kootenaiUpstream());
  const { status, body } = await kootenai('47N03W052200');
  assert.equal(status, 200);
  assert.equal(body.available, true);
  assert.equal(body.county, 'Kootenai');
  assert.equal(body.countySource, 'Kootenai County Assessor (Assessor_Layers)');
  assert.equal(body.statewideRecords, undefined, 'Kootenai no longer uses the statewide layer');
  assert.deepEqual(body.countyRecords, [{
    pin: '47N03W052200', pid: '47N03W-05-2200', ain: '146901', status: 'A', appraisalDistrict: 6, layerId: 10,
    landValue: 99654, improvementValue: 0, totalValue: 99654, homeownerExemption: 0, netValue: 99654,
    assessmentDate: '2026-01-01', taxYear: 2026, assessorAcres: 2.888,
    propertyClass: '512', propertyClassDescription: 'Rural residential tract'
  }]);
  assertNoPersonalData(body);
  // At most one query per district layer, in layer order (at most 4 at once, so a layer queued
  // behind the hit is never sent), never the rate-limited statewide service, never owner fields.
  const layers = requested.map(layerOf);
  assert.ok(layers.includes(10), 'the hit layer was queried');
  assert.deepEqual(layers, [5, 6, 7, 8, 9, 10, 11].slice(0, layers.length));
  for (const url of requested) {
    assert.equal(url.searchParams.get('returnGeometry'), 'false');
    const out = url.searchParams.get('outFields').split(',');
    assert.ok(!out.includes('*'));
    assert.deepEqual(out.filter(f => PERSONAL_KEY.test(f)), []);
  }
});

test('kootenai assessment: owner and mailing fields never reach the response, even if the server sends them', async () => {
  stubFetch(kootenaiUpstream({ hitBody: allFields }));
  const { body } = await kootenai('47N03W052200');
  assert.equal(body.available, true);
  assert.equal(body.countyRecords[0].propertyClass, '512');
  assertNoPersonalData(body);
  for (const key of ['Owner_Primary', 'Recipient_Primary', 'DeliveryAddr_Primary', 'LastLine_Primary', 'City_Primary', 'State_Primary', 'PostalCd_Primary']) {
    assert.ok(!allKeys(body).includes(key), `${key} present`);
  }
});

test('kootenai assessment: a commercial-layer hit and a dashed PID both resolve', async () => {
  stubFetch(kootenaiUpstream({ hitLayer: 11 }));
  const { body } = await kootenai('47N03W-05-2200');
  assert.equal(body.available, true);
  assert.equal(body.countyRecords[0].layerId, 11);
  assert.equal(requested[0].searchParams.get('where'), "PIN='47N03W-05-2200' OR PID='47N03W-05-2200'");
});

test('kootenai assessment: no record in any layer -> available:false with a note', async () => {
  stubFetch(kootenaiUpstream({ hitLayer: -1 }));
  const { status, body } = await kootenai('99N99W999999');
  assert.equal(status, 200);
  assert.equal(body.available, false);
  assert.deepEqual(body.countyRecords, []);
  assert.match(body.note, /No Kootenai County Assessor record/);
  assert.equal(body.error, undefined);
});

test('kootenai assessment: upstream failure degrades to available:false, not a 502', async () => {
  const failures = [
    () => { throw new Error('connect ECONNREFUSED'); },
    () => new Response('bad gateway', { status: 502 }),
    () => arcgisJson(recorded.error),
    () => { throw new DOMException('aborted', 'AbortError'); }
  ];
  let last;
  for (const other of failures) {
    stubFetch(kootenaiUpstream({ hitLayer: -1, other }));
    const { status, body } = await kootenai('47N03W052200');
    assert.equal(status, 200);
    assert.equal(body.available, false);
    assert.deepEqual(body.countyRecords, []);
    assert.match(body.error, /Kootenai County Assessor/);
    last = body;
  }
  assert.match(last.error, /timed out \(7 of 7 layers failed\)/);
});

test('kootenai assessment: a failing layer does not hide a hit in another layer', async () => {
  stubFetch(kootenaiUpstream({ other: url => (layerOf(url) === 5 ? new Response('x', { status: 500 }) : arcgisJson(recorded.miss)) }));
  const { body } = await kootenai('47N03W052200');
  assert.equal(body.available, true);
  assert.equal(body.countyRecords[0].pin, '47N03W052200');
});

test('kootenai assessment: the first hit answers at once and the other layer requests are aborted', async () => {
  const signals = {};
  stubFetch(kootenaiUpstream({
    hitLayer: 5,
    other: (url, init) => {
      signals[layerOf(url)] = init.signal;
      // Layers 7 and 9 hang until aborted (the 10 s timeout would be the only other way out).
      if (layerOf(url) === 7 || layerOf(url) === 9) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      return new Promise(resolve => setTimeout(() => resolve(arcgisJson(recorded.miss)), 50));
    }
  }));
  const started = Date.now();
  const { body } = await kootenai('47N03W052200');
  const elapsed = Date.now() - started;
  assert.equal(body.available, true);
  assert.equal(body.countyRecords[0].layerId, 5);
  assert.ok(elapsed < 500, `answered in ${elapsed} ms`);
  // Layers 5-8 start (the per-host cap is 4); 9-11 wait for a slot and are never sent once
  // layer 5 has answered. Any request still pending is aborted.
  assert.equal(signals[7].aborted, true, 'the hanging layer request was aborted');
  assert.equal(signals[9], undefined, 'a layer waiting behind the cap is not sent after the hit');
  assert.equal(signals[6].aborted, true, 'other pending layer requests were aborted');
});

test('kootenai assessment: a slow host with the hit in a layer queued behind the cap still finds it', async () => {
  // Every layer answers in 6 s; the PIN is in layer 11, which waits for a slot behind 5-8. The
  // 10 s timeout starts when a layer is sent, so 11 (sent at ~6 s) answers at ~12 s.
  // The mocked clock starts at real time, and earlier tests must leave no map.kcgov.us request
  // waiting or holding a slot (a leftover would delay this one).
  assert.equal(queued('map.kcgov.us'), 0, 'no leftover queue entries');
  assert.equal(inFlight('map.kcgov.us'), 0, 'no leftover slots');
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const sent = {};
  stubFetch(kootenaiUpstream({ hitLayer: -1, other: url => new Promise(resolve => {
    sent[layerOf(url)] = Date.now();
    setTimeout(() => resolve(arcgisJson(layerOf(url) === 11 ? recorded.hit : recorded.miss)), 6000);
  }) }));
  const started = Date.now();
  let result = null;
  const pending = getKootenaiAssessment('47N03W052200').then(value => { result = value; });
  for (let ms = 0; ms < 20000 && !result; ms += 10) {
    mock.timers.tick(10);
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  }
  await pending;
  assert.equal(result.status, 'found');
  assert.equal(result.record.layerId, 11);
  assert.ok(sent[11] - started >= 6000, 'layer 11 waited for a slot');
  assert.ok(Date.now() - started < 13000, `found at ${Date.now() - started} ms`);
  assert.equal(queued('map.kcgov.us'), 0, 'cancelled layers left the queue');
});

test('kootenai assessment: a quick hit in a queued layer is found while layers 5-8 hang', async () => {
  // The queue budget (12 s) is a little longer than the 10 s timeout of the layers ahead, so a
  // queued layer is still sent when they time out.
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  stubFetch(kootenaiUpstream({ hitLayer: 9, other: (url, init) => (layerOf(url) <= 8 ? new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason))) : arcgisJson(recorded.miss)) }));
  const started = Date.now();
  let result = null;
  const pending = getKootenaiAssessment('47N03W052200').then(value => { result = value; });
  for (let ms = 0; ms < 20000 && !result; ms += 10) {
    mock.timers.tick(10);
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  }
  await pending;
  assert.equal(result.status, 'found');
  assert.equal(result.record.layerId, 9);
  assert.ok(Date.now() - started < 11000, `found at ${Date.now() - started} ms`);
  assert.equal(queued('map.kcgov.us'), 0);
});

test('kootenai assessment: with no hit, a hanging-then-failing layer still makes it an error, not not-found', async () => {
  stubFetch(kootenaiUpstream({
    hitLayer: -1,
    other: url => (layerOf(url) === 9 ? new Promise((_, reject) => setTimeout(() => reject(new Error('socket hang up')), 30)) : arcgisJson(recorded.miss))
  }));
  const { body } = await kootenai('47N03W052200');
  assert.equal(body.available, false);
  assert.equal(body.error, 'Kootenai County Assessor unavailable: socket hang up');
});

test('kootenai assessment: null, empty and missing values map to null, never 0', async () => {
  const blank = { features: [{ attributes: { ...recorded.hit.features[0].attributes, AssessValue_Land: null, AssessValue_Imp: '', HO_Exemption: null, AssessValue_Net: undefined, PclArea_Acres: null, AssessValue_Date: null } }] };
  stubFetch(kootenaiUpstream({ hitBody: blank }));
  const { body } = await kootenai('47N03W052200');
  const r = body.countyRecords[0];
  assert.deepEqual([r.landValue, r.improvementValue, r.totalValue, r.homeownerExemption, r.netValue, r.assessorAcres, r.assessmentDate, r.taxYear], [null, null, null, null, null, null, null, null]);
  assert.equal(r.propertyClass, '512');
});

test('kootenai assessment: quotes in the parcel number are escaped', async () => {
  stubFetch(kootenaiUpstream({ hitLayer: -1 }));
  await kootenai("47n03w'052200");
  assert.equal(requested.length, 7);
  for (const url of requested) assert.equal(url.searchParams.get('where'), "PIN='47N03W''052200' OR PID='47N03W''052200'");
});

// ---- Kootenai assessor cache (Cache API, validated answers only)

function fakeCache() {
  const store = new Map();
  const puts = [];
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { puts.push(req.url); store.set(req.url, res.clone()); }
  } };
  return { puts };
}

test('kootenai assessor: found records are cached per PIN; misses and errors are not', async t => {
  const { puts } = fakeCache();
  t.after(() => { delete globalThis.caches; });
  const hit = { features: [{ attributes: { PIN: '47N03W052200', PID: '47N03W-05-2200', AssessValue_Land: 1000, AssessValue_Date: 20260101 } }] };
  stubFetch(url => (layerOf(url) === 6 ? arcgisJson(hit) : arcgisJson({ features: [] })));
  const first = await getKootenaiAssessment('47N03W052200');
  assert.equal(first.status, 'found');
  const sent = requested.length;
  assert.ok(sent <= KC_ASSESSOR_LAYERS.length);
  const second = await getKootenaiAssessment('47n03w052200 ');
  assert.deepEqual(second, first);
  assert.equal(requested.length, sent, 'second lookup made no requests');
  assert.equal(puts.length, 1);

  stubFetch(() => arcgisJson({ features: [] }));
  assert.equal((await getKootenaiAssessment('99N99W999999')).status, 'not_found');
  stubFetch(() => new Response('x', { status: 500 }));
  assert.equal((await getKootenaiAssessment('98N98W999999')).status, 'error');
  assert.equal(puts.length, 1, 'misses and errors are not cached');
});
