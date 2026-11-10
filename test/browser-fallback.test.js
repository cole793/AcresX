// Offline tests for public/browser-fallback.js (window.AcresXFallback), run in a node:vm context
// like test/ui-harness.js. For each kind the Worker and the browser module answer the same stubbed
// upstream (recorded fixtures where we have them) and must produce the same JSON; every browser
// request must go to an allowlisted host and never ask for owner or mailing fields. No live network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { getKootenaiCountyIntelligence } from '../src/counties/kootenai.js';
import { makeLazyContext as makeContext, makeContext as makeDomContext, makeClock, readPublic } from './ui-harness.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value)); // what the page receives (and drops vm prototypes)

const KC = 'https://map.kcgov.us/arcgis/rest/services/NewServices';
const PARCELS = `${KC}/Ownership_Display/MapServer/0/query`;
const ZONING = `${KC}/Data_Layers/MapServer/21/query`;
const CITY_LIMITS = `${KC}/Data_Layers/MapServer/18/query`;
const IMPACT = `${KC}/Data_Layers/MapServer/17/query`;
const CDA = 'https://gis.cdaid.org/server/rest/services/Share/Planning/MapServer/8/query';
const IDWR = 'https://gis.idwr.idaho.gov/hosting/rest/services/Groundwater/Wells/FeatureServer/0/query';
const ASSESSOR = id => `https://map.kcgov.us/arcgis/rest/services/Assessor_Layers/MapServer/${id}/query`;
const FEMA = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const ESRI = 'https://services5.arcgis.com/7weheFjxuNkGGiZi/arcgis/rest/services/USA_Flood_Hazard_Areas_view/FeatureServer/0/query';
const ALLOWED = ['map.kcgov.us', 'gis.cdaid.org', 'gis.postfalls.gov', 'gis.idwr.idaho.gov', 'hazards.fema.gov', 'gis.stevenscountywa.gov', 'gismo.spokanecounty.org'];

// Owner names and mailing addresses in the layers this module reads (Kootenai parcel `Name`,
// assessor *_Primary / Recipient / mailing fields, IDWR `Owner`, Idaho statewide OWNER*/MAIL_*,
// Stevens assessor file_as_na / last_name / first_name / owner_id / addr_*, Spokane owner_* / taxpayer_*).
const PERSONAL = /^(owner\w*|taxpayer\w*|name|\w*name_primary|recipient_\w*|attentionline_\w*|deliveryaddr_\w*|lastline_\w*|(city|state|postalcd|country)_primary|mail\w*|public_std|file_as\w*|(first|last)_name|addr_\w*)$/i;

// A recording fetch. handler({ base, params, n }) returns a body, a Response, or throws.
function recorder(handler) {
  const calls = [];
  const counts = new Map();
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const base = url.origin + url.pathname;
    const params = new URLSearchParams(url.search);
    if (init.body) new URLSearchParams(String(init.body)).forEach((v, k) => params.set(k, v));
    const n = (counts.get(base) || 0) + 1;
    counts.set(base, n);
    calls.push({ base, host: url.hostname, protocol: url.protocol, params, method: init.method || 'GET', credentials: init.credentials, redirect: init.redirect, headers: init.headers || {} });
    const answer = await handler({ base, params, n });
    return answer instanceof Response ? answer : new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, calls };
}
// Replays recorded answers per URL, in recorded order (the last one repeats).
const replay = responses => recorder(({ base, n }) => {
  const recorded = responses.filter(r => r.url === base);
  if (!recorded.length) throw new Error(`no recorded answer for ${base}`);
  const r = recorded[Math.min(n, recorded.length) - 1];
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const answers = map => replay(Object.entries(map).flatMap(([url, list]) => (Array.isArray(list) ? list : [list]).map(body => ({ url, status: 200, body }))));
const blocked = status => recorder(() => new Response('blocked', { status }));

// The browser module in a vm context with `fetchImpl` as the page's fetch.
function browser(fetchImpl, { before = '' } = {}) {
  const h = makeContext();
  const timer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; };
  Object.assign(h.context, { URL, URLSearchParams, AbortController, Response, Headers, fetch: fetchImpl, setTimeout: timer, clearTimeout });
  if (before) h.run(before);
  h.run(readPublic('browser-fallback.js'));
  return { h, api: h.context.AcresXFallback };
}

function assertSafe(calls) {
  assert.ok(calls.length > 0, 'expected browser requests');
  for (const c of calls) {
    assert.ok(ALLOWED.includes(c.host), `request to a host outside the allowlist: ${c.host}`);
    assert.equal(c.protocol, 'https:');
    assert.equal(c.credentials, 'omit', 'no cookies');
    assert.equal(c.redirect, 'error', 'no redirects');
    const outFields = c.params.get('outFields');
    assert.ok(outFields, `${c.base} must name its outFields`);
    assert.notEqual(outFields.trim(), '*', `${c.base} must not ask for every field`);
    for (const f of outFields.split(',')) assert.doesNotMatch(f.trim(), PERSONAL, `${c.base} asked for ${f}`);
    assert.ok(c.method === 'GET' || c.headers['Content-Type'] === 'application/x-www-form-urlencoded', 'only CORS-simple requests');
  }
}
// outFields per layer, as a set of "base outFields" strings.
const fieldLists = calls => [...new Set(calls.map(c => `${c.base} ${c.params.get('outFields')}`))].sort();

const env = { ASSETS: { fetch: async () => new Response('') } };
async function api(path, body, fetchImpl) {
  globalThis.fetch = fetchImpl;
  const response = await worker.fetch(new Request(`https://acresx.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  return response;
}
async function apiJson(path, body, fetchImpl) { const r = await api(path, body, fetchImpl); return { status: r.status, body: await r.json() }; }

const realFetch = globalThis.fetch;
const realWarn = console.warn;
let restoreUpstream;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; console.warn = () => {}; restoreUpstream = configureUpstream({ backoffMs: 0 }); });
// The Worker's Kootenai adapter does not wait for the impact-area query once a city answers, so
// let stragglers land on this test's stub, not the next test's.
afterEach(async () => { await new Promise(resolve => setTimeout(resolve, 50)); globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream(); });

// ---- Loading

test('browser fallback is injected last, after the renderers it labels', async () => {
  const html = await (await worker.fetch(new Request('https://acresx.test/'), { ASSETS: { fetch: async () => new Response(readPublic('index.html'), { headers: { 'Content-Type': 'text/html' } }) } }, {})).text();
  const scripts = [...html.matchAll(/<script src="\/([\w-]+)\.js"><\/script>/g)].map(m => m[1]);
  assert.equal(scripts.at(-1), 'browser-fallback');
  for (const renderer of ['parcel-preview', 'property-assessment', 'existing-well', 'flood-status', 'state-selector']) {
    assert.ok(scripts.indexOf(renderer) >= 0 && scripts.indexOf(renderer) < scripts.indexOf('browser-fallback'), renderer);
  }
});

test('browser fallback exposes run(kind, input) for later wiring', () => {
  const { api: fb } = browser(async () => { throw new Error('unused'); });
  assert.deepEqual([...fb.kinds], ['kootenai-parcel', 'kootenai-zoning', 'idaho-wells', 'kootenai-assessor', 'stevens-assessor', 'spokane-assessor', 'fema-flood', 'stevens-zoning']);
  assert.equal(typeof fb.run, 'function');
  assert.deepEqual([...fb.ALLOWED_HOSTS], ALLOWED);
});

// ---- Allowlist and input checks

test('browser fallback: requests outside the allowlist are refused before fetch', async () => {
  const rec = recorder(() => ({ features: [] }));
  const { api: fb } = browser(rec.fetch);
  for (const url of ['https://evil.example/arcgis/rest/services/x/query', 'http://map.kcgov.us/arcgis/rest/services/x/query', 'https://map.kcgov.us:8443/x', 'https://user:pw@map.kcgov.us/x', 'https://map.kcgov.us.evil.example/x', 'not a url']) {
    await assert.rejects(fb._request(url, { outFields: 'PIN' }, { agency: 'x' }), /not allowed|invalid URL/, url);
  }
  assert.equal(rec.calls.length, 0);
});

test('browser fallback: unknown kinds and bad input never reach the network', async () => {
  const rec = recorder(() => ({ features: [] }));
  const { api: fb } = browser(rec.fetch);
  await assert.rejects(fb.run('spokane-zoning', {}), /unknown kind/);
  await assert.rejects(fb.run('stevens-zoning', { lat: 48.2, lon: -117.9 }), /no Stevens answer/);
  await assert.rejects(fb.run('stevens-zoning', { lat: 95, lon: -117.9 }, { base: { county: 'Stevens' } }), /bad point/);
  await assert.rejects(fb.run('__proto__', {}), /unknown kind/);
  await assert.rejects(fb.run('kootenai-zoning', { parcelId: "1' OR 1=1 --" }), /bad parcel number/);
  await assert.rejects(fb.run('kootenai-assessor', { parcelId: '' }), /parcel number required/);
  await assert.rejects(fb.run('idaho-wells', { lat: 95, lon: -116 }), /bad point/);
  await assert.rejects(fb.run('idaho-wells', { lat: '47.7', lon: null }), /bad point/);
  await assert.rejects(fb.run('fema-flood', { geometry: { type: 'Polygon', coordinates: [[['x', 1]]] } }), /bad geometry/);
  await assert.rejects(fb.run('fema-flood', { geometry: { type: 'Point', coordinates: [1, 2] } }), /bad geometry/);
  assert.equal(rec.calls.length, 0);
});

test('browser fallback: a hint never chooses the URL, and must match the route', async () => {
  const rec = recorder(({ base }) => (base === FEMA ? fixture('fema-nfhl-flood.json') : { features: [] }));
  const { api: fb } = browser(rec.fetch);
  const geometry = { type: 'Polygon', coordinates: [[[-116.8, 47.7], [-116.79, 47.7], [-116.79, 47.71], [-116.8, 47.7]]] };
  const hinted = (kind, input) => new Response(JSON.stringify({ available: false, fallback: { mode: 'browser', kind, input } }), { status: 502, headers: { 'Content-Type': 'application/json' } });

  // Route /api/zoning-permits only accepts kootenai-zoning; anything else is left alone.
  const mismatched = hinted('fema-flood', { geometry });
  assert.equal(await fb.recover('/api/zoning-permits', mismatched), mismatched);
  const otherOrigin = hinted('fema-flood', { geometry });
  assert.equal(await fb.recover('https://elsewhere.example/api/hazards', otherOrigin), otherOrigin);
  const notBrowser = new Response(JSON.stringify({ fallback: { mode: 'server', kind: 'fema-flood', input: { geometry } } }), { headers: { 'Content-Type': 'application/json' } });
  assert.equal(await fb.recover('/api/hazards', notBrowser), notBrowser);
  assert.equal(rec.calls.length, 0);

  // URL-looking input is ignored: the query goes to the hard-coded FEMA layer only.
  const recovered = await fb.recover('/api/hazards', hinted('fema-flood', { geometry, url: 'https://evil.example/x', layer: 'https://evil.example/y' }));
  assert.equal(recovered.status, 200);
  assert.deepEqual(rec.calls.map(c => c.base), [FEMA]);
  assertSafe(rec.calls);
});

// ---- 0. Kootenai parcel search: same answer as the Worker

const PARCEL_LAYER = `${KC}/Ownership_Display/MapServer/0/query`;
const parcelCases = [
  ['47N03W052200', fixture('kootenai-parcel-47N03W052200.json')],
  ['47N02W040800', fixture('kootenai-parcel-47N02W040800.json')], // several rows, merged into one outline
  ['50N04W323200', fixture('browser-fallback-50N04W323200.json').responses.find(r => r.url === PARCEL_LAYER && r.body.fields?.length === 5).body],
  ['50N04W-32-3200', fixture('browser-fallback-50N04W323200.json').responses.find(r => r.url === PARCEL_LAYER && r.body.fields?.length === 5).body] // dashed PID
];
for (const [parcelId, layerAnswer] of parcelCases) {
  test(`kootenai-parcel parity on recorded ${parcelId}: browser answer equals the Worker's /api/parcel-search answer`, async () => {
    const w = recorder(({ base }) => (base === PARCEL_LAYER ? layerAnswer : new Response('unexpected', { status: 500 })));
    const expected = await apiJson('/api/parcel-search', { state: 'ID', county: 'Kootenai', parcelId }, w.fetch);
    assert.equal(expected.status, 200);
    const b = recorder(() => layerAnswer);
    const { api: fb } = browser(b.fetch);
    assert.deepEqual(plain(await fb.run('kootenai-parcel', { parcelId })), expected.body);
    const workerCall = w.calls.find(c => c.base === PARCEL_LAYER);
    assert.equal(b.calls.length, 1);
    for (const name of ['where', 'outFields', 'returnGeometry', 'outSR', 'resultRecordCount', 'f']) assert.equal(b.calls[0].params.get(name), workerCall.params.get(name), name);
    assert.equal(b.calls[0].params.get('outFields'), 'PIN,PID,Acres,Loc_Addr,Loc_City');
    assertSafe(b.calls);
  });
}

test('kootenai-parcel: a miss, two parcels, or an owner field sent anyway', async () => {
  const { api: fb } = browser(recorder(() => ({ features: [] })).fetch);
  await assert.rejects(fb.run('kootenai-parcel', { parcelId: '50N04W323200' }), /not found/);
  const two = { features: [{ attributes: { PIN: 'A1', PID: 'X' }, geometry: { rings: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } }, { attributes: { PIN: 'A2', PID: 'X' }, geometry: { rings: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } }] };
  const { api: fb2 } = browser(recorder(() => two).fetch);
  await assert.rejects(fb2.run('kootenai-parcel', { parcelId: 'X' }), /more than one/);
  const withOwner = plain(fixture('kootenai-parcel-47N03W052200.json'));
  withOwner.features[0].attributes.Name = 'OWNER PLACEHOLDER';
  const { api: fb3 } = browser(recorder(() => withOwner).fetch);
  const result = plain(await fb3.run('kootenai-parcel', { parcelId: '47N03W052200' }));
  assert.equal(JSON.stringify(result).includes('OWNER PLACEHOLDER'), false);
});

// ---- 1. Kootenai zoning: same answers as the Worker

const kootenaiFixtures = ['081900010030', '0L8210010030', '48N03W312100', 'C72150030040', 'P00000032775'];

for (const pin of kootenaiFixtures) {
  test(`kootenai-zoning parity on recorded ${pin}: browser answer equals the Worker's, same fields`, async () => {
    const data = fixture(`kootenai-zoning-${pin}.json`);
    const w = replay(data.responses);
    globalThis.fetch = w.fetch;
    const expected = { body: plain(await getKootenaiCountyIntelligence(data.request)) }; // what /api/zoning-permits returns
    assert.equal('fallback' in expected.body, false);
    const b = replay(data.responses);
    const { api: fb } = browser(b.fetch);
    const actual = plain(await fb.run('kootenai-zoning', { parcelId: data.request.parcelId }));
    assert.deepEqual(actual, expected.body);
    assert.deepEqual(fieldLists(b.calls), fieldLists(w.calls));
    assertSafe(b.calls);
  });
}

const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const ring = square(-116.8, 47.7, -116.79, 47.71);
const parcelAnswer = { features: [{ attributes: { PIN: 'P50N04W123456', Acres: 10, Loc_Addr: '1 Test Rd', Loc_City: 'Athol' }, geometry: { rings: [ring] } }] };
const unincorporated = { features: [{ attributes: { CITY: ' ' }, geometry: { rings: [square(-116.81, 47.69, -116.78, 47.72)] } }] };
const empty = { features: [] };
const syntheticCases = {
  'split between two county zones, inside an impact area': {
    [PARCELS]: parcelAnswer,
    [ZONING]: { features: [
      { attributes: { ZONE_NAME: 'AG', LABEL: 'AGRICULTURE', ACRES: 50 }, geometry: { rings: [square(-116.81, 47.69, -116.795, 47.72)] } },
      { attributes: { ZONE_NAME: 'RR', LABEL: 'RESTRICTED RESIDENTIAL', ACRES: 50 }, geometry: { rings: [square(-116.795, 47.69, -116.78, 47.72)] } }
    ] },
    [CITY_LIMITS]: unincorporated,
    [IMPACT]: { features: [{ attributes: { CITY: 'ATHOL', ORDINANCE: 'ORA25-0001' }, geometry: { rings: [square(-116.81, 47.69, -116.78, 47.72)] } }] }
  },
  'inside a city with no zoning layer (Hayden), straddling': {
    [PARCELS]: parcelAnswer,
    [ZONING]: empty,
    [CITY_LIMITS]: { features: [{ attributes: { CITY: 'Hayden' }, geometry: { rings: [square(-116.81, 47.69, -116.793, 47.72)] } }, { attributes: { CITY: null }, geometry: { rings: [square(-116.793, 47.69, -116.78, 47.72)] } }] },
    [IMPACT]: empty
  },
  'no zone polygon on the parcel': { [PARCELS]: parcelAnswer, [ZONING]: empty, [CITY_LIMITS]: unincorporated, [IMPACT]: empty },
  'parcel layer misses: outline from the hint, Coeur d\'Alene zone': {
    [PARCELS]: empty, [ZONING]: empty, [IMPACT]: empty,
    [CITY_LIMITS]: { features: [{ attributes: { CITY: 'Coeur d Alene' }, geometry: { rings: [square(-116.81, 47.69, -116.78, 47.72)] } }] },
    [CDA]: { features: [{ attributes: { ZONING: 'R-3', ZoningInfo: '<a href="https://www.cdaid.org/files/R-3.pdf">R-3</a>', PUD: null, Notes: null, last_edited_date: 1700000000000 }, geometry: { rings: [square(-116.81, 47.69, -116.78, 47.72)] } }] }
  }
};
const syntheticInput = { parcelId: 'P50N04W123456', lat: 47.705, lon: -116.795, geometry: { type: 'Polygon', coordinates: [ring] } };

for (const [name, map] of Object.entries(syntheticCases)) {
  test(`kootenai-zoning parity: ${name}`, async () => {
    const w = answers(map);
    const expected = await apiJson('/api/zoning-permits', { county: 'Kootenai', ...syntheticInput }, w.fetch);
    assert.equal(expected.status, 200);
    const b = answers(map);
    const { api: fb } = browser(b.fetch);
    assert.deepEqual(plain(await fb.run('kootenai-zoning', syntheticInput)), expected.body);
    assert.deepEqual(fieldLists(b.calls), fieldLists(w.calls));
    assertSafe(b.calls);
  });
}

test('kootenai-zoning: a city-limits failure in the browser too keeps the Worker answer', async () => {
  const b = recorder(({ base }) => (base === CITY_LIMITS ? new Response('blocked', { status: 403 }) : base === PARCELS ? parcelAnswer : empty));
  const { api: fb } = browser(b.fetch);
  await assert.rejects(fb.run('kootenai-zoning', syntheticInput), /returned 403/);
  const original = new Response(JSON.stringify({ zoning: { status: 'unavailable' }, fallback: { mode: 'browser', kind: 'kootenai-zoning', input: syntheticInput } }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  assert.equal(await fb.recover('/api/zoning-permits', original), original);
  assert.deepEqual(plain(fb.loaded()), {}, 'no label when the browser did not load it');
});

// ---- 2. IDWR wells

// Points within `miles`; properties as IDWR returns them, cut to the requested outFields.
function idwr({ params }) {
  const fields = params.get('outFields').split(',');
  const miles = Number(params.get('distance'));
  const count = miles < 5 ? 2 : 6;
  const features = Array.from({ length: count }, (_, i) => {
    const all = { WellID: 1000 + i, PermitID: i % 2 ? `P-${i}` : null, MetalTagNumber: i % 3 ? null : `D00${i}`, ConstructionDate: 1500000000000 + i, Owner: i % 2 ? 'OWNER PLACEHOLDER' : null, WellUse: i === 4 ? null : 'Domestic', CountyName: 'Kootenai', WellAddress: `${i} Placeholder Rd`, ProductionRate: 10 + i, StaticWaterLevel: 50 + i, CasingDepth: 80, TotalDepth: i === 5 ? 0 : 120 + i, WellDocs: `https://idwr.example/doc/${i}`, Latitude: 47.7, Longitude: -116.8 + i / 1000 };
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [-116.8 + i / 1000, 47.7] }, properties: Object.fromEntries(fields.filter(f => f in all).map(f => [f, all[f]])) };
  });
  return { type: 'FeatureCollection', features };
}

test('idaho-wells parity: same wells as the Worker, same fields, same ProjectName rule', async () => {
  const w = recorder(idwr);
  const expected = await apiJson('/api/well-search', { state: 'ID', county: 'Kootenai', lat: 47.7, lon: -116.8 }, w.fetch);
  assert.equal(expected.status, 200);
  const b = recorder(idwr);
  const { api: fb } = browser(b.fetch);
  const actual = plain(await fb.run('idaho-wells', { lat: 47.7, lon: -116.8 }));
  assert.deepEqual(actual, expected.body);
  assert.ok(actual.wells.some(w => w.properties.ProjectName === 'Idaho well record') && actual.wells.some(w => w.properties.ProjectName === 'Domestic'), 'both ProjectName branches covered');
  assert.equal(actual.wells.length, 5, 'the radius widened to 5 mi like the Worker');
  assert.ok(actual.wells.every(well => !('Owner' in well.properties)));
  assert.deepEqual(b.calls.map(c => c.params.get('distance')), w.calls.map(c => c.params.get('distance')));
  assert.equal(b.calls[0].params.get('outFields'), w.calls[0].params.get('outFields'));
  assert.equal(w.calls[0].params.get('outFields').split(',').includes('Owner'), false);
  for (const name of ['f', 'where', 'geometry', 'geometryType', 'inSR', 'spatialRel', 'units', 'returnGeometry', 'outSR', 'resultRecordCount']) {
    assert.equal(b.calls[0].params.get(name), w.calls[0].params.get(name), name);
  }
  assertSafe(b.calls);
});

test('idaho-wells: owner and mailing fields are dropped even if a server sends them, as the Worker does', async () => {
  const answer = () => ({ type: 'FeatureCollection', features: Array.from({ length: 5 }, (_, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-116.8, 47.7] }, properties: { WellID: i, TotalDepth: 100, Owner: 'OWNER PLACEHOLDER', OwnerAddress: 'MAIL PLACEHOLDER', MailCity: 'MAIL PLACEHOLDER' } })) });
  const expected = await apiJson('/api/well-search', { state: 'ID', county: 'Kootenai', lat: 47.7, lon: -116.8 }, recorder(answer).fetch);
  const { api: fb } = browser(recorder(answer).fetch);
  const result = plain(await fb.run('idaho-wells', { lat: 47.7, lon: -116.8 }));
  assert.deepEqual(result, expected.body);
  assert.equal(JSON.stringify(result).includes('PLACEHOLDER'), false);
  assert.ok(result.wells.every(well => well.properties.ProjectName === 'Idaho well record'));
});

// ---- 3. Kootenai assessor

const recordedAssessor = fixture('kootenai-assessor-47N03W052200.json');
const assessorAnswers = ({ hitLayer = 10, failLayer = null } = {}) => ({ base }) => {
  const layer = Number(base.match(/MapServer\/(\d+)\/query$/)?.[1]);
  if (layer === failLayer) return new Response('down', { status: 503 });
  return layer === hitLayer ? recordedAssessor.hit : recordedAssessor.miss;
};

test('kootenai-assessor parity: the recorded hit maps to the Worker\'s record', async () => {
  const w = recorder(assessorAnswers());
  const expected = await apiJson('/api/property-assessment', { state: 'ID', county: 'Kootenai', parcelId: '47N03W052200' }, w.fetch);
  assert.equal(expected.body.available, true);
  const b = recorder(assessorAnswers());
  const { api: fb } = browser(b.fetch);
  assert.deepEqual(plain(await fb.run('kootenai-assessor', { parcelId: '47N03W052200' })), expected.body);
  const workerAssessorCalls = w.calls.filter(c => c.base.includes('/Assessor_Layers/'));
  assert.deepEqual(new Set(b.calls.map(c => c.params.get('outFields'))), new Set(workerAssessorCalls.map(c => c.params.get('outFields'))));
  assert.equal(b.calls[0].params.get('where'), workerAssessorCalls[0].params.get('where'));
  assertSafe(b.calls);
});

test('kootenai-assessor parity: no record in any layer', async () => {
  const expected = await apiJson('/api/property-assessment', { state: 'ID', county: 'Kootenai', parcelId: '47N03W052200' }, recorder(assessorAnswers({ hitLayer: null })).fetch);
  const b = recorder(assessorAnswers({ hitLayer: null }));
  const { api: fb } = browser(b.fetch);
  assert.deepEqual(plain(await fb.run('kootenai-assessor', { parcelId: '47N03W052200' })), expected.body);
  assert.equal(b.calls.length, 7);
});

test('kootenai-assessor: a failing layer with no hit keeps the Worker answer; a hit stops the queue', async () => {
  const { api: fb } = browser(recorder(assessorAnswers({ hitLayer: null, failLayer: 9 })).fetch);
  await assert.rejects(fb.run('kootenai-assessor', { parcelId: '47N03W052200' }), /unavailable/);
  const b = recorder(assessorAnswers({ hitLayer: 5 }));
  const { api: fb2 } = browser(b.fetch);
  assert.equal((await fb2.run('kootenai-assessor', { parcelId: '47N03W052200' })).countyRecords[0].layerId, 5);
  assert.ok(b.calls.length <= 4, `at most 4 layers in flight, none sent after the hit (sent ${b.calls.length})`);
});

// ---- 3b. Stevens assessor

const STEVENS = 'https://gis.stevenscountywa.gov/server/rest/services/RealPropertyParcels_Public/MapServer/0/query';
const recordedStevens = fixture('stevens-assessor.json').answers;
const stevensAnswers = id => ({ base, params }) => {
  if (base !== STEVENS) throw new Error(`unexpected ${base}`);
  const asked = /PARCELN='(\d+)'/.exec(params.get('where'))?.[1];
  return asked === id ? recordedStevens[id] : recordedStevens.miss;
};

test('stevens-assessor parity: recorded hits map to the Worker\'s record (current use, several rows, no values)', async () => {
  for (const id of ['2342700', '0231200', '2148112', '8974701']) {
    const w = recorder(stevensAnswers(id));
    const expected = await apiJson('/api/property-assessment', { state: 'WA', county: 'Stevens', parcelId: id }, w.fetch);
    assert.equal(expected.body.available, true, id);
    const b = recorder(stevensAnswers(id));
    const { api: fb } = browser(b.fetch);
    assert.deepEqual(plain(await fb.run('stevens-assessor', { parcelId: id })), expected.body, id);
    assert.equal(b.calls.length, 1);
    for (const key of ['where', 'outFields', 'returnGeometry', 'resultRecordCount']) assert.equal(b.calls[0].params.get(key), w.calls[0].params.get(key), `${id} ${key}`);
    assertSafe(b.calls);
  }
});

test('stevens-assessor parity: no record, a typed short number, and a number that cannot be Stevens', async () => {
  const expected = await apiJson('/api/property-assessment', { state: 'WA', county: 'Stevens', parcelId: '9999999' }, recorder(stevensAnswers('none')).fetch);
  const { api: fb } = browser(recorder(stevensAnswers('none')).fetch);
  assert.deepEqual(plain(await fb.run('stevens-assessor', { parcelId: '9999999' })), expected.body);
  const b = recorder(stevensAnswers('0231200'));
  const { api: fb2 } = browser(b.fetch);
  assert.equal((await fb2.run('stevens-assessor', { parcelId: '231200' })).countyRecords[0].parcelNumber, '0231200');
  assert.equal(b.calls[0].params.get('where'), "PARCELN='0231200'");
  const none = recorder(() => { throw new Error('must not be sent'); });
  const { api: fb3 } = browser(none.fetch);
  assert.equal((await fb3.run('stevens-assessor', { parcelId: 'RR ROW' })).available, false);
  assert.equal(none.calls.length, 0);
});

test('stevens-assessor: a failure in the browser too keeps the Worker answer; owner fields sent anyway are dropped', async () => {
  const { api: fb } = browser(blocked(503).fetch);
  await assert.rejects(fb.run('stevens-assessor', { parcelId: '0231200' }), /Stevens County Assessor returned 503/);
  const all = fixture('stevens-assessor-0231200-all-fields.json');
  const { api: fb2 } = browser(recorder(() => all).fetch);
  const body = plain(await fb2.run('stevens-assessor', { parcelId: '0231200' }));
  assert.equal(body.countyRecords[0].parcelNumber, '0231200');
  assert.doesNotMatch(JSON.stringify(body), /PLACEHOLDER/);
});

test('stevens-assessor: the property search link follows the Worker rule in the browser copy too', async () => {
  const base = recordedStevens['0231200'].features[0].attributes;
  const url = base.Propertyinformation;
  const cases = [
    [url, 'https://propertysearch.trueautomation.com/PropertyAccess/Property.aspx?cid=0&year=2026&prop_id=13056'], // accepted, upgraded
    [url.replace('propertysearch.trueautomation.com', 'evil.example'), null], // different host
    [url.replace('/PropertyAccess/Property.aspx', '/PropertyAccess/Other.aspx'), null], // different path
    [url.replace('prop_id=13056', 'prop_id=40770'), null], // prop_id mismatch
    // Lookalike hosts: a loosened host check (endsWith / includes) accepts these.
    [url.replace('propertysearch.trueautomation.com', 'evil-trueautomation.com'), null],
    [url.replace('propertysearch.trueautomation.com', 'propertysearch.trueautomation.com.evil.com'), null],
    // Only cid, year and prop_id, all numeric; the link is rebuilt from them.
    [`${url}&redirect=//evil.com`, null],
    [url.replace('cid=0', 'cid=x'), null],
    [url.replace('year=2026', 'year=2026a'), null],
    [`${url}&year=2025`, null],
    [`${url.replace('cid=0&year=2026&prop_id=13056', 'prop_id=13056&year=2026&cid=0')}#frag`, 'https://propertysearch.trueautomation.com/PropertyAccess/Property.aspx?cid=0&year=2026&prop_id=13056']
  ];
  for (const [sent, want] of cases) {
    const answer = () => ({ features: [{ attributes: { ...base, Propertyinformation: sent } }] });
    const expected = await apiJson('/api/property-assessment', { state: 'WA', county: 'Stevens', parcelId: '0231200' }, recorder(answer).fetch);
    const { api: fb } = browser(recorder(answer).fetch);
    const body = plain(await fb.run('stevens-assessor', { parcelId: '0231200' }));
    assert.equal(body.countyRecords[0].propertySearchUrl, want, sent);
    assert.deepEqual(body, expected.body, sent);
  }
});

// ---- 3c. Spokane assessor

const SPOKANE = 'https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query';
const SPOKANE_BACKUP = 'https://gismo.spokanecounty.org/arcgis/rest/services/CONNECTExplorer/CONNECTExplorer_REST/MapServer/14/query';
const recordedSpokane = fixture('spokane-assessor.json').answers;
const spokaneAnswers = id => ({ base, params }) => {
  if (base !== SPOKANE && base !== SPOKANE_BACKUP) throw new Error(`unexpected ${base}`);
  const asked = /PID_NUM='([^']+)'/.exec(params.get('where'))?.[1];
  return asked === id ? recordedSpokane[id] : recordedSpokane.miss;
};

test('spokane-assessor parity: recorded hits map to the Worker\'s record (exemption, current use, church, government)', async () => {
  for (const id of ['35234.0602', '48136.9052', '35204.2729', '46301.9025', '13013.2211']) {
    const w = recorder(spokaneAnswers(id));
    const expected = await apiJson('/api/property-assessment', { state: 'WA', county: 'Spokane', parcelId: id }, w.fetch);
    assert.equal(expected.body.available, true, id);
    const b = recorder(spokaneAnswers(id));
    const { api: fb } = browser(b.fetch);
    assert.deepEqual(plain(await fb.run('spokane-assessor', { parcelId: id })), expected.body, id);
    assert.equal(b.calls.length, 1);
    for (const key of ['where', 'outFields', 'returnGeometry', 'resultRecordCount']) assert.equal(b.calls[0].params.get(key), w.calls[0].params.get(key), `${id} ${key}`);
    assertSafe(b.calls);
  }
});

test('spokane-assessor parity: no record, a typed no-dot number, and a number that cannot be Spokane', async () => {
  const expected = await apiJson('/api/property-assessment', { state: 'WA', county: 'Spokane', parcelId: '99999.9999' }, recorder(spokaneAnswers('none')).fetch);
  const { api: fb } = browser(recorder(spokaneAnswers('none')).fetch);
  assert.deepEqual(plain(await fb.run('spokane-assessor', { parcelId: '99999.9999' })), expected.body);
  const b = recorder(spokaneAnswers('35204.2729'));
  const { api: fb2 } = browser(b.fetch);
  assert.equal((await fb2.run('spokane-assessor', { parcelId: '352042729' })).countyRecords[0].parcelNumber, '35204.2729');
  assert.equal(b.calls[0].params.get('where'), "PID_NUM='35204.2729'");
  const none = recorder(() => { throw new Error('must not be sent'); });
  const { api: fb3 } = browser(none.fetch);
  assert.equal((await fb3.run('spokane-assessor', { parcelId: 'UNKNOWN' })).available, false);
  assert.equal(none.calls.length, 0);
});

test('spokane-assessor: the backup layer after an error; a failure on both keeps the Worker answer; owner fields sent anyway are dropped', async () => {
  const gone = recorder(({ base }) => (base === SPOKANE ? { error: { code: 404, message: 'Service not found' } } : recordedSpokane['13013.2211']));
  const { api: fb } = browser(gone.fetch);
  assert.equal((await fb.run('spokane-assessor', { parcelId: '13013.2211' })).countyRecords[0].totalValue, 401500);
  assert.deepEqual(gone.calls.map(c => c.base), [SPOKANE, SPOKANE_BACKUP]);
  assertSafe(gone.calls);
  const { api: fb2 } = browser(blocked(503).fetch);
  await assert.rejects(fb2.run('spokane-assessor', { parcelId: '13013.2211' }), /Spokane County Assessor returned 503/);
  const all = fixture('spokane-assessor-13013.2211-all-fields.json');
  const { api: fb3 } = browser(recorder(() => all).fetch);
  const body = plain(await fb3.run('spokane-assessor', { parcelId: '13013.2211' }));
  assert.equal(body.countyRecords[0].parcelNumber, '13013.2211');
  assert.doesNotMatch(JSON.stringify(body), /PLACEHOLDER|owner|taxpayer/i);
});

// ---- 4. FEMA flood

const floodGeometry = { type: 'Polygon', coordinates: [[[-116.8, 47.7], [-116.79, 47.7], [-116.79, 47.71], [-116.8, 47.71], [-116.8, 47.7]]] };
const bigGeometry = { type: 'Polygon', coordinates: [Array.from({ length: 401 }, (_, i) => { const a = (i % 400) / 400 * 2 * Math.PI; return [-116.8 + 0.01 * Math.cos(a) + i * 1e-7, 47.7 + 0.01 * Math.sin(a)]; })] };
bigGeometry.coordinates[0][400] = bigGeometry.coordinates[0][0];
const floodRows = [
  fixture('fema-nfhl-flood.json'),
  { features: [{ attributes: { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F' } }, { attributes: { FLD_ZONE: 'D', SFHA_TF: 'F' } }] },
  { features: [{ attributes: { FLD_ZONE: 'AREA NOT INCLUDED' } }] },
  { features: [] }
];

for (const [i, rows] of floodRows.entries()) {
  for (const [shape, geometry] of [['small', floodGeometry], ['large', bigGeometry]]) {
    test(`fema-flood parity #${i} (${shape} parcel): browser answer equals the Worker's FEMA answer`, async () => {
      const w = recorder(() => rows);
      const expected = await apiJson('/api/hazards', { kind: 'flood', geometry }, w.fetch);
      assert.equal(expected.body.source.provider, 'FEMA NFHL');
      const b = recorder(() => rows);
      const { api: fb } = browser(b.fetch);
      assert.deepEqual(plain(await fb.run('fema-flood', { geometry })), expected.body);
      assert.equal(b.calls[0].method, w.calls[0].method, 'GET for short, POST for long, like the Worker');
      for (const name of ['outFields', 'geometry', 'geometryType', 'where', 'spatialRel', 'inSR', 'returnGeometry', 'resultRecordCount']) assert.equal(b.calls[0].params.get(name), w.calls[0].params.get(name), name);
      assertSafe(b.calls);
    });
  }
}

// Stevens County, WA: FEMA has no panels, so both sides ask the county's digitized FIRM
// (src/counties/stevens-flood.js; recorded answers in fixtures/stevens-flood.json).
const STEVENS_FLOOD = 'https://gis.stevenscountywa.gov/server/rest/services/Hydrology/MapServer/19/query';
const stevens = fixture('stevens-flood.json').cases;

for (const [name, c] of Object.entries(stevens)) {
  test(`fema-flood parity, Stevens ${name}: FEMA empty, the browser asks the county layer and matches the Worker`, async () => {
    const answer = ({ base }) => (base === STEVENS_FLOOD ? c.response : { features: [] });
    const w = recorder(answer);
    const expected = await apiJson('/api/hazards', { kind: 'flood', geometry: c.geometry }, w.fetch);
    assert.equal(expected.body.source.provider, 'Stevens County digitized FEMA FIRM');
    const b = recorder(answer);
    const { api: fb } = browser(b.fetch);
    assert.deepEqual(plain(await fb.run('fema-flood', { geometry: c.geometry })), expected.body);
    assert.deepEqual(b.calls.map(call => call.base), [FEMA, STEVENS_FLOOD]);
    for (const p of ['outFields', 'geometry', 'geometryType', 'where', 'spatialRel', 'inSR', 'returnGeometry', 'resultRecordCount']) assert.equal(b.calls[1].params.get(p), w.calls[1].params.get(p), p);
    assertSafe(b.calls);
    assert.deepEqual(plain(fb.loaded()), { 'fema-flood': 'Stevens County GIS' });
  });
}

test('fema-flood, Stevens: a county failure in the browser keeps FEMA\'s answer; FEMA failing too keeps the Worker answer', async () => {
  const b = recorder(({ base }) => (base === STEVENS_FLOOD ? new Response('down', { status: 503 }) : { features: [] }));
  const { api: fb } = browser(b.fetch);
  const body = plain(await fb.run('fema-flood', { geometry: stevens.ae.geometry }));
  assert.equal(body.category, 'not_mapped');
  assert.equal(body.source.provider, 'FEMA NFHL');
  const down = recorder(() => new Response('down', { status: 503 }));
  const { api: fb2 } = browser(down.fetch);
  await assert.rejects(fb2.run('fema-flood', { geometry: stevens.ae.geometry }), /FEMA NFHL returned 503/);
  assert.deepEqual(down.calls.map(call => call.base), [FEMA, STEVENS_FLOOD]);
});

test('fema-flood, Stevens: FEMA failing in the browser still lets the county layer answer', async () => {
  const b = recorder(({ base }) => (base === STEVENS_FLOOD ? stevens.ae.response : new Response('Forbidden', { status: 403 })));
  const { api: fb } = browser(b.fetch);
  const body = plain(await fb.run('fema-flood', { geometry: stevens.ae.geometry }));
  assert.equal(body.category, 'high');
  assert.equal(body.source.digitalFemaMap, false);
  // The partial A/AE note is sampled in the browser too (same grid as the Worker).
  assert.equal(body.source.floodZoneShare, 0.099);
  assert.match(body.source.edgeNote, /digitized at 1:24,000, so zone edges can be off by tens of metres; the flood zone covers about 10% of the parcel\. A survey or FEMA elevation certificate is needed to confirm\.$/);
  assert.equal(b.calls.find(c => c.base === STEVENS_FLOOD).params.get('returnGeometry'), 'true');
});

test('fema-flood outside Stevens: the browser never asks the county layer', async () => {
  for (const rows of [{ features: [] }, { features: [{ attributes: { FLD_ZONE: 'AREA NOT INCLUDED' } }] }]) {
    const b = recorder(() => rows);
    const { api: fb } = browser(b.fetch);
    assert.equal((await fb.run('fema-flood', { geometry: floodGeometry })).category, 'not_mapped');
    assert.deepEqual(b.calls.map(call => call.base), [FEMA]);
  }
  const down = recorder(() => new Response('down', { status: 503 }));
  const { api: fb } = browser(down.fetch);
  await assert.rejects(fb.run('fema-flood', { geometry: floodGeometry }), /FEMA NFHL returned 503/);
  assert.deepEqual(down.calls.map(call => call.base), [FEMA]);
});

test('end to end, Stevens: Worker FEMA 403 + Esri empty + county 503 -> hint -> the browser gives the healthy Worker answer', async () => {
  const c = stevens.ae;
  const healthy = plain((await apiJson('/api/hazards', { kind: 'flood', geometry: c.geometry }, recorder(({ base }) => (base === STEVENS_FLOOD ? c.response : { features: [] })).fetch)).body);
  const failed = await api('/api/hazards', { kind: 'flood', geometry: c.geometry }, recorder(({ base }) => (base === ESRI ? { features: [] } : new Response('down', { status: base === FEMA ? 403 : 503 }))).fetch);
  assert.equal((await failed.clone().json()).fallback?.kind, 'fema-flood');
  const b = recorder(({ base }) => (base === STEVENS_FLOOD ? c.response : { features: [] }));
  const { api: fb } = browser(b.fetch);
  const recovered = await fb.recover('/api/hazards', failed);
  assert.deepEqual(await recovered.json(), healthy);
  assert.equal(healthy.category, 'high');
  assertSafe(b.calls);
});

// ---- The whole loop: Worker blocked -> hint -> browser -> the Worker's normal answer

test('end to end: each kind recovers from a blocked Worker with the answer the Worker gives when it can reach the source', async () => {
  const pin = 'C72150030040';
  const zoningData = fixture(`kootenai-zoning-${pin}.json`);
  const cases = [
    { path: '/api/zoning-permits', body: { county: 'Kootenai', parcelId: pin, lat: 47.7, lon: -116.9 }, down: blocked(403), up: () => replay(zoningData.responses) },
    { path: '/api/well-search', body: { state: 'ID', county: 'Kootenai', lat: 47.7, lon: -116.8 }, down: blocked(503), up: () => recorder(idwr) },
    { path: '/api/property-assessment', body: { state: 'ID', county: 'Kootenai', parcelId: '47N03W052200' }, down: recorder(() => { throw new TypeError('fetch failed'); }), up: () => recorder(assessorAnswers()) },
    { path: '/api/hazards', body: { kind: 'flood', geometry: floodGeometry }, down: recorder(({ base }) => (base === ESRI ? { features: [{ attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T' } }] } : new Response('Forbidden', { status: 403 }))), up: () => recorder(() => fixture('fema-nfhl-flood.json')) }
  ];
  for (const c of cases) {
    const healthy = plain((await apiJson(c.path, c.body, c.up().fetch)).body);
    const failed = await api(c.path, c.body, c.down.fetch);
    const hint = (await failed.clone().json()).fallback;
    assert.equal(hint?.mode, 'browser', c.path);
    const b = c.up();
    const { api: fb } = browser(b.fetch);
    const recovered = await fb.recover(c.path, failed);
    assert.equal(recovered.status, 200, c.path);
    assert.deepEqual(await recovered.json(), healthy, c.path);
    assert.equal(Object.keys(fb.loaded()).length, 1, c.path);
    assertSafe(b.calls);
  }
});

test('end to end: the page\'s own fetch calls are recovered transparently', async () => {
  const failed = await api('/api/hazards', { kind: 'flood', geometry: floodGeometry }, blocked(403).fetch);
  const b = recorder(({ base }) => (base === FEMA ? fixture('fema-nfhl-flood.json') : null));
  const pageFetch = async (input, init) => (String(input).startsWith('/api/') ? failed.clone() : b.fetch(input, init));
  const { h } = browser(pageFetch);
  const response = await h.context.fetch('/api/hazards', { method: 'POST', body: '{}' });
  const body = await response.json();
  assert.equal(body.source.provider, 'FEMA NFHL');
  assert.equal(body.category, 'high');
  assert.equal('fallback' in body, false);
  assert.deepEqual(b.calls.map(c => c.base), [FEMA]);
});

// ---- Labels

// The real page has the label targets; these tests use the structured fake DOM from
// test/ui-harness.js (selectors, siblings, remove) and its manual clock.
function domBrowser(fetchImpl, body) {
  const clock = makeClock();
  const page = makeDomContext({ body, clock, fetch: fetchImpl, extra: { Response, Headers, URLSearchParams } });
  page.run(readPublic('browser-fallback.js'), 'browser-fallback.js');
  const notes = kind => page.document.querySelectorAll(`.acresx-fallback-note${kind ? `[data-kind="${kind}"]` : ''}`);
  return { ...page, clock, api: page.ctx.AcresXFallback, notes };
}
const factEl = id => ['div', { class: 'property-overview-fact' }, '', [['span', {}, id], ['strong', { id }, '—']]];

test('labels: a recovered section says where it was loaded from, once, and a new search clears it', async () => {
  const p = domBrowser(recorder(() => fixture('fema-nfhl-flood.json')).fetch, [factEl('overviewFlood')]);
  await p.api.run('fema-flood', { geometry: floodGeometry });
  p.api.applyLabels();
  p.api.applyLabels();
  const notes = p.notes('fema-flood');
  assert.equal(notes.length, 1, 'one label, however often it is applied');
  assert.equal(notes[0].previousElementSibling.id, 'overviewFlood');
  assert.equal(notes[0].textContent, 'Loaded directly from FEMA (National Flood Hazard Layer). Verify with the responsible agency.');
  p.api.reset();
  assert.equal(p.notes().length, 0);
  assert.deepEqual(plain(p.api.loaded()), {});
});

test('labels: the parcel label shows once, even when its first target is re-rendered away and back', async () => {
  const layer = fixture('kootenai-parcel-47N03W052200.json');
  const p = domBrowser(recorder(() => layer).fetch, [factEl('overviewParcelId'), ['div', {}, '', [['span', { id: 'parcelAddress' }, '1 Test Rd']]]]);
  await p.api.run('kootenai-parcel', { parcelId: '47N03W052200' });
  p.api.applyLabels();
  assert.equal(p.notes('kootenai-parcel').length, 1);
  assert.equal(p.notes('kootenai-parcel')[0].previousElementSibling.id, 'overviewParcelId');
  // The overview is rebuilt: its parcel id element is gone for a moment.
  const id = p.document.getElementById('overviewParcelId');
  const holder = id.parentNode;
  id.remove();
  p.api.applyLabels();
  assert.equal(p.notes('kootenai-parcel').length, 1, 'moved to the other target, not duplicated');
  assert.equal(p.notes('kootenai-parcel')[0].previousElementSibling.id, 'parcelAddress');
  holder.prepend(id);
  p.api.applyLabels();
  assert.equal(p.notes('kootenai-parcel').length, 1, 'back after the parcel id, still one');
  assert.equal(p.notes('kootenai-parcel')[0].previousElementSibling.id, 'overviewParcelId');
  assert.equal(p.notes().length, 1);
});

test('labels: a browser answer that lands after a new search started labels nothing', async () => {
  // A slow assessor fallback from search 1; search 2 starts (form submit -> reset) before it lands.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const b = recorder(async ({ base }) => { await gate; return base.endsWith('/10/query') ? recordedAssessor.hit : recordedAssessor.miss; });
  const p = domBrowser(b.fetch, [factEl('overviewAssessorValue'), ['div', { id: 'propertyAssessmentSource' }]]);
  const late = p.api.run('kootenai-assessor', { parcelId: '47N03W052200' });
  await new Promise(resolve => setImmediate(resolve));
  for (const listener of p.document.listeners.submit || []) listener({ target: { id: 'searchForm' } });
  release();
  const body = plain(await late);
  assert.equal(body.available, true, 'the answer still comes back; the caller drops it as stale');
  assert.deepEqual(plain(p.api.loaded()), {});
  p.api.applyLabels();
  assert.equal(p.notes().length, 0, 'no "Loaded directly from" on the next search');

  // Same with progressive loading's search id moving on, without a form submit.
  let release2;
  const gate2 = new Promise(resolve => { release2 = resolve; });
  const p2 = domBrowser(recorder(async () => { await gate2; return fixture('fema-nfhl-flood.json'); }).fetch, [factEl('overviewFlood')]);
  p2.run('window.AcresXSections = { searchId: 1 }');
  const late2 = p2.api.run('fema-flood', { geometry: floodGeometry });
  await new Promise(resolve => setImmediate(resolve));
  p2.run('window.AcresXSections.searchId = 2');
  release2();
  await late2;
  assert.deepEqual(plain(p2.api.loaded()), {});
});

test('run(): a section aborted while the browser answer was being parsed is cancelled, not labelled', async () => {
  const controller = new AbortController();
  const b = recorder(() => { controller.abort(); return fixture('fema-nfhl-flood.json'); });
  const { api: fb } = browser(b.fetch);
  await assert.rejects(fb.run('fema-flood', { geometry: floodGeometry }, { signal: controller.signal }), /cancelled/);
  assert.deepEqual(plain(fb.loaded()), {});
  const aborted = new AbortController();
  aborted.abort();
  const rec = recorder(() => fixture('fema-nfhl-flood.json'));
  const { api: fb2 } = browser(rec.fetch);
  await assert.rejects(fb2.run('fema-flood', { geometry: floodGeometry }, { signal: aborted.signal }), /cancelled/);
  assert.equal(rec.calls.length, 0, 'an already-aborted signal sends nothing');
});

test('requests refuse redirects (a redirect could leave the allowlist)', async () => {
  const b = recorder(() => fixture('fema-nfhl-flood.json'));
  const { api: fb } = browser(b.fetch);
  await fb.run('fema-flood', { geometry: floodGeometry });
  assert.equal(b.calls[0].redirect, 'error');
  // What a browser does with redirect: 'error' when the server redirects: fetch rejects.
  const { api: fb2 } = browser(async (url, init) => { if (init.redirect === 'error') throw new TypeError('Failed to fetch'); return new Response('{}'); });
  await assert.rejects(fb2.run('fema-flood', { geometry: floodGeometry }), /Failed to fetch/);
});

test('labels: zoning names the agency that answered (city or county)', async () => {
  const data = fixture('kootenai-zoning-P00000032775.json');
  const { api: fb } = browser(replay(data.responses).fetch);
  await fb.run('kootenai-zoning', { parcelId: data.request.parcelId });
  assert.deepEqual(plain(fb.loaded()), { 'kootenai-zoning': 'City of Post Falls GIS' });
});
