// What the Cache API stores for the parcel and county lookups on the shared upstream client
// (src/shared/upstream.js cachedJson): never owner or mailing data, and never a partial or
// failed answer. caches.default is faked; fetch is stubbed (no network).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { configureUpstream } from '../src/shared/upstream.js';
import { PERSONAL_FIELD, withoutPersonalFields } from '../src/shared/personal-fields.js';
import { getSpokaneCountyIntelligence, SPOKANE_CACHE_PREFIX } from '../src/counties/spokane.js';
import { getYellowstoneCountyIntelligence, YELLOWSTONE_CACHE_PREFIX } from '../src/counties/yellowstone.js';
import { getGallatinCountyIntelligence, GALLATIN_CACHE_PREFIX } from '../src/counties/gallatin.js';
import { findMontanaParcel, findYellowstoneParcel, MONTANA_PARCEL_CACHE_PREFIX } from '../src/states/montana/parcels.js';
import { findIdahoParcel, IDAHO_PARCEL_CACHE_PREFIX, RATE_LIMIT_RETRY_MS } from '../src/states/idaho/parcels.js';
import { KC_PARCEL_CACHE_PREFIX } from '../src/counties/kootenai-parcels.js';
import { getZoningProfile } from '../src/zoning-counties.js';

const OWNER_VALUE = /TEST OWNER|1 MAIL ST|SMITH JOHN/;
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const realWarn = console.warn;
const realRetry = RATE_LIMIT_RETRY_MS.value;
let calls, restoreUpstream, store;

function fakeCache() {
  const map = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = map.get(req.url); return hit ? new Response(hit) : undefined; },
    async put(req, res) { map.set(req.url, await res.text()); }
  } };
  return map;
}
// Every stored value, parsed, with the key it was stored under.
const stored = () => [...store.entries()].map(([key, text]) => ({ key, value: JSON.parse(text) }));
function allKeys(value, keys = []) {
  if (Array.isArray(value)) value.forEach(v => allKeys(v, keys));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.push(k); allKeys(v, keys); }
  return keys;
}
function assertNoPersonalData(value) {
  assert.deepEqual(allKeys(value).filter(k => PERSONAL_FIELD.test(k) || /^(OWNER\d*|PUBLIC_STD|MAIL_.*)$/i.test(k) || k === 'Name'), []);
  assert.doesNotMatch(JSON.stringify(value), OWNER_VALUE);
}
function stub(route) {
  calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(url);
    return route(url, init, calls.length);
  };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const features = list => json({ features: list.map(attributes => ({ attributes })) });
const geojson = list => json({ type: 'FeatureCollection', features: list });
const square = (lon, lat, d = 0.001) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
const down = () => new Response('down', { status: 500 });

beforeEach(() => {
  store = fakeCache(); console.warn = () => {}; RATE_LIMIT_RETRY_MS.value = 1;
  restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} });
});
afterEach(() => {
  globalThis.fetch = realFetch; console.warn = realWarn; RATE_LIMIT_RETRY_MS.value = realRetry; restoreUpstream();
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

test('withoutPersonalFields drops owner/mailing keys at any depth and keeps zoning names', () => {
  const out = withoutPersonalFields({ a: [{ attributes: { OWNER1: 'x', owner_name: 'x', taxpayer_name: 'x', MAIL_ADD1: 'x', OwnerName: 'x', Owner_Primary: 'x', DeliveryAddr_Primary: 'x', NAME: 'Rural', ZONE_NAME: 'AG', JURISDICTION: 'Spokane County' } }] });
  assert.deepEqual(out, { a: [{ attributes: { NAME: 'Rural', ZONE_NAME: 'AG', JURISDICTION: 'Spokane County' } }] });
});

test('cache prefixes moved past every version that could have held owner fields', () => {
  for (const prefix of [SPOKANE_CACHE_PREFIX, YELLOWSTONE_CACHE_PREFIX, GALLATIN_CACHE_PREFIX, MONTANA_PARCEL_CACHE_PREFIX]) assert.match(prefix, /\/v2\/$/, prefix);
  // idaho-parcels v2 held outFields '*' answers (stripped); v3 holds the named-field answers.
  assert.match(IDAHO_PARCEL_CACHE_PREFIX, /\/idaho-parcels\/v3\/$/);
  assert.match(KC_PARCEL_CACHE_PREFIX, /\/kootenai-parcels\/v3\/$/);
});

// ---- Spokane

const spokaneProfile = getZoningProfile('Spokane');
const spokaneBody = { lat: 47.6005, lon: -117.3995, parcelId: '47174.9017', geometry: square(-117.40, 47.60) };
function spokaneLayers(url, { permits } = {}) {
  const path = url.pathname;
  if (path.includes('ZoningLookup/MapServer/3/')) return features([{ ZONECLASS: 'RR-5', ZONEDESC: 'Rural Residential 5' }]);
  if (path.includes('ZoningLookup/MapServer/4/')) return features([{ LANDUSECODE: 'RR', LANDUSEDESC: 'Rural Residential' }]);
  if (path.includes('ZoningLookup/MapServer/2/')) return features([]);
  if (path.includes('PermittingLookup/MapServer/0/')) return features([{ JURISDICTION: 'Spokane County', OWNER_NAME: 'TEST OWNER' }]);
  if (path.includes('BPPublic/MapServer/5/')) return permits ? permits() : features([{ PERMITNUM: 'B-1', PERMITTYPE: 'Residential', STATUS: 'Final', ADDRESS: '123 TEST RD', OWNER_NAME: 'SMITH JOHN', OWNERADDRESS: '1 MAIL ST' }]);
  throw new Error(`unexpected ${path}`);
}

test('Spokane: the cached layer answers carry no owner fields, and a hit answers the same', async () => {
  stub(url => spokaneLayers(url));
  const fresh = await getSpokaneCountyIntelligence(spokaneBody, spokaneProfile);
  assert.equal(store.size, 1);
  assert.ok(stored()[0].key.startsWith(SPOKANE_CACHE_PREFIX));
  assertNoPersonalData(stored()[0].value);
  assertNoPersonalData(fresh);
  assert.equal(fresh.permitHistory[0].number, 'B-1');
  const before = calls.length;
  const hit = await getSpokaneCountyIntelligence(spokaneBody, spokaneProfile);
  assert.equal(calls.length, before, 'answered from the cache');
  assert.deepEqual(hit, fresh);
});

test('Spokane: one failed layer means nothing is cached', async () => {
  stub(url => spokaneLayers(url, { permits: down }));
  const result = await getSpokaneCountyIntelligence(spokaneBody, spokaneProfile);
  assert.equal(result.permitHistoryStatus, 'unavailable');
  assert.equal(store.size, 0);
});

// ---- Yellowstone zoning

function yellowstoneLayers(url, hits, failing = new Set()) {
  const m = /Zoning\/MapServer\/(\d+)\/query/.exec(url.pathname);
  if (!m) throw new Error(`unexpected ${url.pathname}`);
  const key = `${m[1]}:${url.searchParams.get('geometryType') === 'esriGeometryPolygon' ? 'polygon' : 'point'}`;
  if (failing.has(key)) return down();
  return features(hits[key] ? [hits[key]] : []);
}
const ysBody = { lat: 45.7805, lon: -108.4995, geometry: square(-108.5, 45.78) };

test('Yellowstone: a full answer is cached without owner fields; a failed layer caches nothing', async () => {
  stub(url => yellowstoneLayers(url, { '7:point': { JURISDICTION: 'Yellowstone County', OWNER: 'TEST OWNER' }, '2:point': { ZONE: 'A-1', ZONE_NAME: 'Agricultural Open Space', OwnerName: 'TEST OWNER' } }));
  const fresh = await getYellowstoneCountyIntelligence(ysBody);
  assert.equal(store.size, 1);
  assertNoPersonalData(stored()[0].value);
  assert.deepEqual(stored()[0].value.value, fresh);

  store.clear();
  stub(url => yellowstoneLayers(url, {}, new Set(['4:point', '8:polygon'])));
  await getYellowstoneCountyIntelligence({ ...ysBody, lat: 45.79 });
  assert.equal(store.size, 0);
});

// ---- Gallatin zoning

test('Gallatin: a zoning answer is cached without owner fields; an HTTP or ArcGIS error caches nothing', async () => {
  stub(() => features([{ ZONING: 'AS', ZONE_NAME: 'Agricultural Suburban', OWNER1: 'TEST OWNER' }]));
  await getGallatinCountyIntelligence({ lat: 45.68, lon: -111.05 });
  assert.equal(store.size, 1);
  assertNoPersonalData(stored()[0].value);

  for (const route of [down, () => json({ error: { code: 400, message: 'Invalid geometry' } })]) {
    store.clear();
    stub(route);
    await getGallatinCountyIntelligence({ lat: 45.69, lon: -111.06 }).catch(() => {});
    assert.equal(store.size, 0);
  }
});

// ---- Montana parcels: cached again now that the answers carry no owner fields

test('Montana and Yellowstone parcel answers are cached without owner fields; a hit answers the same', async () => {
  const mt = { type: 'Feature', geometry: square(-111.05, 45.68), properties: { PARCELID: '06079821101010000', OwnerName: 'TEST OWNER', OwnerAddress1: '1 MAIL ST', CareOfTaxpayer: 'TEST OWNER', COUNTY_NM: 'Gallatin' } };
  stub(() => geojson([mt]));
  const parcel = await findMontanaParcel('06079821101010000', 'Gallatin');
  assertNoPersonalData(parcel);
  assert.equal(parcel.properties.PARCELID, '06079821101010000');
  assert.equal(store.size, 1);
  assert.ok(stored()[0].key.startsWith(MONTANA_PARCEL_CACHE_PREFIX));
  assertNoPersonalData(stored()[0].value);
  const before = calls.length;
  assert.deepEqual(await findMontanaParcel('06079821101010000', 'Gallatin'), parcel, 'a cache hit answers the same');
  assert.equal(calls.length, before, 'answered from the cache');

  store.clear();
  stub(() => geojson([{ ...mt, properties: { GEOCODE: '03103323101010000', OWNER: 'TEST OWNER', OWNER_NAME: 'TEST OWNER', MAILADDRESS1: '1 MAIL ST', MAILCITY: 'BILLINGS' } }]));
  assertNoPersonalData(await findYellowstoneParcel('03103323101010000'));
  assert.equal(store.size, 1);
  assertNoPersonalData(stored()[0].value);

  store.clear();
  stub(() => down());
  await findMontanaParcel('06079821101010000', 'Gallatin').catch(() => {});
  stub(() => geojson([]));
  await findMontanaParcel('06079821101010000', 'Gallatin').catch(() => {});
  assert.equal(store.size, 0, 'failed and empty answers are not cached');
});

// ---- Idaho parcels

const statewide = id => ({ type: 'Feature', geometry: square(-116.2, 43.6), properties: { PARCEL_ID: id, County: 'Ada', OWNER1: 'TEST OWNER', OWNER2: '', PUBLIC_STD: 'TEST OWNER', MAIL_ADD1: '1 MAIL ST', MAIL_CITY: 'BOISE', SITE_ADD: '1 SITE RD' } });

test('Idaho (not Kootenai): statewide answers are cached without owner fields; a hit answers the same', async () => {
  stub(() => geojson([statewide('R1234560010')]));
  const parcel = await findIdahoParcel('R1234560010', 'Ada');
  assertNoPersonalData(parcel);
  assert.equal(parcel.properties.SITUS_ADDRESS, '1 SITE RD');
  assert.equal(store.size, 1);
  assert.ok(stored()[0].key.startsWith(IDAHO_PARCEL_CACHE_PREFIX));
  assertNoPersonalData(stored()[0].value);
  const before = calls.length;
  assert.deepEqual(await findIdahoParcel('R1234560010', 'Ada'), parcel, 'a cache hit answers the same');
  assert.equal(calls.length, before, 'answered from the cache');
});

test('Idaho Kootenai fallbacks: statewide and IDWR answers are cached without owner fields', async () => {
  const kStatewide = { ...statewide('47N03W052200'), properties: { ...statewide('47N03W052200').properties, County: 'Kootenai' } };
  stub(url => (url.hostname === 'map.kcgov.us' ? json({ features: [] }) : url.pathname.includes('Public_Idaho_Parcels_') ? geojson([kStatewide]) : geojson([])));
  const fresh = await findIdahoParcel('47N03W052200', 'Kootenai');
  assertNoPersonalData(fresh.properties);
  const idaho = stored().filter(s => s.key.startsWith(IDAHO_PARCEL_CACHE_PREFIX));
  assert.equal(idaho.length, 1);
  assertNoPersonalData(idaho[0].value);
  assert.equal(idaho[0].value.value[0].properties.SITE_ADD, '1 SITE RD');
  const hit = await findIdahoParcel('47N03W052200', 'Kootenai');
  assert.deepEqual(hit, fresh, 'a cache hit answers the same');

  store.clear();
  const idwr = { type: 'Feature', geometry: square(-116.6, 47.3), properties: { PIN: '47N03W052200', COUNTY: 'Kootenai', OWNER: 'TEST OWNER' } };
  stub(url => (url.hostname === 'map.kcgov.us' ? json({ features: [] }) : url.hostname === 'gis.idwr.idaho.gov' ? geojson([idwr]) : geojson([])));
  await findIdahoParcel('47N03W052200', 'Kootenai');
  const cached = stored().filter(s => s.key.startsWith(IDAHO_PARCEL_CACHE_PREFIX));
  assert.equal(cached.length, 1, 'only the IDWR hit; empty statewide answers are not cached');
  assertNoPersonalData(cached[0].value);
});

test('Idaho Kootenai fallbacks: failed, rate-limited and empty answers are not cached', async () => {
  stub(url => (url.hostname === 'map.kcgov.us' ? down() : url.pathname.includes('Public_Idaho_Parcels_') ? json({ error: { code: 429, message: 'Too many requests.' } }) : down()));
  await findIdahoParcel('47N03W052200', 'Kootenai').catch(() => {});
  assert.equal(store.size, 0);
});

test('Kootenai county parcel layer: only the search fields are cached, even if the server sends owner fields', async () => {
  const ring = [[-116.6, 47.3], [-116.6, 47.31], [-116.59, 47.31], [-116.59, 47.3], [-116.6, 47.3]];
  const attributes = { PIN: '47N03W052200', PID: '47N03W-05-2200', Acres: 2.9, Loc_Addr: '1 SITE RD', Loc_City: 'HARRISON', Name: 'TEST OWNER', Owner_Primary: 'TEST OWNER', DeliveryAddr_Primary: '1 MAIL ST', Legal: 'LOT 1' };
  stub(url => (url.hostname === 'map.kcgov.us' ? json({ features: [{ attributes, geometry: { rings: [ring] } }] }) : geojson([])));
  const fresh = await findIdahoParcel('47N03W052200', 'Kootenai');
  const cached = stored().filter(s => s.key.startsWith(KC_PARCEL_CACHE_PREFIX));
  assert.equal(cached.length, 1);
  assertNoPersonalData(cached[0].value);
  assert.deepEqual(Object.keys(cached[0].value.value[0].attributes), ['PIN', 'PID', 'Acres', 'Loc_Addr', 'Loc_City']);
  assertNoPersonalData(fresh.properties);
  const before = calls.length;
  assert.deepEqual(await findIdahoParcel('47N03W052200', 'Kootenai'), fresh, 'a cache hit answers the same');
  assert.equal(calls.length, before);
});
