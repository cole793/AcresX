// No owner names or mailing addresses leave the Worker (owner decision, 2026-10-29).
//
// Every /api/* route runs against a stubbed fetch whose answers carry owner and mailing fields
// (the field names the county, state and well layers really use; the values are placeholders).
// No response body, and no Cache API write, may contain one of those field names or values.
// caches.default is faked; fetch is stubbed (no network).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { PERSONAL_FIELD, withoutPersonalFields, responseWithoutPersonalFields } from '../src/shared/personal-fields.js';
import { RATE_LIMIT_RETRY_MS } from '../src/states/idaho/parcels.js';

// Owner and mailing fields as the upstream layers name them, with placeholder values.
const PLANTED = {
  OwnerName: 'PLACEHOLDER OWNER', OwnerAddress1: '1 PLACEHOLDER MAIL ST', OwnerAddress2: 'PLACEHOLDER UNIT', OwnerAddress3: '',
  OwnerCity: 'PLACEHOLDER CITY', OwnerState: 'MT', OwnerZipCode: '00000', CareOfTaxpayer: 'PLACEHOLDER CARE OF', // Montana cadastral
  OWNER: 'PLACEHOLDER OWNER', OWNER_NAME: 'PLACEHOLDER OWNER', MAILADDRESS1: '1 PLACEHOLDER MAIL ST', MAILCITY: 'PLACEHOLDER CITY', MAILZIP: '00000', // Yellowstone, IDWR parcels
  OWNER1: 'PLACEHOLDER OWNER', OWNER2: 'PLACEHOLDER OWNER TWO', PUBLIC_STD: 'PLACEHOLDER OWNER', MAIL_ADD1: '1 PLACEHOLDER MAIL ST', MAIL_CITY: 'PLACEHOLDER CITY', MAIL_ZIP: '00000', // Idaho statewide
  Owner: 'PLACEHOLDER OWNER', // IDWR wells
  owner_name: 'PLACEHOLDER OWNER', taxpayer_name: 'PLACEHOLDER TAXPAYER', // Spokane assessor
  Owner_Primary: 'PLACEHOLDER OWNER', Recipient_Primary: 'PLACEHOLDER OWNER', DeliveryAddr_Primary: '1 PLACEHOLDER MAIL ST', LastLine_Primary: 'PLACEHOLDER CITY' // Kootenai assessor
};
const PLANTED_VALUE = /PLACEHOLDER/;
// Derived well-match evidence (booleans and a 0-100 score, no names) that keeps its key.
const ALLOWED_KEYS = new Set(['ownerMatch', 'ownerSimilarity']);

const PARCEL = 'P1234567';
const LON = -117.4, LAT = 47.6;
const ring = [[LON, LAT], [LON + 0.002, LAT], [LON + 0.002, LAT + 0.002], [LON, LAT + 0.002], [LON, LAT]];
const polygon = { type: 'Polygon', coordinates: [ring] };

// Attributes that let each route find something (every parcel id field is the test parcel), plus
// the planted owner and mailing fields.
const attributes = {
  OBJECTID: 1, PARCELID: PARCEL, Geocode: PARCEL, GEOCODE: PARCEL, GEO_CODE: PARCEL, TAX_ID: PARCEL, PARCEL_ID: PARCEL, PIN: PARCEL, PID: PARCEL, PID_NUM: PARCEL,
  ParcelNumber: PARCEL, County: 'Ada', COUNTY: 'Kootenai', SITE_ADD: '100 SITE RD', AddressLine1: '100 SITE RD', site_address: '100 SITE RD',
  ZONECLASS: 'RR-5', ZONEDESC: 'Rural Residential 5', ZONING: 'AS', ZONE: 'A-1', ZONE_NAME: 'Agricultural', JURISDICTION: 'Test County', NAME: 'TEST UTILITY',
  PERMITNUM: 'B-1', PERMITTYPE: 'Residential', WellTagNr: 'BAA123', WellID: 5, TotalDepth: 200, CompletedDepth: 200, WellUse: 'Domestic',
  gwicid: 1000, total_depth_ft_bgs: 150, VAL_TOTAL: 1000, TotalValue: 1000, FLD_ZONE: 'X', WETLAND_TYPE: 'Freshwater Emergent Wetland',
  ...PLANTED
};
const esriFeature = { attributes, geometry: { x: LON + 0.001, y: LAT + 0.001, rings: [ring], spatialReference: { wkid: 4326 } } };
const geoFeature = { type: 'Feature', id: 1, geometry: polygon, properties: attributes };

const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
function params(url, init) {
  const out = new URLSearchParams(url.search);
  const body = init?.body;
  if (body instanceof URLSearchParams) for (const [k, v] of body) out.set(k, v);
  else if (typeof body === 'string' && !body.trim().startsWith('{')) for (const [k, v] of new URLSearchParams(body)) out.set(k, v);
  return out;
}
// Personal fields named in an upstream request's outFields, as `host/path: field`.
const requestedPersonal = [];
// A layer answers with the fields asked for (all of them for outFields '*'), like ArcGIS does.
function askedFor(p, url) {
  const asked = p.get('outFields');
  // GWIC site names are the well owner's name; only that layer has the field.
  const layer = url.hostname === 'mbmgmap.mtech.edu' ? { ...attributes, site_name: 'PLACEHOLDER OWNER * TOWN MT' } : attributes;
  if (!asked || asked === '*') return layer;
  const exact = asked.split(',').map(s => s.trim()), names = exact.map(s => s.toLowerCase());
  for (const name of Object.keys(PLANTED)) if (exact.includes(name)) requestedPersonal.push(`${url.hostname}${url.pathname}: ${name}`);
  if (exact.includes('site_name') && layer !== attributes) requestedPersonal.push(`${url.hostname}${url.pathname}: site_name`);
  return Object.fromEntries(Object.entries(layer).filter(([k]) => names.includes(k.toLowerCase())));
}
function reply(input, init) {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const p = params(url, init);
  if (url.hostname === 'sdmdataaccess.sc.egov.usda.gov') return json({ Table: [['mukey', 'muname'], ['1', 'Test loam']], ...PLANTED });
  if (url.hostname === 'google.serper.dev') return json({ organic: [{ title: `100 SITE RD ${PARCEL} land for sale`, link: 'https://listing.example/1', snippet: 'Power on site. Well installed.', ...PLANTED }] });
  if (/\/query$/.test(url.pathname) || /identify$/.test(url.pathname)) {
    const attrs = askedFor(p, url);
    return json(p.get('f') === 'geojson'
      ? { type: 'FeatureCollection', features: [{ ...geoFeature, properties: attrs }], ...PLANTED }
      : { features: [{ ...esriFeature, attributes: attrs }], results: [{ attributes: attrs }], ...PLANTED });
  }
  return json({ value: 1000, elements: [], results: [], features: [esriFeature], ...PLANTED });
}

const env = { ASSETS: { fetch: async () => new Response('<html><body></body></html>', { headers: { 'Content-Type': 'text/html' } }) }, SERPER_API_KEY: 'test-key-not-real' };
const waits = [];
const ctx = { waitUntil(promise) { waits.push(Promise.resolve(promise).catch(() => {})); } };
const post = (path, body) => new Request(`https://acresx.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = path => new Request(`https://acresx.test${path}`);

const point = { lat: LAT + 0.001, lon: LON + 0.001 };
const parcel = { parcelId: PARCEL, geometry: polygon, address: '100 SITE RD', ...point };
// [label, request, expectation on the parsed body (optional; checks the route really ran)]
const CASES = [
  ['upstream-health', get('/api/upstream-health')],
  ['property-tax-test GET', get('/api/property-tax-test')],
  ['property-tax-test POST MT', post('/api/property-tax-test', { state: 'MT', county: 'Yellowstone', parcelId: PARCEL })],
  ['property-assessment WA', post('/api/property-assessment', { state: 'WA', county: 'Spokane', parcelId: PARCEL }), b => assert.equal(b.available, true)],
  ['property-assessment MT Yellowstone', post('/api/property-assessment', { state: 'MT', county: 'Yellowstone', parcelId: PARCEL }), b => { assert.equal(b.statewideRecords.length, 1); assert.equal(b.statewideRecords[0].TotalValue, 1000); }],
  ['property-assessment MT Gallatin', post('/api/property-assessment', { state: 'MT', county: 'Gallatin', parcelId: PARCEL }), b => assert.equal(b.statewideRecords.length, 1)],
  ['property-assessment ID Kootenai', post('/api/property-assessment', { state: 'ID', county: 'Kootenai', parcelId: PARCEL })],
  ['property-assessment ID Ada', post('/api/property-assessment', { state: 'ID', county: 'Ada', parcelId: PARCEL }), b => assert.equal(b.statewideRecords.length, 1)],
  ['parcel-search MT Gallatin', post('/api/parcel-search', { state: 'MT', county: 'Gallatin', parcelId: PARCEL }), b => assert.equal(b.parcel.properties.PARCELID, PARCEL)],
  ['parcel-search MT Yellowstone', post('/api/parcel-search', { state: 'MT', county: 'Yellowstone', parcelId: PARCEL }), b => assert.equal(b.parcel.properties.GEOCODE, PARCEL)],
  ['parcel-search ID Ada', post('/api/parcel-search', { state: 'ID', county: 'Ada', parcelId: PARCEL }), b => assert.equal(b.parcel.properties.SITUS_ADDRESS, '100 SITE RD')],
  ['parcel-search ID Kootenai', post('/api/parcel-search', { state: 'ID', county: 'Kootenai', parcelId: PARCEL }), b => assert.equal(b.parcel.properties.PIN, PARCEL)],
  ['well-search MT', post('/api/well-search', { state: 'MT', ...point }), b => { assert.ok(b.wells.length > 0); assert.equal(b.wells[0].properties.ProjectName, 'Montana GWIC well'); }],
  ['well-search ID', post('/api/well-search', { state: 'ID', ...point }), b => { assert.ok(b.wells.length > 0); assert.equal(b.wells[0].properties.ProjectName, 'Domestic'); }],
  ['existing-well Spokane', post('/api/existing-well', { state: 'WA', county: 'Spokane', ...parcel }), b => { assert.equal(b.status, 'strong_match'); assert.equal(b.match.wellTag, 'BAA123'); assert.equal(b.match.evidence.ownerMatch, true, 'owner names are still compared server-side'); }],
  ['reso-listings', post('/api/reso-listings', { parcelId: PARCEL })],
  ['utility-territory', post('/api/utility-territory', point), b => assert.ok(b.matches.length > 0)],
  ['land-analysis', post('/api/land-analysis', parcel)],
  ['slope-grid', post('/api/slope-grid', parcel)],
  ['hazards wetlands', post('/api/hazards', { kind: 'wetlands', ...parcel })],
  ['hazards flood', post('/api/hazards', { kind: 'flood', ...parcel })],
  ['hazards (legacy kind)', post('/api/hazards', { kind: 'other', ...parcel })],
  ['power-intelligence', post('/api/power-intelligence', { state: 'WA', county: 'Spokane', ...parcel })],
  ['zoning-rules', post('/api/zoning-rules', { state: 'WA', county: 'Spokane', zone: 'RR-5' })],
  ['zoning-permits Spokane', post('/api/zoning-permits', { county: 'Spokane', ...parcel }), b => assert.equal(b.zoning.code, 'RR-5')],
  ['zoning-permits Yellowstone', post('/api/zoning-permits', { county: 'Yellowstone', ...parcel })],
  ['zoning-permits Gallatin', post('/api/zoning-permits', { county: 'Gallatin', ...parcel })],
  ['zoning-permits Kootenai', post('/api/zoning-permits', { county: 'Kootenai', ...parcel })],
  ['zoning-permits Stevens (legacy)', post('/api/zoning-permits', { county: 'Stevens', ...parcel })],
  ['arcgis parcel (legacy passthrough)', post('/api/arcgis', { service: 'parcel', params: { f: 'geojson', where: '1=1', outFields: '*' } }), b => assert.equal(b.features[0].properties.PARCELID, PARCEL)],
  ['arcgis wells (legacy passthrough)', post('/api/arcgis', { service: 'wells', params: { f: 'geojson', where: '1=1', outFields: '*' } }), b => assert.equal(b.features[0].properties.WellTagNr, 'BAA123')],
  ['arcgis utility (legacy passthrough)', post('/api/arcgis', { service: 'utility', params: { f: 'json', where: '1=1', outFields: '*' } }), b => assert.equal(b.features[0].attributes.NAME, 'TEST UTILITY')],
  ['listing-evidence (legacy)', post('/api/listing-evidence', { parcelId: PARCEL, address: '100 SITE RD', county: 'Spokane' })]
];

function allKeys(value, keys = []) {
  if (Array.isArray(value)) value.forEach(v => allKeys(v, keys));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.push(k); allKeys(v, keys); }
  return keys;
}
function assertNoPersonalData(value, where) {
  const planted = new Set(Object.keys(PLANTED));
  const leaked = allKeys(value).filter(k => !ALLOWED_KEYS.has(k) && (planted.has(k) || PERSONAL_FIELD.test(k)));
  assert.deepEqual([...new Set(leaked)], [], `${where}: personal field names`);
  assert.doesNotMatch(JSON.stringify(value), PLANTED_VALUE, `${where}: personal values`);
}

const realFetch = globalThis.fetch, realCaches = globalThis.caches, realWarn = console.warn, realLog = console.log, realRetry = RATE_LIMIT_RETRY_MS.value;
const cacheWrites = [];
const answers = new Map();
let restoreUpstream;

before(async () => {
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(typeof req === 'string' ? req : req.url); return hit ? new Response(hit.text, { headers: hit.headers }) : undefined; },
    async put(req, res) { const text = await res.text(); store.set(typeof req === 'string' ? req : req.url, { text, headers: res.headers }); cacheWrites.push({ key: typeof req === 'string' ? req : req.url, text }); },
    async delete() { return false; }
  } };
  globalThis.fetch = async (input, init) => reply(input, init);
  console.warn = () => {}; console.log = () => {}; RATE_LIMIT_RETRY_MS.value = 1;
  restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} });
  for (const [label, request] of CASES) {
    const response = await worker.fetch(request, env, ctx);
    answers.set(label, { status: response.status, text: await response.text() });
  }
  await Promise.all(waits);
});
after(() => {
  globalThis.fetch = realFetch; console.warn = realWarn; console.log = realLog; RATE_LIMIT_RETRY_MS.value = realRetry; restoreUpstream();
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

test('the cases cover every /api/* route the Worker serves', () => {
  const source = ['src/index.js', 'src/worker.js'].map(f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  const routes = new Set([...source.matchAll(/pathname\s*===\s*'(\/api\/[\w-]+)'/g)].map(m => m[1]));
  const covered = new Set(CASES.map(([, request]) => new URL(request.url).pathname));
  assert.ok(routes.size >= 16, `found ${routes.size} routes`);
  assert.deepEqual([...routes].filter(r => !covered.has(r)), []);
});

for (const [label, , expect] of CASES) {
  test(`${label}: no owner or mailing field in the response`, () => {
    const { text } = answers.get(label);
    let body; try { body = JSON.parse(text); } catch { body = text; }
    assertNoPersonalData(body, label);
    if (expect) expect(body);
  });
}

test('no Cache API write holds an owner or mailing field', () => {
  // Parcel searches (Montana, Idaho, Kootenai) and county zoning answers are cached.
  assert.ok(cacheWrites.length >= 4, `expected cache writes, saw ${cacheWrites.length}`);
  for (const { key, text } of cacheWrites) {
    let value; try { value = JSON.parse(text); } catch { value = text; }
    assertNoPersonalData(value, `cache ${key}`);
  }
  const prefixes = cacheWrites.map(w => w.key);
  for (const prefix of ['montana-parcels/v2/', 'idaho-parcels/v3/']) assert.ok(prefixes.some(k => k.includes(prefix)), `a ${prefix} entry was written`);
});

test('no upstream request names an owner or mailing field, except the Spokane well-match comparison', () => {
  // existing-well compares the assessor owner with the well record owner server-side and returns
  // neither (src/services/existing-well.js).
  const allowed = new Set([
    'gismo.spokanecounty.org/arcgis/rest/services/Assessor/SCOUTSimple/MapServer/0/query: owner_name',
    'gismo.spokanecounty.org/arcgis/rest/services/Assessor/SCOUTSimple/MapServer/0/query: taxpayer_name',
    'services.arcgis.com/6lCKYNJLvwTXqrmp/ArcGIS/rest/services/WR/FeatureServer/9/query: OwnerName'
  ]);
  assert.deepEqual([...new Set(requestedPersonal)].filter(r => !allowed.has(r)), []);
  assert.ok(requestedPersonal.length > 0, 'the comparison still asks for the owner names');
});

test('withoutPersonalFields also drops Montana CareOfTaxpayer', () => {
  assert.deepEqual(withoutPersonalFields({ CareOfTaxpayer: 'x', TotalValue: 1 }), { TotalValue: 1 });
});

test('responseWithoutPersonalFields keeps status and headers and leaves non-JSON alone', async () => {
  const stripped = await responseWithoutPersonalFields(new Response(JSON.stringify({ OWNER1: 'x', a: 1 }), { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }));
  assert.equal(stripped.status, 502);
  assert.equal(stripped.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await stripped.json(), { a: 1 });
  const html = await responseWithoutPersonalFields(new Response('<p>OWNER1</p>', { headers: { 'Content-Type': 'text/html' } }));
  assert.equal(await html.text(), '<p>OWNER1</p>');
});

test('the Spokane well panel no longer shows owner rows', () => {
  const ui = readFileSync(new URL('../public/existing-well.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /Current assessor owner<|Well record owner<|currentOwner|\.ownerName/);
});
