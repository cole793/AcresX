// Gallatin County zoning rules (src/zoning/gallatin-rules.js, routed by
// src/services/zoning-rules.js), the browser block that shows them (public/zoning-potential.js),
// the printed report (public/property-report-v2.js) and the validator request
// (scripts/validate-county.mjs). Offline: fetch is stubbed. The layer values in
// test/fixtures/gallatin-zoning-districts.json were read live on 2026-11-17; the zoning answers
// come from the recorded test/fixtures/gallatin-zoning-<PARCELID>.json runs (2026-11-02).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleZoningRules } from '../src/services/zoning-rules.js';
import { getGallatinZoneRules, findGallatinZone, gallatinDistrictKey, gallatinMappedZones } from '../src/zoning/gallatin-rules.js';
import { getGallatinCountyIntelligence, districtLabel } from '../src/counties/gallatin.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { validateParcel } from '../scripts/validate-county.mjs';
import { makeClock, makeContext, makeLazyContext, readPublic } from './ui-harness.js';

const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const rules = body => handleZoningRules(new Request('https://acresx.test/api/zoning-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(r => r.json());
const STATUSES = new Set(['permitted', 'limited', 'conditional', 'not_permitted']);
const byLabel = (answer, re) => answer.uses.find(u => re.test(u.label));

const realFetch = globalThis.fetch;
const realWarn = console.warn;
let restoreUpstream;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; console.warn = () => {}; restoreUpstream = configureUpstream({ backoffMs: 0 }); });
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream(); });

// ---- The table

test('every mapped district and zone answers with cited, plain-language rules', async () => {
  const mapped = gallatinMappedZones();
  assert.equal(Object.keys(mapped).length, 22, 'all 22 districts on the county layer');
  for (const [district, zones] of Object.entries(mapped)) {
    for (const code of zones) {
      const r = await rules({ county: 'Gallatin', zoneCode: code, jurisdiction: 'Gallatin County', district: districtLabel(district) });
      const at = `${district} ${code}`;
      assert.equal(r.available, true, at);
      assert.equal(r.county, 'Gallatin', at);
      assert.equal(r.code, code, at);
      assert.ok(r.name && r.family && r.density, at);
      assert.match(r.density, /§/, `${at}: density cites a section`);
      if (r.setback) assert.match(r.setback, /§/, `${at}: setback cites a section`);
      assert.match(r.sourceUrl, /^https:\/\/www\.gallatinmt\.gov\/DocumentCenter\/View\/\d+$/, at);
      assert.match(r.source, /Zoning (District )?Regulations? \((adopted|dated) [A-Z][a-z]+ (\d{1,2}, )?\d{4}/, `${at}: document title and dates`);
      assert.match(r.sourceChapter, /§/, at);
      assert.ok(r.uses.length >= 5, at);
      for (const u of r.uses) {
        assert.ok(STATUSES.has(u.status), `${at} ${u.label}: ${u.status}`);
        assert.ok(u.note, `${at} ${u.label}: has a note`);
      }
      assert.ok(byLabel(r, /^Single-family home$/), `${at}: single-family row`);
      assert.ok(byLabel(r, /^Agriculture$/), `${at}: agriculture row`);
      assert.match(r.disclaimer, /Gallatin County Planning/);
      assert.doesNotMatch(JSON.stringify(r), /undefined|NaN/, at);
    }
  }
});

test('every district/zone value on the county layer either maps to its own district\'s rules or says "rules not mapped"', async () => {
  const { values } = load('gallatin-zoning-districts');
  const mapped = [], unmapped = [];
  for (const v of values) {
    if (['ROAD', 'WATER', 'UNZ'].includes(v.INNERZONE)) continue;
    const r = await rules({ county: 'Gallatin', zoneCode: v.INNERZONE, jurisdiction: 'Gallatin County', district: districtLabel(v.DISTRICT_N) });
    const at = `${v.DISTRICT_N} ${v.INNERZONE}`;
    if (r.available) {
      mapped.push(at);
      assert.equal(gallatinDistrictKey(districtLabel(v.DISTRICT_N)), v.DISTRICT_N, at);
      assert.equal(findGallatinZone(v.INNERZONE, v.DISTRICT_N).districtKey, v.DISTRICT_N, `${at}: never another district's rules`);
    } else {
      unmapped.push(at);
      assert.equal(r.status, 'zone_not_mapped', at);
      assert.match(r.codeUrl, /DocumentCenter\/View\/\d+/, `${at}: links its district regulation`);
      assert.match(r.note, /aren't mapped in AcresX yet/, at);
    }
  }
  // The validation parcels' zones and the largest residential/rural zones are mapped.
  for (const z of ['HYALITE RR-10', 'HYALITE RR-5', 'HYALITE R-X', 'BIG SKY RC-SF-10', 'BIG SKY RC-SF-2.5', 'BIG SKY R-SF-11000',
    'GALLATIN COUNTY / BOZEMAN AREA AS', 'GALLATIN COUNTY / BOZEMAN AREA RS', 'BRIDGER CANYON AEPD20', 'BRIDGER CANYON RF-PD-20',
    'FOUR CORNERS RR/A', 'SOUTH GALLATIN RF', 'BOZEMAN PASS AR-80', 'REESE CREEK RW-160', 'NORTH GALLATIN NGC']) assert.ok(mapped.includes(z), z);
  // Commercial, industrial and institutional zones are left out on purpose.
  for (const z of ['BIG SKY CC', 'FOUR CORNERS MU', 'GALLATIN COUNTY / BOZEMAN AREA M-I', 'HEBGEN LAKE PL', 'GALLATIN COUNTY / BOZEMAN AREA RMH']) assert.ok(unmapped.includes(z), z);
  assert.ok(mapped.length >= 60, `${mapped.length} mapped`);
});

test('the same code means different things in different districts', async () => {
  const bigSkyPl = await rules({ county: 'Gallatin', zoneCode: 'PL', district: 'Big Sky zoning district' });
  assert.equal(bigSkyPl.available, true);
  assert.equal(bigSkyPl.district, 'Gallatin Canyon/Big Sky');
  assert.equal(byLabel(bigSkyPl, /^Single-family home$/).status, 'not_permitted');
  assert.equal((await rules({ county: 'Gallatin', zoneCode: 'PL', district: 'Hebgen Lake zoning district' })).available, false, 'Hebgen Lake PL is not mapped');
  // A code alone is used only when exactly one district has it.
  assert.equal((await rules({ county: 'Gallatin', zoneCode: 'PL' })).available, false, 'PL alone is ambiguous');
  assert.equal((await rules({ county: 'Gallatin', zoneCode: 'AR' })).available, false, 'AR alone is ambiguous');
  const cluster = await rules({ county: 'Gallatin', zoneCode: 'RC-SF-2.5' });
  assert.equal(cluster.available, true, 'RC-SF-2.5 exists only in Big Sky');
  assert.equal(cluster.district, 'Gallatin Canyon/Big Sky');
  // Hebgen Lake R-5 (one home per 5 acres, not a lot minimum) vs Bear Canyon R-5 (5-acre lots).
  const hebgen = await rules({ county: 'Gallatin', zoneCode: 'R-5', district: 'Hebgen Lake zoning district' });
  const bear = await rules({ county: 'Gallatin', zoneCode: 'R-5', district: 'Bear Canyon zoning district' });
  assert.match(hebgen.density, /not a minimum lot size/);
  assert.match(bear.density, /minimum lot 5 acres and 150 ft wide/);
  assert.match(bear.source, /^Bear Canyon Zoning Regulation/);
});

test('district names arrive in several spellings', () => {
  for (const [input, key] of [
    ['Hyalite zoning district', 'HYALITE'], ['HYALITE', 'HYALITE'], ['Gallatin County / Bozeman Area zoning district', 'GALLATIN COUNTY / BOZEMAN AREA'],
    ['Gallatin County/Bozeman Area', 'GALLATIN COUNTY / BOZEMAN AREA'], ['Gallatin Canyon/Big Sky', 'BIG SKY'], ['Zoning District 1', 'ZONING DISTRICT 1'],
    ['Zoning District #6', 'ZONING DISTRICT 6'], ['Sypes Canyon 1 zoning district', 'SYPES CANYON 1'], ['Wheatland', 'WHEATLAND HILLS'], ['North Gallatin Canyon', 'NORTH GALLATIN']
  ]) assert.equal(gallatinDistrictKey(input), key, input);
  // Layer spellings for zone codes.
  assert.equal(getGallatinZoneRules('R-X', 'HYALITE').code, 'RX');
  assert.equal(getGallatinZoneRules('AS', 'GALLATIN COUNTY / BOZEMAN AREA').code, 'A-S');
  assert.equal(getGallatinZoneRules('rs', 'GALLATIN COUNTY / BOZEMAN AREA').code, 'R-S');
  assert.equal(getGallatinZoneRules('R-5s', 'BEAR CANYON').code, 'R-5S');
  assert.equal(getGallatinZoneRules('AR40', 'BOZEMAN PASS').code, 'AR-40');
});

test('rules read from the regulations: lot sizes, accessory dwellings and setbacks', () => {
  const rr10 = getGallatinZoneRules('RR-10', 'Hyalite zoning district');
  assert.match(rr10.density, /Minimum lot 10 acres and 330 ft wide \(§6\.4\)/);
  assert.equal(rr10.setback, 'Front 25 ft, rear 25 ft, side 15 ft; ag water conveyances 100 ft; watercourses 150 ft (§6.5)');
  assert.equal(byLabel(rr10, /Accessory dwelling/).status, 'conditional');
  assert.equal(byLabel(rr10, /Manufactured/).status, 'limited');
  assert.equal(rr10.sourceUrl, 'https://www.gallatinmt.gov/DocumentCenter/View/1188');
  assert.match(rr10.source, /Hyalite Zoning Regulation \(adopted March 21, 1988; amended January 26, 2021\)/);

  const rc10 = getGallatinZoneRules('RC-SF-10', 'Big Sky zoning district');
  assert.match(rc10.density, /One dwelling unit per 10 acres \(gross density\); no minimum lot size/);
  assert.equal(byLabel(rc10, /Accessory dwelling/).status, 'permitted');
  assert.equal(byLabel(rc10, /Short-term rental/).status, 'limited');
  assert.equal(byLabel(rc10, /Bed and breakfast/).status, 'conditional');
  assert.equal(rc10.buildingHeight, 'Flat roof 30 ft; pitched roof 33 ft (§10.7)');
  // R-SF-7,500 does not list bed and breakfasts; R-SF-11,000 does (conditional).
  assert.equal(byLabel(getGallatinZoneRules('R-SF-7500', 'BIG SKY'), /Bed and breakfast/).status, 'not_permitted');
  assert.match(byLabel(getGallatinZoneRules('R-SF-11000', 'BIG SKY'), /Bed and breakfast/).note, /§9\.4/);

  // Bridger Canyon: accessory dwellings are listed in AE but not RF.
  assert.equal(byLabel(getGallatinZoneRules('AEPD20', 'BRIDGER CANYON'), /Accessory dwelling/).status, 'permitted');
  assert.equal(byLabel(getGallatinZoneRules('RF-PD-20', 'BRIDGER CANYON'), /Accessory dwelling/).status, 'not_permitted');

  const as = getGallatinZoneRules('AS', 'Gallatin County / Bozeman Area zoning district');
  assert.match(as.density, /One dwelling per 20 acres with a minimum lot of 1 acre/);
  assert.match(byLabel(as, /Manufactured/).note, /HUD-certified/);
  assert.equal(getGallatinZoneRules('RS-10', 'Zoning District 6').buildingHeight, '24 feet (§6.7)');
  assert.equal(byLabel(getGallatinZoneRules('NGC', 'NORTH GALLATIN'), /^Single-family home$/).status, 'permitted');
});

test('unzoned land says plainly that no county zoning applies', async () => {
  for (const code of ['UNZONED', 'UNZ']) {
    const r = await rules({ county: 'Gallatin', zoneCode: code, jurisdiction: 'Gallatin County' });
    assert.equal(r.available, true, code);
    assert.equal(r.code, 'UNZONED');
    assert.equal(r.family, 'Unzoned');
    assert.match(r.density, /^No county zoning/);
    assert.ok(!('setback' in r), 'no zoning setback');
    assert.match(r.disclaimer, /No county zoning district covers this parcel/);
    assert.match(r.disclaimer, /septic and well permits/);
    assert.equal(byLabel(r, /^Single-family home$/).status, 'permitted');
    assert.equal(byLabel(r, /Accessory dwelling/).status, 'limited');
  }
});

test('an unknown code or district says "rules not mapped"; a city zone never gets county rules', async () => {
  const unknown = await rules({ county: 'Gallatin', zoneCode: 'ZZ-9', jurisdiction: 'Gallatin County', district: 'Hyalite zoning district' });
  assert.equal(unknown.available, false);
  assert.equal(unknown.status, 'zone_not_mapped');
  assert.equal(unknown.codeUrl, 'https://www.gallatinmt.gov/DocumentCenter/View/1188');
  const noDistrict = await rules({ county: 'Gallatin', zoneCode: 'RR-10', district: 'Nowhere zoning district' });
  assert.equal(noDistrict.available, false);
  assert.equal(noDistrict.codeUrl, 'https://www.gallatinmt.gov/597/Zoning-Regulations');
  // Bozeman's R-1 and R-3 share letters with county zones.
  for (const jurisdiction of ['City of Bozeman', 'City of Belgrade', 'Town of West Yellowstone']) {
    const city = await rules({ county: 'Gallatin', zoneCode: 'R-1', jurisdiction, district: 'Bear Canyon zoning district' });
    assert.equal(city.available, false, jurisdiction);
    assert.equal(city.status, 'zone_not_mapped');
    assert.doesNotMatch(JSON.stringify(city), /DocumentCenter/);
  }
});

// ---- From the zoning adapter's answer to the rules (recorded live runs)

function replay(name) {
  const data = load(name);
  const seen = new Map();
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    const base = url.origin + url.pathname;
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const recorded = data.responses.filter(r => r.url === base);
    if (!recorded.length) throw new Error(`no recorded answer for ${base}`);
    const r = recorded[Math.min(n, recorded.length) - 1];
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  return data;
}

test('Gallatin 06033804413010000 (recorded): the zoning answer\'s code and district pick Big Sky RC-SF-10', async () => {
  const zp = await getGallatinCountyIntelligence(replay('gallatin-zoning-06033804413010000').request);
  const r = await rules({ county: zp.county, zoneCode: zp.zoning.code, zoneName: zp.zoning.name, jurisdiction: zp.jurisdiction, district: zp.zoning.district });
  assert.equal(r.available, true);
  assert.equal(r.code, 'RC-SF-10');
  assert.equal(r.district, 'Gallatin Canyon/Big Sky');
});

test('Gallatin 06069624301010000 (recorded): unzoned land gets the plain "no county zoning" answer', async () => {
  const zp = await getGallatinCountyIntelligence(replay('gallatin-zoning-06069624301010000').request);
  const r = await rules({ county: zp.county, zoneCode: zp.zoning.code, jurisdiction: zp.jurisdiction, district: zp.zoning.district || '' });
  assert.equal(r.code, 'UNZONED');
  assert.equal(r.family, 'Unzoned');
});

test('Gallatin 06079801358210000 (recorded): a Bozeman city lot (R-3) never gets county rules', async () => {
  const zp = await getGallatinCountyIntelligence(replay('gallatin-zoning-06079801358210000').request);
  assert.equal(zp.jurisdiction, 'City of Bozeman');
  const r = await rules({ county: zp.county, zoneCode: zp.zoning.code, jurisdiction: zp.jurisdiction });
  assert.equal(r.available, false);
  assert.equal(r.status, 'zone_not_mapped');
});

// ---- Browser: the zoning tab (public/zoning-potential.js)

function runPotential(zoningPermits, answer) {
  const requests = [];
  const page = makeContext({ body: [['div', { id: 'results' }]], clock: makeClock(), fetch: async (url, init) => { requests.push(JSON.parse(init.body)); return json(answer); } });
  page.ctx.__last = { zoningPermits, parcel: { properties: { _countyDisplay: 'Gallatin' } } };
  page.run('var last = __last; var activeTab = "zoning"; function esc(v) { return String(v ?? ""); } function renderSummary() {} function renderResults() { document.getElementById("results").innerHTML = ""; }', 'index-inline.js');
  page.run(readPublic('zoning-potential.js'), 'zoning-potential.js');
  page.run('renderResults()');
  return new Promise(resolve => setTimeout(() => resolve({ requests, html: page.document.getElementById('results').children.map(c => c.innerHTML).join('') }), 20));
}

test('browser: a Hyalite RR-10 parcel shows its rules, district and regulation; the request carries the district', async () => {
  const zp = { county: 'Gallatin', jurisdiction: 'Gallatin County', zoning: { status: 'gis_match', code: 'RR-10', name: 'RURAL RESIDENTIAL (ONE SINGLE FAMILY DWELLING PER 10 ACRES)', district: 'Hyalite zoning district' } };
  const { requests, html } = await runPotential(zp, getGallatinZoneRules('RR-10', 'Hyalite zoning district'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].district, 'Hyalite zoning district');
  assert.equal(requests[0].zoneCode, 'RR-10');
  assert.match(html, /Rural Residential \(one home per 10 acres\) \(RR-10\)/);
  assert.match(html, /Minimum lot 10 acres and 330 ft wide/);
  assert.match(html, /General structural setback: Front 25 ft, rear 25 ft, side 15 ft/);
  assert.match(html, /Building height: 32 feet for homes/);
  assert.match(html, /Hyalite zoning district/);
  assert.match(html, /Accessory dwelling \/ guest house<\/strong><span>Special \/ Conditional Review/);
  assert.match(html, /href="https:\/\/www\.gallatinmt\.gov\/DocumentCenter\/View\/1188"/);
  assert.match(html, /Hyalite Zoning Regulation \(adopted March 21, 1988; amended January 26, 2021\) ↗/);
});

test('browser: an unzoned parcel says no county zoning; a Bozeman city lot asks for nothing; an unmapped zone links its regulation', async () => {
  const unz = await runPotential({ county: 'Gallatin', jurisdiction: 'Gallatin County', zoning: { status: 'unzoned', code: 'UNZONED', name: 'Unzoned area' } }, getGallatinZoneRules('UNZONED'));
  assert.equal(unz.requests.length, 1);
  assert.match(unz.html, /No county zoning \(unzoned area\) \(UNZONED\)/);
  assert.match(unz.html, /Gallatin County: no zoning district/);

  const city = await runPotential({ county: 'Gallatin', jurisdiction: 'City of Bozeman', zoning: { status: 'gis_match', code: 'R-3' } }, { available: true });
  assert.equal(city.requests.length, 0, 'no county rules request inside Bozeman');

  const cc = await runPotential({ county: 'Gallatin', jurisdiction: 'Gallatin County', zoning: { status: 'gis_match', code: 'CC', district: 'Big Sky zoning district' } }, getGallatinZoneRules('CC', 'Big Sky zoning district'));
  assert.equal(cc.requests.length, 1);
  assert.match(cc.html, /CC: rules not mapped/);
  assert.match(cc.html, /href="https:\/\/www\.gallatinmt\.gov\/DocumentCenter\/View\/1172"/);
  assert.match(cc.html, /Gallatin Canyon\/Big Sky Zoning Regulation/);
});

// ---- Printed report (public/property-report-v2.js)

const REPORT_MODULES = ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'property-report-v2.js'];
const square = { type: 'Polygon', coordinates: [[[-111.02, 45.59], [-111.01, 45.59], [-111.01, 45.60], [-111.02, 45.60], [-111.02, 45.59]]] };
function report(zoningPermits, zoningDevelopmentPotential) {
  const data = {
    parcel: { type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '06069905302080000', _countyDisplay: 'Gallatin', _stateCode: 'MT' } },
    wells: [{ properties: { CompletedDepth: 180 } }], utility: ['NORTHWESTERN ENERGY'],
    land: { soil: { available: true, feasibility: 'moderate', mapUnit: 'Loam' }, terrain: { available: true, gradePct: 6, reliefFt: 20 } },
    flood: { available: true, intersects: false, zones: [] }, wetlands: { available: true, intersects: false, category: 'none' },
    zoningPermits, zoningDevelopmentPotential
  };
  const h = makeLazyContext({ mappedSqm: 9.88 * 4046.8564224, last: data });
  for (const f of REPORT_MODULES) h.run(readPublic(f));
  h.context.__acresxLast = data;
  h.generate();
  return h.opened.at(-1);
}

test('report: a Gallatin RR-10 parcel prints the plain-language rules, the use table and the regulation as a source', () => {
  const zp = { county: 'Gallatin', jurisdiction: 'Gallatin County', zoning: { status: 'gis_match', code: 'RR-10', name: 'RURAL RESIDENTIAL (ONE SINGLE FAMILY DWELLING PER 10 ACRES)', district: 'Hyalite zoning district' }, permitJurisdiction: { name: 'Gallatin County' } };
  const html = report(zp, getGallatinZoneRules('RR-10', 'Hyalite zoning district'));
  assert.match(html, /<div class="zone-code">RR-10<\/div><div><strong>Rural Residential \(one home per 10 acres\)<\/strong>/);
  assert.match(html, /A single-family home is permitted outright, within the density limit \(Minimum lot 10 acres and 330 ft wide \(§6\.4\)\.\)/);
  assert.match(html, /Accessory dwelling \/ guest house<\/td><td class="st">/);
  assert.match(html, /Zoning allows a home \(RR-10\)/);
  assert.match(html, /Hyalite Zoning Regulation \(adopted March 21, 1988; amended January 26, 2021\), chapter §§6, 9/);
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, ''), /undefined|NaN/);
});

test('report: an unzoned Gallatin parcel says no county zoning applies', () => {
  const zp = { county: 'Gallatin', jurisdiction: 'Gallatin County', zoning: { status: 'unzoned', code: 'UNZONED', name: 'Unzoned area', label: 'Unzoned' }, permitJurisdiction: { name: 'Gallatin County' } };
  const html = report(zp, getGallatinZoneRules('UNZONED'));
  assert.match(html, /No county zoning \(unzoned area\)/);
  assert.match(html, /No county zoning: no zoning density, minimum lot size or setbacks apply here/);
});

// ---- Validator (scripts/validate-county.mjs) asks for Gallatin rules with the district

test('validator: a Gallatin parcel\'s zoning rules are requested with its district and compared by code', async () => {
  const calls = [];
  const zoning = { available: true, county: 'Gallatin', jurisdiction: 'Gallatin County', zoning: { status: 'gis_match', code: 'RR-10', name: 'RURAL RESIDENTIAL', district: 'Hyalite zoning district' }, urbanGrowthArea: { intersects: false } };
  globalThis.fetch = async (url, init = {}) => {
    const route = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ route, body });
    if (route === '/api/parcel-search') return json({ available: true, state: 'MT', county: 'Gallatin', parcel: { type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '06069905302080000', PARCELID: '06069905302080000', _countyDisplay: 'Gallatin' } } });
    if (route === '/api/zoning-permits') return json(zoning);
    if (route === '/api/zoning-rules') return handleZoningRules(new Request('https://acresx.test/api/zoning-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    return json({ error: 'Not found' }, 404);
  };
  const result = await validateParcel({ parcelId: '06069905302080000' }, { state: 'MT', county: 'Gallatin', baseUrl: 'https://acresx.test', requestDelayMs: 0, parcelRetryDelayMs: 0 });
  const sent = calls.find(c => c.route === '/api/zoning-rules');
  assert.ok(sent, 'zoning rules requested for Gallatin');
  assert.equal(sent.body.district, 'Hyalite zoning district');
  assert.equal(result.layers.zoningRules.status, 'ok');
  assert.equal(result.layers.zoningRules.values.code, 'RR-10');
});
