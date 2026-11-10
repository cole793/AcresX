// Spokane County: city zone rules (src/zoning/spokane-city-rules.js, routed by
// src/services/zoning-rules.js and flagged by src/counties/spokane-cities.js) and the browser
// module that shows them (public/zoning-potential.js). A city zone gets its own city's table or
// "rules not mapped" with a link, never Spokane County rules.
// Offline: globalThis.fetch is stubbed. Jurisdiction and zoning answers for real parcels were
// recorded live (read-only) into test/fixtures/spokane-zoning-<parcel>.json.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureUpstream } from '../src/shared/upstream.js';
import { getSpokaneCountyIntelligence } from '../src/counties/spokane.js';
import { getSpokaneCityZoneRules, hasSpokaneCityRules } from '../src/zoning/spokane-city-rules.js';
import { getSpokaneZoneDevelopmentPotential } from '../src/zoning/spokane-rules.js';
import { handleZoningRules } from '../src/services/zoning-rules.js';
import { getZoningProfile } from '../src/zoning-counties.js';
import { makeClock, makeContext, readPublic } from './ui-harness.js';

const profile = getZoningProfile('Spokane');
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const realWarn = console.warn;
let calls, restoreUpstream, store;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const fixture = id => load(`spokane-zoning-${id}`);
const bodyOf = fx => ({ county: 'Spokane', ...fx.parcel });
const pathOf = url => `${url.hostname}${url.pathname}`;
const rules = body => handleZoningRules(new Request('https://acresx.test/api/zoning-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(r => r.json());

const COMP = { features: [{ attributes: { LANDUSECODE: 'CITY', LANDUSEDESC: 'City' } }] };
const PERMITS = { features: [{ attributes: { PERMITNUM: 'B-1', PERMITTYPE: 'Residential', STATUS: 'Final' } }] };
const OVERLAY_PATH = /CriticalAreasBPPublic\/MapServer\/\d+\/query|ZoningLookup\/MapServer\/[01]\/query/;

// Recorded answers by host+path, then overlays not recorded (none there), then canned extras.
// `override` ([path regex, Response factory]) simulates failures.
function stub(responses, override = []) {
  calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push({ url, init });
    const key = pathOf(url);
    for (const [re, make] of override) if (re.test(key)) return make();
    if (responses[key]) return json(responses[key]);
    if (OVERLAY_PATH.test(key)) return json({ features: [] });
    if (/ZoningLookup\/MapServer\/4\/query/.test(key)) return json(COMP);
    if (/ZoningLookup\/MapServer\/2\/query/.test(key)) return json({ features: [] });
    if (/\/BPPublic\/BPPublic\/MapServer\/5\/query/.test(key)) return json(PERMITS);
    throw new Error(`unexpected request ${key}`);
  };
}

function fakeCache() {
  const map = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = map.get(req.url); return hit ? new Response(hit) : undefined; },
    async put(req, res) { map.set(req.url, await res.text()); }
  } };
  return map;
}

beforeEach(() => { store = fakeCache(); console.warn = () => {}; restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} }); });
afterEach(() => {
  globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream();
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

// Synthetic parcel: a Liberty Lake (or other city) parcel with one zone over the whole outline.
const square = (x0, y0, x1, y1) => ({ rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const parcel = { type: 'Polygon', coordinates: [[[-117.10, 47.66], [-117.09, 47.66], [-117.09, 47.67], [-117.10, 47.67], [-117.10, 47.66]]] };
const body = { county: 'Spokane', parcelId: 'TEST', lat: 47.665, lon: -117.095, geometry: parcel };
const J = 'gismo.spokanecounty.org/arcgis/rest/services/SCOUT/PermittingLookup/MapServer/0/query';
const Z = 'gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query';
const LL = 'services.arcgis.com/sAiTgWHcD4FbRdCu/arcgis/rest/services/Liberty_Lake_Zoning/FeatureServer/0/query';
const whole = square(-117.11, 47.65, -117.08, 47.68);
const libertyLake = zone => ({
  [J]: { features: [{ attributes: { NAME: 'Liberty Lake', MUNITYP: 'City' }, geometry: whole }] },
  [Z]: { features: [] },
  [LL]: { features: [{ attributes: { Class_Abv: zone, Class_Desc: zone === 'R1' ? 'Single Family Residential' : 'SAP' }, geometry: whole }] }
});

// What public/zoning-potential.js would send, from a /api/zoning-permits answer.
const rulesRequest = zp => ({ county: zp.county, zoneCode: zp.zoning.code, zoneName: zp.zoning.name || '', jurisdiction: zp.jurisdiction, jurisdictionType: zp.zoning.jurisdictionType || '' });

// ---- City rules

test('City of Spokane parcel 25121.2604 (R1): "rules not mapped" with the SMC Title 17C link, never county rules', async () => {
  const fx = fixture('25121.2604');
  stub(fx.responses);
  const zp = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  assert.equal(zp.zoning.code, 'R1');
  assert.equal(zp.zoning.rules, 'not_mapped');
  assert.match(zp.zoning.rulesNote, /Rules for R1 aren't mapped in AcresX yet; see the Spokane Municipal Code Title 17C/);
  assert.equal(zp.zoning.rulesUrl, 'https://my.spokanecity.org/smc/?Title=17C');
  const answer = await rules(rulesRequest(zp));
  assert.equal(answer.available, false);
  assert.equal(answer.status, 'zone_not_mapped');
  assert.equal(answer.codeUrl, 'https://my.spokanecity.org/smc/?Title=17C');
  assert.ok(!('uses' in answer), 'no rules');
  // The same letters as a county zone never borrow the county table either.
  assert.equal((await rules({ ...rulesRequest(zp), zoneCode: 'RCV' })).available, false);
});

test('Spokane Valley parcel 45012.1111 (R-3): "rules not mapped" with the SVMC link', async () => {
  const fx = fixture('45012.1111');
  stub(fx.responses);
  const zp = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  assert.equal(zp.zoning.code, 'R-3');
  assert.equal(zp.zoning.rules, 'not_mapped');
  assert.equal(zp.zoning.rulesUrl, 'https://ecode360.com/SP4654');
  assert.equal(zp.zoning.codeUrl, 'https://ecode360.com/SP4654', 'the code moved from Code Publishing to eCode360');
  const answer = await rules(rulesRequest(zp));
  assert.equal(answer.available, false);
  assert.equal(answer.jurisdiction, 'City of Spokane Valley');
  assert.match(answer.note, /Spokane Valley Municipal Code Title 19/);
  // 'RC' is a county zone and a Valley zone: still not the county's rules.
  const rc = await rules({ ...rulesRequest(zp), zoneCode: 'RC' });
  assert.equal(rc.available, false);
  assert.doesNotMatch(JSON.stringify(rc), /Regional Commercial|DocumentCenter\/View\/47247/);
});

test('Liberty Lake R1 parcel: the city flags its table and /api/zoning-rules answers from the Development Code', async () => {
  stub(libertyLake('R1'));
  const zp = await getSpokaneCountyIntelligence(body, profile);
  assert.equal(zp.jurisdiction, 'City of Liberty Lake');
  assert.equal(zp.zoning.code, 'R1');
  assert.equal(zp.zoning.rules, 'mapped');
  assert.ok(!('rulesNote' in zp.zoning));
  const answer = await rules(rulesRequest(zp));
  assert.equal(answer.available, true);
  assert.equal(answer.jurisdiction, 'City of Liberty Lake');
  assert.equal(answer.jurisdictionType, 'city');
  assert.equal(answer.code, 'R-1');
  assert.equal(answer.name, 'Single Family Residential');
  assert.equal(answer.buildingHeight, '35 feet');
  assert.match(answer.density, /4 to 6 dwelling units per net acre/);
  assert.match(answer.setback, /^Front 10 ft; rear 15 ft/);
  assert.equal(answer.sourceChapter, '10-2B, matrix 10-2A-4');
  assert.equal(answer.sourceUrl, 'https://www.libertylakewa.gov/DocumentCenter/View/5341/COLL-Full-Development-Code');
  const use = label => answer.uses.find(u => u.label.startsWith(label))?.status;
  assert.equal(use('Single-family dwelling'), 'permitted');
  assert.equal(use('Accessory dwelling unit'), 'limited');
  assert.equal(use('Duplex'), 'not_permitted');
  assert.equal(use('Manufactured home on its own lot'), 'limited');
  assert.equal(use('Multi-family'), 'not_permitted');
  assert.doesNotMatch(JSON.stringify(answer), /Spokane County Zoning Code/);
});

test('Liberty Lake table: every district on the city layer with a table, matrix columns as published', () => {
  const r = code => getSpokaneCityZoneRules('City of Liberty Lake', code);
  const status = (code, label) => r(code).uses.find(u => u.label.startsWith(label)).status;
  for (const code of ['R1', 'R2', 'R3', 'M1', 'M2', 'M3', 'C1', 'C2', 'I', 'R-1', 'r-2']) assert.equal(r(code).available, true, code);
  assert.equal(status('R2', 'Duplex'), 'limited');
  assert.equal(status('R3', 'Multi-family'), 'limited');
  assert.equal(status('M1', 'Single-family dwelling'), 'not_permitted');
  assert.equal(status('C2', "Accessory caretaker's residence"), 'limited');
  assert.equal(r('R3').setback.startsWith('Front 15 ft'), true);
  assert.equal(r('M2').buildingHeight, '50 feet (60 feet where housing is above the ground floor)');
  assert.equal(r('C1').buildingHeight, '70 feet (40 feet next to an R-1 zone)');
  // The legacy route's short name works too.
  assert.equal(hasSpokaneCityRules('Liberty Lake', 'R1'), true);
});

test('a city zone without a table shows "rules not mapped" with the city code link (Liberty Lake SAP, Cheney R-1)', async () => {
  stub(libertyLake('SAP'));
  const zp = await getSpokaneCountyIntelligence(body, profile);
  assert.equal(zp.zoning.code, 'SAP');
  assert.equal(zp.zoning.rules, 'not_mapped');
  assert.equal(zp.zoning.rulesUrl, 'https://www.libertylakewa.gov/DocumentCenter/View/5341/COLL-Full-Development-Code');
  const sap = await rules(rulesRequest(zp));
  assert.equal(sap.available, false);
  assert.match(sap.note, /Rules for SAP aren't mapped in AcresX yet; see the Liberty Lake Development Code/);
  const cheney = await rules({ county: 'Spokane', zoneCode: 'R-1', jurisdiction: 'City of Cheney' });
  assert.equal(cheney.available, false);
  assert.equal(cheney.codeUrl, 'https://www.cityofcheney.org/192/Planning-Department');
  // A town with no link still never gets county rules.
  const town = await rules({ county: 'Spokane', zoneCode: 'LDR', jurisdiction: 'Town of Rockford' });
  assert.equal(town.available, false);
  assert.ok(!('codeUrl' in town));
});

test('a county zone is unchanged: same rules as before for unincorporated land and older clients', async () => {
  const fx = fixture('07123.9075');
  stub(fx.responses);
  const zp = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  assert.equal(zp.zoning.code, 'RCV');
  assert.ok(!('rules' in zp.zoning), 'county zoning block unchanged');
  const expected = { available: true, county: 'Spokane', ...getSpokaneZoneDevelopmentPotential('RCV', { uga: false, developmentAgreement: '' }) };
  assert.deepEqual(await rules({ county: 'Spokane', zoneCode: 'RCV', jurisdiction: 'Spokane County' }), expected);
  assert.deepEqual(await rules({ county: 'Spokane', zoneCode: 'RCV' }), expected);
  assert.equal(expected.source, 'Spokane County Zoning Code, 2025 Printing');
});

// ---- Browser: zoning-potential.js asks only for cities with a table, else shows "not mapped".

function runPotential(zoningPermits, answer) {
  const requests = [];
  const page = makeContext({ body: [['div', { id: 'results' }]], clock: makeClock(), fetch: async (url, init) => { requests.push(JSON.parse(init.body)); return json(answer); } });
  page.ctx.__last = { zoningPermits, parcel: { properties: { _countyDisplay: 'Spokane' } } };
  page.run('var last = __last; var activeTab = "zoning"; function esc(v) { return String(v ?? ""); } function renderSummary() {} function renderResults() { document.getElementById("results").innerHTML = ""; }', 'index-inline.js');
  page.run(readPublic('zoning-potential.js'), 'zoning-potential.js');
  page.run('renderResults()');
  return new Promise(resolve => setTimeout(() => resolve({ requests, html: page.document.getElementById('results').children.map(c => c.innerHTML).join('') }), 20));
}

test('browser: a Liberty Lake zone with a table is asked for; a City of Spokane zone shows "rules not mapped" and its link', async () => {
  const ll = await runPotential(
    { county: 'Spokane', jurisdiction: 'City of Liberty Lake', zoning: { status: 'gis_match', code: 'R1', jurisdictionType: 'city', rules: 'mapped' } },
    getSpokaneCityZoneRules('City of Liberty Lake', 'R1')
  );
  assert.equal(ll.requests.length, 1);
  assert.equal(ll.requests[0].jurisdiction, 'City of Liberty Lake');
  assert.match(ll.html, /Single Family Residential \(R-1\)/);
  assert.match(ll.html, /Liberty Lake Development Code \(Title 10\)/);
  assert.match(ll.html, /Setbacks: Front 10 ft/);

  const spokane = await runPotential(
    { county: 'Spokane', jurisdiction: 'City of Spokane', zoning: { status: 'gis_match', code: 'R1', jurisdictionType: 'city', rules: 'not_mapped', rulesNote: "Rules for R1 aren't mapped in AcresX yet; see the Spokane Municipal Code Title 17C and verify with the city.", rulesUrl: 'https://my.spokanecity.org/smc/?Title=17C', rulesUrlLabel: 'Open Spokane Municipal Code Title 17C ↗' } },
    { available: true }
  );
  assert.equal(spokane.requests.length, 0, 'no rules request for a city without a table');
  assert.match(spokane.html, /R1: rules not mapped/);
  assert.match(spokane.html, /href="https:\/\/my\.spokanecity\.org\/smc\/\?Title=17C"/);
  assert.match(spokane.html, /verify with the city/);
});
