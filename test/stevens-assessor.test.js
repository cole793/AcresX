// Offline tests for the Stevens County (WA) assessor adapter (src/counties/stevens-assessor.js) and
// its /api/property-assessment branch. Upstream answers are recorded from the live layer
// (test/fixtures/stevens-assessor.json, values only) or canned; fetch is stubbed, no network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import {
  getStevensAssessment, normalizeStevensParcelId, STEVENS_ASSESSOR, STEVENS_ASSESSOR_FIELDS, STEVENS_ASSESSOR_CACHE_PREFIX, WA_LAND_USE_CODES
} from '../src/counties/stevens-assessor.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const recorded = fixture('stevens-assessor.json').answers;
const allFields = fixture('stevens-assessor-0231200-all-fields.json');
const env = { ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
const ctx = { waitUntil() {} };
const QUERY = `${STEVENS_ASSESSOR}/query`;

const realFetch = globalThis.fetch, realWarn = console.warn;
let requested = [], restoreUpstream;
function stubFetch(handler) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    requested.push(url);
    return handler(url, init);
  };
}
beforeEach(() => {
  requested = [];
  globalThis.fetch = async () => { throw new Error('network disabled in tests'); };
  console.warn = () => {};
  restoreUpstream = configureUpstream({ backoffMs: 0 });
});
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream(); });

const arcgisJson = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
// Answers the recorded body for the PARCELN asked for, the recorded miss otherwise.
const recordedLayer = url => {
  assert.equal(url.origin + url.pathname, QUERY);
  const id = /PARCELN='(\d+)'/.exec(url.searchParams.get('where'))?.[1];
  return arcgisJson(recorded[id] || recorded.miss);
};
async function assess(parcelId, county = 'Stevens') {
  const response = await worker.fetch(new Request('https://acresx.test/api/property-assessment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'WA', county, parcelId })
  }), env, ctx);
  return { status: response.status, body: await response.json() };
}

test('stevens assessment: a hit maps assessed, taxable and market values, class and current use (2342700)', async () => {
  stubFetch(recordedLayer);
  const { status, body } = await assess('2342700');
  assert.equal(status, 200);
  assert.equal(body.available, true);
  assert.equal(body.state, 'WA');
  assert.equal(body.county, 'Stevens');
  assert.equal(body.countySource, 'Stevens County Assessor (RealPropertyParcels_Public)');
  assert.equal(body.countySourceUrl, STEVENS_ASSESSOR);
  assert.deepEqual(body.countyRecords[0], {
    parcelNumber: '2342700', propertyId: 43102,
    landValue: 12794, improvementValue: 14000, totalValue: 26794, taxableValue: 26794, marketLandValue: 336000, marketValue: 350000,
    netValue: 26794, taxYear: 2026, assessorAcres: 280, taxCodeArea: '021-115',
    propertyClass: '88', propertyClassDescription: 'Designated forest land under chapter 84.33 RCW', propertyClassNote: 'Tax category, not zoning',
    landSchedule: '88-DFL', currentUse: { status: 'classified', program: 'Designated forest land (RCW 84.33)' }
  });
  // One request, named fields only, no geometry.
  assert.equal(requested.length, 1);
  const p = requested[0].searchParams;
  assert.equal(p.get('where'), "PARCELN='2342700'");
  assert.equal(p.get('outFields'), STEVENS_ASSESSOR_FIELDS);
  assert.equal(p.get('returnGeometry'), 'false');
  assert.equal(p.get('f'), 'json');
});

test('stevens assessment: a city lot is not in a current-use program; the layer has no tax amount', async () => {
  stubFetch(recordedLayer);
  const r = (await assess('0231200')).body.countyRecords[0];
  assert.equal(r.propertyClass, '11');
  assert.equal(r.propertyClassDescription, 'Household, single family units');
  assert.equal(r.landSchedule, null, 'a blank Ag_Sched is null');
  assert.deepEqual(r.currentUse, { status: 'not_classified', program: null });
  assert.equal(r.totalValue, 90567);
  assert.equal(r.assessorAcres, 0.12);
  assert.ok(!Object.keys(r).some(k => /tax/i.test(k) && !/taxYear|taxableValue|taxCodeArea/.test(k)), 'no tax amount key');
});

test('stevens assessment: of several rows for one parcel, the one with values wins (2148112)', async () => {
  stubFetch(recordedLayer);
  const r = (await assess('2148112')).body.countyRecords[0];
  assert.equal(recorded['2148112'].features.length, 3);
  assert.equal(r.propertyId, 67209);
  assert.equal(r.totalValue, 48198);
  assert.equal(r.taxYear, 2026);
});

test('stevens assessment: a record with all values 0 shows them as missing, never $0 (8974701)', async () => {
  stubFetch(recordedLayer);
  const r = (await assess('8974701')).body.countyRecords[0];
  for (const k of ['landValue', 'improvementValue', 'totalValue', 'taxableValue', 'marketLandValue', 'marketValue', 'netValue']) assert.equal(r[k], null, k);
  assert.match(r.valuesNote, /carries no values/);
  assert.equal(r.propertyClass, '99');
  assert.equal(r.propertyClassDescription, 'Other undeveloped land');
  assert.equal(r.assessorAcres, 0.75);
});

test('stevens assessment: null and empty values stay null; a real 0 improvement value stays 0', async () => {
  const attrs = { PARCELN: '1234567', year: 2026, property_u: '91', assessed_l: 5000, market_lan: 5000, improvemen: 0, appraised_: null, market_1: '', taxable_va: undefined };
  stubFetch(() => arcgisJson({ features: [{ attributes: attrs }] }));
  const r = (await assess('1234567')).body.countyRecords[0];
  assert.equal(r.improvementValue, 0);
  assert.equal(r.totalValue, 5000, 'land + improvement when appraised_ is missing');
  assert.equal(r.marketValue, null);
  assert.equal(r.taxableValue, null);
  assert.equal(r.netValue, null);
});

test('stevens assessment: land assessed below market without a current-use code is flagged, not called classified', async () => {
  stubFetch(() => arcgisJson({ features: [{ attributes: { PARCELN: '0454820', year: 2026, property_u: '11', Ag_Sched: 'FARM', market_lan: 167220, assessed_l: 10015, improvemen: 1, appraised_: 10016 } }] }));
  const r = (await assess('0454820')).body.countyRecords[0];
  assert.equal(r.currentUse.status, 'reduced_land_value');
  assert.equal(r.currentUse.program, null);
});

test('stevens assessment: no record -> available:false with a note, HTTP 200', async () => {
  stubFetch(recordedLayer);
  const { status, body } = await assess('9999999');
  assert.equal(status, 200);
  assert.equal(body.available, false);
  assert.deepEqual(body.countyRecords, []);
  assert.match(body.note, /No Stevens County Assessor record/);
  assert.equal(body.error, undefined);
  assert.equal(body.fallback, undefined);
});

test('stevens assessment: layer failure degrades this layer only (available:false, error, browser hint when eligible)', async () => {
  const cases = [
    [() => { throw new TypeError('fetch failed'); }, true],
    [() => new Response('bad gateway', { status: 502 }), true],
    [() => new Response('forbidden', { status: 403 }), true],
    [() => arcgisJson({ error: { code: 500, message: 'Unable to complete operation.' } }), true],
    [() => arcgisJson({ error: { code: 400, message: 'Invalid query' } }), false],
    [() => new Response('not json', { status: 200 }), false]
  ];
  for (const [handler, hinted] of cases) {
    stubFetch(handler);
    const { status, body } = await assess('0231200');
    assert.equal(status, 200);
    assert.equal(body.available, false);
    assert.deepEqual(body.countyRecords, []);
    assert.match(body.error, /^Stevens County Assessor/);
    if (hinted) assert.deepEqual(body.fallback, { mode: 'browser', kind: 'stevens-assessor', input: { parcelId: '0231200' } });
    else assert.equal(body.fallback, undefined);
  }
});

test('stevens parcel numbers: formats a realtor might type', () => {
  const cases = {
    '0231200': '0231200', ' 0231200 ': '0231200', '0231-200': '0231200', '02312.00': '0231200',
    '231200': '0231200', '500': '0000500', '065-0231200': '0231200', '0650231200': '0231200', '8974701': '8974701'
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(normalizeStevensParcelId(input), want, input);
  for (const bad of ['', null, undefined, 'RR ROW', '12345678', 'P1234567', "0231200' OR '1'='1", '47N03W052200']) assert.equal(normalizeStevensParcelId(bad), null, String(bad));
});

test('stevens assessment: typed forms reach the same record; ids that cannot be Stevens send no request', async () => {
  stubFetch(recordedLayer);
  for (const typed of ['231200', '065-0231200', '0231 200']) {
    const { body } = await assess(typed);
    assert.equal(body.available, true, typed);
    assert.equal(body.parcelId, typed, 'the answer echoes what was typed');
    assert.equal(body.countyRecords[0].parcelNumber, '0231200');
  }
  assert.ok(requested.every(u => u.searchParams.get('where') === "PARCELN='0231200'"));
  requested = [];
  const { body } = await assess("0231200' OR '1'='1");
  assert.equal(body.available, false);
  assert.equal(requested.length, 0);
  assert.equal((await assess('0231200', 'stevens county')).body.available, true, 'county name forms');
});

test('stevens assessment: owner and mailing fields never reach the response, even if the server sends them', async () => {
  stubFetch(() => arcgisJson(allFields));
  const { body } = await assess('0231200');
  assert.equal(body.available, true);
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /PLACEHOLDER|file_as_na|last_name|first_name|owner_id|addr_/);
  // Fields the adapter never asked for do not leak either (situs, legal description, links).
  assert.doesNotMatch(text, /situs|legal_desc|Propertyinformation|hood_/);
});

test('WA land use descriptions follow WAC 458-53-030(5)', () => {
  assert.equal(WA_LAND_USE_CODES[83], 'Agriculture classified under current use chapter 84.34 RCW');
  assert.equal(WA_LAND_USE_CODES[91], 'Undeveloped land');
  assert.equal(WA_LAND_USE_CODES[36], undefined, 'not presently assigned');
});

// ---- Cache (Cache API, validated answers only)

function fakeCache() {
  const store = new Map();
  const puts = [];
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { puts.push(req.url); store.set(req.url, res.clone()); }
  } };
  return { puts };
}

test('stevens assessor: found records are cached per normalized parcel number; misses and errors are not', async t => {
  const { puts } = fakeCache();
  t.after(() => { delete globalThis.caches; });
  stubFetch(recordedLayer);
  const first = await getStevensAssessment('0231200');
  assert.equal(first.status, 'found');
  assert.equal(requested.length, 1);
  const second = await getStevensAssessment('231-200');
  assert.deepEqual(second, first);
  assert.equal(requested.length, 1, 'second lookup made no requests');
  assert.equal(puts.length, 1);
  assert.ok(puts[0].startsWith(STEVENS_ASSESSOR_CACHE_PREFIX), puts[0]);
  assert.match(STEVENS_ASSESSOR_CACHE_PREFIX, /\/stevens-assessor\/v\d+\/$/);

  assert.equal((await getStevensAssessment('9999999')).status, 'not_found');
  stubFetch(() => new Response('x', { status: 500 }));
  assert.equal((await getStevensAssessment('1111111')).status, 'error');
  assert.equal(puts.length, 1, 'misses and errors are not cached');
});
