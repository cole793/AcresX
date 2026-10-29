// Offline tests for /api/parcel-search in Idaho: Kootenai from the county Ownership_Display layer
// (src/counties/kootenai-parcels.js) with statewide and IDWR fallbacks
// (src/states/idaho/parcels.js), and every other county/state unchanged. fetch is stubbed;
// county fixtures were recorded from map.kcgov.us on 2026-10-27.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { esriPolygonToGeoJSON, mapKootenaiParcel, KC_PARCEL_LAYER, KC_PARCEL_SEARCH_FIELDS } from '../src/counties/kootenai-parcels.js';
import { RATE_LIMIT_RETRY_MS } from '../src/states/idaho/parcels.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { runParcelScenarios, kootenaiIdwrScenario, idwrFeature } from './parcel-search-scenarios.js';

const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const countyHit = fixture('kootenai-parcel-47N03W052200.json');
const countyMultipart = fixture('kootenai-parcel-47N02W040800.json');
const legacySnapshot = fixture('parcel-search-legacy-snapshot.json');
const idwrBase = fixture('parcel-search-kootenai-idwr-base.json');

const COUNTY = `${KC_PARCEL_LAYER}/query`;
const STATEWIDE = 'Public_Idaho_Parcels_/FeatureServer/7/query';
const IDWR = 'gis.idwr.idaho.gov';
// Every property the frontend (public/*.js, public/index.html) or scripts/validate-county.mjs reads
// from a parcel-search answer that the statewide/IDWR path filled.
const FRONTEND_PROPS = ['ORIG_PARCEL_ID', 'PARCEL_ID_NR', 'SITUS_ADDRESS', 'SITUS_CITY_NM', 'SITUS_ZIP_NR', '_countyDisplay', 'COUNTY_NM', 'DATA_LINK', '_stateCode', '_stateDisplay'];
const OWNER_KEY = /owner|^name$|mail|recipient|attention|deliveryaddr|lastline/i;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const geojson = features => json({ type: 'FeatureCollection', features });
const tooMany = () => json({ error: { code: 429, message: 'Unable to perform query. Too many requests.', details: [] } });

let calls;
// handlers: { county, statewide, idwr } -> (params, nth call to that source) => Response | throw
function stub(handlers) {
  calls = [];
  globalThis.fetch = async input => {
    const url = String(input instanceof Request ? input.url : input);
    const params = new URL(url).searchParams;
    const source = url.startsWith(COUNTY) ? 'county' : url.includes(STATEWIDE) ? 'statewide' : url.includes(IDWR) ? 'idwr' : 'other';
    calls.push({ source, params });
    const handler = handlers[source];
    if (!handler) throw new Error(`unexpected request to ${source}: ${url}`);
    return handler(params, calls.filter(c => c.source === source).length);
  };
}
const callsTo = source => calls.filter(c => c.source === source);

async function search(parcelId, county = 'Kootenai') {
  const request = new Request('https://acresx.test/api/parcel-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'ID', county, parcelId }) });
  const response = await worker.fetch(request, { ASSETS: { fetch: async () => new Response('') } }, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
function assertNoOwnerFields(properties) {
  for (const key of Object.keys(properties)) assert.doesNotMatch(key, OWNER_KEY, `owner field ${key} must not be returned`);
  assert.doesNotMatch(JSON.stringify(properties), /TEST OWNER|1 MAIL ST/);
}

const realFetch = globalThis.fetch;
const realWarn = console.warn;
const realRetry = RATE_LIMIT_RETRY_MS.value;
let restoreUpstream;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; console.warn = () => {}; RATE_LIMIT_RETRY_MS.value = 1; restoreUpstream = configureUpstream({ backoffMs: 0 }); });
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; RATE_LIMIT_RETRY_MS.value = realRetry; restoreUpstream(); });

// --- County layer hit ---------------------------------------------------------------------------

test('Kootenai parcel comes from the county layer with the statewide property names', async () => {
  stub({ county: () => json(countyHit) });
  const { status, body } = await search('47N03W052200');
  assert.equal(status, 200);
  assert.equal(body.available, true); assert.equal(body.state, 'ID'); assert.equal(body.county, 'Kootenai');
  const { type, geometry, properties: p } = body.parcel;
  assert.equal(type, 'Feature');
  assert.equal(geometry.type, 'Polygon');
  for (const key of FRONTEND_PROPS) assert.ok(key in p, `missing ${key}`);
  assert.equal(p.ORIG_PARCEL_ID, '47N03W052200'); assert.equal(p.PARCEL_ID_NR, '47N03W052200');
  assert.equal(p.PIN, '47N03W052200'); assert.equal(p.PID, '47N03W-05-2200');
  assert.equal(p.COUNTY_NM, 'Kootenai'); assert.equal(p._countyDisplay, 'Kootenai');
  assert.equal(p.ACRES, 2.888);
  assert.equal(p._source.url, KC_PARCEL_LAYER);
  // One request, nothing sent to the rate-limited statewide layer.
  assert.equal(calls.length, 1);
  const params = callsTo('county')[0].params;
  assert.equal(params.get('where'), "PIN='47N03W052200' OR PID='47N03W052200'");
  assert.equal(params.get('outFields'), 'PIN,PID,Acres,Loc_Addr,Loc_City');
  assert.equal(params.get('outSR'), '4326'); assert.equal(params.get('returnGeometry'), 'true'); assert.equal(params.get('f'), 'json');
});

test('the county answer keeps every property key the IDWR-based answer had, minus owner/internal fields', async () => {
  stub({ county: () => json(countyHit) });
  const { body } = await search('47N03W052200');
  const before = Object.keys(idwrBase.body.parcel.properties).filter(k => !['OWNER', 'OBJECTID', 'Shape__Area', 'Shape__Length'].includes(k));
  for (const key of before) assert.ok(key in body.parcel.properties, `lost ${key}`);
  assert.deepEqual(Object.keys(body).sort(), Object.keys(idwrBase.body).sort());
  assert.equal(body.parcel.properties.SITUS_ADDRESS, ''); assert.equal(body.parcel.properties._assessment.categories, '');
});

test('dashed PID and lower case find the same county parcel; quotes are escaped', async () => {
  stub({ county: () => json(countyHit) });
  const { status, body } = await search('47n03w-05-2200');
  assert.equal(status, 200);
  assert.equal(body.parcel.properties.ORIG_PARCEL_ID, '47N03W052200');
  assert.equal(callsTo('county')[0].params.get('where'), "PIN='47N03W-05-2200' OR PID='47N03W-05-2200'");
  stub({ county: () => json({ features: [] }), statewide: () => geojson([]), idwr: () => geojson([]) });
  await search("47N03W' OR '1'='1");
  assert.equal(callsTo('county')[0].params.get('where'), "PIN='47N03W'' OR ''1''=''1' OR PID='47N03W'' OR ''1''=''1'");
});

test('a county row whose PIN/PID does not match the input exactly is ignored', async () => {
  const other = { features: [{ ...countyHit.features[0], attributes: { ...countyHit.features[0].attributes, PIN: '47N03W052201', PID: '47N03W-05-2201' } }] };
  stub({ county: () => json(other), statewide: () => geojson([]), idwr: () => geojson([idwrFeature]) });
  const { body } = await search('47N03W052200');
  assert.equal(body.parcel.properties._source.url.includes('idwr'), true);
});

test('real multipart county parcel (4 rings) becomes a MultiPolygon with CCW outer rings', async () => {
  stub({ county: () => json(countyMultipart) });
  const { body } = await search('47N02W040800');
  const g = body.parcel.geometry;
  assert.equal(g.type, 'MultiPolygon');
  assert.equal(g.coordinates.length, 4);
  for (const polygon of g.coordinates) { assert.equal(polygon.length, 1); assert.ok(ringSignedArea(polygon[0]) > 0, 'outer ring must be CCW'); }
  assert.equal(body.parcel.properties.SITUS_ADDRESS, '31645 S HIGHWAY 3');
  assert.equal(body.parcel.properties.SITUS_CITY_NM, 'ST MARIES');
});

test('several county rows for one PIN merge into one outline; two PINs are ambiguous and final', async () => {
  const [f] = countyHit.features;
  stub({ county: () => json({ features: [f, { ...f, geometry: { rings: [[[-116, 47], [-116, 47.001], [-115.999, 47.001], [-115.999, 47], [-116, 47]]] } }] }) });
  const merged = await search('47N03W052200');
  assert.equal(merged.body.parcel.geometry.type, 'MultiPolygon');
  assert.equal(merged.body.parcel.geometry.coordinates.length, 2);
  stub({ county: () => json({ features: [f, f, structuredClone(f)] }) });
  const duplicates = await search('47N03W052200');
  assert.equal(duplicates.body.parcel.geometry.type, 'Polygon', 'duplicate rows must not double the outline');
  stub({ county: () => json({ features: [f, { ...f, attributes: { ...f.attributes, PIN: '47N03W-05-2200' } }, { ...f, attributes: { ...f.attributes, PIN: 'OTHERPIN', PID: '47N03W052200' } }] }) });
  const ambiguous = await search('47N03W052200');
  assert.equal(ambiguous.status, 502);
  assert.match(ambiguous.body.error, /Multiple Idaho parcels match/);
  assert.equal(callsTo('statewide').length + callsTo('idwr').length, 0);
});

// --- Fallbacks ----------------------------------------------------------------------------------

test('county miss falls back to the statewide layer, then IDWR', async () => {
  stub({ county: () => json({ features: [] }), statewide: () => geojson([]), idwr: () => geojson([idwrFeature]) });
  const { status, body } = await search('47N03W052200');
  assert.equal(status, 200);
  assert.equal(body.parcel.properties.ORIG_PARCEL_ID, '47N03W052200');
  assert.match(body.parcel.properties._source.name, /IDWR/);
  assert.equal(callsTo('county').length, 1);
  assert.equal(callsTo('statewide').length, 3); // same three statewide queries as before
  assert.equal(callsTo('idwr').length, 1);
  assertNoOwnerFields(body.parcel.properties);
});

test('county miss answered by the statewide layer: owner and mailing fields are dropped', async () => {
  const statewide = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-116.6, 47.3], [-116.59, 47.3], [-116.59, 47.31], [-116.6, 47.3]]] }, properties: { PARCEL_ID: '47N03W052200', County: 'Kootenai', OWNER1: 'TEST OWNER', OWNER2: 'TEST OWNER 2', PUBLIC_STD: 'TEST OWNER', MAIL_ADD1: '1 MAIL ST', MAIL_CITY: 'X', MAIL_STATE: 'ID', MAIL_ZIP: '1', MAIL_CNTRY: 'US', SITE_ADD: '9 SITE RD', SITE_CITY: 'HARRISON', SITE_ZIP: '83833', ASR_ACRES: 2.9, WEBSITE: 'https://example.test', VAL_LAND: 1, VAL_IMPVTS: 2, VAL_TOTAL: 3 } };
  stub({ county: () => json({ features: [] }), statewide: () => geojson([statewide]) });
  const { body } = await search('47N03W052200');
  const p = body.parcel.properties;
  assert.equal(p.SITUS_ADDRESS, '9 SITE RD'); assert.equal(p.SITUS_ZIP_NR, '83833'); assert.equal(p.ACRES, 2.9);
  assert.match(p._source.name, /statewide/);
  assertNoOwnerFields(p);
  assert.equal(callsTo('idwr').length, 0);
});

test('county error falls back; the IDWR answer matches the pre-change answer minus OWNER, plus _source', async () => {
  const { reply } = kootenaiIdwrScenario; // county 502, statewide empty, IDWR hit
  stub({ county: () => reply('other', '', 0, KC_PARCEL_LAYER), statewide: () => geojson([]), idwr: () => geojson([idwrFeature]) });
  const { status, body } = await search('47N03W052200');
  assert.equal(status, idwrBase.status);
  const expected = structuredClone(idwrBase.body);
  delete expected.parcel.properties.OWNER;
  expected.parcel.properties._source = { name: 'IDWR statewide parcel compilation', url: 'https://gis.idwr.idaho.gov/hosting/rest/services/Reference/Parcels/FeatureServer/0' };
  assert.deepEqual(body, expected);
});

test('county ArcGIS error body and network error also fall back', async () => {
  for (const county of [() => json({ error: { code: 500, message: 'Failed to execute query.' } }), () => { throw new Error('connect ECONNREFUSED'); }]) {
    stub({ county, statewide: () => geojson([]), idwr: () => geojson([idwrFeature]) });
    const { status, body } = await search('47N03W052200');
    assert.equal(status, 200);
    assert.equal(body.parcel.properties.PIN, '47N03W052200');
  }
});

test('statewide rate limit (429 body or HTTP 429) is retried once', async () => {
  for (const limited of [tooMany, () => new Response('slow down', { status: 429 })]) {
    stub({ county: () => json({ features: [] }), statewide: (params, n) => n === 1 ? limited() : geojson([]), idwr: () => geojson([idwrFeature]) });
    const { status } = await search('47N03W052200');
    assert.equal(status, 200);
    assert.equal(callsTo('statewide').length, 4); // first query twice, then the other two
    assert.equal(callsTo('statewide')[0].params.get('where'), callsTo('statewide')[1].params.get('where'));
  }
});

test('statewide still rate-limited after the retry: Kootenai moves on to IDWR', async () => {
  stub({ county: () => json({ features: [] }), statewide: tooMany, idwr: () => geojson([idwrFeature]) });
  const { status, body } = await search('47N03W052200');
  assert.equal(status, 200);
  assert.equal(callsTo('statewide').length, 2);
  assert.equal(body.parcel.properties.PIN, '47N03W052200');
});

test('other Idaho counties retry a statewide rate limit once, then report it', async () => {
  stub({ statewide: tooMany });
  const { status, body } = await search('R1234560010', 'Ada');
  assert.equal(status, 502);
  assert.deepEqual(body, { error: 'Unable to perform query. Too many requests.' });
  assert.equal(callsTo('statewide').length, 2);
});

test('all Kootenai sources miss: the same not-found error as before', async () => {
  stub({ county: () => json({ features: [] }), statewide: () => geojson([]), idwr: () => geojson([]) });
  const { status, body } = await search('NOPE00000000');
  assert.equal(status, 502);
  assert.deepEqual(body, { error: 'Parcel not found in available Idaho parcel sources. Confirm the county and assessor parcel number.' });
});

test('all Kootenai sources fail: 502 with an error string naming each failure', async () => {
  stub({ county: () => new Response('', { status: 503 }), statewide: tooMany, idwr: () => new Response('', { status: 500 }) });
  const { status, body } = await search('47N03W052200');
  assert.equal(status, 502);
  // The only addition: the county layer's 503 lets the browser try it (src/shared/fallback.js).
  assert.deepEqual(Object.keys(body), ['error', 'fallback']);
  assert.deepEqual(body.fallback, { mode: 'browser', kind: 'kootenai-parcel', input: { parcelId: '47N03W052200' } });
  assert.match(body.error, /Kootenai County parcel layer returned 503/);
  assert.match(body.error, /Too many requests/);
  assert.match(body.error, /returned 500/);
});

// --- Shared upstream client (src/shared/upstream.js) -------------------------------------------

test('county parcel layer: one attempt (the fallbacks are the retry), labelled log line, no cf', async () => {
  const logs = [], inits = [];
  const restore = configureUpstream({ log: line => logs.push(JSON.parse(line)) });
  try {
    stub({ county: () => json({ error: { code: 500, message: 'Failed to execute query.' } }), statewide: () => geojson([]), idwr: () => new Response('', { status: 500 }) });
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init) => { inits.push(init || {}); return inner(input, init); };
    const { status, body } = await search('47N03W052200');
    assert.equal(status, 502);
    assert.match(body.error, /Kootenai County parcel layer: Failed to execute query\./);
    assert.equal(callsTo('county').length, 1);
    assert.ok(inits.every(init => !('cf' in init)));
    const labels = new Set(logs.map(l => l.label));
    for (const label of ['kootenai-parcel-search', 'idaho-statewide-parcels', 'idwr-parcels']) assert.ok(labels.has(label), label);
    assert.deepEqual(logs.filter(l => l.label === 'kootenai-parcel-search').map(l => [l.host, l.ok, l.attempt]), [['map.kcgov.us', false, 1]]);
  } finally { restore(); }
});

test('statewide and IDWR 5xx answers are retried once by the shared client', async () => {
  stub({
    county: () => json({ features: [] }),
    statewide: (params, n) => (n === 1 ? new Response('down', { status: 500 }) : geojson([])),
    idwr: (params, n) => (n === 1 ? new Response('', { status: 503 }) : geojson([idwrFeature]))
  });
  const { status, body } = await search('47N03W052200');
  assert.equal(status, 200);
  assert.equal(callsTo('statewide').length, 4); // first query twice, then the other two
  assert.equal(callsTo('idwr').length, 2);
  assert.equal(callsTo('idwr')[0].params.get('where'), callsTo('idwr')[1].params.get('where'));
  assert.match(body.parcel.properties._source.name, /IDWR/);
  assertNoOwnerFields(body.parcel.properties);
});

// --- Owner fields ------------------------------------------------------------------------------

test('owner name is never requested or returned, even if the county server sends it', async () => {
  assert.doesNotMatch(KC_PARCEL_SEARCH_FIELDS, /name|owner|mail/i);
  const [f] = countyHit.features;
  stub({ county: () => json({ features: [{ ...f, attributes: { ...f.attributes, Name: 'TEST OWNER', Owner_Primary: 'TEST OWNER', DeliveryAddr_Primary: '1 MAIL ST' } }] }) });
  const { body } = await search('47N03W052200');
  assertNoOwnerFields(body.parcel.properties);
  assert.doesNotMatch(JSON.stringify(body), /TEST OWNER|1 MAIL ST/);
});

// --- Geometry conversion -----------------------------------------------------------------------

function ringSignedArea(ring) { let s = 0; for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return s / 2; }
const cw = (x, y, w) => [[x, y], [x, y + w], [x + w, y + w], [x + w, y], [x, y]];   // Esri outer
const ccw = (x, y, w) => [[x, y], [x + w, y], [x + w, y + w], [x, y + w], [x, y]];  // Esri hole

test('Esri rings: outer CW -> CCW, hole CCW -> CW and attached to its outer ring', () => {
  const g = esriPolygonToGeoJSON({ rings: [cw(0, 0, 10), ccw(2, 2, 2)] });
  assert.equal(g.type, 'Polygon');
  assert.equal(g.coordinates.length, 2);
  assert.ok(ringSignedArea(g.coordinates[0]) > 0);
  assert.ok(ringSignedArea(g.coordinates[1]) < 0);
});

test('Esri rings: two parts, hole listed first, island inside a hole', () => {
  // Part A (0..10) with a hole (2..8) and an island (4..6) inside the hole; part B (20..25).
  const g = esriPolygonToGeoJSON({ rings: [ccw(2, 2, 6), cw(20, 0, 5), cw(0, 0, 10), cw(4, 4, 2)] });
  assert.equal(g.type, 'MultiPolygon');
  assert.equal(g.coordinates.length, 3);
  const byFirstX = Object.fromEntries(g.coordinates.map(p => [Math.min(...p[0].map(c => c[0])), p]));
  assert.equal(byFirstX[0].length, 2, 'part A keeps its hole');
  assert.equal(byFirstX[4].length, 1, 'island is its own polygon');
  assert.equal(byFirstX[20].length, 1);
  for (const polygon of g.coordinates) { assert.ok(ringSignedArea(polygon[0]) > 0); for (const hole of polygon.slice(1)) assert.ok(ringSignedArea(hole) < 0); }
  // The hole belongs to part A (the smallest outer ring containing it), not to the island inside it.
  assert.deepEqual(byFirstX[0][1].map(c => c.join()).sort(), ccw(2, 2, 6).map(c => c.join()).sort());
});

test('Esri rings: unclosed rings are closed, degenerate rings dropped, empty -> null', () => {
  const g = esriPolygonToGeoJSON({ rings: [cw(0, 0, 1).slice(0, 4), [[5, 5], [5, 5], [5, 5], [5, 5]]] });
  assert.equal(g.type, 'Polygon');
  assert.deepEqual(g.coordinates[0][0], g.coordinates[0].at(-1));
  assert.equal(esriPolygonToGeoJSON({ rings: [] }), null);
  assert.equal(esriPolygonToGeoJSON(null), null);
});

test('a hole whose ring touches no outer ring is kept as a polygon, not lost', () => {
  const g = esriPolygonToGeoJSON({ rings: [cw(0, 0, 1), ccw(10, 10, 1)] });
  assert.equal(g.type, 'MultiPolygon');
  for (const polygon of g.coordinates) assert.ok(ringSignedArea(polygon[0]) > 0);
});

test('mapKootenaiParcel copies named fields only', () => {
  const f = mapKootenaiParcel({ PIN: ' P1 ', PID: 'P-1', Acres: '', Loc_Addr: null, Loc_City: 'ATHOL', Name: 'TEST OWNER', Legal: 'X' }, null);
  assert.equal(f.properties.PIN, 'P1'); assert.equal(f.properties.ACRES, null); assert.equal(f.properties.SITUS_ADDRESS, '');
  assert.ok(!('Name' in f.properties)); assert.ok(!('Legal' in f.properties));
});

// --- Everything outside Kootenai is unchanged --------------------------------------------------

// The shared upstream client retries a failed request once (timeout, network, 5xx), so a
// scenario whose upstream fails now sends that request twice in a row; answers are unchanged.
const withoutRetries = results => results.map(r => ({ ...r, requests: r.requests.filter((q, i) => i === 0 || JSON.stringify(q) !== JSON.stringify(r.requests[i - 1])) }));
test('other Idaho counties and Montana answer exactly as before (snapshot from 2d12331)', async () => {
  const now = await runParcelScenarios(worker);
  assert.deepEqual(withoutRetries(now), withoutRetries(legacySnapshot));
  const ada500 = now.find(r => r.name === 'Ada upstream 500');
  assert.equal(ada500.requests.length, 2, 'one shared-client retry of the failing statewide query');
  assert.deepEqual(ada500.requests[0], ada500.requests[1]);
  assert.deepEqual(ada500.body, legacySnapshot.find(r => r.name === 'Ada upstream 500').body);
});
