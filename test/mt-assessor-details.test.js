// Montana assessor details (owner question 2026-11-19: "Why is most assessor info missing from MT
// reports?"). /api/property-assessment now adds cadastralRecords, the state cadastral record
// mapped by src/states/montana/assessment.js, for Yellowstone and Gallatin. Offline: the DNRC and
// Yellowstone layers are stubbed with records recorded 2026-11-19
// (test/fixtures/mt-cadastral-assessment.json, fake PLACEHOLDER_* owner fields added).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { findMontanaStateRecord, montanaStateWhere } from '../src/services/property-tax-test.js';
import { mapMontanaAssessment, montanaPropertyType, montanaLandUse, montanaPropertyCardUrl, MONTANA_AG_NOTE } from '../src/states/montana/assessment.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/mt-cadastral-assessment.json', import.meta.url), 'utf8'));
const env = { ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
const ctx = { waitUntil() {} };
const realFetch = globalThis.fetch;
const arcgis = list => new Response(JSON.stringify({ features: list.map(attributes => ({ attributes })) }), { headers: { 'Content-Type': 'application/json' } });

// Answers the DNRC cadastral and Yellowstone tax-parcel queries from the fixture, by the id in
// the where clause; `dnrcDown` makes the state layer fail.
let dnrcWheres = [];
function stubMontana({ dnrcDown = false } = {}) {
  dnrcWheres = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const where = url.searchParams.get('where') || '';
    const id = (/'([^']+)'/.exec(where) || [])[1] || '';
    if (url.hostname === 'gis.dnrc.mt.gov') {
      if (dnrcDown) throw new Error('DNRC down');
      // One combined query; the 17-digit PARCELID form is what matches on the live layer.
      dnrcWheres.push(where);
      const hit = [...where.matchAll(/'([^']+)'/g)].map(m => m[1]).find(i => fx.records[i]);
      return arcgis(/^PARCELID IN \(/.test(where) && hit ? [fx.records[hit]] : []);
    }
    if (url.hostname === 'gis.yellowstonecountymt.gov') return arcgis(fx.yellowstoneTaxParcel[id] ? [fx.yellowstoneTaxParcel[id]] : []);
    throw new Error(`unexpected upstream ${url.hostname}`);
  };
}
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; });
afterEach(() => { globalThis.fetch = realFetch; });

async function assess(county, parcelId) {
  const response = await worker.fetch(new Request('https://acresx.test/api/property-assessment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'MT', county, parcelId })
  }), env, ctx);
  return { status: response.status, body: await response.json() };
}
const noOwner = body => {
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /PLACEHOLDER|"Owner|CareOf|MAILADDRESS|OWNER_NAME/i, 'no owner or mailing data in the answer');
};

test('Yellowstone vacant grazing/hay parcel: mapped values, type, land use, levy, legal and record link', async () => {
  stubMontana();
  const { status, body } = await assess('Yellowstone', '03092732390050000');
  assert.equal(status, 200);
  assert.equal(body.available, true);
  // The existing fields stay (additive change).
  assert.equal(body.statewideRecords[0].TotalValue, 12666);
  assert.equal(body.countyRecords[0].TAX_ID, 'C12589A');
  assert.equal(body.cadastralSource, 'Montana Cadastral (Department of Revenue ORION)');
  assert.deepEqual(body.cadastralRecords, [{
    parcelNumber: '03092732390050000', geocode: '03-0927-32-3-90-05-0000', taxYear: 2026,
    totalValue: 12666, landValue: 12666, improvementValue: 0, assessorAcres: 53.09,
    propertyClass: null, propertyClassDescription: 'Vacant Land', propertyTypeNote: 'The assessor lists no taxable buildings.',
    landUse: [{ key: 'WildHayAcres', label: 'Wild hay', acres: 38.645 }, { key: 'GrazingAcres', label: 'Grazing', acres: 14.445 }],
    agricultural: true, agriculturalNote: MONTANA_AG_NOTE,
    levyDistrict: '03-0968-3', legalDescription: 'HARVEY SUBD, S32, T01 S, R26 E, BLOCK 1, Lot 5A, AMD (25)', subdivision: 'HARVEY SUBD', certificateOfSurvey: null,
    propertySearchUrl: 'https://svc.mt.gov/msl/cadastral/?page=PropertyDetails&geocode=03092732390050000'
  }]);
  noOwner(body);
});

test('Yellowstone improved irrigated parcel: building value and farmsite/irrigated/grazing acres', async () => {
  stubMontana();
  const { body } = await assess('Yellowstone', '03113503101110000');
  const r = body.cadastralRecords[0];
  assert.equal(r.totalValue, 98204); assert.equal(r.landValue, 42484); assert.equal(r.improvementValue, 55720);
  assert.equal(r.propertyClassDescription, 'Improved Property');
  assert.equal(r.propertyTypeNote, 'The assessor lists buildings or other improvements.');
  assert.deepEqual(r.landUse.map(u => [u.label, u.acres]), [['Irrigated', 32.726], ['Grazing', 3.854], ['Farmsite (homesite)', 1]]);
  assert.equal(r.agricultural, true);
  assert.equal(r.levyDistrict, '03-0982-24');
  noOwner(body);
});

test('Gallatin vacant COS parcel: no land-use classes, so no agricultural note', async () => {
  stubMontana();
  const { body } = await assess('Gallatin', '06069905302080000');
  const r = body.cadastralRecords[0];
  assert.equal(body.countyRecords, undefined);
  assert.equal(r.totalValue, 1228455); assert.equal(r.improvementValue, 0); assert.equal(r.assessorAcres, 10.001);
  assert.deepEqual(r.landUse, []);
  assert.equal(r.agricultural, false); assert.equal(r.agriculturalNote, null);
  assert.equal(r.certificateOfSurvey, '1103K');
  assert.equal(r.legalDescription, 'S05, T03 S, R06 E, C.O.S. 1103K, PARCEL 8A-2, ACRES 10.001');
  noOwner(body);
});

test('state cadastral down: Yellowstone still answers with the county record and empty cadastralRecords', async () => {
  stubMontana({ dnrcDown: true });
  const { status, body } = await assess('Yellowstone', '03092732390050000');
  assert.equal(status, 200);
  assert.equal(body.available, true);
  assert.deepEqual(body.statewideRecords, []);
  assert.deepEqual(body.cadastralRecords, []);
  // The county layer's short legal description is still shown.
  assert.equal(body.countyLegalDescription, 'HARVEY SUBD, S32, T01 S, R26 E, BLOCK 1, Lot 5A, AMD (25)');
  noOwner(body);
});

test('state cadastral down: Gallatin (no county layer) answers available:false with no legal fallback', async () => {
  stubMontana({ dnrcDown: true });
  const { status, body } = await assess('Gallatin', '06069905302080000');
  assert.equal(status, 200);
  assert.equal(body.available, false);
  assert.equal(body.countyLegalDescription, undefined);
});

test('state record found: no county legal fallback is added', async () => {
  stubMontana();
  const { body } = await assess('Yellowstone', '03092732390050000');
  assert.equal(body.countyLegalDescription, undefined);
});

test('state lookup: one combined query, the 17-digit geocode first', async () => {
  stubMontana();
  const { body } = await assess('Yellowstone', '03092732390050000');
  assert.equal(body.cadastralRecords.length, 1);
  assert.equal(dnrcWheres.length, 1, 'one DNRC request (was up to 9 in a row)');
  assert.equal(dnrcWheres[0], "PARCELID IN ('03092732390050000','03-0927-32-3-90-05-0000') OR Geocode IN ('03092732390050000','03-0927-32-3-90-05-0000') OR AssessmentCode IN ('03092732390050000','03-0927-32-3-90-05-0000')");
  // A dashed geocode still puts the 17-digit form first; quotes are escaped.
  assert.match(montanaStateWhere('03-0927-32-3-90-05-0000').where, /^PARCELID IN \('03092732390050000','03-0927-32-3-90-05-0000'\)/);
  assert.match(montanaStateWhere("x'y").where, /'x''y'/);
});

test('state lookup: an AssessmentCode match on another parcel gives way to the exact geocode match', async () => {
  const other = { ...fx.records['06069905302080000'], AssessmentCode: '03092732390050000' };
  globalThis.fetch = async () => arcgis([other, fx.records['03092732390050000']]);
  const { records } = await findMontanaStateRecord('03092732390050000');
  assert.deepEqual(records.map(r => r.attributes.PARCELID), ['03092732390050000']);
});

test('state lookup: a hanging server is cut off by the overall budget (first try + retry together)', async () => {
  let calls = 0;
  globalThis.fetch = (input, init = {}) => { calls++; return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason))); };
  const started = Date.now();
  const result = await findMontanaStateRecord('03092732390050000', { budgetMs: 400 });
  const took = Date.now() - started;
  assert.deepEqual(result.records, []);
  assert.equal(result.formatted, '03-0927-32-3-90-05-0000');
  assert.ok(took < 1500, `stopped at the budget (${took} ms)`);
  assert.ok(calls <= 2, `at most one retry (${calls} requests)`);
});

test('property type: "CODE - Label" split, certain bare codes labelled, anything else shown as written', () => {
  assert.deepEqual(montanaPropertyType('VAC_R - Vacant Land - Rural'), { code: 'VAC_R', label: 'Vacant Land - Rural', note: 'The assessor lists no taxable buildings.' });
  assert.deepEqual(montanaPropertyType('IMP_U'), { code: 'IMP_U', label: 'Improved Property - Urban', note: 'The assessor lists buildings or other improvements.' });
  assert.deepEqual(montanaPropertyType('imp_r'), { code: 'IMP_R', label: 'Improved Property - Rural', note: 'The assessor lists buildings or other improvements.' });
  assert.equal(montanaPropertyType('CA - Centrally Assessed').code, 'CA');
  assert.match(montanaPropertyType('CA - Centrally Assessed').note, /statewide system/);
  assert.deepEqual(montanaPropertyType('Exempt Property'), { code: '', label: 'Exempt Property', note: 'Exempt from property tax (e.g. public or nonprofit owner).' });
  // Unknown codes and types are never guessed.
  assert.deepEqual(montanaPropertyType('FARM_R'), { code: '', label: 'FARM_R', note: '' });
  assert.deepEqual(montanaPropertyType('Mining Claim'), { code: '', label: 'Mining Claim', note: '' });
  assert.deepEqual(montanaPropertyType(null), { code: '', label: '', note: '' });
  assert.deepEqual(montanaPropertyType('  '), { code: '', label: '', note: '' });
});

test('land use: only classes with acres; forest alone counts as valued by use, farmsite or non-qualified alone does not', () => {
  assert.deepEqual(montanaLandUse({ ForestAcres: 20, GrazingAcres: 0, WildHayAcres: null }), { rows: [{ key: 'ForestAcres', label: 'Forest', acres: 20 }], agricultural: true });
  assert.equal(montanaLandUse({ FarmsiteAcres: 1 }).agricultural, false);
  assert.equal(montanaLandUse({ NonQualAcres: 25 }).agricultural, false);
  assert.deepEqual(montanaLandUse({}), { rows: [], agricultural: false });
});

test('missing fields degrade to null, never 0, and a bad record link is dropped', () => {
  const r = mapMontanaAssessment({ PARCELID: '03092732390050000', TotalValue: 5000, TotalBuildingValue: null, TotalLandValue: '', PropertyCardLink: 'https://evil.example/msl/cadastral/?page=PropertyDetails&geocode=03092732390050000', OwnerName: 'PLACEHOLDER_OWNER_NAME' });
  assert.equal(r.totalValue, 5000);
  assert.equal(r.landValue, null); assert.equal(r.improvementValue, null); assert.equal(r.taxYear, null); assert.equal(r.assessorAcres, null);
  assert.equal(r.propertyClassDescription, null); assert.equal(r.levyDistrict, null); assert.equal(r.legalDescription, null);
  assert.deepEqual(r.landUse, []);
  assert.equal(r.propertySearchUrl, null);
  assert.doesNotMatch(JSON.stringify(r), /PLACEHOLDER|Owner/);
  assert.deepEqual(mapMontanaAssessment(null).landUse, []);
  assert.equal(montanaPropertyCardUrl('https://svc.mt.gov/msl/cadastral/?page=PropertyDetails&geocode=06069905302080000', '03092732390050000'), null, 'another parcel\'s geocode');
  assert.equal(montanaPropertyCardUrl('https://svc.mt.gov/msl/cadastral/?page=PropertyDetails&geocode=03092732390050000&redirect=x', '03092732390050000'), null);
});
