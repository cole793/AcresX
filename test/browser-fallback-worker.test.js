// Offline tests for the Worker side of the browser fallback (src/shared/fallback.js): an eligible
// upstream failure adds `fallback: { mode: 'browser', kind, input }` to the answer and nothing
// else changes; success and non-eligible failures add nothing. fetch is stubbed; no live servers.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { isFallbackEligible, fallbackHint, FALLBACK_KINDS } from '../src/shared/fallback.js';
import { UpstreamError, configureUpstream } from '../src/shared/upstream.js';
import { FEMA_NFHL_FLOOD_LAYER, ESRI_USA_FLOOD_HAZARD_LAYER } from '../src/services/flood.js';

const KC = 'https://map.kcgov.us/arcgis/rest/services/NewServices';
const PARCELS = `${KC}/Ownership_Display/MapServer/0/query`;
const ZONING = `${KC}/Data_Layers/MapServer/21/query`;
const CITY_LIMITS = `${KC}/Data_Layers/MapServer/18/query`;
const IMPACT = `${KC}/Data_Layers/MapServer/17/query`;
const CDA = 'https://gis.cdaid.org/server/rest/services/Share/Planning/MapServer/8/query';
const IDWR = 'https://gis.idwr.idaho.gov/hosting/rest/services/Groundwater/Wells/FeatureServer/0/query';

const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const ring = square(-116.8, 47.7, -116.79, 47.71);
const geometry = { type: 'Polygon', coordinates: [ring] };
const big = { rings: [square(-116.81, 47.69, -116.78, 47.72)] };
const zoningAnswer = { features: [{ attributes: { ZONE_NAME: 'Rural', LABEL: 'Rural', ACRES: 120 }, geometry: big }] };
const unincorporated = { features: [{ attributes: { CITY: ' ' }, geometry: big }] };
const inCda = { features: [{ attributes: { CITY: 'Coeur d Alene' }, geometry: big }] };
const empty = { features: [] };
const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const down = status => () => reply('blocked', status);

let calls;
// answers: { base: body | fn(n) -> body | Response }
function stub(answers) {
  calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const base = url.origin + url.pathname;
    calls.push(base);
    if (!(base in answers)) throw new Error(`unexpected request ${base}`);
    const a = typeof answers[base] === 'function' ? answers[base](calls.filter(c => c === base).length) : answers[base];
    return a instanceof Response ? a : reply(a);
  };
}

const realFetch = globalThis.fetch;
const realWarn = console.warn;
let restoreUpstream;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; console.warn = () => {}; restoreUpstream = configureUpstream({ backoffMs: 0 }); });
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream(); });

const env = { ASSETS: { fetch: async () => new Response('') } };
async function api(path, body) {
  const response = await worker.fetch(new Request(`https://acresx.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}

// ---- Classification

test('fallback: eligible failures are network, timeout and 403/429/5xx (HTTP or ArcGIS code)', () => {
  const e = fields => new UpstreamError('x', fields);
  for (const fields of [{ kind: 'network' }, { kind: 'timeout' }, { kind: 'http', status: 403 }, { kind: 'http', status: 429 }, { kind: 'http', status: 500 }, { kind: 'http', status: 525 }, { kind: 'arcgis', code: 503 }]) {
    assert.equal(isFallbackEligible(e(fields)), true, JSON.stringify(fields));
  }
  for (const fields of [{ kind: 'http', status: 400 }, { kind: 'http', status: 404 }, { kind: 'arcgis', code: 400 }, { kind: 'arcgis', code: 499 }, { kind: 'json' }, { kind: 'cancelled' }, { kind: 'invalid' }, {}]) {
    assert.equal(isFallbackEligible(e(fields)), false, JSON.stringify(fields));
  }
  assert.equal(isFallbackEligible(null), false);
  assert.deepEqual(fallbackHint('fema-flood', { a: 1 }), { mode: 'browser', kind: 'fema-flood', input: { a: 1 } });
  assert.deepEqual(Object.values(FALLBACK_KINDS), ['kootenai-parcel', 'kootenai-zoning', 'idaho-wells', 'kootenai-assessor', 'fema-flood']);
});

// ---- Kootenai zoning (/api/zoning-permits)

const kootenaiBody = { county: 'Kootenai', parcelId: 'P50N04W123456', lat: 47.705, lon: -116.795, geometry };
const kootenaiHint = { mode: 'browser', kind: 'kootenai-zoning', input: { parcelId: 'P50N04W123456', lat: 47.705, lon: -116.795, geometry } };

test('fallback: Kootenai zoning success carries no hint', async () => {
  stub({ [PARCELS]: empty, [ZONING]: zoningAnswer, [CITY_LIMITS]: unincorporated, [IMPACT]: empty });
  const { status, body } = await api('/api/zoning-permits', kootenaiBody);
  assert.equal(status, 200);
  assert.equal(body.zoning.code, 'Rural');
  assert.equal('fallback' in body, false);
});

test('fallback: Kootenai county zoning blocked (403) keeps the 502 shape and adds the hint', async () => {
  stub({ [PARCELS]: down(403), [ZONING]: down(403), [CITY_LIMITS]: unincorporated, [IMPACT]: empty });
  const { status, body } = await api('/api/zoning-permits', kootenaiBody);
  assert.equal(status, 502);
  const { fallback, ...rest } = body;
  assert.deepEqual(rest, {
    available: false, county: 'Kootenai', state: 'ID', countyStatus: 'kootenai-error', jurisdiction: 'Kootenai County', permitJurisdiction: { name: 'Kootenai County' },
    zoning: { status: 'unavailable', label: 'Kootenai zoning lookup unavailable', note: 'Kootenai County GIS returned 403' }, permits: [], error: 'Kootenai County GIS returned 403'
  });
  assert.deepEqual(fallback, kootenaiHint);
});

test('fallback: Kootenai county zoning timeout / network error adds the hint; an ArcGIS 400 does not', async () => {
  stub({ [PARCELS]: empty, [ZONING]: () => { throw new TypeError('fetch failed'); }, [CITY_LIMITS]: unincorporated, [IMPACT]: empty });
  assert.deepEqual((await api('/api/zoning-permits', kootenaiBody)).body.fallback, kootenaiHint);
  stub({ [PARCELS]: empty, [ZONING]: { error: { code: 400, message: 'Invalid query' } }, [CITY_LIMITS]: unincorporated, [IMPACT]: empty });
  const { status, body } = await api('/api/zoning-permits', kootenaiBody);
  assert.equal(status, 502);
  assert.equal('fallback' in body, false);
});

test('fallback: Kootenai city limits down -> county zoning answer plus the hint (the parcel may be in a city)', async () => {
  stub({ [PARCELS]: empty, [ZONING]: zoningAnswer, [CITY_LIMITS]: down(503), [IMPACT]: empty });
  const { status, body } = await api('/api/zoning-permits', kootenaiBody);
  assert.equal(status, 200);
  const { fallback, ...rest } = body;
  assert.equal(rest.zoning.code, 'Rural');
  assert.equal(rest.available, true);
  assert.deepEqual(fallback, kootenaiHint);
});

test('fallback: a city zoning layer that fails eligibly adds the hint to its "unavailable" answer', async () => {
  stub({ [PARCELS]: empty, [ZONING]: zoningAnswer, [CITY_LIMITS]: inCda, [IMPACT]: empty, [CDA]: down(429) });
  const { status, body } = await api('/api/zoning-permits', kootenaiBody);
  assert.equal(status, 200);
  assert.equal(body.zoning.status, 'unavailable');
  assert.equal(body.jurisdiction, "City of Coeur d'Alene");
  assert.deepEqual(body.fallback, kootenaiHint);
  stub({ [PARCELS]: empty, [ZONING]: zoningAnswer, [CITY_LIMITS]: inCda, [IMPACT]: empty, [CDA]: { error: { code: 400, message: 'bad' } } });
  assert.equal('fallback' in (await api('/api/zoning-permits', kootenaiBody)).body, false);
});

test('fallback: the Kootenai hint leaves out what the request did not have', async () => {
  stub({ [PARCELS]: empty, [ZONING]: down(500), [CITY_LIMITS]: unincorporated, [IMPACT]: empty });
  const { body } = await api('/api/zoning-permits', { county: 'Kootenai', parcelId: 'P1', lat: 47.7, lon: -116.8 });
  assert.deepEqual(body.fallback, { mode: 'browser', kind: 'kootenai-zoning', input: { parcelId: 'P1', lat: 47.7, lon: -116.8 } });
});

// ---- Kootenai parcel search (/api/parcel-search)

const KC_PARCEL = `${KC}/Ownership_Display/MapServer/0/query`;
const STATEWIDE = 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/ArcGIS/rest/services/Public_Idaho_Parcels_/FeatureServer/7/query';
const IDWR_PARCELS_HOST = 'gis.idwr.idaho.gov';
// Every Kootenai/IDWR/statewide request fails the way the 2026-10-29 outage did.
function parcelStub(county) {
  calls = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(url.origin + url.pathname);
    if (url.origin + url.pathname === KC_PARCEL) return county();
    if (url.hostname === IDWR_PARCELS_HOST || url.origin + url.pathname === STATEWIDE) { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; throw e; }
    throw new Error(`unexpected request ${url.href}`);
  };
}

test('fallback: Kootenai parcel search with every source timing out -> the { error } 502 plus the parcel hint', async () => {
  parcelStub(() => { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; throw e; });
  const { status, body } = await api('/api/parcel-search', { state: 'ID', county: 'Kootenai', parcelId: '50N04W323200' });
  assert.equal(status, 502);
  assert.deepEqual(Object.keys(body).sort(), ['error', 'fallback']);
  assert.match(body.error, /^Idaho parcel sources failed for Kootenai/);
  assert.deepEqual(body.fallback, { mode: 'browser', kind: 'kootenai-parcel', input: { parcelId: '50N04W323200' } });
});

test('fallback: Kootenai parcel search gets no hint when the county layer answered (miss or 400)', async () => {
  parcelStub(() => reply(empty));
  const miss = await api('/api/parcel-search', { state: 'ID', county: 'Kootenai', parcelId: '50N04W323200' });
  assert.equal(miss.status, 502);
  assert.equal('fallback' in miss.body, false, 'a county miss: the browser would miss too');
  parcelStub(() => reply({ error: { code: 400, message: 'Invalid query' } }));
  assert.equal('fallback' in (await api('/api/parcel-search', { state: 'ID', county: 'Kootenai', parcelId: '50N04W323200' })).body, false);
});

test('fallback: other Idaho counties never get the Kootenai parcel hint', async () => {
  calls = [];
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const { status, body } = await api('/api/parcel-search', { state: 'ID', county: 'Bonner', parcelId: 'RP1' });
  assert.equal(status, 502);
  assert.deepEqual(Object.keys(body), ['error']);
});

// ---- Idaho wells (/api/well-search)

const wellsAnswer = { type: 'FeatureCollection', features: Array.from({ length: 5 }, (_, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-116.8 + i / 1000, 47.7] }, properties: { WellID: i + 1, TotalDepth: 100 + i } })) };

test('fallback: IDWR wells blocked (403) keeps the { error } 502 and adds the hint', async () => {
  stub({ [IDWR]: down(403) });
  const { status, body } = await api('/api/well-search', { state: 'ID', county: 'Kootenai', lat: 47.7, lon: -116.8 });
  assert.equal(status, 502);
  assert.deepEqual(Object.keys(body).sort(), ['error', 'fallback']);
  assert.equal(body.error, 'Idaho well service returned 403');
  assert.deepEqual(body.fallback, { mode: 'browser', kind: 'idaho-wells', input: { lat: 47.7, lon: -116.8 } });
});

test('fallback: IDWR wells success and an ArcGIS 400 carry no hint', async () => {
  stub({ [IDWR]: wellsAnswer });
  const ok = await api('/api/well-search', { state: 'ID', county: 'Kootenai', lat: 47.7, lon: -116.8 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.wells.length, 5);
  assert.equal('fallback' in ok.body, false);
  stub({ [IDWR]: { error: { code: 400, message: 'bad' } } });
  const bad = await api('/api/well-search', { state: 'ID', county: 'Kootenai', lat: 47.7, lon: -116.8 });
  assert.equal(bad.status, 502);
  assert.deepEqual(bad.body, { error: 'bad' });
});

// ---- Kootenai assessor (/api/property-assessment)

test('fallback: Kootenai assessor layers unreachable -> unavailable answer plus the hint', async () => {
  stub(Object.fromEntries([5, 6, 7, 8, 9, 10, 11].map(id => [`https://map.kcgov.us/arcgis/rest/services/Assessor_Layers/MapServer/${id}/query`, () => { throw new TypeError('fetch failed'); }])));
  const { status, body } = await api('/api/property-assessment', { state: 'ID', county: 'Kootenai', parcelId: '47N03W052200' });
  assert.equal(status, 200);
  const { fallback, ...rest } = body;
  assert.deepEqual(Object.keys(rest).sort(), ['available', 'county', 'countyRecords', 'countySource', 'countySourceUrl', 'error', 'parcelId', 'state']);
  assert.equal(rest.available, false);
  assert.deepEqual(fallback, { mode: 'browser', kind: 'kootenai-assessor', input: { parcelId: '47N03W052200' } });
});

test('fallback: Kootenai assessor not-found and 400 errors carry no hint', async () => {
  stub(Object.fromEntries([5, 6, 7, 8, 9, 10, 11].map(id => [`https://map.kcgov.us/arcgis/rest/services/Assessor_Layers/MapServer/${id}/query`, empty])));
  const miss = await api('/api/property-assessment', { state: 'ID', county: 'Kootenai', parcelId: '47N03W052200' });
  assert.equal(miss.body.note, 'No Kootenai County Assessor record matched this parcel number.');
  assert.equal('fallback' in miss.body, false);
  stub(Object.fromEntries([5, 6, 7, 8, 9, 10, 11].map(id => [`https://map.kcgov.us/arcgis/rest/services/Assessor_Layers/MapServer/${id}/query`, id === 7 ? { error: { code: 400, message: 'bad' } } : empty])));
  const bad = await api('/api/property-assessment', { state: 'ID', county: 'Kootenai', parcelId: '47N03W052200' });
  assert.ok(bad.body.error);
  assert.equal('fallback' in bad.body, false);
});

// ---- FEMA flood (/api/hazards kind flood)

const esriAE = { features: [{ attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T' } }] };
const femaX = { features: [{ attributes: { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' } }] };

test('fallback: FEMA 403 (as from Cloudflare today) -> Esri answer plus the FEMA hint', async () => {
  stub({ [`${FEMA_NFHL_FLOOD_LAYER}/query`]: down(403), [`${ESRI_USA_FLOOD_HAZARD_LAYER}/query`]: esriAE });
  const { status, body } = await api('/api/hazards', { kind: 'flood', geometry });
  assert.equal(status, 200);
  assert.equal(body.source.provider, 'Esri USA Flood Hazard Areas');
  assert.deepEqual(body.fallback, { mode: 'browser', kind: 'fema-flood', input: { geometry } });
});

test('fallback: FEMA success and FEMA 400 carry no hint', async () => {
  stub({ [`${FEMA_NFHL_FLOOD_LAYER}/query`]: femaX });
  const ok = await api('/api/hazards', { kind: 'flood', geometry });
  assert.equal(ok.body.category, 'minimal');
  assert.equal('fallback' in ok.body, false);
  stub({ [`${FEMA_NFHL_FLOOD_LAYER}/query`]: down(400), [`${ESRI_USA_FLOOD_HAZARD_LAYER}/query`]: esriAE });
  assert.equal('fallback' in (await api('/api/hazards', { kind: 'flood', geometry })).body, false);
});
