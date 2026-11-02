// Spokane County zoning, jurisdiction first (src/counties/spokane.js, spokane-cities.js).
// Offline: globalThis.fetch is stubbed. The jurisdiction, county zoning and city zoning answers
// for four real parcels were recorded live (read-only) on 2026-11-02 into
// test/fixtures/spokane-zoning-<parcel>.json; comp plan, UGA and permits get small canned answers.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureUpstream } from '../src/shared/upstream.js';
import { getSpokaneCountyIntelligence } from '../src/counties/spokane.js';
import { decideJurisdiction, spokaneCityInfo, SPOKANE_JURISDICTIONS } from '../src/counties/spokane-cities.js';
import { getZoningProfile } from '../src/zoning-counties.js';

const profile = getZoningProfile('Spokane');
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const realWarn = console.warn;
let calls, restoreUpstream, store;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fixture = id => JSON.parse(readFileSync(new URL(`./fixtures/spokane-zoning-${id}.json`, import.meta.url), 'utf8'));
const bodyOf = fx => ({ county: 'Spokane', ...fx.parcel });
const pathOf = url => `${url.hostname}${url.pathname}`;

const COMP = { features: [{ attributes: { LANDUSECODE: 'CITY', LANDUSEDESC: 'City' } }] };
const PERMITS = { features: [{ attributes: { PERMITNUM: 'B-1', PERMITTYPE: 'Residential', STATUS: 'Final', ADDRESS: '1 TEST ST' } }] };

// Recorded answers by host+path; canned answers for the extras; `override` (path regex -> Response
// factory) simulates failures. Anything else is an unexpected request.
function stub(fx, override = []) {
  calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push({ url, init });
    const key = pathOf(url);
    for (const [re, make] of override) if (re.test(key)) return make();
    if (fx.responses[key]) return json(fx.responses[key]);
    if (/ZoningLookup\/MapServer\/4\/query/.test(key)) return json(COMP);
    if (/ZoningLookup\/MapServer\/2\/query/.test(key)) return json({ features: [] });
    if (/BPPublic\/MapServer\/5\/query/.test(key)) return json(PERMITS);
    throw new Error(`unexpected request ${key}`);
  };
}
const asked = re => calls.filter(c => re.test(pathOf(c.url)));
const down = () => new Response('down', { status: 500 });

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

// Everything but zoning keeps working whatever the zoning answer is.
function assertExtras(result) {
  assert.equal(result.available, true);
  assert.equal(result.comprehensivePlan.code, 'CITY');
  assert.equal(result.urbanGrowthArea.intersects, false);
  assert.equal(result.permitHistoryStatus, 'found');
  assert.equal(result.permitHistory[0].number, 'B-1');
  assert.ok(Array.isArray(result.permits) && result.permits.length);
}
// A parcel inside a city never shows county zoning or "no zoning found".
function assertNotCountyZoning(zoning) {
  assert.notEqual(zoning.status, 'no_match');
  assert.ok(!('zoneFileNumber' in zoning), 'no county zone file');
  assert.doesNotMatch(zoning.note, /SCOUT zoning|no intersecting designation/);
  assert.notEqual(zoning.sourceUrl, 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3');
}

test('City of Spokane parcel 25121.2604: city zoning R1 from the city layer, read across the parcel', async () => {
  const fx = fixture('25121.2604');
  stub(fx);
  const result = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  assert.equal(result.jurisdiction, 'City of Spokane');
  assert.equal(result.permitJurisdiction.name, 'City of Spokane');
  const z = result.zoning;
  assert.equal(z.status, 'gis_match');
  assert.equal(z.code, 'R1');
  assert.equal(z.name, 'Residential 1');
  assert.equal(z.baseZone, 'R1');
  assert.equal(z.jurisdictionType, 'city');
  assert.equal(z.sourceUrl, 'https://services.arcgis.com/3PDwyTturHqnGCu0/arcgis/rest/services/Zoning/FeatureServer/5');
  assert.equal(z.url, 'https://my.spokanecity.org/smc/?Title=17C');
  assert.equal(z.rules, 'not_mapped');
  assert.match(z.note, /City of Spokane official zoning map/);
  assert.match(z.note, /Verify .* with City of Spokane/);
  assertNotCountyZoning(z);
  assertExtras(result);
  assert.equal(result.zoningMatch.method, 'parcel area (sampled)');
  assert.equal(result.zoningMatch.jurisdictionShare, 1);
  // Jurisdiction and city zoning are polygon queries that return outlines for sampling.
  for (const re of [/PermittingLookup\/MapServer\/0\/query/, /Zoning\/FeatureServer\/5\/query/]) {
    const [call] = asked(re);
    assert.ok(call, String(re));
    const params = new URLSearchParams(call.init?.body || call.url.search);
    assert.equal(params.get('geometryType'), 'esriGeometryPolygon');
    assert.equal(params.get('returnGeometry'), 'true');
  }
});

test('Spokane Valley parcel 45012.1111: city zoning R-3 with the designation name', async () => {
  const fx = fixture('45012.1111');
  stub(fx);
  const result = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  assert.equal(result.jurisdiction, 'City of Spokane Valley');
  const z = result.zoning;
  assert.equal(z.status, 'gis_match');
  assert.equal(z.code, 'R-3');
  assert.equal(z.name, 'Single-Family Residential');
  assert.equal(z.sourceUrl, 'https://arcgis.spokanevalley.org/arcgis/rest/services/ViewerV3/LandUse/MapServer/1');
  assert.equal(z.sourceField, 'Zoning');
  assert.equal(z.url, 'https://www.spokanevalleywa.gov/269/Planning-and-Zoning');
  assertNotCountyZoning(z);
  assertExtras(result);
});

test('Medical Lake parcel 14183.3812 (no public city layer): "City of Medical Lake zoning applies", link, no guess', async () => {
  const fx = fixture('14183.3812');
  stub(fx);
  const result = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  assert.equal(result.jurisdiction, 'City of Medical Lake');
  const z = result.zoning;
  assert.equal(z.status, 'city_jurisdiction');
  assert.equal(z.code, null);
  assert.equal(z.label, 'City of Medical Lake zoning applies – see city');
  assert.match(z.note, /City of Medical Lake zoning applies, not Spokane County zoning/);
  assert.match(z.note, /verify with the city/);
  assert.equal(z.url, 'https://medical-lake.org/city-government/planning-zoning-department/');
  assert.equal(z.sourceUrl, SPOKANE_JURISDICTIONS);
  assertNotCountyZoning(z);
  assertExtras(result);
  assert.equal(calls.filter(c => !/gismo\.spokanecounty\.org/.test(c.url.hostname)).length, 0, 'no city layer asked');
});

test('unincorporated parcel 07123.9075: county zoning RCV, same result as before plus the parcel-area read', async () => {
  const fx = fixture('07123.9075');
  stub(fx);
  const result = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  assert.equal(result.jurisdiction, 'Spokane County');
  assert.equal(result.permitJurisdiction.name, 'Spokane County');
  const z = result.zoning;
  // The keys and values the point lookup gave for a county parcel, unchanged.
  assert.deepEqual(
    { status: z.status, code: z.code, name: z.name, label: z.label, url: z.url, sourceUrl: z.sourceUrl, sourceField: z.sourceField },
    { status: 'gis_match', code: 'RCV', name: 'Rural Conservation', label: 'Official mapped zoning', url: 'https://cp.spokanecounty.org/scout/propertyinformation/', sourceUrl: 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3', sourceField: 'ZONECLASS' }
  );
  for (const key of ['zoneFileNumber', 'developmentAgreement', 'developmentAgreementUrl']) assert.ok(key in z, key);
  assert.ok(z.note.startsWith('Mapped directly from Spokane County SCOUT zoning. Verify allowed uses, density, setbacks and overlays with Spokane County or the applicable city.'));
  assert.ok(!('jurisdictionType' in z));
  assertExtras(result);
  assert.equal(asked(/services\.arcgis\.com|spokanevalley/).length, 0, 'no city layer asked');
  assert.equal(store.size, 1, 'a full answer is cached');
});

test('jurisdiction layer fails: only zoning degrades, no county zone is shown, nothing is cached', async () => {
  const fx = fixture('07123.9075');
  stub(fx, [[/PermittingLookup\/MapServer\/0\/query/, down]]);
  const result = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  const z = result.zoning;
  assert.equal(z.status, 'unavailable');
  assert.equal(z.code, null);
  assert.equal(z.label, 'Zoning lookup unavailable – jurisdiction unknown');
  assert.match(z.note, /cannot tell whether city or Spokane County zoning applies/);
  assert.match(z.error, /returned 500/);
  assert.equal(result.jurisdiction, 'Jurisdiction unknown');
  assert.match(result.zoningMatch.jurisdictionError, /returned 500/);
  assertExtras(result);
  assert.equal(asked(/PermittingLookup\/MapServer\/0\/query/).length, 2, 'one retry');
  assert.equal(store.size, 0);
});

test('a failing city zoning layer degrades to "unavailable" for that city only', async () => {
  const fx = fixture('45012.1111');
  stub(fx, [[/ViewerV3\/LandUse\/MapServer\/1\/query/, () => json({ error: { code: 500, message: 'Error performing query operation' } })]]);
  const result = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  assert.equal(result.jurisdiction, 'City of Spokane Valley');
  const z = result.zoning;
  assert.equal(z.status, 'unavailable');
  assert.equal(z.label, 'City of Spokane Valley zoning lookup unavailable');
  assert.match(z.note, /City of Spokane Valley zoning applies/);
  assertNotCountyZoning(z);
  assertExtras(result);
  assert.equal(store.size, 0);
});

// ---- Likely permits: the city's departments inside a city, the county's outside.

const byName = permits => Object.fromEntries(permits.map(p => [p.name, p]));
const SHARED = ['On-site septic approval', 'Well notice / water review'];

test('permits: a city parcel names the city departments and links its page; state and health items stay', async () => {
  const county = byName((await (async () => { const fx = fixture('07123.9075'); stub(fx); return getSpokaneCountyIntelligence(bodyOf(fx), profile); })()).permits);
  const fx = fixture('45012.1111');
  stub(fx);
  const { permits } = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  const p = byName(permits);
  assert.deepEqual(Object.keys(p), Object.keys(county), 'same items, same order');
  assert.equal(p['Building permit'].agency, 'City of Spokane Valley building / permit department');
  assert.equal(p['Land-use / zoning verification'].agency, 'City of Spokane Valley planning / community development');
  assert.equal(p['Critical-areas review'].agency, 'City of Spokane Valley planning / community development');
  assert.equal(p['Driveway / road approach permit'].agency, 'City of Spokane Valley public works / streets');
  assert.match(p['Driveway / road approach permit'].reason, /a city or state road/);
  for (const name of ['Building permit', 'Land-use / zoning verification', 'Critical-areas review', 'Driveway / road approach permit']) {
    assert.equal(p[name].url, 'https://www.spokanevalleywa.gov/269/Planning-and-Zoning', name);
  }
  assert.doesNotMatch(JSON.stringify(permits), /Spokane County Building|Spokane County Public Works|spokanecounty\.org/);
  for (const name of SHARED) assert.deepEqual(p[name], county[name], name);
  for (const p of permits) assert.deepEqual(Object.keys(p).sort(), ['agency', 'name', 'reason', 'status', 'url'], 'item shape');
});

test('permits: a city without a verified page gets no link; unincorporated land keeps the county agencies', async () => {
  stub(synthetic({
    [J]: { features: [{ attributes: { NAME: 'Millwood', MUNITYP: 'City' }, geometry: square(-117.31, 47.49, -117.28, 47.52) }] },
    [Z]: { features: [] }
  }));
  const millwood = byName((await getSpokaneCountyIntelligence({ county: 'Spokane', ...synthetic({}).parcel }, profile)).permits);
  assert.equal(millwood['Building permit'].agency, 'City of Millwood building / permit department');
  assert.equal(millwood['Building permit'].url, '');
  const fx = fixture('07123.9075');
  stub(fx);
  const county = byName((await getSpokaneCountyIntelligence(bodyOf(fx), profile)).permits);
  assert.equal(county['Building permit'].agency, 'Spokane County Building & Planning');
  assert.equal(county['Building permit'].url, 'https://www.spokanecounty.org/194/Building-Planning');
  assert.equal(county['Driveway / road approach permit'].agency, 'Spokane County Public Works');
  assert.match(county['Driveway / road approach permit'].reason, /a county or state road/);
});

// ---- Synthetic outlines: shares across the parcel.

const square = (x0, y0, x1, y1) => ({ rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const parcel = { type: 'Polygon', coordinates: [[[-117.30, 47.50], [-117.29, 47.50], [-117.29, 47.51], [-117.30, 47.51], [-117.30, 47.50]]] };
const synthetic = responses => ({ parcel: { parcelId: 'TEST', lat: 47.505, lon: -117.295, geometry: parcel }, responses });
const J = 'gismo.spokanecounty.org/arcgis/rest/services/SCOUT/PermittingLookup/MapServer/0/query';
const Z = 'gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query';
const CHENEY = 'services.arcgis.com/yP5WvH3YqutU0LDh/arcgis/rest/services/Cheney__WA___Zoning_Map___2025_WFL1/FeatureServer/3/query';

test('county zoning: the zone covering most of the parcel wins and the others are noted', async () => {
  stub(synthetic({
    [J]: { features: [{ attributes: { NAME: 'Spokane County', MUNITYP: 'Other' }, geometry: square(-117.31, 47.49, -117.28, 47.52) }] },
    [Z]: { features: [
      { attributes: { ZONECLASS: 'SRR', ZONEDESC: 'Small Tract Rural Residential' }, geometry: square(-117.30, 47.50, -117.293, 47.51) },
      { attributes: { ZONECLASS: 'RR-10', ZONEDESC: 'Rural Residential 10' }, geometry: square(-117.293, 47.50, -117.29, 47.51) }
    ] }
  }));
  const { zoning } = await getSpokaneCountyIntelligence({ county: 'Spokane', ...synthetic({}).parcel }, profile);
  assert.equal(zoning.code, 'SRR');
  assert.equal(zoning.name, 'Small Tract Rural Residential');
  assert.equal(zoning.otherZones.length, 1);
  assert.equal(zoning.otherZones[0].code, 'RR-10');
  // The sample grid resolves a 70/30 split to within a few percent.
  assert.ok(Math.abs(zoning.otherZones[0].share - 0.3) < 0.06, String(zoning.otherZones[0].share));
  assert.match(zoning.note, /Covers about (6[5-9]|7\d)% of the parcel; also partly RR-10 \(about (2\d|3[0-5])%\)/);
});

test('a parcel mostly inside a city gets city zoning and a note naming the rest; the county zone is never used', async () => {
  stub(synthetic({
    [J]: { features: [
      { attributes: { NAME: 'Cheney', MUNITYP: 'City' }, geometry: square(-117.31, 47.49, -117.294, 47.52) },
      { attributes: { NAME: 'Spokane County', MUNITYP: 'Other' }, geometry: square(-117.294, 47.49, -117.28, 47.52) }
    ] },
    [Z]: { features: [{ attributes: { ZONECLASS: 'LTA', ZONEDESC: 'Large Tract Agriculture' }, geometry: square(-117.31, 47.49, -117.28, 47.52) }] },
    [CHENEY]: { features: [{ attributes: { ZoneCODE: 'R-1', ZONE: 'Single Family Residential' }, geometry: square(-117.31, 47.49, -117.294, 47.52) }] }
  }));
  const result = await getSpokaneCountyIntelligence({ county: 'Spokane', ...synthetic({}).parcel }, profile);
  assert.equal(result.jurisdiction, 'City of Cheney');
  assert.equal(result.zoning.code, 'R-1');
  assert.equal(result.zoning.name, 'Single Family Residential');
  assert.match(result.zoning.note, /About (5\d|6\d)% of the parcel is inside City of Cheney limits; the rest is in unincorporated Spokane County \(about (3\d|4\d)%\)/);
  assert.equal(result.zoningMatch.otherJurisdictions[0].name, 'unincorporated Spokane County');
});

test('a parcel mostly outside a city keeps county zoning and notes the city part', async () => {
  stub(synthetic({
    [J]: { features: [
      { attributes: { NAME: 'Cheney', MUNITYP: 'City' }, geometry: square(-117.31, 47.49, -117.298, 47.52) },
      { attributes: { NAME: 'Spokane County', MUNITYP: 'Other' }, geometry: square(-117.298, 47.49, -117.28, 47.52) }
    ] },
    [Z]: { features: [{ attributes: { ZONECLASS: 'LTA', ZONEDESC: 'Large Tract Agriculture' }, geometry: square(-117.298, 47.49, -117.28, 47.52) }] }
  }));
  const result = await getSpokaneCountyIntelligence({ county: 'Spokane', ...synthetic({}).parcel }, profile);
  assert.equal(result.jurisdiction, 'Spokane County');
  assert.equal(result.zoning.code, 'LTA');
  assert.match(result.zoning.note, /About (7\d|8\d)% of the parcel is in unincorporated Spokane County; the rest is in City of Cheney \(about (1\d|2\d)%\)/);
  assert.equal(asked(/Cheney__WA/).length, 0, 'no city layer asked');
});

test('a city zoning map with no zone on the parcel still says city zoning applies', async () => {
  stub(synthetic({
    [J]: { features: [{ attributes: { NAME: 'Cheney', MUNITYP: 'City' }, geometry: square(-117.31, 47.49, -117.28, 47.52) }] },
    [Z]: { features: [] },
    [CHENEY]: { features: [] }
  }));
  const { zoning } = await getSpokaneCountyIntelligence({ county: 'Spokane', ...synthetic({}).parcel }, profile);
  assert.equal(zoning.status, 'city_jurisdiction');
  assert.match(zoning.note, /City of Cheney zoning applies/);
  assert.match(zoning.note, /returned no zone on this parcel/);
});

test('jurisdiction names: known cities, towns, the air base and unknown names', () => {
  assert.equal(spokaneCityInfo('Spokane County'), null);
  assert.equal(spokaneCityInfo('Spokane Valley').name, 'City of Spokane Valley');
  assert.equal(spokaneCityInfo('Rockford', 'Town').name, 'Town of Rockford');
  assert.equal(spokaneCityInfo('Fairchild Air Force Base', 'Other').federal, true);
  assert.equal(spokaneCityInfo('New Place', 'City').name, 'City of New Place');
  // Unincorporated competes as one jurisdiction whatever it is called or when nothing covers it.
  assert.equal(decideJurisdiction([{ key: 'SPOKANE COUNTY', share: 0.3 }, { key: null, share: 0.3 }, { key: 'CHENEY', share: 0.4 }]).city, null);
  assert.equal(decideJurisdiction([]).city, null);
});
