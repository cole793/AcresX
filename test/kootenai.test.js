// Offline tests for the Kootenai site adapter (src/counties/kootenai.js) and its city-zoning
// helper (src/counties/kootenai-cities.js). fetch is stubbed with canned or recorded ArcGIS
// answers; nothing touches the county or city servers. The recorded fixtures
// (test/fixtures/kootenai-zoning-<PIN>.json) were captured live on 2026-10-27.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { getKootenaiCountyIntelligence } from '../src/counties/kootenai.js';
import { ringsFromGeometry, samplePoints, pointInRings, coverageShares } from '../src/shared/polygon-coverage.js';

const PARCELS = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0/query';
const ZONING = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/21/query';
const CITY_LIMITS = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/18/query';
const IMPACT = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/17/query';
const CDA = 'https://gis.cdaid.org/server/rest/services/Share/Planning/MapServer/8/query';
const POST_FALLS = 'https://gis.postfalls.gov/server/rest/services/GIS2/LandUse/MapServer/5/query';

const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const ring = square(-116.8, 47.7, -116.79, 47.71);
const parcelAnswer = { features: [{ attributes: { PIN: 'P50N04W123456', Acres: 10, Loc_Addr: '1 Test Rd', Loc_City: 'Athol' }, geometry: { rings: [ring] } }] };
const zoningAttrs = { ZONE_NAME: 'Rural', LABEL: 'Rural', ACRES: 120 };
const zoningAnswer = { features: [{ attributes: zoningAttrs, geometry: { rings: [square(-116.81, 47.69, -116.78, 47.72)] } }] };
const unincorporated = { features: [{ attributes: { CITY: ' ' }, geometry: { rings: [square(-116.81, 47.69, -116.78, 47.72)] } }] };
const empty = { features: [] };
// What the Ownership_Display layer actually returns when outFields names a field it lacks.
const arcgisError = { error: { code: 400, message: 'Failed to execute query.', details: [] } };

let calls;
const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function record(input, init) {
  const url = new URL(String(input));
  const base = url.origin + url.pathname;
  const params = new URLSearchParams(url.search);
  if (init?.body) new URLSearchParams(String(init.body)).forEach((v, k) => params.set(k, v));
  calls.push({ base, params, method: init?.method || 'GET' });
  return { base, params, n: calls.filter(c => c.base === base).length };
}
// Canned answers per layer; each answer is a body, or a function (params, n) => body | Response.
function stub(overrides = {}) {
  calls = [];
  const answers = { [PARCELS]: parcelAnswer, [ZONING]: zoningAnswer, [CITY_LIMITS]: unincorporated, [IMPACT]: empty, ...overrides };
  return async (input, init) => {
    const { base, params, n } = await record(input, init);
    if (!(base in answers)) throw new Error(`unexpected request ${base}`);
    const a = typeof answers[base] === 'function' ? answers[base](params, n) : answers[base];
    return a instanceof Response ? a : reply(a);
  };
}
// Replays a recorded live run: answers for each layer in the order they were recorded.
function fixture(pin, overrides = {}) {
  const data = JSON.parse(readFileSync(new URL(`./fixtures/kootenai-zoning-${pin}.json`, import.meta.url), 'utf8'));
  calls = [];
  return {
    data,
    fetch: async (input, init) => {
      const { base, n } = await record(input, init);
      if (base in overrides) return overrides[base]();
      const recorded = data.responses.filter(r => r.url === base);
      if (!recorded.length) throw new Error(`no recorded answer for ${base}`);
      const r = recorded[Math.min(n, recorded.length) - 1];
      return reply(r.body, r.status);
    }
  };
}
const callsTo = base => calls.filter(c => c.base === base);
const parcelCalls = () => callsTo(PARCELS);
const down = () => reply('Service Unavailable', 503);

const realFetch = globalThis.fetch;
const realWarn = console.warn;
let warnings;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; warnings = []; console.warn = (...args) => warnings.push(args.map(String).join(' ')); });
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; });

const env = { ASSETS: { fetch: async () => new Response('') } };
async function api(path, body) {
  const response = await worker.fetch(new Request(`https://acresx.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  return response.json();
}
const zoningPermits = body => api('/api/zoning-permits', body);

// --- Parcel lookup (unchanged behaviour) ---

test('Kootenai parcel query does not request the missing ZONING field', async () => {
  globalThis.fetch = stub();
  await zoningPermits({ county: 'Kootenai', parcelId: 'P50N04W123456', lat: 47.705, lon: -116.795 });
  assert.equal(parcelCalls().length, 1);
  const outFields = parcelCalls()[0].params.get('outFields').split(',');
  assert.ok(!outFields.includes('ZONING'), `outFields was ${outFields}`);
  assert.deepEqual(outFields, ['PIN', 'PID', 'Acres', 'Legal', 'Loc_Addr', 'Loc_City', 'Ex_Value', 'Net_Val', 'Gross_Val', 'TCA']);
  assert.deepEqual(warnings, []);
});

test('Kootenai parcel query retries once with minimal fields after an ArcGIS error', async () => {
  globalThis.fetch = stub({ [PARCELS]: (params, n) => (n === 1 ? arcgisError : parcelAnswer) });
  // No lat/lon: the parcel outline from the retry is what the zoning query uses.
  const result = await getKootenaiCountyIntelligence({ parcelId: 'p50n04w123456' });
  assert.equal(parcelCalls().length, 2);
  assert.equal(parcelCalls()[1].params.get('outFields'), 'PIN,Acres,Loc_Addr,Loc_City');
  assert.equal(parcelCalls()[1].params.get('where'), "UPPER(PIN)='P50N04W123456'");
  assert.equal(parcelCalls()[1].params.get('returnGeometry'), 'true');
  const zq = callsTo(ZONING)[0].params;
  assert.equal(zq.get('geometryType'), 'esriGeometryPolygon');
  assert.deepEqual(JSON.parse(zq.get('geometry')).rings, [ring]);
  assert.equal(result.available, true);
  assert.equal(result.zoning.code, 'Rural');
  assert.equal(result.source.parcelAttributes.PIN, 'P50N04W123456');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /retrying with minimal fields/);
  assert.match(warnings[0], /Failed to execute query/);
});

test('Kootenai zoning still comes from a point query when both parcel queries fail', async () => {
  globalThis.fetch = stub({ [PARCELS]: () => arcgisError, [ZONING]: { features: [{ attributes: zoningAttrs }] }, [CITY_LIMITS]: { features: [{ attributes: { CITY: null } }] } });
  const result = await zoningPermits({ county: 'Kootenai', parcelId: 'P1', lat: 47.705, lon: -116.795 });
  assert.equal(parcelCalls().length, 2, 'one retry only');
  const zq = callsTo(ZONING)[0].params;
  assert.equal(zq.get('geometryType'), 'esriGeometryPoint');
  assert.deepEqual(JSON.parse(zq.get('geometry')), { x: -116.795, y: 47.705, spatialReference: { wkid: 4326 } });
  assert.equal(result.available, true);
  assert.equal(result.zoning.code, 'Rural');
  assert.equal(result.source.matchMethod, 'parcel location');
  assert.deepEqual(result.source.parcelAttributes, {});
});

test('Kootenai zoning uses the outline the browser sent when the county parcel query fails', async () => {
  globalThis.fetch = stub({ [PARCELS]: () => arcgisError });
  const result = await zoningPermits({ county: 'Kootenai', parcelId: 'P1', lat: 47.705, lon: -116.795, geometry: { type: 'Polygon', coordinates: [ring] } });
  assert.equal(callsTo(ZONING)[0].params.get('geometryType'), 'esriGeometryPolygon');
  assert.equal(result.zoning.code, 'Rural');
  assert.equal(result.source.matchMethod, 'parcel area (sampled)');
});

test('Kootenai parcel query is not retried after an HTTP failure', async () => {
  globalThis.fetch = stub({ [PARCELS]: down });
  const result = await zoningPermits({ county: 'Kootenai', parcelId: 'P1', lat: 47.705, lon: -116.795 });
  assert.equal(parcelCalls().length, 1);
  assert.equal(result.available, true);
});

// --- Unincorporated parcels: county zoning by parcel area ---

test('/api/zoning-permits Kootenai unincorporated response keeps its shape', async () => {
  globalThis.fetch = stub();
  const result = await zoningPermits({ county: 'Kootenai', parcelId: 'P50N04W123456', lat: 47.705, lon: -116.795 });
  assert.deepEqual(Object.keys(result), ['available', 'county', 'state', 'countyStatus', 'jurisdiction', 'permitJurisdiction', 'zoning', 'allowedBuildings', 'permittedUses', 'comprehensivePlan', 'urbanGrowthArea', 'overlays', 'permits', 'permitHistory', 'permitHistoryStatus', 'source']);
  assert.deepEqual(result.zoning, { status: 'gis_match', code: 'Rural', name: 'Rural', label: 'Rural', note: 'Mapped zoning designation from Kootenai County KCEarth/Data_Layers.', sourceUrl: 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/21', url: 'https://www.kcgov.us/230/Planning' });
  assert.deepEqual(Object.keys(result.source), ['agency', 'service', 'layerId', 'matchMethod', 'attributes', 'parcelAttributes']);
  assert.deepEqual(result.source.attributes, zoningAttrs);
  assert.deepEqual(result.source.parcelAttributes, parcelAnswer.features[0].attributes);
  assert.equal(result.allowedBuildings.status, 'mapped_from_county_code');
  assert.equal(result.countyStatus, 'kootenai-data-layers-v3');
  assert.equal(result.jurisdiction, 'Kootenai County');
});

test('Kootenai unincorporated parcel whose center hits a zone (recorded 0L8210010030)', async () => {
  const { fetch } = fixture('0L8210010030');
  globalThis.fetch = fetch;
  const result = await zoningPermits({ county: 'Kootenai', parcelId: '0L8210010030', lat: 47.9, lon: -116.9 });
  assert.equal(result.jurisdiction, 'Kootenai County');
  assert.equal(result.zoning.status, 'gis_match');
  assert.equal(result.zoning.code, 'RURAL');
  assert.equal(result.zoning.note, 'Mapped zoning designation from Kootenai County KCEarth/Data_Layers.');
  assert.equal(result.zoning.otherZones, undefined);
  assert.equal(result.source.attributes.Shape, undefined);
});

test('Kootenai parcel whose center misses the county zoning map gets the zone covering most of it (recorded 48N03W312100)', async () => {
  const { data, fetch } = fixture('48N03W312100');
  globalThis.fetch = fetch;
  // The old method: the parcel's vertex-average center lies in none of the zone polygons.
  const parcelRings = ringsFromGeometry(data.responses.find(r => r.url === PARCELS && r.body.features).body.features[0].geometry);
  const [cx, cy] = parcelRings[0].reduce(([x, y], p) => [x + p[0] / parcelRings[0].length, y + p[1] / parcelRings[0].length], [0, 0]);
  const zones = data.responses.find(r => r.url === ZONING).body.features;
  assert.ok(!zones.some(f => pointInRings(cx, cy, ringsFromGeometry(f.geometry))), 'center should miss every zone');

  const result = await getKootenaiCountyIntelligence({ parcelId: '48N03W312100' });
  assert.equal(result.available, true);
  assert.equal(result.jurisdiction, 'Kootenai County');
  assert.equal(result.zoning.status, 'gis_match');
  assert.equal(result.zoning.code, 'AGRICULTURE');
  assert.match(result.zoning.note, /Covers about 5\d% of the parcel; about 4\d% has no mapped county zone\./);
  assert.equal(result.source.matchMethod, 'parcel area (sampled)');
  assert.equal(result.allowedBuildings.status, 'mapped_from_county_code');
  // A 46-vertex outline is too long for a GET URL, so the spatial queries are POSTed.
  assert.equal(callsTo(ZONING)[0].method, 'POST');
});

test('Kootenai parcel split between county zones reports the larger one and the others', async () => {
  globalThis.fetch = stub({ [ZONING]: { features: [
    { attributes: { ZONE_NAME: 'AG', LABEL: 'AGRICULTURE' }, geometry: { rings: [square(-116.81, 47.69, -116.797, 47.72)] } },
    { attributes: { ZONE_NAME: 'RESRES', LABEL: 'RESTRICTED RESIDENTIAL' }, geometry: { rings: [square(-116.797, 47.69, -116.78, 47.72)] } }
  ] } });
  const result = await getKootenaiCountyIntelligence({ parcelId: 'P50N04W123456' });
  assert.equal(result.zoning.code, 'RESTRICTED RESIDENTIAL');
  assert.match(result.zoning.note, /Covers about (6[5-9]|7[0-5])% of the parcel; also partly AGRICULTURE \(about (2[5-9]|3[0-5])%\)\.$/);
  assert.equal(result.zoning.otherZones.length, 1);
  assert.equal(result.zoning.otherZones[0].code, 'AGRICULTURE');
});

test('Kootenai area of city impact is shown as info and keeps county zoning', async () => {
  globalThis.fetch = stub({ [IMPACT]: { features: [{ attributes: { CITY: 'RATHDRUM', ORDINANCE: 'ORA25-0018' }, geometry: { rings: [square(-116.81, 47.69, -116.78, 47.72)] } }] } });
  const result = await getKootenaiCountyIntelligence({ parcelId: 'P50N04W123456' });
  assert.equal(result.jurisdiction, 'Kootenai County');
  assert.equal(result.zoning.code, 'Rural');
  assert.deepEqual(result.zoning.cityImpactArea, { city: 'City of Rathdrum', ordinance: 'ORA25-0018' });
  assert.match(result.zoning.note, /Inside the City of Rathdrum area of city impact; Kootenai County zoning applies outside city limits\./);
});

test('Kootenai city-limits service down falls back to county zoning', async () => {
  globalThis.fetch = stub({ [CITY_LIMITS]: down, [IMPACT]: down });
  const result = await zoningPermits({ county: 'Kootenai', parcelId: 'P50N04W123456', lat: 47.705, lon: -116.795 });
  assert.equal(result.available, true);
  assert.equal(result.jurisdiction, 'Kootenai County');
  assert.equal(result.zoning.code, 'Rural');
  assert.equal(result.zoning.note, 'Mapped zoning designation from Kootenai County KCEarth/Data_Layers.');
  assert.ok(warnings.some(w => /city limits lookup failed; using county zoning/.test(w)));
});

test('Kootenai county zoning failure still degrades only the zoning layer', async () => {
  globalThis.fetch = stub({ [ZONING]: down });
  const response = await worker.fetch(new Request('https://acresx.test/api/zoning-permits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ county: 'Kootenai', parcelId: 'P1', lat: 47.705, lon: -116.795 }) }), env, { waitUntil() {} });
  const result = await response.json();
  assert.equal(result.zoning.status, 'unavailable');
  assert.equal(result.jurisdiction, 'Kootenai County');
});

// --- Parcels inside a city ---

test('Coeur d\'Alene parcel gets city zoning from the city layer (recorded C72150030040)', async () => {
  const { fetch } = fixture('C72150030040');
  globalThis.fetch = fetch;
  const result = await zoningPermits({ county: 'Kootenai', parcelId: 'C72150030040', lat: 47.724453, lon: -116.803995 });
  assert.equal(result.available, true);
  assert.equal(result.jurisdiction, "City of Coeur d'Alene");
  assert.deepEqual(result.permitJurisdiction, { name: "City of Coeur d'Alene" });
  assert.equal(result.zoning.status, 'gis_match');
  assert.equal(result.zoning.code, 'R-12');
  assert.equal(result.zoning.sourceUrl, 'https://gis.cdaid.org/server/rest/services/Share/Planning/MapServer/8');
  assert.equal(result.zoning.url, 'https://www.cdaid.org/Files/Planning/R-12.pdf');
  assert.doesNotMatch(JSON.stringify(result), /No mapped zoning result found/);
  assert.equal(result.allowedBuildings.status, 'not_mapped');
  assert.equal(result.allowedBuildings.note, "City zoning rules aren't mapped in AcresX yet; see the city's zoning code.");
  assert.equal(result.source.layerId, 8);
  assert.equal(result.source.jurisdictionSource.city, 'COEUR D ALENE');
  assert.equal(result.countyStatus, 'kootenai-city-zoning-v1');
});

test('Coeur d\'Alene zone PDF link is used only when it names the same zone', async () => {
  const city = { features: [{ attributes: { CITY: 'Coeur d Alene' }, geometry: { rings: [square(-116.81, 47.69, -116.78, 47.72)] } }] };
  const cda = { features: [{ attributes: { ZONING: 'C-17', ZoningInfo: '<a href=http://www.cdaid.org/Files/Planning/R-17.pdf target=_blank>C-17</a>' }, geometry: { rings: [square(-116.81, 47.69, -116.78, 47.72)] } }] };
  globalThis.fetch = stub({ [CITY_LIMITS]: city, [CDA]: cda });
  const result = await getKootenaiCountyIntelligence({ parcelId: 'P50N04W123456' });
  assert.equal(result.zoning.code, 'C-17');
  assert.equal(result.zoning.url, 'https://www.cdaid.org/planning');
});

test('Post Falls parcel gets city zoning from the city layer (recorded P00000032775)', async () => {
  const { fetch } = fixture('P00000032775');
  globalThis.fetch = fetch;
  const result = await getKootenaiCountyIntelligence({ parcelId: 'P00000032775' });
  assert.equal(result.jurisdiction, 'City of Post Falls');
  assert.equal(result.zoning.status, 'gis_match');
  assert.equal(result.zoning.code, 'R-3');
  assert.equal(result.zoning.sourceUrl, 'https://gis.postfalls.gov/server/rest/services/GIS2/LandUse/MapServer/5');
  assert.equal(result.zoning.url, 'https://www.postfalls.gov/179/Planning');
  assert.equal(result.allowedBuildings.status, 'not_mapped');
});

test('Hayden parcel says city zoning applies, honestly (recorded 081900010030)', async () => {
  const { fetch } = fixture('081900010030');
  globalThis.fetch = fetch;
  const result = await zoningPermits({ county: 'Kootenai', parcelId: '081900010030', lat: 47.7956, lon: -116.787 });
  assert.equal(result.available, false);
  assert.equal(result.jurisdiction, 'City of Hayden');
  assert.deepEqual(result.permitJurisdiction, { name: 'City of Hayden' });
  assert.equal(result.zoning.status, 'city_jurisdiction');
  assert.equal(result.zoning.label, 'City of Hayden zoning – see city');
  assert.match(result.zoning.note, /inside City of Hayden limits, so city zoning applies/);
  assert.match(result.zoning.note, /not available digitally/);
  assert.equal(result.zoning.url, 'https://www.haydenid.gov/departments/planning_/index.php');
  assert.equal(result.zoning.code, undefined);
  assert.doesNotMatch(JSON.stringify(result), /No mapped zoning result found/);
});

test('City without a verified planning page says to contact the city', async () => {
  const city = { features: [{ attributes: { CITY: 'Rathdrum' }, geometry: { rings: [square(-116.81, 47.69, -116.78, 47.72)] } }] };
  globalThis.fetch = stub({ [CITY_LIMITS]: city });
  const result = await getKootenaiCountyIntelligence({ parcelId: 'P50N04W123456' });
  assert.equal(result.zoning.status, 'city_jurisdiction');
  assert.equal(result.jurisdiction, 'City of Rathdrum');
  assert.match(result.zoning.note, /Contact City of Rathdrum for its zoning map and code\./);
  assert.equal(result.zoning.url, undefined);
});

test('Parcel straddling city limits goes to whichever covers most of it', async () => {
  // City covers the west 70% of the parcel (-116.8 .. -116.793), unincorporated the rest.
  const split = cityShare => ({ features: [
    { attributes: { CITY: 'Coeur d Alene' }, geometry: { rings: [square(-116.81, 47.69, -116.8 + cityShare * 0.01, 47.72)] } },
    { attributes: { CITY: ' ' }, geometry: { rings: [square(-116.8 + cityShare * 0.01, 47.69, -116.78, 47.72)] } }
  ] });
  const cda = { features: [{ attributes: { ZONING: 'R-8' }, geometry: { rings: [square(-116.81, 47.69, -116.78, 47.72)] } }] };

  globalThis.fetch = stub({ [CITY_LIMITS]: split(0.7), [CDA]: cda });
  let result = await getKootenaiCountyIntelligence({ parcelId: 'P50N04W123456' });
  assert.equal(result.jurisdiction, "City of Coeur d'Alene");
  assert.equal(result.zoning.code, 'R-8');
  assert.match(result.zoning.note, /About (6[5-9]|7[0-5])% of the parcel is inside City of Coeur d'Alene limits; the rest may fall under another jurisdiction\./);

  globalThis.fetch = stub({ [CITY_LIMITS]: split(0.3), [CDA]: cda });
  result = await getKootenaiCountyIntelligence({ parcelId: 'P50N04W123456' });
  assert.equal(result.jurisdiction, 'Kootenai County');
  assert.equal(result.zoning.code, 'Rural');
  assert.equal(callsTo(CDA).length, 0);
});

test('City zoning layer down gives an honest unavailable result that still names the city', async () => {
  const { fetch } = fixture('C72150030040', { [CDA]: down });
  globalThis.fetch = fetch;
  const result = await zoningPermits({ county: 'Kootenai', parcelId: 'C72150030040', lat: 47.724453, lon: -116.803995 });
  assert.equal(result.available, false);
  assert.equal(result.jurisdiction, "City of Coeur d'Alene");
  assert.equal(result.zoning.status, 'unavailable');
  assert.equal(result.zoning.label, "City of Coeur d'Alene zoning lookup unavailable");
  assert.match(result.zoning.note, /city zoning applies/);
  assert.equal(result.zoning.url, 'https://www.cdaid.org/planning');
  assert.doesNotMatch(JSON.stringify(result), /No mapped zoning result found/);
  assert.ok(warnings.some(w => /City of Coeur d'Alene zoning lookup failed/.test(w)));
});

test('/api/zoning-rules does not apply county rules to Kootenai city zones', async () => {
  const city = await api('/api/zoning-rules', { county: 'Kootenai', zoneCode: 'M', jurisdiction: "City of Coeur d'Alene" });
  assert.equal(city.available, false);
  assert.equal(city.status, 'zone_not_mapped');
  assert.match(city.note, /City zoning rules aren't mapped/);
  const county = await api('/api/zoning-rules', { county: 'Kootenai', zoneCode: 'AGRICULTURE', jurisdiction: 'Kootenai County' });
  assert.equal(county.available, true);
});

// --- Coverage helper ---

test('samplePoints fills irregular parcels and respects holes', () => {
  const outer = square(0, 47, 0.01, 47.01), hole = square(0.0025, 47.0025, 0.0075, 47.0075);
  const pts = samplePoints([outer, hole]);
  assert.ok(pts.length >= 100, `got ${pts.length}`);
  assert.ok(pts.every(([x, y]) => !(x > 0.0025 && x < 0.0075 && y > 47.0025 && y < 47.0075)));
  const triangle = [[0, 47], [0.01, 47], [0, 47.01], [0, 47]];
  assert.ok(samplePoints([triangle]).length >= 100);
  const shares = coverageShares(samplePoints([outer]), [{ attributes: { Z: 'A' }, geometry: { rings: [square(0, 47, 0.005, 47.01)] } }], a => a.Z);
  assert.deepEqual(shares.map(s => s.key), ['A', null]);
  assert.ok(Math.abs(shares[0].share - 0.5) < 0.05);
});
