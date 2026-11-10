// Offline tests for the "Swap to hookups" frontend (owner decision 2026-11-09): with public water
// and/or sewer served or likely (last.publicUtilities, public/public-utilities.js) the water/septic
// score factors turn favorable and the well/septic cost lines become connection ranges; with
// not_found, unavailable or no answer the report is unchanged. Runs the real browser scripts in
// node:vm with the fake DOM from test/ui-harness.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, makeContext, makeLazyContext, readPublic } from './ui-harness.js';

const square = { type: 'Polygon', coordinates: [[[-117.4, 47.6], [-117.399, 47.6], [-117.399, 47.601], [-117.4, 47.601], [-117.4, 47.6]]] };
const parcel = (county = 'Kootenai') => ({ type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: 'C72150030040', _countyDisplay: county, _stateCode: county === 'Kootenai' ? 'ID' : undefined } });
const SERVED = (provider = "City of Coeur d'Alene") => ({ status: 'served', provider, basis: `${provider} main 7 m from the parcel`, source: { name: 'Mains', url: 'https://gis.example.test/3' }, distanceM: 7 });
const LIKELY = { status: 'likely', provider: 'City of Hayden', basis: 'inside City of Hayden limits; no sewer utility map published', source: { name: 'Tax districts', url: 'https://map.example.test/25' } };
const NONE = { status: 'not_found', provider: null, basis: 'No public sewer service area, district or main found near the parcel (checked: X).', source: null };
const DOWN = { status: 'unavailable', provider: null, basis: 'Mains did not answer.', source: null };

// Deep wells (420 ft) and limited soil, so a swap is visible in both factors and costs.
const baseLast = (publicUtilities, extra = {}) => ({
  parcel: parcel(extra.county), wells: [{ properties: { CompletedDepth: 420, _distance: 0.1 } }], utility: ['Avista'],
  flood: { available: true, intersects: false, zones: [] }, wetlands: { available: true, intersects: false, count: 0 },
  zoningPermits: { zoning: { status: 'gis_match', code: 'R-12' } }, evidence: extra.evidence || { status: 'none' },
  land: { soil: { available: true, feasibility: 'limited', mapUnit: 'Test loam' }, terrain: { available: true, gradePct: 4, reliefFt: 10 } },
  ...(publicUtilities === undefined ? {} : { publicUtilities })
});

const PAGE = [
  ['div', { class: 'overview-grid' }, '', [
    ['article', { class: 'card score-card' }, '', [['div', { id: 'scoreMetric', class: 'metric-value' }, '—'], ['div', { id: 'scoreNote' }, '']]],
    ['article', { id: 'developmentCostCard', class: 'card development-cost-card' }, '', [['div', { class: 'cost-value' }, ''], ['div', { class: 'cost-note' }, '']]]
  ]],
  ['article', { class: 'card snapshot-card', 'data-detail': 'wells' }, '', [['span', { id: 'waterGrade' }, ''], ['span', { id: 'waterStatus' }, ''], ['span', { id: 'wellNote' }, '5 nearby wells']]],
  ['article', { class: 'card snapshot-card', 'data-detail': 'soil' }, '', [['span', { id: 'soilGrade' }, ''], ['span', { id: 'soilStatus' }, ''], ['span', { id: 'soilNote' }, 'Well drained']]],
  ['div', { id: 'results' }]
];

// The score/cost modules in their injection order, then public-utilities.js (src/index.js).
function render(last, { withUtilities = true } = {}) {
  const clock = makeClock();
  const page = makeContext({ body: PAGE, clock, fetch: async () => { throw new Error('no network'); }, autoIds: true });
  page.ctx.__last = last;
  page.run('var last = __last; var activeTab = "wells"; function renderSummary() {} function renderResults() { document.getElementById("results").innerHTML = "<p>wells list</p>"; }', 'index-inline.js');
  for (const f of ['score-cost.js', 'screening-refinements.js', 'spokane-cost-model.js', ...(withUtilities ? ['public-utilities.js'] : [])]) page.run(readPublic(f), f);
  page.run('renderSummary(last.parcel)');
  const $ = id => page.document.getElementById(id);
  const chips = page.document.querySelector('.score-factor-line')?.textContent || '';
  const factor = label => Number(new RegExp(`${label} (\\d+)`).exec(chips)?.[1]);
  const general = page.run('window.__acresxGeneralCostEstimate()');
  const spokane = page.run('window.__acresxSpokaneCostEstimate()');
  return { page, $, score: $('scoreMetric').textContent, water: factor('Water'), septic: factor('Septic'), general, spokane };
}

test('without a public-utilities answer the score and costs are what wells and soil give', () => {
  const r = render(baseLast(undefined));
  assert.equal(r.water, 55, 'deep wells');
  assert.equal(r.septic, 38, 'limited soil');
  assert.equal(r.general.components.well.low, 30000);
  assert.equal(r.general.components.septic.low, 25000);
  assert.equal(r.general.components.well.label, undefined);
  const without = render(baseLast(undefined), { withUtilities: false });
  assert.equal(without.score, r.score, 'loading public-utilities.js alone changes nothing');
});

test('public water served swaps the water factor and the well line only (sewer not found keeps septic)', () => {
  const off = render(baseLast({ water: SERVED(), sewer: NONE }));
  assert.equal(off.water, 92);
  assert.equal(off.septic, 38, 'septic stays on the soil screening');
  const well = off.general.components.well;
  assert.deepEqual([well.label, well.low, well.high], ['Water connection', 3000, 15000]);
  assert.match(well.basis, /connection\/capacity fees vary; check the city or district fee schedule/);
  assert.match(well.basis, /verify with the city\/district/);
  assert.equal(off.general.components.septic.low, 25000);
  assert.equal(off.general.components.septic.label, undefined);
  assert.ok(Number(off.score) > Number(render(baseLast(undefined)).score), 'the score rises');
});

test('public sewer swaps the septic factor and line independently; likely scores 85', () => {
  const r = render(baseLast({ water: NONE, sewer: LIKELY }));
  assert.equal(r.water, 55, 'water stays on the well depths');
  assert.equal(r.septic, 85);
  const septic = r.general.components.septic;
  assert.deepEqual([septic.label, septic.low, septic.high], ['Sewer connection', 4000, 20000]);
  assert.equal(r.general.components.well.label, undefined);
  const both = render(baseLast({ water: SERVED(), sewer: SERVED() }));
  assert.deepEqual([both.water, both.septic], [92, 92]);
  assert.equal(both.general.low, 3000 + 4000 + both.general.components.power.low + both.general.components.driveway.low + both.general.components.sitework.low);
});

test('not_found, unavailable and a timed-out section keep the private well and septic', () => {
  const base = render(baseLast(undefined));
  for (const pu of [{ water: NONE, sewer: NONE }, { water: DOWN, sewer: DOWN }, { available: false, timedOut: true, water: { status: 'unavailable' }, sewer: { status: 'unavailable' } }, null]) {
    const r = render(baseLast(pu));
    assert.deepEqual([r.score, r.water, r.septic, r.general.low, r.general.high], [base.score, base.water, base.septic, base.general.low, base.general.high], JSON.stringify(pu));
  }
});

test('listing data never changes the score, with or without public utilities', () => {
  const pu = { water: SERVED(), sewer: LIKELY };
  const a = render(baseLast(pu, { evidence: { status: 'found', matchScore: 90, claims: [{ label: 'City water and sewer' }] } }));
  const b = render(baseLast(pu, { evidence: { status: 'error' } }));
  assert.equal(a.score, b.score);
});

test('the Spokane cost model swaps its well and septic lines the same way', () => {
  const off = render(baseLast(undefined, { county: 'Spokane' }));
  const on = render(baseLast({ water: SERVED('City of Spokane'), sewer: SERVED('City of Spokane') }, { county: 'Spokane' }));
  assert.match(off.spokane.components.septic.basis, /SRHD residential OSS permit fee/);
  assert.deepEqual([on.spokane.components.well.label, on.spokane.components.well.low], ['Water connection', 3000]);
  assert.deepEqual([on.spokane.components.septic.label, on.spokane.components.septic.high], ['Sewer connection', 20000]);
  assert.ok(on.spokane.high < off.spokane.high);
});

test('cards and detail tab say "Public water: …", keep well data as "if a private well were needed"', () => {
  const r = render(baseLast({ water: SERVED(), sewer: NONE }));
  assert.equal(r.$('waterGrade').textContent, 'Public water');
  assert.match(r.$('waterStatus').textContent, /^Public water likely available — City of Coeur d'Alene · verify with the city\/district$/);
  assert.equal(r.$('wellNote').textContent, 'If a private well were needed: 1 residential-comparable well · median depth', 'the depth note is kept, labelled');
  assert.equal(r.$('soilNote').textContent, 'Well drained', 'sewer not found: septic card untouched');
  r.page.run('renderResults()');
  const block = r.page.document.querySelector('.public-utilities-detail');
  assert.ok(block, 'detail block shown on the wells tab');
  assert.match(block.textContent, /Public water: likely available — City of Coeur d(&#39;|')Alene/, 'the fake DOM keeps entities');
  assert.match(block.textContent, /verify with the city\/district/);
  assert.match(block.textContent, /If a private well were needed/);
  const U = r.page.ctx.AcresXUtilities;
  assert.equal(U.overviewText(r.page.run('last')), "Public water: likely available — City of Coeur d'Alene · Public sewer: not found — verify with the city/district");
});

test('index.html renderSummary grades public water and sewer the same way', () => {
  const lines = readPublic('index.html').split('\n');
  const pick = name => lines.find(l => l.startsWith(`function ${name}(`) || l.startsWith(`const ${name}=`)) || '';
  const run = last => {
    const h = makeLazyContext({ last });
    h.run(readPublic('public-utilities.js'));
    h.run(`const $=id=>document.getElementById(id);\n${pick('UTILITY_LOOKUP_FAILED')}\n${pick('utilityText')}\n${pick('gradeWellDepth')}\n${pick('setTraffic')}\n${pick('renderSummary')}`);
    h.run('renderSummary(last.parcel)');
    return { score: h.el('scoreMetric').textContent, water: h.el('waterGrade').textContent, soil: h.el('soilGrade').textContent };
  };
  const off = run(baseLast({ water: NONE, sewer: NONE }));
  const on = run(baseLast({ water: SERVED(), sewer: LIKELY }));
  assert.deepEqual([off.water, off.soil], ['Deep', 'Limited']);
  assert.deepEqual([on.water, on.soil], ['Public water', 'Public sewer likely']);
  assert.ok(Number(on.score) > Number(off.score));
});

test('the printable report shows public water/sewer and keeps the private well data as a fallback note', () => {
  const data = baseLast({ water: SERVED(), sewer: NONE });
  const h = makeLazyContext({ mappedSqm: 1000, last: data });
  h.run(readPublic('public-utilities.js'));
  h.run(readPublic('acreage.js'));
  h.run(readPublic('property-report-v2.js'));
  h.context.__acresxLast = data;
  h.context.__acresxGeneralCostEstimate = () => ({ low: 1, high: 2, components: { well: { low: 3000, high: 15000, label: 'Water connection', basis: 'fees vary' } } });
  h.el('wellMetric').textContent = '420 ft est.';
  h.el('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
  const html = h.opened.at(-1);
  assert.match(html, /Public water: likely available — City of Coeur d(&#39;|')Alene/);
  assert.match(html, /If a private well were needed/);
  assert.match(html, /Water connection/);
  assert.match(html, /Septic &amp; Soils|Septic & Soils/, 'sewer not found keeps the septic finding');
});

test('findPublicUtilities posts state, county, point and outline; a failure answers unavailable', async () => {
  const clock = makeClock();
  const sent = [];
  let reply = { ok: true, status: 200, json: async () => ({ available: true, water: SERVED(), sewer: NONE }) };
  const page = makeContext({ body: [], clock, fetch: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return reply; }, extra: { turf: { centroid: () => ({ geometry: { coordinates: [-116.8, 47.7] } }) } } });
  page.run(readPublic('public-utilities.js'));
  page.ctx.__p = parcel();
  const ok = await page.run('findPublicUtilities(__p)');
  assert.equal(ok.water.status, 'served');
  assert.deepEqual({ ...sent[0].body, geometry: undefined }, { state: 'ID', county: 'Kootenai', lat: 47.7, lon: -116.8, geometry: undefined });
  assert.deepEqual(sent[0].body.geometry, square);
  assert.equal(sent[0].url, '/api/public-utilities');
  reply = { ok: false, status: 502, json: async () => ({ error: 'Request failed' }) };
  const bad = await page.run('findPublicUtilities(__p)');
  assert.deepEqual([bad.water.status, bad.sewer.status], ['unavailable', 'unavailable']);
});
