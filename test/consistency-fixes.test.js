// Offline tests for the 2026-11-14 consistency fixes (owner-approved):
// 1. One nearby-well-depth number on every surface (public/screening-inputs.js AcresXWellDepth).
// 2. The score's flood factor follows the measured SFHA share, and the buildable-area homesite
//    check (screening-refinements.js) caps the score when a homesite may not fit; one "why" line.
// 3. Septic uses the measured parcel slope, with the soil map unit's slope class as context.
// Runs the real browser scripts in node:vm with the fake DOMs from test/ui-harness.js. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, makeContext, makeLazyContext, readPublic } from './ui-harness.js';

const square = { type: 'Polygon', coordinates: [[[-117.4, 47.6], [-117.39, 47.6], [-117.39, 47.61], [-117.4, 47.61], [-117.4, 47.6]]] };
const parcel = () => ({ type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '23123.9051', _countyDisplay: 'Spokane', _stateCode: 'WA' } });
// Closest first. Mean of the five depths 151; proximity-weighted 126; residential median 100
// (the irrigation well is left out of the median).
const WELLS = [
  { properties: { CompletedDepth: 100, _distance: 0.05, WellProjectType: 'Water' } },
  { properties: { CompletedDepth: 100, _distance: 0.05, WellProjectType: 'Water' } },
  { properties: { CompletedDepth: 100, _distance: 0.06, WellProjectType: 'Water' } },
  { properties: { CompletedDepth: 215, _distance: 0.13, WellProjectType: 'Irrigation' } },
  { properties: { CompletedDepth: 240, _distance: 0.13, WellProjectType: 'Water' } }
];
const soil = (over = {}) => ({ available: true, mapUnit: 'Maginnis channery clay loam, 15 to 35 percent slopes', component: 'Maginnis', drainage: 'Well drained', hydrologicGroup: 'B', soilSlopePct: 25, feasibility: 'limited', ...over });
const sfha = (pct, acres = 20) => ({
  available: true, category: 'high', high: true, intersects: true, zones: ['A', 'X'], sfhaSharePct: pct,
  floodShare: { status: 'measured', restSharePct: 100 - pct },
  floodZones: [{ zone: 'A', sfha: true, category: 'high', sharePct: pct, acres: acres * pct / 100 }, { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', category: 'minimal', sharePct: 100 - pct, acres: acres * (100 - pct) / 100, remainder: true }]
});
const MINIMAL = { available: true, category: 'minimal', intersects: true, zones: ['X'], zoneDetails: [{ zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false }] };
const baseLast = (over = {}) => ({
  parcel: parcel(), wells: WELLS, utility: ['Avista'],
  flood: MINIMAL, wetlands: { available: true, intersects: false, count: 0 },
  zoningPermits: { zoning: { status: 'gis_match', code: 'RT' } }, evidence: { status: 'none' },
  land: { available: true, soil: soil(), terrain: { available: true, gradePct: 1.9, reliefFt: 10 } },
  ...over
});
const measured = (buildableAcres, parcelAcres = 20, removed = []) => ({ status: 'measured', parcelAcres, buildableAcres, buildablePct: Math.round(buildableAcres / parcelAcres * 1000) / 10, removed, layers: [] });

const PAGE = [
  ['div', { class: 'overview-grid' }, '', [
    ['article', { class: 'card score-card' }, '', [['div', { id: 'scoreMetric', class: 'metric-value' }, '—'], ['div', { id: 'scoreNote' }, ''], ['div', { class: 'score-factor-line' }, ''], ['div', { class: 'score-constraint' }, '']]],
    ['article', { id: 'developmentCostCard', class: 'card development-cost-card' }, '', [['div', { class: 'cost-value' }, ''], ['div', { class: 'cost-note' }, '']]]
  ]],
  ['article', { class: 'card snapshot-card', 'data-detail': 'wells' }, '', [['div', { id: 'wellMetric' }, ''], ['span', { id: 'waterGrade' }, ''], ['span', { id: 'waterStatus' }, ''], ['span', { id: 'wellNote' }, '']]],
  ['article', { class: 'card snapshot-card', 'data-detail': 'soil' }, '', [['span', { id: 'soilGrade' }, ''], ['span', { id: 'soilStatus' }, ''], ['span', { id: 'soilNote' }, '']]],
  ['div', { id: 'results' }]
];
const L = { map: () => ({ fitBounds() {}, invalidateSize() {} }), tileLayer: () => ({ addTo() { return this; } }), geoJSON: () => ({ addTo() { return this; }, getBounds: () => ({ isValid: () => false }) }) };
const turf = { area: () => 20 * 4046.86, centroid: () => ({ geometry: { coordinates: [-117.395, 47.605] } }) };

// The dashboard modules in their injection order (src/index.js), with index.html's real
// renderSummary line in front of them.
const DASH = ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'ui-polish.js', 'parcel-preview.js', 'score-cost.js', 'screening-refinements.js', 'parcel-summary-insights.js', 'cost-tables.js', 'local-cost-model.js', 'buildable-area.js'];
function dashboard(last, { fetch } = {}) {
  const clock = makeClock();
  const page = makeContext({ body: PAGE, clock, fetch: fetch || (async () => { throw new Error('no network'); }), autoIds: true, extra: { L, turf } });
  page.ctx.__last = last;
  const lines = readPublic('index.html').split('\n');
  const pick = name => lines.find(l => l.startsWith(`function ${name}(`) || l.startsWith(`const ${name}=`)) || '';
  page.run(`var last = __last; var activeTab = ""; const $=id=>document.getElementById(id);\n${pick('UTILITY_LOOKUP_FAILED')}\n${pick('utilityText')}\n${pick('gradeWellDepth')}\n${pick('setTraffic')}\n${pick('renderSummary')}\nfunction renderResults() {}`, 'index-inline.js');
  for (const f of DASH) page.run(readPublic(f), f);
  page.run('renderSummary(last.parcel)');
  return { page, clock, $: id => page.document.getElementById(id) };
}

function report(data) {
  const h = makeLazyContext({ mappedSqm: 20 * 4046.86, last: data });
  for (const f of ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'buildable-area.js', 'property-report-v2.js']) h.run(readPublic(f));
  h.context.__acresxLast = data;
  h.generate();
  return { html: h.opened.at(-1), calc: h.context.AcresXScore.calculate() };
}

// ---- 1. Well depth

test('well depth: one definition, the median of residential-comparable wells among the closest five', () => {
  const h = makeLazyContext();
  h.run(readPublic('screening-inputs.js'));
  const WD = h.context.AcresXWellDepth;
  const s = WD.stats({ wells: WELLS });
  assert.equal(s.feet, 100);
  assert.equal(s.count, 4);
  assert.equal(s.excluded, 1);
  assert.equal(WD.label(s), 'Median nearby well depth (4 wells)');
  assert.equal(WD.fact(s), '100 ft (4 wells)');
  assert.equal(WD.note(s), 'Median nearby well depth (4 wells) · 1 nonresidential excluded');
  const none = WD.stats({ wells: [{ properties: { CompletedDepth: 300, WellProjectType: 'Irrigation' } }, { properties: { CompletedDepth: 500, WellProjectType: 'Monitoring' } }] });
  assert.equal(none.feet, 400, 'no residential well: median of all depths');
  assert.match(WD.note(none), /no clearly residential well type/);
  assert.equal(WD.fact(WD.stats({ wells: [] })), 'Not available');
  assert.equal(WD.stats({}), null, 'wells not loaded yet');
});

test('well depth: overview, well card, cost model and report show the same number', () => {
  const data = baseLast();
  const d = dashboard(data);
  assert.equal(d.$('overviewWellDepth').textContent, '100 ft (4 wells)', 'overview (was the 151 ft mean)');
  assert.equal(d.$('wellMetric').textContent, '100 ft', 'well card (index.html had the 126 ft weighted mean)');
  assert.equal(d.$('wellNote').textContent, 'Median nearby well depth (4 wells) · 1 nonresidential excluded');
  const cost = d.page.run('window.AcresXCostModel.estimate(last)');
  assert.equal(cost.local, true, 'Spokane: the local cost model');
  assert.match(cost.components.well.basis, /100 ft median nearby well depth \(4 wells\)/, 'local cost model (was 7 wells, 30-1500 ft)');
  const generic = d.page.run('window.__acresxScreeningCostEstimate()');
  assert.match(generic.components.well.basis, /^100 ft median nearby well depth \(4 wells\)$/);
  const { html, calc } = report(baseLast());
  assert.match(html, /Median nearby well depth \(4 wells\): 100 ft/);
  assert.equal(calc.factors.water.score, 92, 'the score reads the same 100 ft');
});

// ---- 2. Score: flood share and buildable area

test('flood factor follows the measured SFHA share; unmeasured keeps the category score', () => {
  const h = makeLazyContext();
  h.run(readPublic('flood-status.js'));
  const FX = h.context.AcresXFlood;
  assert.equal(FX.shareScore(sfha(0.4)), 85, 'edge only: small penalty');
  assert.equal(FX.shareScore(sfha(10)), 69);
  assert.equal(FX.shareScore(sfha(67.1)), 19.2);
  assert.equal(FX.shareScore(sfha(100)), 5, 'whole parcel: severe');
  const unmeasured = { available: true, high: true, intersects: true, zones: ['A'], category: 'high' };
  assert.equal(FX.shareScore(unmeasured), null);
  assert.equal(FX.score(unmeasured), 20, 'category score unchanged');
  assert.equal(FX.shareScore(MINIMAL), null);
  const edge = report(baseLast({ flood: sfha(0.4) })).calc;
  const most = report(baseLast({ flood: sfha(90) })).calc;
  assert.equal(edge.factors.flood.score, 85);
  assert.ok(edge.score - most.score > 1, `edge-only ${edge.score} vs 90% ${most.score}`);
});

test('buildable area: under the homesite minimum caps the score; ample area adds no penalty', () => {
  const removed = [{ key: 'flood', reason: 'FEMA high-risk flood zone A', acres: 13.85, pct: 67.1 }, { key: 'wetland', reason: 'Mapped wetlands (NWI)', acres: 2.4, pct: 11.7 }];
  const none = report(baseLast({ flood: sfha(67.1) })).calc;
  const ample = report(baseLast({ flood: sfha(67.1), buildableArea: measured(6.78, 20.63, removed) })).calc;
  assert.equal(ample.score, none.score, 'flood/wetlands outside an ample homesite are not penalized twice');
  assert.equal(ample.why, '6.8 ac remain outside the flood zone and wetlands');
  const tight = report(baseLast({ flood: sfha(98), buildableArea: measured(0.2, 20, removed) })).calc;
  assert.equal(tight.score, 2.5 + 2.5 * 0.2 / 0.5);
  assert.equal(tight.rating, 'Challenging');
  assert.equal(tight.why, 'Only 0.2 ac remain outside the flood zone and wetlands: a homesite may not fit');
  // A 0.26 ac city lot with nothing removed: half the parcel is the minimum, so no cap.
  const lot = report(baseLast({ buildableArea: measured(0.26, 0.26) })).calc;
  assert.equal(lot.buildable.tight, false);
  assert.equal(lot.why, 'All 0.26 ac outside mapped flood zones, wetlands and steep slopes');
  assert.match(report(baseLast()).calc.why, /^Buildable area still measuring · main constraint: /);
});

test('listing evidence and the cost estimate never change the score', () => {
  const plain = report(baseLast()).calc.score;
  const listed = report(baseLast({ evidence: { status: 'found', matchScore: 95, claims: ['well', 'septic'] }, resoListings: { available: true, best: { listingId: '1' } } })).calc.score;
  assert.equal(listed, plain);
  const src = readPublic('screening-refinements.js');
  const calc = src.slice(src.indexOf('function scoreFactors()'), src.indexOf('function renderScore()'));
  assert.doesNotMatch(calc, /evidence|resoListings|costEstimate|AcresXCostModel/);
});

test('report page 1 prints the dashboard score and the same "why" line', () => {
  const data = baseLast({ flood: sfha(67.1), buildableArea: measured(6.78, 20.63, [{ key: 'flood', reason: 'FEMA high-risk flood zone A', acres: 13.85, pct: 67.1 }]) });
  const d = dashboard(data);
  const shown = d.$('scoreMetric').textContent;
  assert.equal(d.page.document.querySelector('.score-why').textContent, '6.8 ac remain outside the flood zone');
  const { html } = report(data);
  assert.match(html, new RegExp(`<div class="t-num">${shown.replace('.', '\\.')}<`));
  assert.match(html, /<p class="t-why">6\.8 ac remain outside the flood zone\.<\/p>/);
});

test('the score updates when the buildable-area answer arrives', async () => {
  const removed = [{ key: 'flood', reason: 'FEMA high-risk flood zone A', acres: 19.8, pct: 99 }];
  const fetch = async () => ({ ok: true, status: 200, json: async () => measured(0.2, 20, removed) });
  const d = dashboard(baseLast({ flood: sfha(99) }), { fetch });
  const before = d.$('scoreMetric').textContent;
  assert.match(d.page.document.querySelector('.score-why').textContent, /still measuring/);
  await d.clock.advance(100); // buildable-area.js sends its request on the next frame
  assert.equal(d.page.run('last.buildableArea.buildableAcres'), 0.2);
  assert.equal(d.$('scoreMetric').textContent, '3.5', `was ${before}`);
  assert.match(d.page.document.querySelector('.score-why').textContent, /a homesite may not fit/);
});

test('progressive loading re-renders the summary when buildableArea settles', () => {
  const src = readPublic('progressive-loading.js');
  assert.match(src, /const RERENDER_FOLLOWUPS = \['buildableArea'\];/);
  assert.match(src, /RERENDER_FOLLOWUPS\.includes\(key\)\) \{\n\s+run\.dirty = true;\n\s+scheduleRender\(\);/);
});

// ---- 3. Septic

test('septic: the slope part uses the measured parcel grade; drainage and group D still limit', () => {
  const h = makeLazyContext();
  h.run(readPublic('screening-inputs.js'));
  const SX = h.context.AcresXSeptic;
  // Yellowstone 03072527101010000 shape: group B here, so only the slope class was limiting.
  const flat = SX.assess({ soil: soil(), terrain: { available: true, gradePct: 1.9 } });
  assert.equal(flat.feasibility, 'favorable', 'was limited by the map unit slope_r 25%');
  assert.equal(flat.context, 'Soil map unit spans 15–35% slopes; measured parcel grade 1.9%');
  assert.equal(flat.note, 'USDA screening only; a site evaluation sets the system type.');
  const groupD = SX.assess({ soil: soil({ hydrologicGroup: 'D' }), terrain: { available: true, gradePct: 1.9 } });
  assert.equal(groupD.feasibility, 'limited');
  assert.deepEqual([...groupD.limits], ['hydrologic group D (slow infiltration)']);
  const steep = SX.assess({ soil: soil({ mapUnit: 'Garrison loam, 0 to 8 percent slopes', soilSlopePct: 4, feasibility: 'favorable' }), terrain: { available: true, gradePct: 22 } });
  assert.equal(steep.feasibility, 'limited', 'measured 22% grade limits even a gentle map unit');
  assert.deepEqual([...steep.limits], ['measured grade 22.0% (over 15%)']);
  const noTerrain = SX.assess({ soil: soil(), terrain: { available: false } });
  assert.equal(noTerrain.feasibility, 'limited', 'without terrain the map slope is kept');
  assert.match(noTerrain.context, /^Measured parcel grade not available; soil map slope 25% used$/);
  const old = SX.assess({ soil: { available: true, feasibility: 'favorable' }, terrain: { available: true, gradePct: 30 } });
  assert.equal(old.feasibility, 'favorable', 'an answer without drainage or group keeps its grade');
});

test('septic: the land answer is graded once, and card, score, cost and report agree', async () => {
  const data = baseLast();
  const d = dashboard(data);
  assert.equal(d.$('soilGrade').textContent, 'Favorable');
  assert.equal(d.$('soilNote').textContent, 'Soil map unit spans 15–35% slopes; measured parcel grade 1.9%. USDA screening only; a site evaluation sets the system type.');
  assert.equal(d.page.run('last.land.soil.soilMapFeasibility'), 'limited');
  const chips = d.page.document.querySelector('.score-factor-line').innerHTML;
  assert.match(chips, /Septic 92/);
  assert.match(d.page.run('window.__acresxScreeningCostEstimate()').components.septic.basis, /Favorable/);
  // findLandAnalysis (index.html) is wrapped, so the answer is graded as it arrives.
  const page = makeContext({ body: [], clock: makeClock(), fetch: async () => ({}) });
  page.run('async function findLandAnalysis() { return { available: true, soil: { available: true, mapUnit: "Maginnis channery clay loam, 15 to 35 percent slopes", drainage: "Well drained", hydrologicGroup: "B", soilSlopePct: 25, feasibility: "limited" }, terrain: { available: true, gradePct: 1.9 } }; }');
  page.run(readPublic('screening-inputs.js'));
  const land = await page.run('window.findLandAnalysis()');
  assert.equal(land.soil.feasibility, 'favorable');
  assert.equal(land.soil.septic.slopeSource, 'measured');
  const { html } = report(baseLast());
  assert.match(html, /Soil map unit spans 15–35% slopes; measured parcel grade 1\.9%/);
  assert.match(html, /USDA screening only; a site evaluation sets the system type/);
});

test('screening-inputs.js is injected before the modules that read it', () => {
  const src = readPublic('../src/index.js');
  const list = src.match(/for\(const s of \[([^\]]+)\]\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.equal(list[1], 'screening-inputs');
  for (const user of ['parcel-preview', 'score-cost', 'screening-refinements', 'parcel-summary-insights', 'local-cost-model', 'property-report-v2']) {
    assert.ok(list.indexOf(user) > 1 || readPublic('index.html').includes(`${user}.js`), user);
  }
});
