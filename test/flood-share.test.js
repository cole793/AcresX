// Offline tests for flood zone shares: src/shared/polygon-coverage.js stripAreas, the share step
// in src/services/flood-share.js (through POST /api/hazards { kind: 'flood' }), and the page's
// reading of it (public/flood-status.js shareText / overviewShare, the property report and the
// overview fact). fetch is stubbed by URL and `where`; no live FEMA or Esri calls.
// Recorded fixture: fixtures/fema-flood-share-23123.9051.json (FEMA zone A outline for Spokane
// parcel 23123.9051, 2026-11-14).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker from '../src/index.js';
import { FEMA_NFHL_FLOOD_LAYER, ESRI_USA_FLOOD_HAZARD_LAYER, CACHE_KEY_PREFIX, describeFloodRow } from '../src/services/flood.js';
import { floodShares, floodSharePlan, WHERE_NOT_X, WHERE_SHADED, FLOOD_SHARE_MAX_BYTES } from '../src/services/flood-share.js';
import { stripAreas, ringsFromGeometry, SQM_PER_ACRE } from '../src/shared/polygon-coverage.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { makeLazyContext, readPublic } from './ui-harness.js';

const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const plain = v => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

// A 0.01 x 0.01 degree parcel (about 206 acres at 47.7 N).
const W = -116.8, E = -116.79, S = 47.7, N = 47.71;
const box = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const geometry = { type: 'Polygon', coordinates: box(W, S, E, N) };
const esriPolygon = (x0, y0, x1, y1) => ({ rings: box(x0, y0, x1, y1), spatialReference: { wkid: 4326 } });
const feature = (attributes, polygon) => ({ attributes, geometry: polygon });
const A = { FLD_ZONE: 'A', ZONE_SUBTY: null, SFHA_TF: 'T' };
const AE = { FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T' };
const AE_FW = { FLD_ZONE: 'AE', ZONE_SUBTY: 'FLOODWAY', SFHA_TF: 'T' };
const X_MIN = { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' };
const X_02 = { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F' };

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const realWarn = console.warn;
let calls, restoreUpstream;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
// handler({ base, where, returnGeometry, params, n }) -> body object or Response.
function stub(handler) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const params = new URLSearchParams(url.search);
    if (init.body) new URLSearchParams(String(init.body)).forEach((v, k) => params.set(k, v));
    const call = { base: url.origin + url.pathname, where: params.get('where'), returnGeometry: params.get('returnGeometry'), params, n: calls.length + 1 };
    calls.push(call);
    const answer = await handler(call);
    return answer instanceof Response ? answer : jsonResponse(answer);
  };
}
const FEMA = `${FEMA_NFHL_FLOOD_LAYER}/query`;
const ESRI = `${ESRI_USA_FLOOD_HAZARD_LAYER}/query`;
// FEMA: the zone query (no geometry) answers `zones`; share queries answer by their where clause.
const femaWith = (zones, byWhere = {}) => stub(c => {
  if (c.base !== FEMA) throw new Error(`unexpected ${c.base}`);
  if (c.returnGeometry !== 'true') return { features: zones.map(attributes => ({ attributes })) };
  const answer = byWhere[c.where];
  if (answer === undefined) throw new Error(`unexpected share query ${c.where}`);
  return typeof answer === 'function' ? answer(c) : { features: answer };
});

function fakeCache() {
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); }
  } };
  return store;
}

async function floodCall(g = geometry, ctx) {
  const pending = [];
  const request = new Request('https://acresx.test/api/hazards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'flood', geometry: g }) });
  const response = await worker.fetch(request, {}, ctx || { waitUntil(p) { pending.push(p); } });
  await Promise.all(pending);
  return { response, body: await response.json() };
}

beforeEach(() => { calls = []; delete globalThis.caches; console.warn = () => {}; restoreUpstream = configureUpstream({ backoffMs: 0 }); });
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  restoreUpstream();
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} not within ${tolerance} of ${expected}`);

// ---- stripAreas

test('stripAreas: halves, quarters, holes and overlapping polygons counted once', () => {
  const parcel = ringsFromGeometry(geometry);
  const west = box(W, S, (W + E) / 2, N);
  const southWest = box(W - 1, S - 1, (W + E) / 2, (S + N) / 2);
  const holed = [...box(W - 1, S - 1, E + 1, N + 1), ...box(W + 0.0025, S + 0.0025, E - 0.0025, N - 0.0025)];
  const { parcelSqM, groups } = stripAreas(parcel, { west: [west], sw: [southWest], holed: [holed], twice: [west, west, southWest], none: [] });
  near(groups.west / parcelSqM, 0.5, 0.0005, 'west half');
  near(groups.sw / parcelSqM, 0.25, 0.003, 'south-west quarter');
  near(groups.holed / parcelSqM, 0.75, 0.003, 'all but the central quarter');
  near(groups.twice / parcelSqM, 0.5, 0.0005, 'overlaps count once');
  assert.equal(groups.none, 0);
  // 0.01 x 0.01 degrees at 47.705 N on a 6,371,008.8 m sphere.
  const expected = (0.01 * Math.PI / 180 * 6371008.8) ** 2 * Math.cos(47.705 * Math.PI / 180);
  near(parcelSqM, expected, expected * 0.001, 'parcel area');
});

test('stripAreas: the recorded zone A outline covers about 67% of Spokane parcel 23123.9051', () => {
  const parcel = ringsFromGeometry(fixture('report-spokane-23123.9051.json').parcel.geometry);
  const zoneA = ringsFromGeometry(fixture('fema-flood-share-23123.9051.json').features[0].geometry);
  const { parcelSqM, groups } = stripAreas(parcel, { a: [zoneA] });
  // 400 strips: 67.12%; 10,000 strips: 67.13% (checked 2026-11-14).
  near(groups.a / parcelSqM, 0.6712, 0.001, 'zone A share');
  near(parcelSqM / SQM_PER_ACRE, 20.63, 0.05, 'parcel acres (assessor: 20.48)');
});

// ---- plan

test('plan: minimal X needs no query; A/AE ask NOT IN (X, C); shaded X asks the subtype query', () => {
  const describe = row => describeFloodRow(row);
  assert.deepEqual(plain(floodSharePlan([X_MIN], { describe })), { queries: [], restZone: 'X' });
  assert.deepEqual(floodSharePlan([AE, X_MIN], { describe }).queries.map(q => q.where), [WHERE_NOT_X]);
  assert.deepEqual(floodSharePlan([X_02, X_MIN], { describe }).queries.map(q => q.where), [WHERE_SHADED]);
  assert.deepEqual(floodSharePlan([AE, X_02], { describe }).queries.map(q => q.where), [WHERE_NOT_X, WHERE_SHADED]);
  assert.equal(floodSharePlan([AE, X_02], { describe }).restZone, null);
  // FEMA's firewall answers any where clause with " AND " or " OR " with an empty HTTP 202.
  for (const where of [WHERE_NOT_X, WHERE_SHADED]) assert.doesNotMatch(where, /\s(AND|OR)\s/i);
});

// ---- Worker, end to end

test('partial: zone A on the west quarter, the rest zone X; shares, acres, cached under v6', async () => {
  const store = fakeCache();
  femaWith([A, X_MIN], { [WHERE_NOT_X]: [feature(A, esriPolygon(W - 0.01, S - 0.01, W + 0.0025, N + 0.01))] });
  const { response, body } = await floodCall();
  assert.equal(response.status, 200);
  // The zone answer is unchanged.
  assert.deepEqual(body.zones, ['A', 'X']);
  assert.equal(body.category, 'high');
  assert.equal(body.high, true);
  assert.deepEqual(body.source, { provider: 'FEMA NFHL', url: FEMA_NFHL_FLOOD_LAYER });
  // Added fields.
  assert.equal(body.floodZones.length, 2);
  const [x, a] = body.floodZones;
  assert.deepEqual({ ...x, acres: undefined }, { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false, category: 'minimal', sharePct: 75, acres: undefined, remainder: true });
  assert.deepEqual({ ...a, acres: undefined }, { zone: 'A', subtype: null, sfha: true, category: 'high', sharePct: 25, acres: undefined });
  near(a.acres + x.acres, body.parcelAcres, 0.02, 'zone acres add up');
  near(body.parcelAcres, 205.6, 1, 'parcel acres');
  assert.equal(body.sfhaSharePct, 25);
  assert.equal(body.sfhaAcres, a.acres);
  assert.deepEqual(body.floodShare, { status: 'measured', method: 'strip-integration', source: 'FEMA NFHL', restSharePct: 75, restZone: 'X' });
  // Requests: the zone query, then one share query with outlines in WGS84, generalized ~1 m.
  assert.equal(calls.length, 2);
  const share = calls[1].params;
  assert.equal(share.get('where'), WHERE_NOT_X);
  assert.equal(share.get('outSR'), '4326');
  assert.equal(share.get('maxAllowableOffset'), '0.00001');
  assert.equal(share.get('spatialRel'), 'esriSpatialRelIntersects');
  assert.equal(store.size, 1);
  assert.ok([...store.keys()][0].startsWith(CACHE_KEY_PREFIX));
  assert.ok(CACHE_KEY_PREFIX.endsWith('/flood/v6/'));
  // A repeat call is served from the cache with the shares.
  calls = [];
  const again = await floodCall();
  assert.equal(calls.length, 0);
  assert.deepEqual(again.body.floodZones, body.floodZones);
});

test('full: zone AE covers the whole parcel; no remainder entry', async () => {
  femaWith([AE], { [WHERE_NOT_X]: [feature(AE, esriPolygon(W - 1, S - 1, E + 1, N + 1))] });
  const { body } = await floodCall();
  assert.deepEqual(body.floodZones.map(z => [z.zone, z.sharePct, Boolean(z.remainder)]), [['AE', 100, false]]);
  assert.equal(body.sfhaSharePct, 100);
  assert.equal(body.sfhaAcres, body.parcelAcres);
  assert.equal(body.floodShare.restSharePct, 0);
  assert.equal(body.floodShare.restZone, null);
});

test('none: all minimal X costs no extra request and is 100% zone X', async () => {
  femaWith([X_MIN]);
  const { body } = await floodCall();
  assert.equal(calls.length, 1);
  assert.equal(body.category, 'minimal');
  assert.deepEqual(body.floodZones.map(z => [z.zone, z.sharePct, z.remainder]), [['X', 100, true]]);
  assert.equal(body.sfhaSharePct, 0);
  assert.equal(body.floodShare.method, 'single-zone');
});

test('no zone at all (not mapped) adds no share fields', async () => {
  femaWith([]);
  const { body } = await floodCall();
  assert.equal(calls.length, 1);
  for (const key of ['floodZones', 'sfhaSharePct', 'sfhaAcres', 'parcelAcres', 'floodShare']) assert.equal(key in body, false, key);
});

test('edge only: an A polygon that only meets the parcel line measures 0% and is flagged', async () => {
  femaWith([A, X_MIN], { [WHERE_NOT_X]: [feature(A, esriPolygon(W - 0.01, S, W, N))] });
  const { body } = await floodCall();
  assert.equal(body.sfhaSharePct, 0);
  const a = body.floodZones.find(z => z.zone === 'A');
  assert.equal(a.sharePct, 0);
  assert.equal(a.edgeOnly, true);
  assert.equal(body.floodZones.find(z => z.remainder).sharePct, 100);
  assert.equal(body.category, 'high', 'the category and score never change with the share');
});

test('shaded X and floodway: both share queries run, AE from the subtype query is not counted twice', async () => {
  femaWith([AE, AE_FW, X_02, X_MIN], {
    [WHERE_NOT_X]: [feature(AE, esriPolygon(W - 1, S - 1, W + 0.002, N + 1)), feature(AE_FW, esriPolygon(W - 1, S - 1, W + 0.001, N + 1))],
    [WHERE_SHADED]: [feature(AE_FW, esriPolygon(W - 1, S - 1, W + 0.001, N + 1)), feature(X_02, esriPolygon(W + 0.002, S - 1, W + 0.005, N + 1))]
  });
  const { body } = await floodCall();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.slice(1).map(c => c.where).sort(), [WHERE_NOT_X, WHERE_SHADED].sort());
  const by = Object.fromEntries(body.floodZones.map(z => [`${z.zone}|${z.subtype || ''}`, z.sharePct]));
  assert.deepEqual(by, { 'AE|': 20, 'AE|FLOODWAY': 10, 'X|0.2 PCT ANNUAL CHANCE FLOOD HAZARD': 30, 'X|AREA OF MINIMAL FLOOD HAZARD': 50 });
  assert.equal(body.sfhaSharePct, 20, 'AE and its floodway overlap; the SFHA share counts them once');
});

test('upstream failure: the zone answer stands, floodShare says unavailable, no-store, not cached', async () => {
  const store = fakeCache();
  femaWith([A, X_MIN], { [WHERE_NOT_X]: () => new Response('busy', { status: 503 }) });
  const { response, body } = await floodCall();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(body.zones, ['A', 'X']);
  assert.equal(body.category, 'high');
  assert.equal('floodZones' in body, false);
  assert.equal('sfhaSharePct' in body, false);
  assert.deepEqual(body.floodShare, { status: 'unavailable', source: 'FEMA NFHL', error: 'FEMA NFHL returned 503' });
  assert.equal(calls.length, 3, 'one FEMA attempt, no retry, then the Esri backup once');
  assert.equal(calls[2].base, ESRI, 'the backup layer was asked');
  assert.equal(store.size, 0);
});

test('upstream failure: a timeout, an outline missing or an answer over the size cap degrade the same way', async () => {
  configureUpstream({ backoffMs: 0 });
  for (const [label, answer, message] of [
    ['no outline', () => ({ features: [{ attributes: A }] }), /without its outline/],
    ['too large', () => new Response('x'.repeat(FLOOD_SHARE_MAX_BYTES + 10), { status: 200, headers: { 'Content-Length': String(FLOOD_SHARE_MAX_BYTES + 10) } }), /larger than 3000000 bytes/],
    ['network', () => { throw new TypeError('fetch failed'); }, /fetch failed/]
  ]) {
    calls = [];
    femaWith([A, X_MIN], { [WHERE_NOT_X]: answer });
    const { body } = await floodCall();
    assert.equal(body.category, 'high', label);
    assert.equal(body.floodShare.status, 'unavailable', label);
    assert.match(body.floodShare.error, message, label);
  }
});

test('budget: with under 2 s left after the zone lookup, no share query is sent', async () => {
  globalThis.fetch = async () => { throw new Error('must not be called'); };
  const out = await floodShares(geometry, { layerUrl: FEMA_NFHL_FLOOD_LAYER, provider: 'FEMA NFHL', rows: [A, X_MIN], describe: r => describeFloodRow(r), timeoutMs: 1500 });
  assert.equal(out.floodShare.status, 'unavailable');
  assert.match(out.floodShare.error, /no time left/);
});

test('Esri backup: one 1=1 share query; the rest is outside mapped high/moderate areas', async () => {
  stub(c => {
    if (c.base === FEMA) return new Response('Forbidden', { status: 403 });
    if (c.base !== ESRI) throw new Error(`unexpected ${c.base}`);
    if (c.returnGeometry !== 'true') return { features: [{ attributes: { ...AE, esri_symbology: '1% Annual Chance Flood Hazard' } }] };
    assert.equal(c.where, '1=1');
    assert.equal(c.params.get('outFields'), 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,esri_symbology');
    return { features: [feature({ ...AE, esri_symbology: '1% Annual Chance Flood Hazard' }, esriPolygon(W - 1, S - 1, W + 0.004, N + 1))] };
  });
  const { body } = await floodCall();
  assert.equal(body.source.provider, 'Esri USA Flood Hazard Areas');
  assert.equal(body.fallback?.kind, 'fema-flood', 'the browser hint is kept');
  assert.deepEqual(body.floodZones.map(z => [z.zone, z.sharePct]), [['AE', 40]]);
  assert.deepEqual(body.floodShare, { status: 'measured', method: 'strip-integration', source: 'Esri USA Flood Hazard Areas', restSharePct: 60, restZone: null, coverage: 'high-and-moderate-risk-only' });
});

test('recorded: Spokane 23123.9051 measures zone A on about 67% (13.8 ac), the rest zone X', async () => {
  const parcel = fixture('report-spokane-23123.9051.json').parcel.geometry;
  femaWith([A, X_MIN], { [WHERE_NOT_X]: fixture('fema-flood-share-23123.9051.json').features });
  const { body } = await floodCall(parcel);
  assert.deepEqual(body.floodZones.map(z => [z.zone, z.sharePct, z.acres]), [['A', 67.1, 13.85], ['X', 32.9, 6.78]]);
  assert.equal(body.sfhaSharePct, 67.1);
  assert.equal(body.parcelAcres, 20.63);
});

// ---- FEMA outlines blocked (production 2026-11-14: FEMA answers 403 to a request without a
// User-Agent, which is what a Cloudflare Worker's fetch sends unless told otherwise)

const userAgent = init => (init?.headers instanceof Headers ? init.headers.get('User-Agent') : Object.entries(init?.headers || {}).find(([k]) => k.toLowerCase() === 'user-agent')?.[1]) || null;
// FEMA: zone query answers `zones`; share queries answer `outlines`, or 403 when `blocked` (or
// when the request has no User-Agent, like FEMA's firewall). Esri: `esriOutlines`, or 403.
function femaAndEsri({ zones, outlines = [], blocked = false, esriOutlines }) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const params = new URLSearchParams(url.search);
    if (init.body) new URLSearchParams(String(init.body)).forEach((v, k) => params.set(k, v));
    const call = { base: url.origin + url.pathname, where: params.get('where'), returnGeometry: params.get('returnGeometry'), ua: userAgent(init), n: calls.length + 1 };
    calls.push(call);
    if (call.base === FEMA) {
      if (!call.ua) return new Response('Forbidden', { status: 403 });
      if (call.returnGeometry !== 'true') return jsonResponse({ features: zones.map(attributes => ({ attributes })) });
      return blocked ? new Response('Forbidden', { status: 403 }) : jsonResponse({ features: outlines });
    }
    if (call.base === ESRI) return esriOutlines ? jsonResponse({ features: esriOutlines }) : new Response('Forbidden', { status: 403 });
    throw new TypeError(`network disabled: ${call.base}`);
  };
}

test('User-Agent: every FEMA request sends one (FEMA answers 403 without it), so shares are measured from FEMA', async () => {
  femaAndEsri({ zones: [A, X_MIN], outlines: [feature(A, esriPolygon(W - 1, S - 1, W + 0.0025, N + 1))] });
  const { body } = await floodCall();
  assert.equal(body.floodShare.status, 'measured');
  assert.equal(body.floodShare.source, 'FEMA NFHL');
  assert.deepEqual(body.floodZones.map(z => [z.zone, z.sharePct]), [['X', 75], ['A', 25]]);
  assert.ok(calls.every(c => c.ua === 'AcresX/0.5.2'), 'zone and share queries both carry the User-Agent');
  assert.equal(calls.some(c => c.base === ESRI), false, 'no backup needed');
});

test('FEMA outlines 403: shares come from the Esri backup copy, the rest stays FEMA zone X, cached', async () => {
  const store = fakeCache();
  femaAndEsri({
    zones: [A, X_MIN], blocked: true,
    esriOutlines: [
      feature({ ...A, esri_symbology: '1% Annual Chance Flood Hazard' }, esriPolygon(W - 1, S - 1, W + 0.0025, N + 1)),
      // Not in FEMA's zone answer for this parcel: dropped, FEMA's zone list is the authority.
      feature({ ...X_02, esri_symbology: '0.2% Annual Chance Flood Hazard' }, esriPolygon(E - 0.001, S - 1, E + 1, N + 1))
    ]
  });
  const { response, body } = await floodCall();
  assert.equal(response.status, 200);
  assert.equal(body.source.provider, 'FEMA NFHL', 'the zone answer is still FEMA\'s');
  assert.deepEqual(body.zones, ['A', 'X']);
  assert.deepEqual(body.floodZones.map(z => [z.zone, z.sharePct, Boolean(z.remainder)]), [['X', 75, true], ['A', 25, false]]);
  assert.equal(body.sfhaSharePct, 25);
  assert.deepEqual(body.floodShare, {
    status: 'measured', method: 'strip-integration', source: 'Esri USA Flood Hazard Areas', restSharePct: 75, restZone: 'X',
    fallbackFrom: { provider: 'FEMA NFHL', error: 'FEMA NFHL returned 403' }
  });
  assert.equal(calls.filter(c => c.base === ESRI).length, 1);
  assert.equal(calls.find(c => c.base === ESRI).where, '1=1');
  assert.equal(store.size, 1, 'a measured answer is cached');
});

test('FEMA outlines 403 and the backup lacks the zone (or fails): unmeasured, FEMA\'s error, not cached', async () => {
  for (const esriOutlines of [[], undefined]) {
    calls = [];
    const store = fakeCache();
    femaAndEsri({ zones: [A, X_MIN], blocked: true, esriOutlines });
    const { response, body } = await floodCall();
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(body.floodShare, { status: 'unavailable', source: 'FEMA NFHL', error: 'FEMA NFHL returned 403' });
    assert.equal('floodZones' in body, false);
    assert.equal(store.size, 0);
  }
});

test('recorded: Spokane 23123.9051 with FEMA outlines blocked measures zone A 67.1% from the Esri copy', async () => {
  const parcel = fixture('report-spokane-23123.9051.json').parcel.geometry;
  const zoneA = fixture('fema-flood-share-23123.9051.json').features.map(f => ({ ...f, attributes: { ...f.attributes, esri_symbology: '1% Annual Chance Flood Hazard' } }));
  femaAndEsri({ zones: [A, X_MIN], blocked: true, esriOutlines: zoneA });
  const { body } = await floodCall(parcel);
  assert.deepEqual(body.floodZones.map(z => [z.zone, z.sharePct, z.acres]), [['A', 67.1, 13.85], ['X', 32.9, 6.78]]);
  assert.equal(body.floodShare.source, 'Esri USA Flood Hazard Areas');
});

// ---- The page

function loadFlood() {
  const window = {};
  vm.runInNewContext(readFileSync(new URL('../public/flood-status.js', import.meta.url), 'utf8'), { window });
  return window.AcresXFlood;
}
const measuredAnswer = (zones, extra = {}) => ({
  available: true, intersects: true, high: true, zones: ['A', 'X'],
  zoneDetails: [{ zone: 'A', subtype: null, sfha: true }, { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false }],
  category: 'high', source: { provider: 'FEMA NFHL', url: FEMA_NFHL_FLOOD_LAYER },
  floodZones: zones, sfhaSharePct: zones.filter(z => z.sfha).reduce((s, z) => s + z.sharePct, 0), parcelAcres: 20.63,
  floodShare: { status: 'measured', method: 'strip-integration', source: 'FEMA NFHL', restSharePct: 0, restZone: 'X' }, ...extra
});
const zA = (sharePct, acres, more = {}) => ({ zone: 'A', subtype: null, sfha: true, category: 'high', sharePct, acres, ...more });
const zX = (sharePct, acres) => ({ zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false, category: 'minimal', sharePct, acres, remainder: true });

test('page: shareText and overviewShare for partial, full, edge-only and unmeasured answers', () => {
  const FX = loadFlood();
  assert.equal(FX.shareText(measuredAnswer([zX(88, 18.15), zA(12, 2.48)])), 'Zone A on 12% of parcel (2.5 ac); rest zone X (18.1 ac)');
  assert.equal(FX.overviewShare(measuredAnswer([zX(88, 18.15), zA(12, 2.48)])), '12% of parcel');
  assert.equal(FX.shareText(measuredAnswer([zA(100, 20.63)])), 'Zone A on all of the parcel (20.6 ac)');
  assert.equal(FX.overviewShare(measuredAnswer([zA(100, 20.63)])), 'whole parcel');
  assert.equal(FX.shareText(measuredAnswer([zX(99.7, 20.57), zA(0.3, 0.06)])), 'Zone A only touches the edge of the parcel (under 1%); rest zone X (20.6 ac)');
  assert.equal(FX.shareText(measuredAnswer([zX(100, 20.63), zA(0, 0, { edgeOnly: true })])), 'Zone A only touches the edge of the parcel (no measurable area); rest zone X (20.6 ac)');
  assert.equal(FX.overviewShare(measuredAnswer([zX(100, 20.63), zA(0, 0, { edgeOnly: true })])), 'edge only');
  assert.equal(FX.shareText(measuredAnswer([zX(97.6, 20.13), zA(2.4, 0.5)])), 'Zone A on 2.4% of parcel (0.50 ac); rest zone X (20.1 ac)');
  // Not measured: nothing to say, and the grade is unchanged either way.
  const unmeasured = measuredAnswer([], { floodShare: { status: 'unavailable', error: 'x' } });
  delete unmeasured.floodZones;
  assert.equal(FX.shareText(unmeasured), '');
  assert.equal(FX.overviewShare(unmeasured), '');
  assert.deepEqual(plain(FX.grade(unmeasured)), plain(FX.grade(measuredAnswer([zX(88, 18.15), zA(12, 2.48)]))));
  // Esri backup: the rest is not called zone X.
  const backup = measuredAnswer([zA(40, 8.25)], { source: { provider: 'Esri USA Flood Hazard Areas', coverage: 'high-and-moderate-risk-only' }, floodShare: { status: 'measured', restSharePct: 60, restZone: null, coverage: 'high-and-moderate-risk-only' } });
  assert.equal(FX.shareText(backup), 'Zone A on 40% of parcel (8.3 ac); rest outside mapped high- and moderate-risk areas (60%)');
});

function report(data) {
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: data });
  for (const f of ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'property-report-v2.js']) h.run(readPublic(f));
  h.el('scoreMetric').textContent = '';
  h.context.__acresxLast = data;
  h.generate();
  return h.opened.at(-1).replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
}

test('report: the flood card and key finding give the measured share instead of "not measured"', () => {
  const data = fixture('report-spokane-23123.9051.json');
  const before = report(data);
  assert.match(before, /Mapped share of the parcel not measured/);
  data.flood = measuredAnswer([zA(67.1, 13.85), zX(32.9, 6.78)]);
  const after = report(data);
  assert.doesNotMatch(after, /Mapped share of the parcel not measured/);
  assert.match(after, /High-risk flood zone on the parcel Zone A on 67% of parcel \(13\.8 ac\); rest zone X \(6\.8 ac\)/, 'key finding');
  assert.match(after, /Zone A on 67% of parcel \(13\.8 ac\); rest zone X \(6\.8 ac\)\. Map estimate; a floodplain determination confirms where the line falls\./, 'flood card');
  assert.match(after, /Get a floodplain determination/, 'next steps keep the verify framing');
});

test('report: an edge-only zone A is said plainly', () => {
  const data = fixture('report-spokane-23123.9051.json');
  data.flood = measuredAnswer([zX(100, 20.63), zA(0, 0, { edgeOnly: true })]);
  assert.match(report(data), /Zone A only touches the edge of the parcel \(no measurable area\); rest zone X/);
});

test('overview fact: "High-risk flood zone · 12% of parcel" when measured, unchanged otherwise', () => {
  const source = readFileSync(new URL('../public/parcel-preview.js', import.meta.url), 'utf8');
  assert.match(source, /FX\.overviewShare\(result\)/);
  const FX = loadFlood();
  const answer = measuredAnswer([zX(88, 18.15), zA(12, 2.48)]);
  assert.equal(`${FX.grade(answer).overview} · ${FX.overviewShare(answer)}`, 'High-risk flood zone · 12% of parcel');
});
