// Spokane County overlay layers in /api/zoning-permits (src/counties/spokane-overlays.js: critical
// areas, shoreline designations, airport zones), read across the parcel with
// src/shared/polygon-coverage.js overlapShares, and the browser module that shows them
// (public/zoning-overlays.js). Additive only; one failing layer degrades only that overlay.
// Offline: globalThis.fetch is stubbed. Jurisdiction, zoning and overlay answers for real parcels
// were recorded live (read-only) into test/fixtures/spokane-zoning-<parcel>.json (overlays for
// 07123.9075 on 2026-11-10) and test/fixtures/spokane-overlays-25335.9034.json.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureUpstream } from '../src/shared/upstream.js';
import { getSpokaneCountyIntelligence } from '../src/counties/spokane.js';
import { SPOKANE_OVERLAY_LAYERS, queryOverlayShares, overlayResponse } from '../src/counties/spokane-overlays.js';
import { overlapShares, ringsFromGeometry, samplePoints } from '../src/shared/polygon-coverage.js';
import { getZoningProfile } from '../src/zoning-counties.js';
import { makeClock, makeContext, readPublic } from './ui-harness.js';

const profile = getZoningProfile('Spokane');
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const realWarn = console.warn;
let calls, restoreUpstream, store;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const fixture = id => load(`spokane-zoning-${id}`);
const bodyOf = fx => ({ county: 'Spokane', ...fx.parcel });
const pathOf = url => `${url.hostname}${url.pathname}`;
const down = () => new Response('down', { status: 500 });

const COMP = { features: [{ attributes: { LANDUSECODE: 'CITY', LANDUSEDESC: 'City' } }] };
const PERMITS = { features: [{ attributes: { PERMITNUM: 'B-1', PERMITTYPE: 'Residential', STATUS: 'Final' } }] };
const OVERLAY_PATH = /CriticalAreasBPPublic\/MapServer\/\d+\/query|ZoningLookup\/MapServer\/[01]\/query/;

// Recorded answers by host+path, then overlays not recorded (none there), then canned extras.
// `override` ([path regex, Response factory]) simulates failures.
function stub(responses, override = []) {
  calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push({ url, init });
    const key = pathOf(url);
    for (const [re, make] of override) if (re.test(key)) return make();
    if (responses[key]) return json(responses[key]);
    if (OVERLAY_PATH.test(key)) return json({ features: [] });
    if (/ZoningLookup\/MapServer\/4\/query/.test(key)) return json(COMP);
    if (/ZoningLookup\/MapServer\/2\/query/.test(key)) return json({ features: [] });
    if (/\/BPPublic\/BPPublic\/MapServer\/5\/query/.test(key)) return json(PERMITS);
    throw new Error(`unexpected request ${key}`);
  };
}

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

// ---- Overlays

const overlay = (zp, type) => zp.overlays.filter(o => o.type === type);

test('overlays present (07123.9075): shoreline designation and aquifer recharge, read across the parcel, with the verify note', async () => {
  const fx = fixture('07123.9075');
  stub(fx.responses);
  const zp = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  assert.deepEqual(overlay(zp, 'shoreline').map(o => o.name), ['Shoreline designation: Rural Conservancy']);
  const cara = overlay(zp, 'aquifer_recharge');
  assert.deepEqual(cara.map(o => o.name).sort(), ['Critical aquifer recharge area: high susceptibility', 'Critical aquifer recharge area: low susceptibility']);
  for (const o of zp.overlays) {
    assert.ok(o.share >= 0 && o.share <= 1, `${o.name} ${o.share}`);
    assert.match(o.sourceUrl, /^https:\/\/gismo\.spokanecounty\.org\/arcgis\/rest\/services\//);
    assert.ok(o.source && o.detail);
  }
  // The water body rows ('Water') are not designations.
  assert.equal(zp.overlays.some(o => /Water/.test(o.name)), false);
  assert.deepEqual(zp.overlaysUnavailable, []);
  assert.match(zp.overlayNote, /screening information only.*Verify with Spokane County Building & Planning/);
  // Additive only: the zone and its rules are what they were.
  assert.equal(zp.zoning.code, 'RCV');
  // Each overlay layer asked once, as a polygon query.
  for (const layer of SPOKANE_OVERLAY_LAYERS) {
    const asked = calls.filter(c => pathOf(c.url) === `${new URL(layer.url).hostname}${new URL(layer.url).pathname}/query`);
    assert.equal(asked.length, 1, layer.type);
    const params = new URLSearchParams(asked[0].init?.body || asked[0].url.search);
    assert.equal(params.get('geometryType'), 'esriGeometryPolygon');
  }
  assert.equal(store.size, 1, 'a full answer is cached');
  const before = calls.length;
  assert.deepEqual(await getSpokaneCountyIntelligence(bodyOf(fx), profile), zp, 'a cache hit answers the same');
  assert.equal(calls.length, before);
});

test('overlays present (25335.9034, near SIA): nested airfield zones each counted, FAR Part 77 restriction', async () => {
  const fx = load('spokane-overlays-25335.9034');
  stub(fx.responses);
  const rings = ringsFromGeometry(fx.parcel.geometry);
  const where = { rings, lon: fx.parcel.lon, lat: fx.parcel.lat };
  const samples = samplePoints(rings);
  const settled = await Promise.all(SPOKANE_OVERLAY_LAYERS.map(l => queryOverlayShares(l, where, samples).then(value => ({ status: 'fulfilled', value }))));
  const out = overlayResponse(settled, { name: 'City of Spokane' });
  const airport = out.overlays.filter(o => o.type === 'airport').map(o => o.name);
  assert.deepEqual(airport.sort(), [
    'Airfield overlay zone – Spokane International Airport: Inner Approach/Departure Zone',
    'Airfield overlay zone – Spokane International Airport: Inner Turning Zone-Outer Approach/Departure Zone',
    'Airfield overlay zone – Spokane International Airport: Traffic Pattern Zone'
  ]);
  // Zones overlap: the traffic pattern zone is counted on its own, not only where the others are not.
  const shares = Object.fromEntries(out.overlays.map(o => [o.name, o.share]));
  const total = airport.reduce((t, n) => t + shares[n], 0);
  assert.ok(total > 1 || airport.some(n => shares[n] === 1), `overlapping shares ${JSON.stringify(shares)}`);
  assert.deepEqual(out.overlays.filter(o => o.type === 'airport_height').map(o => o.name), ['FAR Part 77 height-restricted parcel']);
  assert.match(out.overlayNote, /Inside City of Spokane limits the city's own critical-areas and shoreline rules apply\. Verify with City of Spokane/);
});

test('overlays absent (45012.1111): an empty list, no layer down, and the UI says none mapped', async () => {
  const fx = fixture('45012.1111');
  stub(fx.responses);
  const zp = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  assert.deepEqual(zp.overlays, []);
  assert.deepEqual(zp.overlaysUnavailable, []);
  assert.match(zp.overlayNote, /Verify with City of Spokane Valley/);
  const html = renderOverlays(zp);
  assert.match(html, /No mapped county overlay on this parcel/);
});

test('an overlay layer failing: only that overlay is "unavailable"; the others, zoning and the rest stay; nothing is cached', async () => {
  const fx = fixture('07123.9075');
  stub(fx.responses, [[/CriticalAreasBPPublic\/MapServer\/3\/query/, down]]);
  const zp = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  assert.deepEqual(zp.overlaysUnavailable.map(o => o.type), ['aquifer_recharge']);
  assert.match(zp.overlaysUnavailable[0].error, /returned 500/);
  assert.equal(overlay(zp, 'aquifer_recharge').length, 0);
  assert.deepEqual(overlay(zp, 'shoreline').map(o => o.name), ['Shoreline designation: Rural Conservancy']);
  assert.equal(zp.zoning.status, 'gis_match');
  assert.equal(zp.zoning.code, 'RCV');
  assert.equal(zp.permitHistoryStatus, 'found');
  assert.equal(calls.filter(c => /CriticalAreasBPPublic\/MapServer\/3\/query/.test(pathOf(c.url))).length, 2, 'one retry');
  assert.equal(store.size, 0, 'a partial answer is not cached');
  const html = renderOverlays(zp);
  assert.match(html, /Critical Aquifer Recharge Areas.*did not answer/);
  assert.match(html, /unknown for the parcel, not absent/);
  assert.match(html, /Shoreline designation: Rural Conservancy/);
});

test('subrequest budget: a city parcel asks 15 layers (no retries), all overlay layers once, under 50 with retries', async () => {
  const fx = fixture('45012.1111');
  stub(fx.responses);
  await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  // jurisdiction, county zoning, comp plan, UGA, permits, city zoning + 9 overlay layers = 15;
  // every request may be retried once, so at most 30 of Cloudflare's 50 subrequests.
  assert.equal(SPOKANE_OVERLAY_LAYERS.length, 9);
  assert.equal(calls.length, 15, String(calls.length));
  assert.ok(calls.length * 2 < 50);
  assert.equal(calls.filter(c => OVERLAY_PATH.test(pathOf(c.url))).length, SPOKANE_OVERLAY_LAYERS.length);
});

test('overlapShares counts stacked features on their own and keeps edge-only features at 0', () => {
  const samples = [[0.25, 0.5], [0.75, 0.5]];
  const sq = (x0, x1) => ({ rings: [[[x0, 0], [x1, 0], [x1, 1], [x0, 1], [x0, 0]]] });
  const shares = overlapShares(samples, [
    { attributes: { Z: 'outer' }, geometry: sq(0, 1) },
    { attributes: { Z: 'inner' }, geometry: sq(0, 0.5) },
    { attributes: { Z: 'edge' }, geometry: sq(1, 2) },
    { attributes: { Z: '' }, geometry: sq(0, 1) }
  ], a => a.Z);
  assert.deepEqual(shares, [{ key: 'outer', share: 1 }, { key: 'inner', share: 0.5 }, { key: 'edge', share: 0 }]);
  // Point query (no outlines): each key covers the point.
  assert.deepEqual(overlapShares([[0, 0]], [{ attributes: { Z: 'a' } }, { attributes: { Z: 'a' } }], a => a.Z), [{ key: 'a', share: 1 }]);
});

// ---- Browser: zoning-overlays.js

function renderOverlays(zoningPermits) {
  const page = makeContext({ body: [['div', { id: 'results' }]], clock: makeClock(), fetch: async () => { throw new Error('no network'); } });
  page.ctx.__last = { zoningPermits };
  page.run('var last = __last; var activeTab = "zoning"; function renderResults() { document.getElementById("results").innerHTML = ""; }', 'index-inline.js');
  page.run(readPublic('zoning-overlays.js'), 'zoning-overlays.js');
  page.run('renderResults()');
  return page.document.getElementById('results').children.map(c => c.innerHTML).join('');
}

test('browser: overlays render with coverage, source link and the verify framing; other counties are unchanged', () => {
  const html = renderOverlays({
    overlays: [
      { type: 'shoreline', name: 'Shoreline designation: Rural Conservancy', source: 'Spokane County Shoreline Designations', sourceUrl: 'https://gismo.spokanecounty.org/x/0', share: 0.42, detail: 'Shoreline permit may be needed.' },
      { type: 'airport', name: 'Airfield overlay zone – Felts Field: Runway', source: 'Airfield Overlay Zone', sourceUrl: '', share: 0, detail: '' }
    ],
    overlaysUnavailable: [],
    overlayNote: 'Overlays are mapped by Spokane County and are screening information only. Verify with Spokane County Building & Planning before design.'
  });
  assert.match(html, /2 mapped overlays/);
  assert.match(html, /covers about 42% of the parcel/);
  assert.match(html, /touches the parcel edge/);
  assert.match(html, /href="https:\/\/gismo\.spokanecounty\.org\/x\/0"/);
  assert.match(html, /Verify with Spokane County Building &amp; Planning|Verify with Spokane County Building & Planning/);
  // Kootenai / Yellowstone answers have no overlaysUnavailable: nothing added.
  assert.equal(renderOverlays({ overlays: [{ code: 'ENTRYWAY', name: 'Entryway Zoning District' }] }), '');
});

test('overlays present (48136.9052, Colbert): county wetland buffers 190 ft and 250 ft; no 50-year channel migration zone', async () => {
  const fx = load('spokane-overlays-48136.9052');
  stub(fx.responses);
  const rings = ringsFromGeometry(fx.parcel.geometry);
  const samples = samplePoints(rings);
  const settled = await Promise.all(SPOKANE_OVERLAY_LAYERS.map(l => queryOverlayShares(l, { rings, lon: fx.parcel.lon, lat: fx.parcel.lat }, samples).then(value => ({ status: 'fulfilled', value }))));
  const out = overlayResponse(settled);
  assert.deepEqual(out.overlays.filter(o => o.type === 'wetland_buffer').map(o => o.name).sort(), ['Mapped wetland buffer: 190 foot buffer', 'Mapped wetland buffer: 250 foot buffer']);
  for (const o of out.overlays.filter(o => o.type === 'wetland_buffer')) assert.match(o.detail, /depends on the wetland rating/);
  assert.equal(out.overlays.some(o => /50 Year Channel Migration/.test(o.name)), false);
  // The 50-year and 100-year zones are separate layers with their own names.
  const cmz = SPOKANE_OVERLAY_LAYERS.filter(l => l.type === 'channel_migration');
  assert.deepEqual(cmz.map(l => l.url.split('/').pop()).sort(), ['1', '2']);
  assert.deepEqual(cmz.map(l => l.name(l.key({}))).sort(), ['100 Year Channel Migration Zone', '50 Year Channel Migration Zone']);
});
