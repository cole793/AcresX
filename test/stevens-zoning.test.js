// Stevens County, WA zoning (src/counties/stevens.js, stevens-cities.js, src/zoning/stevens-rules.js)
// and its browser fallback kind (public/browser-fallback.js 'stevens-zoning'). Offline:
// globalThis.fetch is stubbed. The Stevens_County_Zoning_Data layer answers for six real parcels
// were recorded live (read-only) on 2026-11-04 into test/fixtures/stevens-zoning-<parcel>.json:
//   8974701 unincorporated RA-5        2378001 RA-20 / RA-10 boundary (about 51% / 49%)
//   0231200 City of Chewelah (R1)      0000500 City of Colville (C-2)
//   0648500 Loon Lake LAMIRD Business  0763202 Lake Spokane UGA, R-1 Residential
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import legacyWorker from '../src/worker.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { getStevensCountyIntelligence, countyDistrict, STEVENS_COUNTY_ZONING } from '../src/counties/stevens.js';
import { decideJurisdiction, stevensCityInfo } from '../src/counties/stevens-cities.js';
import { getStevensZoneRules, stevensRulesKey } from '../src/zoning/stevens-rules.js';
import { getZoningProfile } from '../src/zoning-counties.js';
import { makeLazyContext, readPublic } from './ui-harness.js';

const profile = getZoningProfile('Stevens');
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const realWarn = console.warn;
let calls, restoreUpstream, store;

const SERVICE = 'gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer';
const layer = id => new RegExp(`Stevens_County_Zoning_Data/MapServer/${id}/query$`);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fixture = id => JSON.parse(readFileSync(new URL(`./fixtures/stevens-zoning-${id}.json`, import.meta.url), 'utf8'));
const bodyOf = fx => ({ ...fx.parcel });
const pathOf = url => `${url.hostname}${url.pathname}`;
const plain = value => JSON.parse(JSON.stringify(value));
const down = () => new Response('down', { status: 503 });

// A recording fetch: recorded answers by host+path, `override` ([regex, () => Response]) first.
function stubFetch(fx, override = []) {
  const list = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const params = new URLSearchParams(url.search);
    if (init.body) new URLSearchParams(String(init.body)).forEach((v, k) => params.set(k, v));
    list.push({ url, params, host: url.hostname, method: init.method || 'GET', credentials: init.credentials, redirect: init.redirect, headers: init.headers || {} });
    const key = pathOf(url);
    for (const [re, make] of override) if (re.test(key)) return make();
    if (fx.responses[key]) return json(fx.responses[key]);
    // Layers a recording did not need (another city's zoning): no feature.
    if (key.startsWith(SERVICE)) return json({ features: [] });
    throw new Error(`unexpected request ${key}`);
  };
  return { fetch, calls: list };
}
function stub(fx, override) { const s = stubFetch(fx, override); calls = s.calls; globalThis.fetch = s.fetch; return s; }
const asked = re => calls.filter(c => re.test(pathOf(c.url)));

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

// The permit list the legacy route produced for Stevens (recorded in the upstream-callers snapshot).
const LEGACY_PERMITS = JSON.parse(readFileSync(new URL('./fixtures/upstream-callers-snapshot.json', import.meta.url), 'utf8'))['legacy worker: Stevens zoning through the configured service'].output.ok.body.permits;

function assertExtras(result) {
  assert.equal(result.available, true);
  assert.equal(result.county, 'Stevens');
  assert.deepEqual(result.permits, LEGACY_PERMITS, 'same permit list as the legacy route (NETCHD septic etc.)');
  assert.equal(result.permitHistoryStatus, 'not_configured');
  assert.equal(result.agencies.healthAgency, 'Northeast Tri County Health District');
}
function assertEveryQueryNamesFields() {
  for (const c of calls) {
    const outFields = c.params.get('outFields');
    assert.ok(outFields && outFields.trim() !== '*', `${pathOf(c.url)} must name its outFields`);
    assert.doesNotMatch(outFields, /owner|mail|first_name|last_name/i);
  }
}

// ---- Unincorporated

test('unincorporated 8974701: RA-5 read across the parcel; the numeric layer value is kept as numericCode', async () => {
  const fx = fixture('8974701');
  stub(fx);
  const result = await getStevensCountyIntelligence(bodyOf(fx), profile);
  assertExtras(result);
  assert.equal(result.jurisdiction, 'Stevens County');
  assert.equal(result.permitJurisdiction.name, 'Stevens County');
  const z = result.zoning;
  assert.equal(z.status, 'gis_match');
  assert.equal(z.code, 'RA-5');
  assert.equal(z.numericCode, '5');
  assert.equal(z.name, 'Rural Area — 5');
  assert.equal(z.jurisdictionType, 'county');
  assert.equal(z.rules, 'mapped');
  assert.equal(z.sourceUrl, `https://${SERVICE}/1`);
  assert.equal('otherZones' in z, false);
  assert.equal(result.zoningMatch.method, 'parcel area (sampled)');
  assert.deepEqual(result.zoningMatch.unavailableLayers, []);
  assert.equal(result.urbanGrowthArea.intersects, false);
  assert.equal(result.lamird.intersects, false);
  assert.equal('fallback' in result, false);
  // The county layer is asked with the parcel polygon, not a point.
  assert.equal(asked(layer(1))[0].params.get('geometryType'), 'esriGeometryPolygon');
  // Cities, county, LAMIRD and UGA; no city layer for an unincorporated parcel.
  assert.deepEqual(calls.map(c => pathOf(c.url).split('/MapServer/')[1]).sort(), ['0/query', '1/query', '8/query', '9/query']);
  assertEveryQueryNamesFields();
});

test('boundary 2378001: the zone covering most of the parcel, with the other one listed', async () => {
  const fx = fixture('2378001');
  stub(fx);
  const z = (await getStevensCountyIntelligence(bodyOf(fx), profile)).zoning;
  assert.equal(z.code, 'RA-20');
  assert.equal(z.numericCode, '20');
  assert.equal(z.otherZones.length, 1);
  assert.equal(z.otherZones[0].code, 'RA-10');
  assert.equal(z.otherZones[0].name, 'Rural Area — 10');
  assert.ok(z.otherZones[0].share > 0.4 && z.otherZones[0].share < 0.6, String(z.otherZones[0].share));
  assert.match(z.note, /Covers about 5\d% of the parcel; also partly RA-10 \(about 49%\)/);
});

test('without an outline the parcel point is used', async () => {
  const fx = fixture('8974701');
  stub(fx);
  const { geometry, ...body } = bodyOf(fx);
  const result = await getStevensCountyIntelligence(body, profile);
  assert.equal(result.zoning.code, 'RA-5');
  assert.equal(result.zoningMatch.method, 'parcel location');
  assert.equal(asked(layer(1))[0].params.get('geometryType'), 'esriGeometryPoint');
});

// ---- Cities

test('Chewelah 0231200: city zoning from the city layer, never county zoning, labelled with the city', async () => {
  const fx = fixture('0231200');
  stub(fx);
  const result = await getStevensCountyIntelligence(bodyOf(fx), profile);
  assertExtras(result);
  assert.equal(result.jurisdiction, 'City of Chewelah');
  assert.equal(result.permitJurisdiction.name, 'City of Chewelah');
  const z = result.zoning;
  assert.equal(z.status, 'gis_match');
  assert.equal(z.code, 'R1');
  assert.equal(z.name, 'Residential');
  assert.equal(z.jurisdictionType, 'city');
  assert.equal(z.sourceUrl, `https://${SERVICE}/2`);
  assert.equal(z.url, 'https://www.cityofchewelah.org/');
  assert.equal(z.rules, 'not_mapped');
  assert.equal('numericCode' in z, false);
  assert.doesNotMatch(JSON.stringify([result.jurisdiction, result.zoning, result.permitJurisdiction]), /unincorporated|Stevens County zoning applies/);
  assert.equal(asked(layer(2)).length, 1);
});

test('Colville 0000500: ZONING / NAME from the Colville layer; no planning link (none verified)', async () => {
  const fx = fixture('0000500');
  stub(fx);
  const result = await getStevensCountyIntelligence(bodyOf(fx), profile);
  assertExtras(result);
  assert.equal(result.jurisdiction, 'City of Colville');
  const z = result.zoning;
  assert.equal(z.code, 'C-2');
  assert.equal(z.name, 'Central Business');
  assert.equal(z.sourceField, 'ZONING');
  assert.equal('url' in z, false);
});

test('a city with no zoning feature on the parcel says city zoning applies, not "no zoning"', async () => {
  const fx = fixture('0000500');
  stub(fx, [[layer(3), () => json({ features: [] })]]);
  const z = (await getStevensCountyIntelligence(bodyOf(fx), profile)).zoning;
  assert.equal(z.status, 'city_jurisdiction');
  assert.equal(z.code, null);
  assert.match(z.label, /City of Colville zoning applies/);
  assert.match(z.note, /Contact City of Colville/);
});

test('city info and jurisdiction: towns are towns; unincorporated land wins ties against a sliver of city', () => {
  assert.equal(stevensCityInfo('Marcus').name, 'Town of Marcus');
  assert.equal(stevensCityInfo('Kettle Falls').name, 'City of Kettle Falls');
  assert.equal(stevensCityInfo(''), null);
  const d = decideJurisdiction([{ key: null, share: 0.7 }, { key: 'COLVILLE', share: 0.3 }]);
  assert.equal(d.city, null);
  assert.deepEqual(d.others, [{ name: 'City of Colville', share: 0.3 }]);
  assert.equal(decideJurisdiction([{ key: 'COLVILLE', share: 0.6 }, { key: null, share: 0.4 }]).city.name, 'City of Colville');
});

// ---- LAMIRD and UGA

test('LAMIRD 0648500: the Loon Lake Business district (layer value 0) maps to B', async () => {
  const fx = fixture('0648500');
  stub(fx);
  const result = await getStevensCountyIntelligence(bodyOf(fx), profile);
  assertExtras(result);
  const z = result.zoning;
  assert.equal(z.code, 'B');
  assert.equal(z.name, 'Loon Lake Business');
  assert.equal(z.numericCode, '0');
  assert.deepEqual(z.district, { community: 'Loon Lake', type: 'Business', area: 'lamird' });
  assert.equal(z.rules, 'mapped');
  assert.match(z.note, /Loon Lake LAMIRD/);
  assert.equal(result.lamird.intersects, true);
  assert.equal(result.lamird.name, 'Loon Lake');
  assert.equal(result.urbanGrowthArea.intersects, false);
});

test('UGA 0763202: Lake Spokane R-1 Residential maps to R-1; the UGA is information with the layer quoted', async () => {
  const fx = fixture('0763202');
  stub(fx);
  const result = await getStevensCountyIntelligence(bodyOf(fx), profile);
  const z = result.zoning;
  assert.equal(z.code, 'R-1');
  assert.equal(z.name, 'Lake Spokane R-1 Residential');
  assert.deepEqual(z.district, { community: 'Lake Spokane', type: 'R-1 Residential', area: 'uga' });
  assert.equal(result.lamird.intersects, false, 'Lake Spokane is on the UGA layer, not the LAMIRD layer');
  const u = result.urbanGrowthArea;
  assert.equal(u.intersects, true);
  assert.equal(u.name, 'Lake Spokane');
  assert.equal(u.sourceUrl, `https://${SERVICE}/9`);
  assert.match(u.note, /"This dataset shows the Urban Growth Areas \(UGA\) designated by the Stevens County Comprehensive Plan\. The dataset also shows the zoning areas designated by the Stevens County Development Regulations Title 3\."/);
});

test('every county-layer value maps to a named district; Crossroads and Resort show rules not mapped', () => {
  const cases = [
    [{ zoning: 5, zoningtext: 'RA-5' }, 'RA-5', true], [{ zoning: 10, zoningtext: 'RA-10' }, 'RA-10', true],
    [{ zoning: 20, zoningtext: 'RA-20' }, 'RA-20', true], [{ zoning: 103, zoningtext: 'AR-10' }, 'AR-10', true],
    [{ zoning: 100, zoningtext: 'NR Forest' }, 'NR Forest', true], [{ zoning: 101, zoningtext: 'NR Ag' }, 'NR Ag', true],
    [{ zoning: 0, zoningtext: ' ', name: 'Clayton', type: 'R-2 Residential' }, 'R-2', true],
    [{ zoning: 0, zoningtext: ' ', name: 'Arden', type: 'Industrial' }, 'I', true],
    [{ zoning: 0, zoningtext: ' ', name: 'Colville', type: 'Open Space' }, 'UO', true],
    [{ zoning: 0, zoningtext: ' ', name: 'Daisy', type: 'Crossroads' }, 'Crossroads', false],
    [{ zoning: 0, zoningtext: ' ', name: 'Deer Lake', type: 'Resort' }, 'Resort', false]
  ];
  for (const [attrs, code, mapped] of cases) {
    const d = countyDistrict(attrs);
    assert.equal(d.code, code, JSON.stringify(attrs));
    assert.equal(d.rulesMapped, mapped, JSON.stringify(attrs));
    assert.equal(getStevensZoneRules(d.code).available, mapped, d.code);
  }
  assert.equal(countyDistrict({ zoning: 100, zoningtext: 'NR Forest' }).name, 'Forest');
  assert.equal(stevensRulesKey('nr ag'), 'A');
  assert.equal(countyDistrict({ zoning: 0, zoningtext: ' ' }), null);
});

test('a Crossroads district answers with its name and "rules not mapped", never another zone\'s rules', async () => {
  const fx = fixture('0648500');
  const swap = body => JSON.parse(JSON.stringify(body).replaceAll('Business', 'Crossroads'));
  stub(fx, [[layer(1), () => json(swap(fx.responses[`${SERVICE}/1/query`]))], [layer(8), () => json(swap(fx.responses[`${SERVICE}/8/query`]))]]);
  const z = (await getStevensCountyIntelligence(bodyOf(fx), profile)).zoning;
  assert.equal(z.code, 'Crossroads');
  assert.equal(z.rules, 'not_mapped');
  assert.match(z.rulesNote, /Rules not mapped for Crossroads/);
  assert.match(z.note, /not mapped in AcresX yet/);
});

test('where the county layer has no polygon, the LAMIRD layer\'s district is used', async () => {
  const fx = fixture('0648500');
  stub(fx, [[layer(1), () => json({ features: [] })]]);
  const z = (await getStevensCountyIntelligence(bodyOf(fx), profile)).zoning;
  assert.equal(z.code, 'B');
  assert.equal(z.name, 'Loon Lake Business');
  assert.equal(z.sourceUrl, `https://${SERVICE}/8`);
  assert.equal('numericCode' in z, false);
});

// ---- Degrading one layer at a time

test('Chewelah layer failing: only zoning degrades, still naming the city; browser hint added', async () => {
  const fx = fixture('0231200');
  stub(fx, [[layer(2), down]]);
  const result = await getStevensCountyIntelligence(bodyOf(fx), profile);
  assertExtras(result);
  assert.equal(result.jurisdiction, 'City of Chewelah');
  assert.equal(result.zoning.status, 'unavailable');
  assert.equal(result.zoning.code, null);
  assert.match(result.zoning.note, /City of Chewelah zoning applies[\s\S]*did not answer/);
  assert.deepEqual(result.zoningMatch.unavailableLayers, ['cityZoning']);
  assert.equal(result.fallback.kind, 'stevens-zoning');
  assert.equal(result.fallback.input.parcelId, '0231200');
  assert.equal(store.size, 0, 'a degraded answer is not cached');
});

test('county layer failing: zoning unavailable (not "no zoning"), the rest of the answer stays', async () => {
  const fx = fixture('8974701');
  stub(fx, [[layer(1), down]]);
  const result = await getStevensCountyIntelligence(bodyOf(fx), profile);
  assertExtras(result);
  assert.equal(result.jurisdiction, 'Stevens County');
  assert.equal(result.zoning.status, 'unavailable');
  assert.equal(result.zoning.code, null);
  assert.match(result.zoning.note, /did not answer/);
  assert.equal(result.urbanGrowthArea.intersects, false);
  assert.equal('status' in result.urbanGrowthArea, false);
  assert.deepEqual(result.zoningMatch.unavailableLayers, ['countyZoning']);
  assert.equal(result.fallback.kind, 'stevens-zoning');
  assert.equal(asked(layer(1)).length, 2, 'one retry');
  assert.equal(store.size, 0);
});

test('city limits failing: the county zone still shows, with a note that city limits were not checked', async () => {
  const fx = fixture('8974701');
  stub(fx, [[layer(0), down]]);
  const result = await getStevensCountyIntelligence(bodyOf(fx), profile);
  assert.equal(result.zoning.code, 'RA-5');
  assert.match(result.zoning.note, /city-limits layer did not answer/);
  assert.ok(result.zoningMatch.jurisdictionError);
  assert.equal(result.fallback.kind, 'stevens-zoning');
});

test('UGA and LAMIRD layers failing degrade only themselves, without a browser hint', async () => {
  const fx = fixture('0763202');
  stub(fx, [[layer(8), down], [layer(9), down]]);
  const result = await getStevensCountyIntelligence(bodyOf(fx), profile);
  assert.equal(result.zoning.code, 'R-1');
  assert.equal(result.zoning.district.area, undefined);
  assert.equal(result.urbanGrowthArea.status, 'unavailable');
  assert.equal(result.lamird.status, 'unavailable');
  assert.deepEqual(result.zoningMatch.unavailableLayers.sort(), ['lamird', 'uga']);
  assert.equal('fallback' in result, false);
});

test('a fully answered lookup is cached and rebuilt without new requests', async () => {
  const fx = fixture('0763202');
  stub(fx);
  const first = await getStevensCountyIntelligence(bodyOf(fx), profile);
  assert.equal(store.size, 1);
  const before = calls.length;
  const second = await getStevensCountyIntelligence(bodyOf(fx), profile);
  assert.equal(calls.length, before);
  assert.deepEqual(second, first);
  assert.doesNotMatch([...store.values()].join(''), /"rings"/, 'no outlines in the cache');
});

// ---- Routing and /api/zoning-rules

const env = { ASSETS: { fetch: async () => new Response('') } };
const post = (path, body) => new Request(`https://acresx.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('/api/zoning-permits routes Stevens to the new adapter, not the legacy discovery path', async () => {
  const fx = fixture('2378001');
  stub(fx);
  const response = await worker.fetch(post('/api/zoning-permits', { ...bodyOf(fx), county: 'Stevens County' }), env, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /max-age=3600/);
  const body = await response.json();
  assert.equal(body.countyStatus, 'stevens-official-adapter-v1');
  assert.equal(body.zoning.code, 'RA-20');
  assert.equal(calls.some(c => /MapServer$/.test(c.url.pathname) || c.host === 'www.arcgis.com'), false, 'no service inspection or catalog search');
  // Shape: every key the legacy answer had is still there.
  const legacyKeys = ['available', 'county', 'parcelId', 'address', 'jurisdiction', 'countyStatus', 'zoning', 'agencies', 'permits', 'permitHistory', 'permitHistoryStatus'];
  for (const key of legacyKeys) assert.ok(key in body, key);
  for (const key of ['status', 'code', 'name', 'label', 'note', 'url', 'sourceUrl', 'sourceField']) assert.ok(key in body.zoning, `zoning.${key}`);
});

test('/api/zoning-permits: a degraded Stevens answer is not cached by browsers or the edge', async () => {
  const fx = fixture('8974701');
  stub(fx, [[layer(1), down]]);
  const response = await worker.fetch(post('/api/zoning-permits', { ...bodyOf(fx), county: 'Stevens' }), env, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('the legacy worker keeps its generic path for other counties (Stevens is no longer routed there)', async () => {
  globalThis.fetch = async () => json({ layers: [] });
  const body = await (await legacyWorker.fetch(post('/api/zoning-permits', { county: 'Ferry', lat: 48.6, lon: -118.5 }), env, {})).json();
  assert.equal(body.county, 'Ferry');
  assert.equal(body.countyStatus, 'discovery');
});

async function rules(body) { return (await worker.fetch(post('/api/zoning-rules', body), env, {})).json(); }

test('/api/zoning-rules maps the new named codes, the old numeric ones, and keeps city codes off county rules', async () => {
  for (const [code, key] of [['RA-5', 'RA-5'], ['5', 'RA-5'], ['RA-10', 'RA-10'], ['10', 'RA-10'], ['103', 'AR-10'], ['AR-10', 'AR-10'], ['NR Forest', 'F'], ['NR Ag', 'A'], ['R-1', 'R-1'], ['B', 'B']]) {
    const r = await rules({ county: 'Stevens', zoneCode: code, jurisdiction: 'Stevens County' });
    assert.equal(r.available, true, code);
    assert.equal(r.code, key, code);
  }
  const unchanged = await rules({ county: 'Stevens', zoneCode: '20' });
  assert.equal(unchanged.name, 'Rural Area — 20');
  assert.equal(unchanged.sourceChapter, '3.03.020 / 3.04.010');
  assert.equal((await rules({ county: 'Stevens', zoneCode: 'Crossroads', jurisdiction: 'Stevens County' })).status, 'zone_not_mapped');
  const city = await rules({ county: 'Stevens', zoneCode: 'R-1', jurisdiction: 'City of Colville' });
  assert.equal(city.available, false);
  assert.equal(city.status, 'zone_not_mapped');
  // The old label still counts as the county.
  assert.equal((await rules({ county: 'Stevens', zoneCode: 'RA-5', jurisdiction: 'Stevens County (unincorporated areas)' })).available, true);
});

// ---- Browser fallback ('stevens-zoning')

const ALLOWED = ['map.kcgov.us', 'gis.cdaid.org', 'gis.postfalls.gov', 'gis.idwr.idaho.gov', 'hazards.fema.gov', 'gis.stevenscountywa.gov'];
function browser(fetchImpl) {
  const h = makeLazyContext();
  const timer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; };
  Object.assign(h.context, { URL, URLSearchParams, AbortController, Response, Headers, fetch: fetchImpl, setTimeout: timer, clearTimeout });
  h.run(readPublic('browser-fallback.js'));
  return h.context.AcresXFallback;
}
function assertSafe(list) {
  assert.ok(list.length > 0);
  for (const c of list) {
    assert.ok(ALLOWED.includes(c.host), c.host);
    assert.equal(c.credentials, 'omit');
    assert.equal(c.redirect, 'error');
    const outFields = c.params.get('outFields');
    assert.ok(outFields && outFields !== '*');
    assert.ok(c.method === 'GET' || c.headers['Content-Type'] === 'application/x-www-form-urlencoded');
  }
}

for (const [id, failing] of [['8974701', 1], ['2378001', 1], ['0231200', 2], ['0000500', 0], ['0648500', 1], ['0763202', 0]]) {
  test(`stevens-zoning parity on recorded ${id}: a blocked layer ${failing} recovered in the browser equals the Worker's healthy answer`, async () => {
    const fx = fixture(id);
    const body = { ...bodyOf(fx), county: 'Stevens' };
    stub(fx);
    const healthy = plain(await (await worker.fetch(post('/api/zoning-permits', body), env, {})).json());
    const healthyCalls = calls;
    store.clear();
    stub(fx, [[layer(failing), () => new Response('Forbidden', { status: 403 })]]);
    const failed = await worker.fetch(post('/api/zoning-permits', body), env, {});
    const hint = (await failed.clone().json()).fallback;
    assert.equal(hint.kind, 'stevens-zoning');
    const b = stubFetch(fx);
    const fb = browser(b.fetch);
    const recovered = await fb.recover('/api/zoning-permits', failed);
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), healthy);
    assert.deepEqual(Object.keys(fb.loaded()), ['stevens-zoning']);
    assertSafe(b.calls);
    // Same layers and fields as the Worker.
    const fieldsOf = list => [...new Set(list.map(c => `${pathOf(c.url)} ${c.params.get('outFields')}`))].sort();
    assert.deepEqual(fieldsOf(b.calls), fieldsOf(healthyCalls));
  });
}

test('stevens-zoning: a decisive layer failing in the browser too keeps the Worker answer', async () => {
  const fx = fixture('8974701');
  const body = { ...bodyOf(fx), county: 'Stevens' };
  stub(fx, [[layer(1), down]]);
  const failed = await worker.fetch(post('/api/zoning-permits', body), env, {});
  const b = stubFetch(fx, [[layer(1), down]]);
  const fb = browser(b.fetch);
  const kept = await fb.recover('/api/zoning-permits', failed);
  assert.equal(kept, failed);
  assert.deepEqual(Object.keys(fb.loaded()), []);
});

test('the Stevens rules module and county layer URL agree with the browser copy', () => {
  const src = readPublic('browser-fallback.js');
  assert.ok(src.includes(STEVENS_COUNTY_ZONING.replace(/\/1$/, '')));
  for (const code of ['RA-5', 'RA-10', 'RA-20', 'AR-10', 'F', 'A', 'R-1', 'R-2', 'UO', 'B', 'I']) {
    assert.ok(src.includes(`'${getStevensZoneRules(code).name}'`), code);
  }
});
