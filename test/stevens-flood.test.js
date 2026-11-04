// Offline tests for the Stevens County, WA flood layer (src/counties/stevens-flood.js) as
// src/services/flood.js uses it when FEMA NFHL has no mapped zone. County answers are recorded
// from the live layer (test/fixtures/stevens-flood.json, recorded 2026-11-04); FEMA and Esri are
// stubbed. No live network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import {
  FEMA_NFHL_FLOOD_LAYER, ESRI_USA_FLOOD_HAZARD_LAYER, FEMA_PROVIDER, FEMA_TIMEOUT_MS, FEMA_RETRY_BACKOFF_MS, FEMA_RETRY_TIMEOUT_MS,
  FALLBACK_TIMEOUT_MS, COUNTY_FLOOD_SOURCES, summarizeFloodRows
} from '../src/services/flood.js';
import {
  STEVENS_FLOOD_LAYER, STEVENS_FLOOD_PROVIDER, STEVENS_FLOOD_LABEL, STEVENS_FLOOD_NOTE, STEVENS_FLOOD_OUT_FIELDS, STEVENS_FLOOD_BBOX,
  STEVENS_FLOOD_TIMEOUT_MS, STEVENS_FLOOD_RETRY_TIMEOUT_MS, STEVENS_FLOOD_LATE_TIMEOUT_MS, isStevensParcel, stevensFloodRow, stevensFlood
} from '../src/counties/stevens-flood.js';

const recorded = JSON.parse(readFileSync(new URL('fixtures/stevens-flood.json', import.meta.url), 'utf8'));
const { ae, x, ani } = recorded.cases;
// A Kootenai County, ID parcel (the one test/flood.test.js uses): outside Stevens.
const kootenai = { type: 'Polygon', coordinates: [[[-116.8, 47.7], [-116.79, 47.7], [-116.79, 47.71], [-116.8, 47.71], [-116.8, 47.7]]] };

const FX = (() => { const window = {}; vm.runInNewContext(readFileSync(new URL('../public/flood-status.js', import.meta.url), 'utf8'), { window }); return window.AcresXFlood; })();
const plain = v => JSON.parse(JSON.stringify(v));

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const realWarn = console.warn;
let calls;
let restoreUpstream;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const empty = () => jsonResponse({ features: [] });
const status = code => () => new Response('', { status: code });
const notIncluded = () => jsonResponse({ features: [{ attributes: { FLD_ZONE: 'AREA NOT INCLUDED', ZONE_SUBTY: null, SFHA_TF: 'F' } }] });
const county = c => () => jsonResponse(c.response);
const isFema = url => url.startsWith(`${FEMA_NFHL_FLOOD_LAYER}/query`);
const isEsri = url => url.startsWith(`${ESRI_USA_FLOOD_HAZARD_LAYER}/query`);
const isCounty = url => url.startsWith(`${STEVENS_FLOOD_LAYER}/query`);

function stubFetch(...handlers) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const params = new URLSearchParams(url.split('?')[1] || '');
    if (init.body) new URLSearchParams(String(init.body)).forEach((v, k) => params.set(k, v));
    calls.push({ url, method: init.method || 'GET', params });
    const handler = handlers[calls.length - 1];
    if (!handler) throw new Error(`unexpected upstream call #${calls.length}: ${url}`);
    return handler(url);
  };
}
const kinds = () => calls.map(c => (isFema(c.url) ? 'fema' : isEsri(c.url) ? 'esri' : isCounty(c.url) ? 'county' : c.url));

function fakeCache() {
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); }
  } };
  return store;
}

beforeEach(() => { calls = []; delete globalThis.caches; console.warn = () => {}; restoreUpstream = configureUpstream({ backoffMs: 0 }); });
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  restoreUpstream();
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

async function floodCall(geometry, extra = {}) {
  const pending = [];
  const request = new Request('https://acresx.test/api/hazards', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'flood', geometry, ...extra })
  });
  const response = await worker.fetch(request, {}, { waitUntil(p) { pending.push(p); } });
  await Promise.all(pending);
  return { response, body: await response.json() };
}

const countySource = zones => ({
  provider: STEVENS_FLOOD_PROVIDER, url: STEVENS_FLOOD_LAYER, label: STEVENS_FLOOD_LABEL, coverage: 'paper-firm-copy',
  digitalFemaMap: false, mapDate: '1998', countyZones: zones.zones, firmPanels: zones.panels, note: STEVENS_FLOOD_NOTE
});
const femaNotMapped = { available: true, intersects: false, high: false, zones: [], zoneDetails: [], category: 'not_mapped', source: { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER } };

// --- The recorded fixtures are what the adapter asks for -------------------------------------

test('stevens flood fixtures: recorded from MapServer/19 with zones AE+X, X and ANI', () => {
  assert.equal(recorded.layer, STEVENS_FLOOD_LAYER);
  assert.equal(STEVENS_FLOOD_LAYER, 'https://gis.stevenscountywa.gov/server/rest/services/Hydrology/MapServer/19');
  assert.deepEqual(ae.response.features.map(f => f.attributes.zone_).sort(), ['AE', 'X']);
  assert.deepEqual(x.response.features.map(f => f.attributes.zone_), ['X']);
  assert.deepEqual(ani.response.features.map(f => f.attributes.zone_), ['ANI']);
  for (const c of [ae, x, ani]) assert.ok(isStevensParcel(c.geometry), 'fixture parcels are inside the Stevens bbox');
});

// --- NFHL not mapped -> county layer ---------------------------------------------------------

test('stevens flood: NFHL no features + county AE is high (score 20), labelled as the county paper-map copy, cached', async () => {
  const store = fakeCache();
  stubFetch(empty, county(ae));
  const { response, body } = await floodCall(ae.geometry);
  assert.equal(response.status, 200);
  assert.deepEqual(kinds(), ['fema', 'county']);
  assert.deepEqual(body, {
    available: true, intersects: true, high: true, zones: ['X', 'AE'],
    zoneDetails: [{ zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false }, { zone: 'AE', subtype: null, sfha: true }],
    category: 'high', source: countySource({ zones: ['X', 'AE'], panels: ['5301850125B'] })
  });
  assert.equal(FX.grade(body).score, 20);
  assert.equal(FX.grade(body).label, 'High risk');
  assert.equal(store.size, 1, 'a county answer is cached');
  // The whole parcel outline goes to the county layer, with the adapter's field list.
  const sent = calls[1].params;
  assert.deepEqual(JSON.parse(sent.get('geometry')).rings, ae.geometry.coordinates);
  assert.equal(sent.get('geometryType'), 'esriGeometryPolygon');
  assert.equal(sent.get('spatialRel'), 'esriSpatialRelIntersects');
  assert.equal(sent.get('inSR'), '4326');
  assert.equal(sent.get('outFields'), STEVENS_FLOOD_OUT_FIELDS);
  assert.equal(sent.get('returnGeometry'), 'false');
});

test('stevens flood: an NFHL "AREA NOT INCLUDED" answer also asks the county layer', async () => {
  stubFetch(notIncluded, county(ae));
  const { body } = await floodCall(ae.geometry);
  assert.deepEqual(kinds(), ['fema', 'county']);
  assert.equal(body.category, 'high');
  assert.equal(body.high, true);
  assert.equal(body.source.provider, STEVENS_FLOOD_PROVIDER);
});

test('stevens flood: county X only is minimal (score 96)', async () => {
  stubFetch(empty, county(x));
  const { body } = await floodCall(x.geometry);
  assert.equal(body.category, 'minimal');
  assert.equal(body.high, false);
  assert.deepEqual(body.zoneDetails, [{ zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false }]);
  assert.deepEqual(body.source.countyZones, ['X']);
  assert.equal(FX.grade(body).score, 96);
});

test('stevens flood: county ANI (area not included) is not mapped, never high', async () => {
  stubFetch(empty, county(ani));
  const { body } = await floodCall(ani.geometry);
  assert.equal(body.category, 'not_mapped');
  assert.equal(body.high, false);
  assert.deepEqual(body.zones, ['AREA NOT INCLUDED']);
  assert.deepEqual(body.source.countyZones, ['ANI']);
  assert.equal(FX.grade(body).label, 'Not mapped');
  assert.equal(FX.grade(body).score, 70);
});

test('stevens flood: county layer failing gives the old not_mapped answer, the layer marked unavailable, not cached', async () => {
  const store = fakeCache();
  stubFetch(empty, status(503), status(503));
  const { response, body } = await floodCall(ae.geometry);
  assert.equal(response.status, 200);
  assert.deepEqual(kinds(), ['fema', 'county', 'county'], 'one county retry after a FEMA answer');
  const { source, fallback, ...rest } = body;
  const { source: oldSource, ...oldRest } = femaNotMapped;
  assert.deepEqual(rest, oldRest);
  assert.deepEqual(source, { ...oldSource, countyLayer: { provider: STEVENS_FLOOD_PROVIDER, url: STEVENS_FLOOD_LAYER, status: 'unavailable', error: 'Stevens County GIS returned 503' } });
  assert.deepEqual(fallback, { mode: 'browser', kind: 'fema-flood', input: { geometry: ae.geometry } }, 'the browser may try FEMA and the county layer');
  assert.equal(store.size, 0, 'a county failure is never cached');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(FX.grade(body).category, 'not_mapped');
});

test('stevens flood: an ArcGIS 400 from the county layer is not retried and adds no browser hint', async () => {
  stubFetch(empty, () => jsonResponse({ error: { code: 400, message: 'Invalid query' } }));
  const { body } = await floodCall(ae.geometry);
  assert.deepEqual(kinds(), ['fema', 'county']);
  assert.equal(body.category, 'not_mapped');
  assert.equal(body.source.countyLayer.status, 'unavailable');
  assert.equal('fallback' in body, false);
});

test('stevens flood: no county polygon on the parcel keeps FEMA\'s answer, marked no_features, cached', async () => {
  const store = fakeCache();
  stubFetch(empty, empty);
  const { body } = await floodCall(ae.geometry);
  assert.deepEqual(body, { ...femaNotMapped, source: { ...femaNotMapped.source, countyLayer: { provider: STEVENS_FLOOD_PROVIDER, url: STEVENS_FLOOD_LAYER, status: 'no_features' } } });
  assert.equal(store.size, 1);
});

test('stevens flood: a mapped FEMA zone never asks the county layer', async () => {
  stubFetch(() => jsonResponse({ features: [{ attributes: { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' } }] }));
  const { body } = await floodCall(ae.geometry);
  assert.deepEqual(kinds(), ['fema']);
  assert.equal(body.source.provider, FEMA_PROVIDER);
});

// --- FEMA unreachable -> Esri -> county ------------------------------------------------------

test('stevens flood: FEMA and Esri both fail, county AE answers high, no browser hint, cached', async () => {
  const store = fakeCache();
  stubFetch(status(403), status(403), county(ae));
  const { response, body } = await floodCall(ae.geometry);
  assert.equal(response.status, 200);
  assert.deepEqual(kinds(), ['fema', 'esri', 'county']);
  assert.equal(body.category, 'high');
  assert.equal(body.source.provider, STEVENS_FLOOD_PROVIDER);
  assert.equal('fallback' in body, false, 'the county layer answered, so the browser has nothing to add');
  assert.equal(store.size, 1);
});

test('stevens flood: FEMA fails and the Esri copy is empty, county AE answers high', async () => {
  stubFetch(status(403), empty, county(ae));
  const { body } = await floodCall(ae.geometry);
  assert.deepEqual(kinds(), ['fema', 'esri', 'county']);
  assert.equal(body.category, 'high');
  assert.equal(body.source.emptyResult, undefined);
});

test('stevens flood: FEMA, Esri and the county layer all fail: 502 naming all three, one county attempt, with the hint', async () => {
  stubFetch(status(403), status(503), status(503));
  const { response, body } = await floodCall(ae.geometry);
  assert.equal(response.status, 502);
  assert.deepEqual(kinds(), ['fema', 'esri', 'county'], 'one short county attempt after FEMA and Esri failed');
  assert.equal(body.error, 'Flood data unavailable: FEMA NFHL returned 403; Esri USA Flood Hazard Areas returned 503; Stevens County digitized FEMA FIRM returned 503');
  assert.equal(body.error.match(/Stevens/g).length, 1, 'Stevens is named once');
  assert.equal(body.fallback.kind, 'fema-flood');
});

test('stevens flood: FEMA fails, Esri empty, county fails: the limited Esri answer stands, county marked unavailable', async () => {
  stubFetch(status(403), empty, status(503));
  const { body } = await floodCall(ae.geometry);
  assert.equal(body.category, 'limited');
  assert.equal(body.source.emptyResult, true);
  assert.equal(body.source.countyLayer.status, 'unavailable');
  assert.equal(body.fallback.kind, 'fema-flood');
});

// --- Never for other counties ----------------------------------------------------------------

test('stevens flood: a non-Stevens parcel never queries the county layer (FEMA empty, or FEMA and Esri down)', async () => {
  stubFetch(empty);
  assert.equal((await floodCall(kootenai)).body.category, 'not_mapped');
  assert.deepEqual(kinds(), ['fema']);
  calls = [];
  globalThis.fetch = async input => { calls.push({ url: String(input), params: new URLSearchParams() }); throw new TypeError('fetch failed'); };
  assert.equal((await floodCall(kootenai)).response.status, 502);
  assert.ok(!kinds().includes('county'));
  assert.equal(calls.length, 3, 'still at most 3 requests outside Stevens');
});

test('stevens flood: a request naming another county skips the layer even inside the bbox; naming Stevens uses it', async () => {
  stubFetch(empty);
  await floodCall(ae.geometry, { county: 'Spokane' });
  assert.deepEqual(kinds(), ['fema']);
  calls = [];
  stubFetch(empty, county(ae));
  assert.equal((await floodCall(ae.geometry, { county: 'Stevens' })).body.category, 'high');
  assert.deepEqual(kinds(), ['fema', 'county']);
});

test('stevens flood: parcel selection by bbox and county name', () => {
  assert.equal(isStevensParcel(kootenai), false);
  assert.equal(isStevensParcel(ae.geometry), true);
  assert.equal(isStevensParcel({ type: 'MultiPolygon', coordinates: [kootenai.coordinates, ani.geometry.coordinates] }), true);
  assert.equal(isStevensParcel(null), false);
  for (const name of ['Stevens', 'stevens county', 'Stevens County, WA', 'Stevens County, Washington']) assert.equal(isStevensParcel(kootenai, name), true, name);
  for (const name of ['Spokane', 'Kootenai', 'Stevens County, MN extra']) assert.equal(isStevensParcel(ae.geometry, name), false, name);
  assert.deepEqual(STEVENS_FLOOD_BBOX, { xmin: -118.43, ymin: 47.75, xmax: -117.35, ymax: 49.05 });
  assert.deepEqual(COUNTY_FLOOD_SOURCES, [stevensFlood]);
});

// --- Zone mapping ----------------------------------------------------------------------------

test('stevens flood: zone mapping uses the shared FEMA categories', () => {
  const category = attrs => summarizeFloodRows([stevensFloodRow(attrs)]).category;
  assert.equal(category({ zone_: 'A', sfha: 'IN', floodway: ' ' }), 'high');
  assert.equal(category({ zone_: 'AE', sfha: 'IN', floodway: ' ' }), 'high');
  assert.deepEqual(stevensFloodRow({ zone_: 'AE', sfha: 'IN', floodway: 'FW' }), { FLD_ZONE: 'AE', ZONE_SUBTY: 'FLOODWAY', SFHA_TF: 'T' });
  assert.equal(category({ zone_: 'X500', sfha: 'OUT', floodway: ' ' }), 'moderate');
  assert.equal(category({ zone_: 'X', sfha: 'OUT', floodway: ' ' }), 'minimal');
  assert.equal(category({ zone_: 'ANI', sfha: 'OUT', floodway: ' ' }), 'not_mapped');
  assert.equal(summarizeFloodRows([stevensFloodRow({ zone_: 'ANI', sfha: 'OUT' })]).high, false);
  assert.equal(category({ zone_: 'ZZ', sfha: 'OUT' }), 'undetermined', 'an unknown code is never safe');
  assert.equal(category({ zone_: 'ZZ', sfha: 'IN' }), 'high');
  assert.equal(category({ zone_: ' x500 ', sfha: 'OUT' }), 'moderate');
  // Worst zone wins across rows, as for FEMA.
  assert.equal(summarizeFloodRows([{ zone_: 'X' }, { zone_: 'X500' }, { zone_: 'ANI' }].map(stevensFloodRow)).category, 'moderate');
});

// --- Frontend labels -------------------------------------------------------------------------

test('stevens flood: the page names the county copy and says FEMA has no digital map', async () => {
  stubFetch(empty, county(ae));
  const { body } = await floodCall(ae.geometry);
  assert.deepEqual(plain(FX.grade(body)), {
    category: 'high', score: 20, label: 'High risk', cls: 'red', overview: 'High-risk flood zone (county copy of FEMA paper map)', overviewCls: 'warn',
    detail: 'Flood zone AE (1% annual chance, Special Flood Hazard Area); also zone X (minimal flood hazard). Source: Stevens County digitized FEMA FIRM (paper map copy, not a FEMA digital map). FEMA has no digital flood map here. Verify with the county or FEMA.'
  });
  const moderate = { ...summarizeFloodRows([stevensFloodRow({ zone_: 'X500' })]), source: body.source };
  assert.equal(FX.grade(moderate).detail, 'Flood zone X (0.2% annual chance). Source: Stevens County digitized FEMA FIRM (paper map copy, not a FEMA digital map). FEMA has no digital flood map here. Verify with the county or FEMA.');
  assert.equal(FX.grade(moderate).score, 70);
  const notMapped = { ...summarizeFloodRows([stevensFloodRow({ zone_: 'ANI' })]), source: body.source };
  assert.equal(FX.grade(notMapped).overview, 'No digital FEMA flood map');
  assert.equal(FX.grade(notMapped).detail, FX.NOT_MAPPED_TEXT);
});

// --- Budget ----------------------------------------------------------------------------------

test('stevens flood: worst-case time stays under the 30 s client limit, and at most 4 requests', async () => {
  // After a FEMA answer (FEMA may have needed its retry): county 6 s + backoff + 4 s.
  assert.ok(FEMA_TIMEOUT_MS + FEMA_RETRY_BACKOFF_MS + FEMA_RETRY_TIMEOUT_MS + STEVENS_FLOOD_TIMEOUT_MS + 300 + STEVENS_FLOOD_RETRY_TIMEOUT_MS <= 25000);
  // After FEMA and Esri failed: one 5 s county attempt.
  assert.ok(FEMA_TIMEOUT_MS + FEMA_RETRY_BACKOFF_MS + FEMA_RETRY_TIMEOUT_MS + FALLBACK_TIMEOUT_MS + STEVENS_FLOOD_LATE_TIMEOUT_MS <= 28000);
  globalThis.fetch = async input => { calls.push({ url: String(input), params: new URLSearchParams() }); throw new TypeError('fetch failed'); };
  assert.equal((await floodCall(ae.geometry)).response.status, 502);
  assert.deepEqual(kinds(), ['fema', 'fema', 'esri', 'county']);
});
