// Offline tests for the Spokane County (WA) assessor adapter (src/counties/spokane-assessor.js) and
// its /api/property-assessment branch. Upstream answers are recorded from the live layer on
// 2026-11-10 (test/fixtures/spokane-assessor.json, and spokane-assessor-13013.2211-all-fields.json
// with owner values replaced by placeholders) or canned; fetch is stubbed, no network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { PERSONAL_FIELD } from '../src/shared/personal-fields.js';
import {
  getSpokaneAssessment, normalizeSpokaneParcelId, spokaneScoutUrl, mapSpokaneAssessorRecord,
  SPOKANE_ASSESSOR, SPOKANE_ASSESSOR_BACKUP, SPOKANE_ASSESSOR_FIELDS, SPOKANE_ASSESSOR_CACHE_PREFIX
} from '../src/counties/spokane-assessor.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const recorded = fixture('spokane-assessor.json').answers;
const allFields = fixture('spokane-assessor-13013.2211-all-fields.json');
const env = { ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
const ctx = { waitUntil() {} };
const QUERY = `${SPOKANE_ASSESSOR}/query`;
const BACKUP_QUERY = `${SPOKANE_ASSESSOR_BACKUP}/query`;
const SCOUT = pid => `https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=${pid}`;

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
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream(); delete globalThis.caches; });

const arcgisJson = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const askedPid = url => /PID_NUM='([^']+)'/.exec(url.searchParams.get('where'))?.[1];
// Answers the recorded body for the PID_NUM asked for, the recorded miss otherwise.
const recordedLayer = url => {
  assert.equal(url.origin + url.pathname, QUERY);
  return arcgisJson(recorded[askedPid(url)] || recorded.miss);
};
async function post(path, body) {
  const response = await worker.fetch(new Request(`https://acresx.test${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }), env, ctx);
  return { status: response.status, body: await response.json(), cache: response.headers.get('Cache-Control') };
}
const assess = parcelId => post('/api/property-assessment', { state: 'WA', county: 'Spokane', parcelId });

// ---- Assessor: hits

test('spokane assessment: a hit maps assessed, land, improvement, taxable values, exemption, class and the SCOUT link (35234.0602)', async () => {
  stubFetch(recordedLayer);
  const { status, body } = await assess('35234.0602');
  assert.equal(status, 200);
  assert.equal(body.available, true);
  assert.equal(body.county, 'Spokane');
  assert.equal(body.countySource, 'Spokane County Assessor (assessor parcel table, Spokane County GIS)');
  assert.equal(body.countySourceUrl, SPOKANE_ASSESSOR);
  assert.equal(body.source, body.countySource);
  // Live SCOUT, tax year 2027: Taxable 76,466, Market Total 589,000, Land 110,000, Dwelling/Structure 479,000.
  assert.deepEqual(body.countyRecords[0], {
    parcelNumber: '35234.0602', propertySearchUrl: SCOUT('35234.0602'), propertySearchLabel: 'View on Spokane County SCOUT',
    landValue: 110000, improvementValue: 479000, improvementValueNote: 'Assessed total minus land value',
    totalValue: 589000, taxableValue: 76466, netValue: 76466, marketLandValue: 110000, marketValue: 589000,
    exemption: { code: null, description: 'Personal exemption applied (details on SCOUT)', value: 512534, personal: true },
    taxYear: 2027, taxAmount: null, taxAmountNote: 'Not published in the county GIS. The SCOUT page lists the tax bill.',
    assessorAcres: 0.42, taxCodeArea: '0140', segStatus: 'Active-Complete',
    propertyClass: '11', propertyClassDescription: 'Single Unit', propertyClassNote: 'Tax category, not zoning',
    currentUse: { status: 'not_classified', program: null }
  });
  // The older raw row is kept, with the keys SCOUTSimple gave it.
  assert.deepEqual(Object.keys(body.records[0]), ['PID_NUM', 'tax_year', 'asmt_year', 'land_value', 'exmp_amt', 'asmt_year_exmp_amt', 'acreage', 'site_address', 'prop_use_desc']);
  assert.equal(body.records[0].land_value, 110000);
  // One request, named fields only, no geometry.
  assert.equal(requested.length, 1);
  const p = requested[0].searchParams;
  assert.equal(p.get('where'), "PID_NUM='35234.0602'");
  assert.equal(p.get('outFields'), SPOKANE_ASSESSOR_FIELDS);
  assert.equal(p.get('returnGeometry'), 'false');
  assert.equal(p.get('f'), 'json');
});

test('spokane assessment: current-use land (88, 83) has an assessed total but no land/improvement split, and keeps the market land value', async () => {
  stubFetch(recordedLayer);
  // 48136.9052, SCOUT 2027: Taxable 99,910 = current-use land 57,610 + structure 42,300; market land 283,740.
  const forest = (await assess('48136.9052')).body.countyRecords[0];
  assert.equal(forest.totalValue, 99910);
  assert.equal(forest.taxableValue, 99910);
  assert.equal(forest.landValue, null);
  assert.equal(forest.improvementValue, null);
  assert.equal(forest.marketValue, null);
  assert.equal(forest.marketLandValue, 283740);
  assert.deepEqual(forest.currentUse, { status: 'classified', program: 'Designated forest land (RCW 84.33)' });
  assert.match(forest.valuesNote, /current-use value/);
  assert.equal(`${forest.propertyClass} ${forest.propertyClassDescription}`, '88 Designated Forest Lnd');
  const farm = (await assess('32322.9002')).body.countyRecords[0];
  assert.equal(farm.totalValue, 62690);
  assert.equal(farm.marketLandValue, 503410);
  assert.deepEqual(farm.currentUse, { status: 'classified', program: 'Current use: agriculture (RCW 84.34)' });
});

test('spokane assessment: exempt parcels (church, government) show taxable 0 and the exemption, improvements 0 from the record', async () => {
  stubFetch(recordedLayer);
  const church = (await assess('35204.2729')).body.countyRecords[0];
  assert.equal(church.totalValue, 72900);
  assert.equal(church.taxableValue, 0);
  assert.equal(church.improvementValue, 0, 'SCOUT shows Dwelling/Structure 0');
  assert.deepEqual(church.exemption, { code: 'DOR', description: null, value: 72900 });
  assert.equal(`${church.propertyClass} ${church.propertyClassDescription}`, '77 Churches');
  const gov = (await assess('46301.9025')).body.countyRecords[0];
  assert.deepEqual(gov.exemption, { code: 'GOVT', description: null, value: 199510 });
  const plain = (await assess('13013.2211')).body.countyRecords[0];
  assert.equal(plain.exemption, null);
  assert.equal(plain.improvementValue, 301500);
});

test('spokane assessment: a record without values gives null values and a note, never $0', () => {
  const r = mapSpokaneAssessorRecord({ PID_NUM: '12345.6789', prop_use_code: '91', prop_use_desc: 'Vacant Land', land_value: 0, assessed_amt: 0, taxable_amt: null, asmt_year: 2027 });
  for (const k of ['landValue', 'improvementValue', 'totalValue', 'taxableValue', 'netValue', 'marketLandValue', 'marketValue']) assert.equal(r[k], null, k);
  assert.equal(r.exemption, null);
  assert.match(r.valuesNote, /carries no values/);
  assert.equal(r.propertyClass, '91');
});

// ---- Assessor: misses, failures

test('spokane assessment: no record is available:false with a note, not an error', async () => {
  stubFetch(recordedLayer);
  const { status, body } = await assess('99999.9999');
  assert.equal(status, 200);
  assert.equal(body.available, false);
  assert.deepEqual(body.countyRecords, []);
  assert.deepEqual(body.records, []);
  assert.match(body.note, /No Spokane County Assessor record/);
  assert.equal(body.error, undefined);
  assert.equal(body.fallback, undefined);
});

test('spokane assessment: layer failure degrades this layer only (available:false, error, browser hint when eligible)', async () => {
  const cases = [
    // [handler, browser hint, requests]. A network error is not retried on the backup (same host).
    [() => { throw new TypeError('fetch failed'); }, true, 1],
    [() => new Response('bad gateway', { status: 502 }), true, 2],
    [() => new Response('forbidden', { status: 403 }), true, 2],
    [() => arcgisJson({ error: { code: 500, message: 'Unable to complete operation.' } }), true, 2],
    [() => arcgisJson({ error: { code: 400, message: 'Invalid query' } }), false, 2],
    [() => new Response('not json', { status: 200 }), false, 2]
  ];
  for (const [handler, hinted, requests] of cases) {
    requested = [];
    stubFetch(handler);
    const { status, body } = await assess('13013.2211');
    assert.equal(status, 200);
    assert.equal(body.available, false);
    assert.deepEqual(body.countyRecords, []);
    assert.match(body.error, /^Spokane County Assessor/);
    assert.equal(requested.length, requests);
    if (requests === 2) assert.equal(requested[1].origin + requested[1].pathname, BACKUP_QUERY);
    if (hinted) assert.deepEqual(body.fallback, { mode: 'browser', kind: 'spokane-assessor', input: { parcelId: '13013.2211' } });
    else assert.equal(body.fallback, undefined);
  }
});

test('spokane assessment: when the first layer is gone, the backup layer answers with the same fields', async () => {
  stubFetch(url => (url.origin + url.pathname === QUERY
    ? arcgisJson({ error: { code: 404, message: 'Service ISDSDE/LandCapacityAnalysis/MapServer not found' } })
    : arcgisJson(recorded['13013.2211'])));
  const { body } = await assess('13013.2211');
  assert.equal(body.available, true);
  assert.equal(body.countyRecords[0].totalValue, 401500);
  assert.equal(requested.length, 2);
  assert.equal(requested[1].origin + requested[1].pathname, BACKUP_QUERY);
  assert.equal(requested[1].searchParams.get('outFields'), SPOKANE_ASSESSOR_FIELDS);
});

// ---- Parcel numbers

test('spokane parcel numbers: dots, dashes, spaces, no dots and the statewide PARCEL_ID_NR form', () => {
  const cases = {
    '35204.2729': '35204.2729', ' 35204.2729 ': '35204.2729', '35204-2729': '35204.2729', '35204 2729': '35204.2729',
    '352042729': '35204.2729', '063-35204.2729': '35204.2729', '06335204.2729': '35204.2729', '063352042729': '35204.2729'
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(normalizeSpokaneParcelId(input), want, input);
  for (const bad of ['', null, undefined, 'UNKNOWN', '3520.42729x', '35204.272', '3520427299', "35204.2729' OR '1'='1", '47N03W052200', '0231200']) {
    assert.equal(normalizeSpokaneParcelId(bad), null, String(bad));
  }
});

test('spokane assessment: typed forms reach the same record; ids that cannot be Spokane send no request', async () => {
  stubFetch(recordedLayer);
  for (const typed of ['352042729', '35204-2729', '063-35204.2729']) {
    const { body } = await assess(typed);
    assert.equal(body.available, true, typed);
    assert.equal(body.parcelId, typed, 'the answer echoes what was typed');
    assert.equal(body.countyRecords[0].parcelNumber, '35204.2729');
  }
  assert.ok(requested.every(u => u.searchParams.get('where') === "PID_NUM='35204.2729'"));
  requested = [];
  for (const bad of ['UNKNOWN', "1' OR '1'='1"]) assert.equal((await assess(bad)).body.available, false);
  assert.equal(requested.length, 0);
});

// ---- Privacy

test('spokane assessor: the field list names no owner, taxpayer or mailing field; owner data sent anyway never reaches the answer', async () => {
  const fields = SPOKANE_ASSESSOR_FIELDS.split(',');
  assert.ok(!fields.includes('*'));
  assert.deepEqual(fields.filter(f => PERSONAL_FIELD.test(f)), []);
  // Every owner/taxpayer field the backup layer publishes matches the strip pattern.
  const layerFields = allFields.fields.map(f => f.name);
  const ownerFields = layerFields.filter(n => /^(owner|taxpayer)/i.test(n));
  assert.ok(ownerFields.length >= 10, ownerFields.join());
  assert.deepEqual(ownerFields.filter(n => !PERSONAL_FIELD.test(n)), []);
  assert.deepEqual(ownerFields.filter(n => fields.includes(n)), []);
  // A server that ignores outFields and sends everything (owner values are placeholders).
  stubFetch(() => arcgisJson(allFields));
  const { body } = await assess('13013.2211');
  assert.equal(body.available, true);
  assert.doesNotMatch(JSON.stringify(body), /PLACEHOLDER|owner|taxpayer/i);
  assert.equal(body.countyRecords[0].totalValue, 401500);
});

test('spokane mapper strips personal fields before reading the record (Worker and browser copy)', () => {
  const workerSource = readFileSync(new URL('../src/counties/spokane-assessor.js', import.meta.url), 'utf8');
  const browserCopy = readFileSync(new URL('../public/browser-fallback.js', import.meta.url), 'utf8');
  const firstStep = /function mapSpokaneAssessorRecord\(raw = \{\}\) \{\s*const attrs = withoutPersonalFields\(raw\);/;
  assert.match(workerSource, firstStep);
  assert.match(browserCopy, firstStep);
});

test('spokane assessment: a Senior/Disabled exemption (SA, SB, SC) returns only the amount, never its code or name; other codes keep theirs', async () => {
  for (const code of ['SA', 'SB', 'SC', 'sb']) {
    const attrs = { ...recorded['35234.0602'].features[0].attributes, exmp_code: code };
    stubFetch(() => arcgisJson({ features: [{ attributes: attrs }] }));
    const { body } = await assess('35234.0602');
    assert.deepEqual(body.countyRecords[0].exemption, { code: null, description: 'Personal exemption applied (details on SCOUT)', value: 512534, personal: true }, code);
    assert.equal(body.countyRecords[0].taxableValue, 76466, 'taxable value unchanged');
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /Senior|Disabled/i, code);
    assert.ok(!text.includes(`"${code}"`), `the code ${code} is not in the answer`);
    assert.ok(!Object.keys(body.records[0]).includes('exmp_code'));
  }
  const named = { '1HOME': 'Homeowner exemption', MFUH: 'Multi Family Urban Housing', '2HIST': 'Historical Designation', DOR: null, GOVT: null };
  for (const [code, description] of Object.entries(named)) {
    assert.deepEqual(mapSpokaneAssessorRecord({ PID_NUM: '12345.6789', assessed_amt: 300000, taxable_amt: 280000, land_value: 100000, exmp_code: code }).exemption, { code, description, value: 20000 }, code);
  }
});

// ---- SCOUT link

test('spokane SCOUT link: built from the record PID only; any other host, path or parameter is refused', () => {
  assert.equal(spokaneScoutUrl(undefined, '35204.2729'), SCOUT('35204.2729'));
  assert.equal(spokaneScoutUrl(undefined, 'UNKNOWN'), null);
  assert.equal(spokaneScoutUrl(undefined, '35204.2729&x=1'), null);
  const url = SCOUT('35204.2729');
  const cases = [
    [url, url],
    [url.replace('https:', 'http:'), url], // upgraded
    [url.replace('/SCOUT/', '/scout/'), url], // the county links both spellings
    [url.replace('cp.spokanecounty.org', 'evil.example'), null],
    [url.replace('cp.spokanecounty.org', 'cp.spokanecounty.org.evil.com'), null],
    [url.replace('cp.spokanecounty.org', 'evil-spokanecounty.org'), null],
    [url.replace('cp.spokanecounty.org', 'cp.spokanecounty.org:8443'), null],
    [url.replace('https://', 'https://user:pw@'), null],
    [url.replace('Summary.aspx', 'Taxes.aspx'), null],
    [url.replace('35204.2729', '35204.2730'), null], // another parcel
    [`${url}&redirect=//evil.com`, null],
    [`${url}&PID=35204.2729`, null],
    ['javascript:alert(1)', null]
  ];
  for (const [sent, want] of cases) assert.equal(spokaneScoutUrl(sent, '35204.2729'), want, sent);
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

test('spokane assessor: found records are cached per normalized parcel number; misses and errors are not', async () => {
  const { puts } = fakeCache();
  stubFetch(recordedLayer);
  const first = await getSpokaneAssessment('35204.2729');
  assert.equal(first.status, 'found');
  assert.equal(requested.length, 1);
  const second = await getSpokaneAssessment('352042729');
  assert.deepEqual(second, first);
  assert.equal(requested.length, 1, 'second lookup made no requests');
  assert.equal(puts.length, 1);
  assert.ok(puts[0].startsWith(SPOKANE_ASSESSOR_CACHE_PREFIX), puts[0]);
  assert.equal((await getSpokaneAssessment('99999.9999')).status, 'not_found');
  stubFetch(() => new Response('x', { status: 500 }));
  assert.equal((await getSpokaneAssessment('11111.1111')).status, 'error');
  assert.equal(puts.length, 1, 'misses and errors are not cached');
  assert.doesNotMatch(JSON.stringify(first), /owner|taxpayer/i);
});
