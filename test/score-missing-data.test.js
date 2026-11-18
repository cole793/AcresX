// Offline tests for the missing-data score fix (2026-11-15): a factor whose source failed, timed
// out or has not answered is left out of the buildability score (weights re-normalized over the
// measured factors) instead of being scored as bad, and the score says "Incomplete — N of 7
// factors measured" (Provisional below 4) on the dashboard and on report page 1. The cost
// estimate keeps its range but names the missing inputs. Real "bad" answers are still scored.
// Runs the real browser scripts in node:vm with the fake DOMs from test/ui-harness.js. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeClock, makeContext, makeLazyContext, readPublic } from './ui-harness.js';

// The page's wells now carry the terrain-aware estimate (public/well-terrain.js attaches it as
// wells.terrain; recorded for this parcel 2026-11-18: moderate confidence, 170 ft, 8 wells at similar elevation).
const TERRAIN = JSON.parse(readFileSync(new URL('./fixtures/well-depth-terrain-spokane-23123.9051.json', import.meta.url), 'utf8')).answer;
const withTerrain = data => { data.wells.terrain = structuredClone(TERRAIN); return data; };
const fixture = () => withTerrain(JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8')));
// What the browser leaves when USDA soil and USGS terrain did not answer (src/services/land-analysis.js).
const withoutSoilTerrain = data => ({
  ...data,
  land: { ...data.land, soil: { available: false, error: 'Soil data unavailable' }, terrain: { available: false, error: 'Elevation unavailable' } }
});

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
const turf = { area: () => 20.68 * 4046.86, centroid: () => ({ geometry: { coordinates: [-117.395, 47.605] } }) };
const DASH = ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'ui-polish.js', 'parcel-preview.js', 'score-cost.js', 'screening-refinements.js', 'parcel-summary-insights.js', 'cost-tables.js', 'local-cost-model.js', 'buildable-area.js', 'public-utilities.js'];

function dashboard(last) {
  const clock = makeClock();
  const page = makeContext({ body: PAGE, clock, fetch: async () => { throw new Error('no network'); }, autoIds: true, extra: { L, turf } });
  page.ctx.__last = last;
  const lines = readPublic('index.html').split('\n');
  const pick = name => lines.find(l => l.startsWith(`function ${name}(`) || l.startsWith(`const ${name}=`)) || '';
  page.run(`var last = __last; var activeTab = ""; const $=id=>document.getElementById(id);\n${pick('UTILITY_LOOKUP_FAILED')}\n${pick('utilityText')}\n${pick('gradeWellDepth')}\n${pick('setTraffic')}\n${pick('renderSummary')}\nfunction renderResults() {}`, 'index-inline.js');
  for (const f of DASH) page.run(readPublic(f), f);
  page.run('renderSummary(last.parcel)');
  const $ = id => page.document.getElementById(id);
  const card = page.document.querySelector('.overview-grid .score-card');
  return {
    page, $, calc: page.ctx.AcresXScore.calculate(),
    score: $('scoreMetric').textContent, note: $('scoreNote').textContent,
    chips: card.querySelector('.score-factor-line').innerHTML,
    constraint: card.querySelector('.score-constraint').textContent,
    missing: card.querySelector('.score-missing')?.innerHTML || '',
    cost: page.document.getElementById('developmentCostCard').textContent
  };
}

function report(data, shownScore) {
  const h = makeLazyContext({ mappedSqm: 20.68 * 4046.86, last: data });
  for (const f of ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'buildable-area.js', 'property-report-v2.js']) h.run(readPublic(f));
  h.el('scoreMetric').textContent = shownScore ?? '';
  h.context.__acresxLast = data;
  h.generate();
  const html = h.opened.at(-1);
  const text = html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
  // Page 1 score tile + page 2 "About the score" section.
  const scoreCard = (/<article class="tile t-score[\s\S]*?<\/article>/.exec(html)?.[0] || '') + (/<section class="c-sec block"><h2>About the score<\/h2>[\s\S]*?<\/section>/.exec(html)?.[0] || '');
  return { html, text, scoreCard, calc: h.context.AcresXScore.calculate() };
}

// The measured factors' weighted average (0-10), from a calculation's factors.
function measuredAverage(calc, skip = []) {
  const keys = Object.keys(calc.factors).filter(k => !skip.includes(k));
  const w = keys.reduce((s, k) => s + calc.weights[k], 0);
  return keys.reduce((s, k) => s + calc.factors[k].score * calc.weights[k], 0) / w / 10;
}

test('same parcel: soil and terrain missing are left out of the score, not scored as bad', () => {
  const full = dashboard(fixture());
  const gap = dashboard(withoutSoilTerrain(fixture()));
  assert.equal(full.calc.completeness.complete, true);
  assert.equal(full.note, `${full.calc.rating} buildability · 7-factor screening`, 'a complete score is labeled as before');
  assert.equal(gap.calc.completeness.measured, 5);
  assert.deepEqual([...gap.calc.completeness.missing.map(m => m.key)], ['soil', 'terrain']);
  // The re-normalized weighted average of the five factors both runs measured.
  const expected = measuredAverage(full.calc, ['soil', 'terrain']);
  assert.ok(Math.abs(gap.calc.score - expected) < 1e-9, `${gap.calc.score} vs ${expected}`);
  assert.equal(gap.score, expected.toFixed(1));
  // The old behavior would have scored both at 50 and pulled the score down.
  const penalized = (Object.entries(full.calc.factors).reduce((s, [k, f]) => s + (k === 'soil' || k === 'terrain' ? 50 : f.score) * full.calc.weights[k], 0) / 100) / 10;
  assert.ok(gap.calc.score > penalized + 0.5, `not penalized: ${gap.calc.score} vs old ${penalized}`);
  // Labels on the dashboard card.
  assert.equal(gap.note, `${gap.calc.rating} buildability · Incomplete — 5 of 7 factors measured`);
  assert.match(gap.missing, /Not measured: Septic \(USDA soil service didn't answer\); Terrain \(USGS elevation service didn't answer\)\. Left out of the score\./);
  assert.match(gap.chips, /Septic not checked/);
  assert.match(gap.chips, /Terrain not checked/);
  assert.doesNotMatch(gap.chips, /Septic 50|Terrain 50/);
  assert.doesNotMatch(gap.constraint, /Septic|Terrain/, 'a missing factor is not the main constraint');
});

test('report page 1 matches the dashboard: same score, "Incomplete" label, "not checked" drivers', () => {
  const data = withoutSoilTerrain(fixture());
  const dash = dashboard(withoutSoilTerrain(fixture()));
  const r = report(data, dash.score);
  assert.match(r.scoreCard, new RegExp(`<div class="t-num">${dash.score.replace('.', '\\.')}<small>/10`));
  assert.match(r.scoreCard, /<p class="t-flag">Incomplete — 5 of 7 factors measured<\/p>/);
  assert.match(r.scoreCard, new RegExp(`<p class="t-label"><i class="dot \\w+"></i>${dash.calc.rating}</p>`));
  assert.match(r.text, /Soil not checked \(USDA soil service didn't answer\) — try again/);
  assert.match(r.text, /Terrain not checked \(USGS elevation service didn't answer\) — try again/);
  assert.doesNotMatch(r.text, /Soil data not available for septic screening|Terrain not measured/);
  assert.match(r.scoreCard, /<li class="missing"><i class="dot verify"><\/i><p>Soil not checked/, 'shown as not checked, not as a red warning');
  // Key findings: one amber "not checked" line.
  assert.match(r.text, /Not checked: soil, terrain — try again/);
  // The complete report has neither.
  const full = report(fixture(), dashboard(fixture()).score);
  assert.doesNotMatch(full.scoreCard, /t-flag|not checked/);
  assert.equal(r.calc.score.toFixed(1), dash.score);
});

test('fewer than 4 measured factors: the score is Provisional on the dashboard and the report', () => {
  const data = withoutSoilTerrain(fixture());
  data.flood = { available: false, error: 'Timed out', timedOut: true };
  data.wetlands = { available: false, error: 'NWI unavailable' };
  const dash = dashboard(JSON.parse(JSON.stringify(data)));
  assert.equal(dash.calc.completeness.measured, 3);
  assert.equal(dash.calc.rating, 'Provisional');
  assert.equal(dash.note, 'Provisional score · Incomplete — 3 of 7 factors measured');
  assert.match(dash.missing, /Flood \(FEMA flood map service timed out\)/);
  assert.match(dash.missing, /too few factors for a firm rating/);
  const r = report(data, dash.score);
  assert.match(r.scoreCard, /tile t-score band-na/);
  assert.match(r.scoreCard, /<p class="t-label"><i class="dot na"><\/i>Provisional<\/p>/);
  assert.match(r.scoreCard, /Incomplete — 3 of 7 factors measured/);
  assert.match(r.text, /Flood not checked \(FEMA flood map service timed out\) — try again/);
});

test('data that says bad is still scored: limited soil and steep terrain keep their low factors', () => {
  const data = fixture();
  data.land.soil = { ...data.land.soil, drainage: 'Poorly drained', hydrologicGroup: 'D', feasibility: 'limited' };
  data.land.terrain = { ...data.land.terrain, gradePct: 22 };
  const dash = dashboard(data);
  assert.equal(dash.calc.completeness.complete, true);
  assert.equal(dash.calc.factors.terrain.score, 35);
  assert.equal(dash.calc.factors.soil.score, 38);
  assert.match(dash.chips, /Terrain 35/);
  assert.ok(dash.calc.score < dashboard(fixture()).calc.score);
});

test('no nearby wells and no provider found are real answers, scored as before; failed lookups are not', () => {
  const none = fixture();
  none.wells = [];
  none.utility = [];
  none.powerIntelligence = null;
  const a = dashboard(none).calc;
  assert.equal(a.completeness.complete, true);
  assert.equal(a.factors.water.score, 40);
  assert.equal(a.factors.power.score, 45);
  const failed = fixture();
  failed.wells = []; failed.wells.lookupFailed = true;
  failed.utility = []; failed.utility.lookupFailed = true;
  failed.powerIntelligence = null;
  const b = report(failed).calc;
  assert.deepEqual([...b.completeness.missing.map(m => m.key)], ['water', 'power']);
  const r = report(failed);
  const page1 = r.text.slice(0, r.text.indexOf('Page 1 of'));
  assert.doesNotMatch(page1, /Power provider not identified|No nearby well depths/);
  assert.match(r.text, /Not checked: water, power — try again/);
});

test('the buildable-area cap (PR #67) still applies to an incomplete score', () => {
  const data = withoutSoilTerrain(fixture());
  data.buildableArea = { status: 'measured', parcelAcres: 20.68, buildableAcres: 0.1, buildablePct: 0.5, removed: [{ key: 'flood', acres: 20.58 }], layers: [] };
  const c = dashboard(data).calc;
  assert.equal(c.completeness.measured, 5);
  assert.ok(Math.abs(c.score - (2.5 + 2.5 * 0.1 / 0.5)) < 1e-9);
  assert.match(c.why, /Only 0\.1 ac remain outside the flood zone/);
});

test('cost: the range is kept and the missing inputs are named on the card and the report', () => {
  const dash = dashboard(withoutSoilTerrain(fixture()));
  const e = dash.page.ctx.AcresXCostModel.estimate();
  assert.deepEqual([...e.missingInputs.map(m => m.key)], ['soil', 'terrain']);
  assert.equal(e.missingNote, "Soil and terrain not checked (USDA soil service didn't answer; USGS elevation service didn't answer): the septic and site work lines use wider planning ranges until they load.");
  assert.match(dash.cost, /Soil and terrain not checked/);
  assert.equal(e.low, e.components.well.low + e.components.septic.low + e.components.electric.low + e.components.driveway.low + e.components.sitework.low + e.components.permits.low);
  const r = report(withoutSoilTerrain(fixture()), dash.score);
  assert.match(r.text, /Soil and terrain not checked \(USDA soil service didn't answer; USGS elevation service didn't answer\)/);
  // Complete data: no note.
  assert.equal(dashboard(fixture()).page.ctx.AcresXCostModel.estimate().missingNote, '');
  // The cost never feeds the score: changing the estimate leaves the score alone.
  const before = dash.calc.score;
  dash.page.ctx.AcresXCostModel.estimate = () => ({ low: 1, high: 2, components: {} });
  assert.equal(dash.page.ctx.AcresXScore.calculate().score, before);
});

test('listing claims never feed the score, complete or incomplete', () => {
  for (const make of [fixture, () => withoutSoilTerrain(fixture())]) {
    const a = dashboard(make()).calc.score;
    const data = make();
    data.evidence = { status: 'found', claims: [{ type: 'septic', text: 'Septic approved' }, { type: 'well', text: 'Well 80 ft' }] };
    data.resoListings = { configured: true, best: { remarks: 'Perc tested, power at the road' } };
    assert.equal(dashboard(data).calc.score, a);
  }
});

test('limited-data counties (PR #66) keep the Incomplete part of the score note', () => {
  const src = readPublic('coverage-trust.js');
  const m = /const m = (\/.*\/)\.exec\(t\);/.exec(src);
  assert.ok(m, 'coverage-trust.js note pattern');
  // eslint-disable-next-line no-eval
  const re = eval(m[1]);
  const rewrite = t => { const x = re.exec(t); return x ? `${x[1]} · limited data${t.slice(x[0].length)}` : t; };
  assert.equal(rewrite('Excellent buildability · 7-factor screening'), 'Excellent buildability · limited data');
  assert.equal(rewrite('Good buildability · Incomplete — 5 of 7 factors measured'), 'Good buildability · limited data · Incomplete — 5 of 7 factors measured');
  assert.equal(rewrite('Provisional score · Incomplete — 3 of 7 factors measured'), 'Provisional score · limited data · Incomplete — 3 of 7 factors measured');
});

test('"Retry missing layers" re-runs the settled sections behind the missing factors', async () => {
  const clock = makeClock();
  const page = makeContext({
    body: [['div', { id: 'status' }], ['section', { id: 'emptyState' }], ['section', { id: 'dashboard' }], ['article', { id: 'detailCard' }], ['button', { id: 'searchBtn' }], ['select', { id: 'county' }], ['input', { id: 'parcel' }],
      ['div', { class: 'overview-grid' }, '', [['article', { class: 'card score-card' }, '', [['div', { id: 'scoreMetric' }, '—'], ['div', { id: 'scoreNote' }, ''], ['div', { class: 'score-factor-line' }, '']]]]]],
    clock, fetch: async () => { throw new Error('no network'); }, extra: {}
  });
  const asks = {};
  page.ctx.__ask = (name, signal) => new Promise(resolve => { (asks[name] ||= []).push({ resolve, signal }); });
  page.run(`let last = {}; let activeTab = '';
    function renderSummary() {} function renderMap() {} function renderResults() {}
    async function findParcel() { return { type: 'Feature', properties: {}, geometry: null }; }
    ${['Wells', 'Utility', 'ListingEvidence', 'Flood', 'Wetlands', 'ZoningPermits', 'LandAnalysis', 'PublicUtilities'].map(n => `async function find${n}(p, s) { return __ask('${n}', s); }`).join('\n')}`, 'index-inline.js');
  page.run(readPublic('screening-refinements.js'), 'screening-refinements.js');
  page.run(readPublic('progressive-loading.js'), 'progressive-loading.js');
  const P = page.ctx.AcresXProgress, S = page.ctx.AcresXSections;
  await P.search();
  await clock.flush();
  asks.LandAnalysis[0].resolve({ available: true, soil: { available: false }, terrain: { available: false } });
  asks.Flood[0].resolve({ available: true, category: 'minimal' });
  await clock.flush();
  assert.equal(S.status('land'), 'done');
  const missing = page.ctx.AcresXScore.missingInputs(page.run('last'));
  assert.equal(missing.soil.section, 'land');
  assert.equal(missing.soil.state, 'failed');
  assert.equal(missing.wetlands.state, 'pending', 'a section still loading is "still loading", not failed');
  assert.match(missing.wetlands.text, /still loading\)$/);
  const restarted = P.retryMissing(['land', 'wetlands', 'flood']);
  assert.deepEqual([...restarted], ['land', 'flood'], 'pending sections are not restarted');
  assert.equal(asks.LandAnalysis.length, 2);
  assert.equal(S.status('land'), 'pending');
  assert.equal(asks.Wetlands.length, 1);
});

// Soil backup (src/services/soils.js): when USDA Soil Data Access is down, the Esri Living Atlas
// SSURGO copy answers with the same fields. Live, for this parcel, it gave the same values as SDA.
const withBackupSoil = data => ({
  ...data,
  land: { ...data.land, soil: {
    ...data.land.soil, source: 'USDA SSURGO via Esri Living Atlas (backup; USDA Soil Data Access unavailable)', backup: true,
    fallbackFrom: 'USDA soil service returned 502 with an invalid response.', septicRating: 'Very limited', slopeRangePct: { low: 3, high: 15 },
    sourceUrl: 'https://services5.arcgis.com/7weheFjxuNkGGiZi/arcgis/rest/services/USA_Soils_Map_Units/FeatureServer/0', vintage: 'gSSURGO, published December 2025'
  } }
});

test('soil backup answer: scored like the SDA answer (complete score), and the report names the backup source', () => {
  const full = dashboard(fixture());
  const backup = dashboard(withBackupSoil(fixture()));
  assert.equal(backup.calc.completeness.complete, true);
  assert.equal(backup.calc.score, full.calc.score);
  assert.equal(backup.calc.factors.soil.score, full.calc.factors.soil.score);
  assert.equal(backup.score, full.score);
  assert.equal(backup.cost, full.cost, 'cost model unchanged');
  const r = report(withBackupSoil(fixture()), backup.score);
  assert.match(r.text, /USDA SSURGO via Esri Living Atlas \(backup; USDA Soil Data Access unavailable\)/);
  assert.doesNotMatch(r.text, /USDA NRCS Soil Data Access \(SSURGO\)/);
  const sda = report(fixture(), full.score);
  assert.match(sda.text, /USDA NRCS Soil Data Access \(SSURGO\)/);
  assert.doesNotMatch(sda.text, /Esri Living Atlas \(backup/);
});
