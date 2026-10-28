// Offline tests for progressive loading (public/progressive-loading.js): the dashboard opens as
// soon as the parcel is found, sections fill in as they answer, pending is not failed, a slow
// section times out alone, follow-up requests fire once per search, answers for an older search
// are dropped, and the score waits for its inputs. Runs the real scripts in node:vm with the fake
// DOM, clock and fetch from test/ui-harness.js; a small stand-in plays index.html's inline script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, makeContext, makeFetch, readPublic } from './ui-harness.js';

const card = (detail, metric, status) => ['article', { class: 'card snapshot-card', 'data-detail': detail }, '', [
  ['div', { class: 'snapshot-value', id: metric }, '—'], ['span', { id: status }, 'Pending'], ['button', { class: 'snapshot-details-btn' }, 'Details']
]];
const fact = id => ['div', { class: 'property-overview-fact' }, '', [['span', {}, id], ['strong', { id }, '—']]];
const PAGE = [
  ['div', { id: 'status', class: 'status' }],
  ['section', { id: 'emptyState' }],
  ['section', { id: 'dashboard', class: 'dashboard' }, '', [
    ['span', { id: 'parcelFact' }, '—'],
    ['div', { class: 'property-overview-facts' }, '', ['overviewUtility', 'overviewFlood', 'overviewWetlands', 'overviewSoil', 'overviewWellDepth', 'overviewAvgGrade'].map(fact)],
    ['div', { class: 'overview-grid' }, '', [
      ['article', { class: 'card score-card' }, '', [['div', { id: 'scoreMetric', class: 'metric-value' }, '—'], ['div', { id: 'scoreNote' }, '']]],
      ['article', { id: 'developmentCostCard', class: 'card development-cost-card' }, '', [['div', { class: 'cost-value' }, ''], ['div', { class: 'cost-note' }, '']]]
    ]],
    ['div', { class: 'snapshot-grid' }, '', [
      card('wells', 'wellMetric', 'waterStatus'), card('power', 'utilityMetric', 'powerStatus'), card('listing', 'evidenceMetric', 'listingStatus'),
      card('soil', 'soilMetric', 'soilStatus'), card('slope', 'slopeMetric', 'slopeStatus')
    ]],
    ['div', { class: 'zoning-grid' }, '', [['article', { class: 'card snapshot-card horizontal', 'data-detail': 'zoning' }, '', [
      ['div', {}, '', [['div', { id: 'zoningMetric', class: 'snapshot-value' }, '—'], ['span', { id: 'zoningNote' }, '']]], ['button', { class: 'snapshot-details-btn' }, 'Details']
    ]]]],
    ['article', { id: 'detailCard' }, '', [['h3', { id: 'resultsTitle' }], ['div', { id: 'results', class: 'results-scroll' }]]]
  ]],
  ['select', { id: 'state' }], ['select', { id: 'county' }], ['input', { id: 'parcel' }], ['button', { id: 'searchBtn' }, 'Analyze property'],
  ['div', { class: 'version' }]
];

// Stand-in for index.html's inline script: the same globals, a renderSummary that renders each
// section from `last` (with the same "unavailable" wording when data is missing), and find*
// functions the test answers by hand.
const BASE = `
let last = { parcel: null, wells: [], utility: [], evidence: null };
let activeTab = 'wells';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '');
const log = [];
function renderSummary(parcel) {
  log.push('summary');
  $('parcelFact').textContent = parcel.properties.ORIG_PARCEL_ID;
  $('wellMetric').textContent = last.wells.length ? last.wells.length + ' wells' : 'Not found';
  $('waterStatus').textContent = last.wells.length ? 'Recorded wells nearby' : 'No nearby well depths returned';
  $('utilityMetric').textContent = last.utility.length ? last.utility.join(' / ') : 'Not identified';
  $('powerStatus').textContent = last.utility.length ? 'Likely provider identified' : 'Utility territory not identified';
  $('evidenceMetric').textContent = last.evidence?.status === 'none' ? 'No reliable listing' : 'Not configured';
  $('listingStatus').textContent = 'Listing search';
  $('zoningMetric').textContent = last.zoningPermits?.zoning?.code || 'Not configured';
  $('zoningNote').textContent = last.zoningPermits?.error || 'County source';
  $('soilMetric').textContent = last.land?.soil?.available ? 'Garrison' : 'Unavailable';
  $('soilStatus').textContent = 'Soil screening';
  $('slopeMetric').textContent = last.land?.terrain?.available ? '4.2%' : 'Unavailable';
  $('slopeStatus').textContent = 'Slope screening';
  $('overviewFlood').textContent = last.flood?.available ? 'Minimal flood hazard' : 'Not verified';
  $('overviewWetlands').textContent = last.wetlands?.available ? 'No mapped wetlands' : 'Not verified';
  $('overviewUtility').textContent = last.utility.length ? last.utility.join(' / ') : 'Not identified';
  $('overviewSoil').textContent = last.land?.soil?.available ? 'Garrison' : 'Not available';
  $('overviewWellDepth').textContent = last.wells.length ? '200 ft' : 'Not available';
  $('overviewAvgGrade').textContent = last.land?.terrain?.available ? '4.2%' : 'Not available';
  $('scoreMetric').textContent = (5 + ['flood', 'wetlands', 'zoningPermits', 'land'].filter(k => last[k]?.available).length * 0.5 + (last.powerIntelligence?.territory?.confirmed ? 0.1 : 0)).toFixed(1);
  $('scoreNote').textContent = 'Beta score';
  document.querySelector('#developmentCostCard .cost-value').textContent = '$40k–$60k';
  document.querySelector('#developmentCostCard .cost-note').textContent = 'Planning range';
}
function renderMap(fit) { log.push('map:' + fit); }
function renderResults() { log.push('results:' + activeTab); $('results').innerHTML = 'details for ' + activeTab; }
async function findParcel(county, input) { return __ctl('parcel', null, input); }
async function findWells(parcel, signal) { return __ctl('wells', signal); }
async function findUtility(parcel, signal) { return __ctl('utility', signal); }
async function findListingEvidence(parcel, signal) { return __ctl('evidence', signal); }
async function findFlood(parcel, signal) { return __ctl('flood', signal); }
async function findWetlands(parcel, signal) { return __ctl('wetlands', signal); }
async function findZoningPermits(parcel, signal) { return __ctl('zoningPermits', signal); }
async function findLandAnalysis(parcel, signal) { return __ctl('land', signal); }
`;

const parcelFor = id => ({ type: 'Feature', properties: { ORIG_PARCEL_ID: id, SITUS_ADDRESS: '1 Test Rd' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
const ANSWERS = {
  wells: [{ properties: { CompletedDepth: 200 } }],
  utility: ['Avista Utilities'],
  evidence: { status: 'none', matches: [] },
  flood: { available: true, category: 'minimal' },
  wetlands: { available: true, category: 'none' },
  zoningPermits: { available: true, county: 'Spokane', zoning: { status: 'gis_match', code: 'RR-10' }, permits: [] },
  land: { available: true, soil: { available: true }, terrain: { available: true, gradePct: 4.2 } }
};
const FOLLOWUP_ROUTES = {
  '/api/power-intelligence': { delay: 300, body: { available: true, provider: 'Avista Utilities', territory: { confirmed: true }, distribution: {} } },
  '/api/existing-well': { delay: 200, body: { available: true, match: null, confidence: 'Low' } },
  '/api/property-assessment': { delay: 200, body: { available: true, state: 'WA', records: [{ land_value: 1 }] } },
  '/api/reso-listings': { delay: 200, body: { configured: true, best: null } },
  '/api/zoning-rules': { delay: 200, body: { available: true, code: 'RR-10', uses: [] } }
};

// followups: also load the real modules that fire follow-up requests from renderSummary, in
// their injection order, before progressive-loading.js wraps everything (as in the browser).
function setup({ followups = false } = {}) {
  const clock = makeClock();
  const { fetch, calls } = makeFetch(clock, FOLLOWUP_ROUTES);
  const asks = {}; // name -> [{ resolve, reject, signal, input }]
  const __ctl = (name, signal, input) => new Promise((resolve, reject) => { (asks[name] ||= []).push({ resolve, reject, signal, input }); });
  const turf = { centroid: () => ({ geometry: { coordinates: [-117.3, 47.6] } }) };
  const page = makeContext({ body: PAGE, clock, fetch, extra: { __ctl, turf } });
  const { ctx, document, run } = page;
  document.getElementById('state').value = 'WA';
  document.getElementById('county').value = 'Spokane';
  document.getElementById('parcel').value = 'P1';
  run(BASE, 'index-inline.js');
  if (followups) for (const f of ['ui-polish.js', 'zoning-potential.js', 'property-assessment.js', 'existing-well.js', 'reso-listing-context.js']) run(readPublic(f), f);
  run(readPublic('progressive-loading.js'), 'progressive-loading.js');
  const $ = id => document.getElementById(id);
  const text = id => $(id).textContent;
  const answer = (name, value = ANSWERS[name], i = -1) => asks[name].at(i).resolve(value);
  const fail = (name, error = new Error('boom'), i = -1) => asks[name].at(i).reject(error);
  // Start a search and answer its parcel lookup.
  async function search(id = 'P1') {
    $('parcel').value = id;
    const done = ctx.AcresXProgress.search();
    await clock.flush();
    answer('parcel', parcelFor(id));
    await done;
    await clock.flush();
  }
  const summaries = () => run('log.filter(x => x === "summary").length');
  const lastValue = key => run(`last[${JSON.stringify(key)}]`);
  return { clock, ctx, document, run, $, text, asks, answer, fail, search, summaries, lastValue, calls, S: ctx.AcresXSections };
}

const SECTIONS = ['wells', 'utility', 'evidence', 'flood', 'wetlands', 'zoningPermits', 'land'];

test('the dashboard opens right after the parcel is found, with every section checking', async () => {
  const t = setup();
  await t.search();
  assert.ok(t.$('dashboard').classList.contains('show'));
  assert.equal(t.text('parcelFact'), 'P1');
  assert.equal(t.summaries(), 1);
  assert.deepEqual(t.run('JSON.stringify(log.filter(x => x.startsWith("map")))'), JSON.stringify(['map:true']));
  for (const name of SECTIONS) assert.equal(t.asks[name].length, 1, `${name} requested at once`);
  for (const id of ['wellMetric', 'utilityMetric', 'evidenceMetric', 'zoningMetric', 'soilMetric', 'slopeMetric', 'overviewFlood', 'overviewWetlands', 'overviewUtility', 'overviewSoil', 'overviewWellDepth', 'overviewAvgGrade']) {
    assert.equal(t.text(id), 'Checking…', id);
  }
  assert.equal(t.text('waterStatus'), 'Checking nearby well records…');
  assert.equal(t.text('scoreMetric'), 'Updating…');
  assert.match(t.text('scoreNote'), /^Waiting for wells, utility, flood, wetlands, zoning, soil & terrain…$/);
  assert.equal(t.document.querySelector('#developmentCostCard .cost-value').textContent, 'Updating…');
  assert.match(t.text('status'), /Dashboard ready/);
  assert.equal(t.$('searchBtn').disabled, false);
});

test('sections render on their own, in the order they answer, with bursts debounced', async () => {
  const t = setup();
  await t.search();
  t.answer('flood');
  await t.clock.advance(149);
  assert.equal(t.text('overviewFlood'), 'Checking…', 'debounced');
  await t.clock.advance(1);
  assert.equal(t.text('overviewFlood'), 'Minimal flood hazard');
  assert.equal(t.text('zoningMetric'), 'Checking…');
  assert.equal(t.text('wellMetric'), 'Checking…');
  assert.equal(t.summaries(), 2);

  t.answer('wells');
  await t.clock.advance(50);
  t.answer('wetlands');
  t.answer('land');
  await t.clock.advance(150);
  assert.equal(t.summaries(), 3, 'one re-render for the burst');
  assert.equal(t.text('wellMetric'), '1 wells');
  assert.equal(t.text('overviewWetlands'), 'No mapped wetlands');
  assert.equal(t.text('soilMetric'), 'Garrison');
  assert.equal(t.text('zoningMetric'), 'Checking…');
  assert.deepEqual(t.run('JSON.stringify(log.filter(x => x.startsWith("map")))'), JSON.stringify(['map:true', 'map:false']), 'wells redraw the map without refitting');
});

test('a failed section shows its usual unavailable text, not "Checking…"', async () => {
  const t = setup();
  await t.search();
  t.fail('zoningPermits');
  await t.clock.advance(150);
  assert.equal(t.S.status('zoningPermits'), 'failed');
  assert.equal(t.S.placeholder('zoningPermits'), null);
  assert.equal(t.text('zoningMetric'), 'Not configured');
  assert.equal(t.$('zoningMetric').classList.contains('section-pending-text'), false);
  assert.equal(t.document.querySelectorAll('.section-retry').length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(t.lastValue('zoningPermits'))), { available: false, permits: [], zoning: { status: 'unavailable' } });
  // Still pending: a different state from failed.
  assert.equal(t.S.placeholder('land'), 'pending');
  assert.equal(t.text('soilMetric'), 'Checking…');
});

test('a section that runs out of time shows "Timed out" alone and can be retried', async () => {
  const t = setup();
  await t.search();
  for (const name of SECTIONS.filter(n => n !== 'zoningPermits')) t.answer(name);
  await t.clock.advance(19999 - t.clock.now);
  assert.equal(t.text('zoningMetric'), 'Checking…');
  assert.equal(t.text('scoreMetric'), 'Updating…', 'score waits for zoning');
  await t.clock.advance(20150 - t.clock.now);
  assert.equal(t.S.status('zoningPermits'), 'timeout');
  assert.ok(t.asks.zoningPermits[0].signal.aborted, 'the request is aborted');
  assert.equal(t.text('zoningMetric'), 'Timed out');
  assert.equal(t.text('zoningNote'), 'Timed out — try again');
  const zoningCard = t.document.querySelector('.snapshot-card[data-detail="zoning"]');
  assert.ok(zoningCard.classList.contains('section-timeout'));
  assert.equal(t.document.querySelectorAll('.section-retry').length, 1);
  assert.equal(zoningCard.querySelector('.section-retry').dataset.section, 'zoningPermits');
  // The rest of the report is unaffected, and the score is final with zoning as unavailable.
  assert.equal(t.text('overviewFlood'), 'Minimal flood hazard');
  assert.equal(t.text('wellMetric'), '1 wells');
  assert.equal(t.text('scoreMetric'), '6.5');
  assert.match(t.text('scoreNote'), /zoning timed out \(scored as unavailable\)/);
  assert.match(t.text('status'), /Timed out: zoning/);

  // Retry: pending again, then filled; the old request's late answer is ignored.
  const retry = zoningCard.querySelector('.section-retry');
  for (const fn of t.document.listeners.click) fn({ target: retry, preventDefault() {}, stopPropagation() {} });
  assert.equal(t.asks.zoningPermits.length, 2);
  assert.equal(t.text('zoningMetric'), 'Checking…');
  assert.equal(t.text('scoreMetric'), 'Updating…');
  t.answer('zoningPermits', { available: true, zoning: { status: 'gis_match', code: 'OLD' } }, 0);
  t.answer('zoningPermits', ANSWERS.zoningPermits, 1);
  await t.clock.advance(150);
  assert.equal(t.text('zoningMetric'), 'RR-10');
  assert.equal(t.document.querySelectorAll('.section-retry').length, 0);
  assert.equal(t.text('scoreMetric'), '7.0');
});

test('each section has its own time limit: listing 12 s, wells/utility 15 s, the rest 20 s', async () => {
  const t = setup();
  await t.search();
  await t.clock.advance(11999);
  assert.equal(t.S.placeholder('evidence'), 'pending');
  await t.clock.advance(1);
  assert.equal(t.S.placeholder('evidence'), 'timeout');
  assert.equal(t.S.placeholder('wells'), 'pending');
  await t.clock.advance(3000);
  assert.equal(t.S.placeholder('wells'), 'timeout');
  assert.equal(t.S.placeholder('utility'), 'timeout');
  assert.equal(t.S.placeholder('flood'), 'pending');
  await t.clock.advance(5000);
  for (const name of ['flood', 'wetlands', 'zoningPermits', 'land']) assert.equal(t.S.placeholder(name), 'timeout', name);
  await t.clock.advance(150);
  assert.equal(t.text('overviewFlood'), 'Timed out — try again');
  assert.equal(t.text('evidenceMetric'), 'Timed out');
});

test('answers for an older search never overwrite a newer one', async () => {
  const t = setup();
  await t.search('P1');
  const first = Object.fromEntries(SECTIONS.map(n => [n, t.asks[n][0]]));
  await t.search('P2');
  assert.equal(t.text('parcelFact'), 'P2');
  for (const name of SECTIONS) assert.ok(first[name].signal.aborted, `${name} of the old search aborted`);
  first.flood.resolve({ available: true, category: 'high' });
  first.zoningPermits.resolve({ available: true, zoning: { code: 'OLD-ZONE' } });
  await t.clock.advance(500);
  assert.equal(t.lastValue('flood'), null);
  assert.equal(t.lastValue('zoningPermits'), null);
  assert.equal(t.text('zoningMetric'), 'Checking…');
  t.answer('zoningPermits');
  await t.clock.advance(150);
  assert.equal(t.text('zoningMetric'), 'RR-10');
});

test('the score and cost cards wait for every scored input, then compute once', async () => {
  const t = setup({ followups: true });
  await t.search();
  const seen = new Set();
  const watch = () => seen.add(t.text('scoreMetric'));
  for (const name of ['wells', 'wetlands', 'zoningPermits', 'land', 'evidence']) { t.answer(name); await t.clock.advance(200); watch(); }
  assert.equal(t.text('scoreMetric'), 'Updating…');
  assert.match(t.text('scoreNote'), /^Waiting for utility, flood…$/);
  t.answer('flood');
  await t.clock.advance(200);
  watch();
  assert.match(t.text('scoreNote'), /^Waiting for utility…$/);
  // Utility finds a provider, so the power-intelligence answer (a score input) is awaited too.
  t.answer('utility');
  await t.clock.advance(160);
  watch();
  assert.equal(t.S.status('powerIntelligence'), 'pending');
  assert.equal(t.text('scoreMetric'), 'Updating…');
  assert.equal(t.text('scoreNote'), 'Waiting for power proximity…');
  assert.equal(t.document.querySelector('#developmentCostCard .cost-value').textContent, 'Updating…');
  await t.clock.advance(1000);
  watch();
  assert.equal(t.text('scoreMetric'), '7.1');
  assert.equal(t.document.querySelector('#developmentCostCard .cost-value').textContent, '$40k–$60k');
  assert.deepEqual([...seen].filter(v => v !== 'Updating…'), ['7.1'], 'no interim score was ever shown');
});

test('follow-up requests fire once per search, only after their inputs exist', async () => {
  const t = setup({ followups: true });
  await t.search();
  const at = {};
  for (const [i, name] of ['flood', 'wells', 'land', 'wetlands', 'evidence', 'utility', 'zoningPermits'].entries()) {
    await t.clock.advance(400);
    at[name] = t.clock.now;
    t.answer(name);
    void i;
  }
  await t.clock.advance(3000);
  assert.ok(t.summaries() >= 7, `summary re-rendered as sections arrived (${t.summaries()})`);
  const count = path => t.calls.filter(c => c.path === path).length;
  for (const path of Object.keys(FOLLOWUP_ROUTES)) assert.equal(count(path), 1, `${path} fired once`);
  const first = path => t.calls.find(c => c.path === path).at;
  assert.ok(first('/api/power-intelligence') >= at.utility, 'power intelligence waits for the utility answer');
  assert.ok(first('/api/zoning-rules') >= at.zoningPermits, 'zoning rules wait for the zoning answer');
  assert.equal(t.run('last.powerIntelligence.provider'), 'Avista Utilities');
  assert.equal(t.text('powerStatus'), 'Avista Utilities territory identified · no nearby OSM distribution mapping found', 'kept across re-renders');

  // A second search fires its own follow-ups once; an answer still in flight for the first
  // search is dropped.
  FOLLOWUP_ROUTES['/api/power-intelligence'].delay = 5000;
  try {
    await t.search('P2');
    t.answer('utility');
    await t.clock.advance(400);
    assert.equal(count('/api/power-intelligence'), 2);
    await t.search('P3');
    await t.clock.advance(6000);
    assert.equal(t.run('last.powerIntelligence'), undefined, 'P2 power answer not stored on P3');
    assert.equal(t.S.status('powerIntelligence'), undefined);
  } finally {
    FOLLOWUP_ROUTES['/api/power-intelligence'].delay = 300;
  }
  assert.equal(count('/api/property-assessment'), 3);
  assert.equal(count('/api/reso-listings'), 3);
  assert.equal(count('/api/existing-well'), 3);
});
