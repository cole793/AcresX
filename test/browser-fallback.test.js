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
import { makeLazyContext as makeContext, readPublic } from './ui-harness.js';

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
const ALLOWED = ['map.kcgov.us', 'gis.cdaid.org', 'gis.postfalls.gov', 'gis.idwr.idaho.gov', 'hazards.fema.gov'];

// Owner names and mailing addresses in the layers this module reads (Kootenai parcel `Name`,
// assessor *_Primary / Recipient / mailing fields, IDWR `Owner`, Idaho statewide OWNER*/MAIL_*).
const PERSONAL = /^(owner\w*|name|\w*name_primary|recipient_\w*|attentionline_\w*|deliveryaddr_\w*|lastline_\w*|(city|state|postalcd|country)_primary|mail\w*|public_std)$/i;

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
    calls.push({ base, host: url.hostname, protocol: url.protocol, params, method: init.method || 'GET', credentials: init.credentials, headers: init.headers || {} });
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
  assert.deepEqual([...fb.kinds], ['kootenai-parcel', 'kootenai-zoning', 'idaho-wells', 'kootenai-assessor', 'fema-flood']);
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
  await assert.rejects(fb.run('stevens-zoning', {}), /unknown kind/);
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

test('idaho-wells parity: same wells as the Worker, minus the Owner field the browser never asks for', async () => {
  const w = recorder(idwr);
  const expected = await apiJson('/api/well-search', { state: 'ID', county: 'Kootenai', lat: 47.7, lon: -116.8 }, w.fetch);
  assert.equal(expected.status, 200);
  const b = recorder(idwr);
  const { api: fb } = browser(b.fetch);
  const actual = plain(await fb.run('idaho-wells', { lat: 47.7, lon: -116.8 }));
  // The Worker asks IDWR for Owner and uses it as ProjectName; the browser never does.
  const withoutOwner = plain(expected.body);
  for (const well of withoutOwner.wells) { delete well.properties.Owner; well.properties.ProjectName = well.properties.WellUse || 'Idaho well record'; }
  assert.deepEqual(actual, withoutOwner);
  assert.equal(actual.wells.length, 5, 'the radius widened to 5 mi like the Worker');
  assert.ok(actual.wells.every(well => !('Owner' in well.properties)));
  assert.deepEqual(b.calls.map(c => c.params.get('distance')), w.calls.map(c => c.params.get('distance')));
  const workerFields = w.calls[0].params.get('outFields').split(',');
  assert.deepEqual(b.calls[0].params.get('outFields').split(','), workerFields.filter(f => f !== 'Owner'));
  for (const name of ['f', 'where', 'geometry', 'geometryType', 'inSR', 'spatialRel', 'units', 'returnGeometry', 'outSR', 'resultRecordCount']) {
    assert.equal(b.calls[0].params.get(name), w.calls[0].params.get(name), name);
  }
  assertSafe(b.calls);
});

test('idaho-wells: Owner is dropped even if a server sends it', async () => {
  const b = recorder(() => ({ type: 'FeatureCollection', features: Array.from({ length: 5 }, (_, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-116.8, 47.7] }, properties: { WellID: i, TotalDepth: 100, Owner: 'OWNER PLACEHOLDER' } })) }));
  const { api: fb } = browser(b.fetch);
  const result = plain(await fb.run('idaho-wells', { lat: 47.7, lon: -116.8 }));
  assert.ok(result.wells.every(well => !('Owner' in well.properties) && well.properties.ProjectName === 'Idaho well record'));
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

// ---- The whole loop: Worker blocked -> hint -> browser -> the Worker's normal answer

test('end to end: each kind recovers from a blocked Worker with the answer the Worker gives when it can reach the source', async () => {
  const pin = 'C72150030040';
  const zoningData = fixture(`kootenai-zoning-${pin}.json`);
  const cases = [
    { path: '/api/zoning-permits', body: { county: 'Kootenai', parcelId: pin, lat: 47.7, lon: -116.9 }, down: blocked(403), up: () => replay(zoningData.responses) },
    { path: '/api/well-search', body: { state: 'ID', county: 'Kootenai', lat: 47.7, lon: -116.8 }, down: blocked(503), up: () => recorder(idwr), dropOwner: true },
    { path: '/api/property-assessment', body: { state: 'ID', county: 'Kootenai', parcelId: '47N03W052200' }, down: recorder(() => { throw new TypeError('fetch failed'); }), up: () => recorder(assessorAnswers()) },
    { path: '/api/hazards', body: { kind: 'flood', geometry: floodGeometry }, down: recorder(({ base }) => (base === ESRI ? { features: [{ attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T' } }] } : new Response('Forbidden', { status: 403 }))), up: () => recorder(() => fixture('fema-nfhl-flood.json')) }
  ];
  for (const c of cases) {
    const healthy = plain((await apiJson(c.path, c.body, c.up().fetch)).body);
    if (c.dropOwner) for (const well of healthy.wells) { delete well.properties.Owner; well.properties.ProjectName = well.properties.WellUse || 'Idaho well record'; }
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

test('labels: a recovered section says where it was loaded from, and a new search clears it', async () => {
  const before = 'function renderSummary(){ globalThis.rendered = (globalThis.rendered || 0) + 1; }';
  const b = recorder(() => fixture('fema-nfhl-flood.json'));
  const { h, api: fb } = browser(b.fetch, { before });
  const inserted = [];
  const target = h.el('overviewFlood');
  target.parentNode = { querySelector: sel => inserted.find(n => sel.includes(`data-kind="${n.attrs['data-kind']}"`)) || null };
  target.insertAdjacentElement = (where, el) => { assert.equal(where, 'afterend'); inserted.push(el); };
  h.context.document.createElement = () => ({ attrs: {}, textContent: '', className: '', setAttribute(k, v) { this.attrs[k] = v; }, remove() { inserted.splice(inserted.indexOf(this), 1); } });
  h.context.document.querySelectorAll = sel => (sel === '.acresx-fallback-note' ? [...inserted] : []);
  await fb.run('fema-flood', { geometry: floodGeometry });
  fb.applyLabels();
  fb.applyLabels();
  assert.equal(inserted.length, 1, 'one label, however often it is applied');
  assert.equal(inserted[0].className, 'acresx-fallback-note');
  assert.equal(inserted[0].textContent, 'Loaded directly from FEMA (National Flood Hazard Layer). Verify with the responsible agency.');
  h.run('renderSummary()');
  assert.equal(h.context.rendered, 1, 'renderSummary still runs');
  fb.reset();
  assert.equal(inserted.length, 0);
  assert.deepEqual(plain(fb.loaded()), {});
});

test('labels: zoning names the agency that answered (city or county)', async () => {
  const data = fixture('kootenai-zoning-P00000032775.json');
  const { api: fb } = browser(replay(data.responses).fetch);
  await fb.run('kootenai-zoning', { parcelId: data.request.parcelId });
  assert.deepEqual(plain(fb.loaded()), { 'kootenai-zoning': 'City of Post Falls GIS' });
});
