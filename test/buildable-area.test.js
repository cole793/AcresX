// Offline tests for the buildable-acres screening estimate: the strip union in
// src/shared/area-mask.js, POST /api/buildable-area (src/services/buildable-area.js) with fetch
// stubbed by URL, the dashboard card and map shading (public/buildable-area.js) and page 1 of the
// printable report (public/property-report-v2.js). No live FEMA, USFWS, county or USGS calls.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { maskAreas, maskGeometry, intersectIntervals, subtractIntervals, capsuleLine } from '../src/shared/area-mask.js';
import { ringsFromGeometry, SQM_PER_ACRE } from '../src/shared/polygon-coverage.js';
import { buildableFromLayers, parseSetbackFeet, DISCLAIMER, STEEP_SLOPE_PCT } from '../src/services/buildable-area.js';
import { FEMA_NFHL_FLOOD_LAYER, ESRI_USA_FLOOD_HAZARD_LAYER } from '../src/services/flood.js';
import { NWI_LAYER, GEOMETRY_SERVER } from '../src/services/wetlands.js';
import { SPOKANE_WETLAND_LAYERS } from '../src/counties/spokane-overlays.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { makeLazyContext, readPublic } from './ui-harness.js';

const box = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
// A 0.01 x 0.01 degree parcel (about 206 acres at 47.7 N).
const W = -116.8, E = -116.79, S = 47.7, N = 47.71;
const geometry = { type: 'Polygon', coordinates: box(W, S, E, N) };
const parcel = ringsFromGeometry(geometry);
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} vs ${expected}`);

// ---- area-mask.js

test('interval helpers: intersect and subtract', () => {
  assert.deepEqual(intersectIntervals([[0, 4], [6, 10]], [[2, 7]]), [[2, 4], [6, 7]]);
  assert.deepEqual(subtractIntervals([[0, 10]], [[2, 3], [5, 6]]), [[0, 2], [3, 5], [6, 10]]);
  assert.deepEqual(subtractIntervals([[0, 10]], [[-1, 11]]), []);
  assert.deepEqual(subtractIntervals([[0, 2], [4, 6]], []), [[0, 2], [4, 6]]);
  assert.deepEqual(capsuleLine(0, 0, 10, 0, 2, 1).map(v => Math.round(v * 1000) / 1000), [-1.732, 11.732]);
  assert.equal(capsuleLine(0, 0, 10, 0, 2, 3), null);
});

test('no removal: buildable is the whole parcel, one rectangle', () => {
  const a = maskAreas(parcel, {});
  assert.equal(a.removedSqM, 0);
  near(a.parcelSqM / SQM_PER_ACRE, 206, 3, 'parcel acres');
  const g = maskGeometry(parcel, {});
  assert.equal(g.buildable.length, 1);
  assert.equal(g.removed.length, 0);
});

test('full removal: a constraint larger than the parcel leaves nothing buildable', () => {
  const a = maskAreas(parcel, { flood: [box(W - 1, S - 1, E + 1, N + 1)] });
  near(a.removedSqM / a.parcelSqM, 1, 1e-9, 'removed share');
  assert.equal(maskGeometry(parcel, { flood: [box(W - 1, S - 1, E + 1, N + 1)] }).buildable.length, 0);
});

test('partial removal and overlap union: overlaps are removed once, per-group areas keep their own size', () => {
  const groups = { flood: [box(W, S, W + 0.006, N)], wetland: [box(W + 0.004, S, W + 0.007, N)] };
  const a = maskAreas(parcel, groups);
  near(a.groups.flood / a.parcelSqM, 0.6, 0.002, 'flood share');
  near(a.groups.wetland / a.parcelSqM, 0.3, 0.002, 'wetland share');
  near(a.removedSqM / a.parcelSqM, 0.7, 0.002, 'union');
  near(a.added.wetland / a.parcelSqM, 0.1, 0.002, 'wetland beyond flood');
  const g = maskGeometry(parcel, groups);
  assert.equal(g.buildable.length, 1, 'a straight split is one buildable rectangle');
  assert.equal(g.removed.length, 1);
  const [[[x0], [x1]]] = g.buildable[0];
  near(x0, W + 0.007, 1e-5, 'buildable starts where the wetland ends');
  near(x1, E, 1e-5, 'and runs to the east line');
});

test('a flagged group (wetland buffers) is measured outside the removed area, not removed', () => {
  const groups = { flood: [box(W, S, W + 0.006, N)], buffer: [box(W + 0.004, S, W + 0.008, N)] };
  const a = maskAreas(parcel, groups, { flag: 'buffer' });
  near(a.removedSqM / a.parcelSqM, 0.6, 0.002, 'only flood removed');
  near(a.flaggedSqM / a.parcelSqM, 0.2, 0.002, 'buffer beyond flood');
  const g = maskGeometry(parcel, groups, { flag: 'buffer' });
  assert.equal(g.flagged.length, 1);
  const [[[x0], [x1]]] = g.flagged[0];
  near(x0, W + 0.006, 1e-5, 'buffer drawn from the flood edge');
  near(x1, W + 0.008, 1e-5, 'to its own edge');
  assert.equal(g.buildable.length, 1, 'buildable still includes the buffer part');
});

test('a uniform setback removes the band along every parcel line', () => {
  // About 100 m x 100 m; a 10 m setback leaves the inner 80 m x 80 m (64%).
  const dLon = 100 / (6371008.8 * Math.PI / 180 * Math.cos(47.7 * Math.PI / 180)), dLat = 100 / (6371008.8 * Math.PI / 180);
  const small = ringsFromGeometry({ type: 'Polygon', coordinates: box(W, S, W + dLon, S + dLat) });
  const a = maskAreas(small, {}, { setbackM: 10 });
  near(a.parcelSqM, 10000, 20, 'parcel sq m');
  near(1 - a.removedSqM / a.parcelSqM, 0.64, 0.01, 'inner share');
});

test('geometry is size-capped: a jagged constraint is drawn with fewer strips', () => {
  const teeth = [];
  for (let i = 0; i < 400; i++) teeth.push(box(W + i * 0.000025, S, W + i * 0.000025 + 0.0000125, S + (i % 2 ? 0.009 : 0.004)));
  const g = maskGeometry(parcel, { wetland: teeth }, { maxRects: 300 });
  assert.ok(g.rects <= 300 || g.strips === 10, `${g.rects} rects at ${g.strips} strips`);
});

// ---- buildableFromLayers (pure) and setback parsing

test('setbacks: only a single plain number is applied', () => {
  assert.equal(parseSetbackFeet('10 feet'), 10);
  assert.equal(parseSetbackFeet('25 ft'), 25);
  assert.equal(parseSetbackFeet('0 feet'), 0);
  assert.equal(parseSetbackFeet('0 feet in UGA; 10 feet in rural community'), null);
  assert.equal(parseSetbackFeet('Front 10 ft; rear 15 ft (6 ft on an alley); side 5 ft'), null);
  assert.equal(parseSetbackFeet(undefined), null);
});

test('missing layer: computed with what answered, status partial, the gap is listed', () => {
  const b = buildableFromLayers(geometry, [
    { key: 'flood', label: 'FEMA high-risk flood zone (SFHA)', status: 'unavailable', note: 'Flood map did not answer, so flood areas were not subtracted.' },
    { key: 'wetland', label: 'Mapped wetlands', status: 'counted', source: 'USFWS National Wetlands Inventory', rings: [box(W, S, W + 0.002, N)] },
    { key: 'slope', label: `Slopes over ${STEEP_SLOPE_PCT}%`, status: 'none', rings: [] }
  ]);
  assert.equal(b.status, 'partial');
  near(b.buildablePct, 80, 0.2, 'buildable pct');
  assert.deepEqual(b.removed.map(r => r.key), ['wetland']);
  assert.ok(b.notes.some(n => /flood areas were not subtracted/.test(n)));
  assert.equal(b.layers.find(l => l.key === 'flood').status, 'unavailable');
  assert.equal(b.disclaimer, DISCLAIMER);
  assert.equal(b.geometry.type, 'MultiPolygon');
});

test('nothing could be checked: unavailable, no buildable number, no geometry', () => {
  const b = buildableFromLayers(geometry, [
    { key: 'flood', label: 'Flood', status: 'unavailable', note: 'Flood map did not answer.' },
    { key: 'wetland', label: 'Mapped wetlands', status: 'unavailable', note: 'NWI did not answer.' }
  ]);
  assert.equal(b.status, 'unavailable');
  assert.equal(b.buildableAcres, null);
  assert.equal(b.geometry, null);
  near(b.parcelAcres, 206, 3, 'parcel acres still given');
});

test('steep slope cells are removed as their rectangles; a numeric setback adds its own line', () => {
  const b = buildableFromLayers(geometry, [
    { key: 'flood', label: 'Flood', status: 'none', rings: [] },
    { key: 'slope', label: 'Slopes over 30%', status: 'counted', source: 'USGS', rings: [box(W, S, W + 0.0025, S + 0.0025)] }
  ], { setbackFt: 10 });
  assert.equal(b.status, 'measured');
  near(b.removed.find(r => r.key === 'slope').pct, 6.25, 0.1, 'one of 16 cells');
  assert.ok(b.removed.find(r => r.key === 'setback'), 'setback removed');
  assert.match(b.disclaimer, /general zoning setback is included/);
});

// ---- POST /api/buildable-area, fetch stubbed

const realFetch = globalThis.fetch, realWarn = console.warn, realLog = console.log;
let calls, restoreUpstream;
const jsonResponse = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const esri = (x0, y0, x1, y1) => ({ rings: box(x0, y0, x1, y1), spatialReference: { wkid: 4326 } });
const A = { FLD_ZONE: 'A', ZONE_SUBTY: null, SFHA_TF: 'T' };
const X_MIN = { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' };
const [CW, CB190, CB250] = ['wetland', 'wetland-buffer-190', 'wetland-buffer-250'].map(s => SPOKANE_WETLAND_LAYERS.find(l => l.label === `spokane-${s === 'wetland' ? 'county-wetland' : s}`).url);

// routes: { [base url]: (call) -> body | Response }. Anything else (elevation, terrain tiles) fails.
function stub(routes) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const params = new URLSearchParams(url.search);
    if (init.body) new URLSearchParams(String(init.body)).forEach((v, k) => params.set(k, v));
    const base = url.origin + url.pathname;
    calls.push(base);
    const route = routes[base];
    if (!route) throw new TypeError(`network disabled: ${base}`);
    const answer = await route({ params, where: params.get('where'), returnGeometry: params.get('returnGeometry') });
    return answer instanceof Response ? answer : jsonResponse(answer);
  };
}
const femaRoute = (zones, outlines) => c => (c.returnGeometry === 'true' ? { features: outlines } : { features: zones.map(attributes => ({ attributes })) });
async function post(body) {
  const response = await worker.fetch(new Request('https://acresx.test/api/buildable-area', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), {}, { waitUntil() {} });
  return { response, body: await response.json() };
}

beforeEach(() => { calls = []; console.warn = () => {}; console.log = () => {}; restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} }); });
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; console.log = realLog; restoreUpstream(); });

test('Spokane: flood zone A and NWI unioned, county buffer shown not subtracted; slope unavailable -> partial', async () => {
  const nwi = esri(W + 0.004, S, W + 0.006, S + 0.002);
  stub({
    [`${FEMA_NFHL_FLOOD_LAYER}/query`]: femaRoute([A, X_MIN], [{ attributes: A, geometry: esri(W, S, W + 0.005, N) }]),
    [`${NWI_LAYER}/query`]: () => ({ features: [{ attributes: { WETLAND_TYPE: 'Freshwater Emergent Wetland' }, geometry: nwi }] }),
    [GEOMETRY_SERVER]: () => ({ geometries: [{ rings: nwi.rings }] }),
    [`${CW}/query`]: () => ({ features: [] }),
    [`${CB190}/query`]: () => ({ features: [{ attributes: { NAME: '190 Foot Buffer' }, geometry: esri(E - 0.001, S, E, N) }] }),
    [`${CB250}/query`]: () => ({ features: [] })
  });
  const { response, body } = await post({ state: 'WA', county: 'Spokane', geometry });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(body.status, 'partial');
  near(body.removed.find(r => r.key === 'flood').pct, 50, 0.2, 'flood');
  near(body.removed.find(r => r.key === 'wetland').pct, 4, 0.2, 'wetland own area');
  assert.equal(body.removed.find(r => r.key === 'buffer'), undefined, 'buffers are not subtracted');
  near(body.mayAlsoRestrict[0].pct, 10, 0.2, 'buffer outside the removed area');
  assert.match(body.mayAlsoRestrict[0].note, /depends on a wetland delineation/);
  assert.equal(body.layers.find(l => l.key === 'buffer').status, 'shown');
  assert.equal(body.bufferGeometry.type, 'MultiPolygon');
  near(body.removedPct, 52, 0.3, 'union, overlap once');
  near(body.buildablePct, 48, 0.3, 'buildable');
  near(body.overlapAcres / body.parcelAcres * 100, 2, 0.2, 'overlap');
  assert.equal(body.removed.find(r => r.key === 'wetland').reason, 'Mapped wetlands (NWI)', 'says which wetland layers');
  near(body.buildableAcres + body.removedAcres, body.parcelAcres, 0.02, 'adds up');
  assert.equal(body.layers.find(l => l.key === 'slope').status, 'unavailable');
  assert.match(body.removed.find(r => r.key === 'flood').reason, /zone A/);
  assert.ok(body.notes.some(n => /190 ft and 250 ft wetland buffers; they are shown but not subtracted/.test(n)));
  assert.ok(body.notes.some(n => /setbacks were not subtracted/i.test(n)));
  assert.equal(body.geometry.type, 'MultiPolygon');
  assert.equal(body.removedGeometry.type, 'MultiPolygon');
  assert.ok(JSON.stringify(body).length < 200000);
});

test('no constraint mapped (Kootenai, minimal X, no NWI): all buildable, buffers noted as not mapped', async () => {
  stub({
    [`${FEMA_NFHL_FLOOD_LAYER}/query`]: femaRoute([X_MIN], []),
    [`${NWI_LAYER}/query`]: () => ({ features: [] })
  });
  const { body } = await post({ state: 'ID', county: 'Kootenai', geometry, zoning: { code: 'R-12', setback: 'Front 20 ft; side 5 ft' } });
  assert.equal(body.status, 'partial', 'slope did not answer');
  assert.equal(body.removed.length, 0);
  assert.equal(body.buildablePct, 100);
  assert.ok(body.notes.some(n => /Wetland buffers are not mapped for Kootenai County/.test(n)));
  assert.ok(body.notes.some(n => /different front, side and rear setbacks/.test(n)));
  assert.equal(calls.filter(c => c.startsWith(FEMA_NFHL_FLOOD_LAYER)).length, 1, 'no outline query for a minimal-X parcel');
});

test('flood map down everywhere: flood is not subtracted, the rest still measured', async () => {
  stub({
    [`${FEMA_NFHL_FLOOD_LAYER}/query`]: () => new Response('down', { status: 500 }),
    [`${ESRI_USA_FLOOD_HAZARD_LAYER}/query`]: () => new Response('down', { status: 500 }),
    [`${NWI_LAYER}/query`]: () => ({ features: [{ attributes: {}, geometry: esri(W, S, W + 0.001, N) }] }),
    [GEOMETRY_SERVER]: () => ({ geometries: [{ rings: box(W, S, W + 0.001, N) }] })
  });
  const { body } = await post({ state: 'MT', county: 'Yellowstone', geometry });
  assert.equal(body.status, 'partial');
  assert.equal(body.layers.find(l => l.key === 'flood').status, 'unavailable');
  near(body.buildablePct, 90, 0.2, 'wetland removed');
  assert.ok(body.notes.some(n => /flood areas were not subtracted/.test(n)));
});

test('FEMA outlines blocked (403): flood is subtracted from the Esri backup outlines', async () => {
  const outline = { attributes: { ...A, esri_symbology: '1% Annual Chance Flood Hazard' }, geometry: esri(W, S, W + 0.005, N) };
  stub({
    // Zone query answers; every outline query is refused, as hazards.fema.gov did in production.
    [`${FEMA_NFHL_FLOOD_LAYER}/query`]: c => (c.returnGeometry === 'true' ? new Response('Forbidden', { status: 403 }) : { features: [A, X_MIN].map(attributes => ({ attributes })) }),
    [`${ESRI_USA_FLOOD_HAZARD_LAYER}/query`]: () => ({ features: [outline] }),
    [`${NWI_LAYER}/query`]: () => ({ features: [] })
  });
  const { body } = await post({ state: 'WA', county: 'Lincoln', geometry });
  const flood = body.layers.find(l => l.key === 'flood');
  assert.equal(flood.status, 'counted');
  assert.equal(flood.source, 'Esri USA Flood Hazard Areas (copy of FEMA NFHL)');
  near(body.removed.find(r => r.key === 'flood').pct, 50, 0.2, 'flood');
  near(body.buildablePct, 50, 0.3, 'buildable');
  assert.equal(body.notes.some(n => /flood zone share could not be measured/.test(n)), false);
  assert.equal(calls.filter(c => c.startsWith(FEMA_NFHL_FLOOD_LAYER)).length, 2, 'FEMA zone + one share try; outlines go straight to the backup');
});

test('zone D is noted, not subtracted', async () => {
  stub({
    [`${FEMA_NFHL_FLOOD_LAYER}/query`]: femaRoute([{ FLD_ZONE: 'D', ZONE_SUBTY: null, SFHA_TF: 'F' }], []),
    [`${NWI_LAYER}/query`]: () => ({ features: [] })
  });
  const { body } = await post({ state: 'MT', county: 'Yellowstone', geometry });
  assert.equal(body.layers.find(l => l.key === 'flood').status, 'none');
  assert.equal(body.buildablePct, 100);
  assert.ok(body.notes.some(n => /zone D \(flood risk undetermined\)/.test(n)));
});

test('bad geometry is a 400 with JSON', async () => {
  const { response, body } = await post({ geometry: { type: 'Point', coordinates: [0, 0] } });
  assert.equal(response.status, 400);
  assert.equal(body.status, 'unavailable');
});

// ---- Dashboard (public/buildable-area.js)

const SAMPLE = {
  status: 'measured', parcelAcres: 20.63, buildableAcres: 6.62, buildablePct: 32.1, removedAcres: 14.01, removedPct: 67.9, overlapAcres: 10.49,
  removed: [
    { key: 'flood', reason: 'FEMA high-risk flood zone A', acres: 13.85, pct: 67.1, source: 'FEMA NFHL' },
    { key: 'wetland', reason: 'Mapped wetlands (NWI + Spokane County)', acres: 2.41, pct: 11.7, source: 'USFWS National Wetlands Inventory' },
  ],
  mayAlsoRestrict: [{ key: 'buffer', reason: 'Mapped wetland buffers (190/250 ft, Spokane County)', acres: 1.2, pct: 5.8, source: 'Spokane County', note: 'The buffer that applies depends on a wetland delineation.' }],
  layers: [{ key: 'flood', status: 'counted' }, { key: 'wetland', status: 'counted' }, { key: 'buffer', status: 'shown' }, { key: 'slope', label: 'Slopes over 30%', status: 'unavailable' }],
  notes: ['Elevation samples were not available, so steep slopes were not subtracted.'], disclaimer: DISCLAIMER,
  geometry: { type: 'MultiPolygon', coordinates: [box(W + 0.006, S, E, N)] }, removedGeometry: { type: 'MultiPolygon', coordinates: [box(W, S, W + 0.006, N)] },
  bufferGeometry: { type: 'MultiPolygon', coordinates: [box(W + 0.006, S, W + 0.007, N)] }
};

test('dashboard: one request after the sections settle, then the card and the map shading', async () => {
  const lastData = { parcel: { type: 'Feature', geometry, properties: { _stateCode: 'WA', _countyDisplay: 'Spokane' } }, zoningDevelopmentPotential: { available: true, setback: '10 feet' }, zoningPermits: { zoning: { code: 'RA-5' } } };
  const h = makeLazyContext({ last: lastData });
  const sent = [], shaded = [];
  h.context.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => SAMPLE }; };
  const group = { clearLayers() {}, addTo() { return this; } };
  h.context.map = { hasLayer: () => false, removeLayer() {} };
  h.context.L = { layerGroup: () => group, geoJSON: (g, o) => { shaded.push({ g, o }); return { addTo() { return this; }, eachLayer() {} }; } };
  h.run('function renderSummary() {}');
  h.run(readPublic('buildable-area.js'));
  h.run('renderSummary()');
  h.run('renderSummary()');
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.equal(sent.length, 1, 'one request per search');
  assert.equal(sent[0].url, '/api/buildable-area');
  assert.equal(sent[0].body.county, 'Spokane');
  assert.deepEqual(sent[0].body.zoning, { code: 'RA-5', setback: '10 feet' });
  const card = h.el('buildableAreaCard').innerHTML;
  assert.match(card, /About 6\.6 of 20\.6 acres buildable/);
  assert.match(card, /FEMA high-risk flood zone A<\/span><b>−13\.8 ac · 67\.1%/);
  assert.match(card, /Overlapping areas counted once/);
  assert.match(card, /Not counted:<\/strong> Slopes over 30%/);
  assert.match(card, /Screening estimate, not a survey/);
  assert.match(card, /Verify with the responsible agency/);
  assert.match(card, /May also be restricted:<\/b> mapped wetland buffers \(190\/250 ft, Spokane County\) 1\.2 ac \(5\.8%\) — the buffer that applies depends on a wetland delineation/);
  assert.match(card, /Mapped wetlands \(NWI \+ Spokane County\)/);
  assert.equal(shaded.length, 3, 'buildable, removed and buffer layers');
  assert.deepEqual(shaded.map(x => x.o.style.fillColor), ['#2f8a58', '#c0392b', '#d39a2a'], 'buffers in amber, not red');
});

test('dashboard: waits while flood, wetlands, zoning or terrain is pending; a failed request says not measured', async () => {
  const lastData = { parcel: { type: 'Feature', geometry, properties: {} } };
  const h = makeLazyContext({ last: lastData });
  const status = { flood: 'pending', wetlands: 'done', zoningPermits: 'done', land: 'done' };
  const sent = [];
  h.context.AcresXSections = { status: n => status[n], claim: () => true, settle() {}, isCurrent: () => true, searchId: 1 };
  h.context.fetch = async () => { sent.push(1); return { ok: false, status: 502, json: async () => ({ error: 'down' }) }; };
  h.run('function renderSummary() {}');
  h.run(readPublic('buildable-area.js'));
  h.run('renderSummary()');
  await new Promise(r => setImmediate(r));
  assert.equal(sent.length, 0);
  status.flood = 'timeout';
  h.run('renderSummary()');
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.equal(sent.length, 1);
  assert.match(h.el('buildableAreaCard').innerHTML, /Buildable area not measured/);
  assert.equal(lastData.buildableArea.status, 'unavailable');
});

// ---- Report page 1

const reportFixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
const MODULES = ['flood-status.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'buildable-area.js', 'property-report-v2.js'];
function report(data) {
  const h = makeLazyContext({ mappedSqm: 20.63 * SQM_PER_ACRE, last: data });
  for (const f of MODULES) h.run(readPublic(f));
  h.context.__acresxLast = data;
  h.el('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
  return h.opened.at(-1).split('<section class="page ').slice(1);
}

test('report page 1: the buildable estimate, its breakdown and the shaded map', () => {
  const data = reportFixture();
  data.buildableArea = SAMPLE;
  const [p1, p2] = report(data);
  assert.match(p1, /About 6\.6 of 20\.6 acres buildable/);
  assert.match(p1, /Removed: FEMA high-risk flood zone A <b>13\.8 ac<\/b> \(67\.1%\) · Mapped wetlands \(NWI \+ Spokane County\) <b>2\.4 ac<\/b>/);
  assert.match(p1, /May also be restricted:<\/b> mapped wetland buffers \(190\/250 ft, Spokane County\) 1\.2 ac \(5\.8%\) — the buffer that applies depends on a wetland delineation\./);
  assert.match(p1, /<path class="buf" d="M[^"]+" fill="url\(#bufHatch\)"/);
  assert.match(p1, /wetland buffer \(not removed\)/);
  assert.match(p1, /1 mapped wetland feature · 5\.1% of parcel/, 'the key finding keeps its NWI-only source');
  assert.match(p1, /overlaps counted once \(10\.5 ac\)/);
  assert.match(p1, /Not counted: Slopes over 30%/);
  assert.match(p1, /Screening estimate, not a survey\. Wetland buffers depend on a delineation; setbacks and easements not included\./);
  assert.match(p1, /<path class="keep" d="M/);
  assert.match(p1, /<path class="cut" d="M[^"]+" fill="url\(#cutHatch\)"/);
  assert.match(p1, /buildable estimate/);
  assert.doesNotMatch(p2, /acres buildable/, 'page 1 only');
});

test('report page 1 without an estimate: "Not measured", no shading, same score', () => {
  const data = reportFixture();
  const [p1] = report(data);
  assert.match(p1, /Buildable area · screening estimate[\s\S]*Not measured/);
  assert.doesNotMatch(p1, /<path class="keep"/);
  const withB = reportFixture(); withB.buildableArea = SAMPLE;
  const score = html => /<div class="score-num">([^<]*)/.exec(html)[1];
  assert.equal(score(report(withB)[0]), score(p1), 'buildable acres never change the score');
});
