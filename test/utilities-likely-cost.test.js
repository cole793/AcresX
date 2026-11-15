// Offline tests for the owner bug of 2026-11-15, frontend side: only a "served" public water/sewer
// finding prices the connection and scores the factor favorable (public/public-utilities.js,
// public/local-cost-model.js). "Likely" keeps the private well/septic as the primary estimate,
// with the connection as an alternative line on the dashboard cost card and report page 3
// (property-report-v2.js), never in the total, and scores like not served. A matched listing that
// says "no public water or sewer" is shown as an unverified note (claims parsed by
// public/mls-description-scanner.js) and never changes the score or the cost.
// Runs the real browser scripts in node:vm with the fake DOMs from test/ui-harness.js. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, makeContext, makeLazyContext, readPublic } from './ui-harness.js';

const square = { type: 'Polygon', coordinates: [[[-108.546, 45.7015], [-108.544, 45.7015], [-108.544, 45.7027], [-108.546, 45.7027], [-108.546, 45.7015]]] };
const LIKELY_OUT = { status: 'likely', provider: 'City of Billings', basis: 'City of Billings water main 60 m from the parcel', distanceM: 60, cityLimits: 'outside', source: { name: 'Mains', url: 'https://gis.example.test/1' } };
const LIKELY_SEWER = { ...LIKELY_OUT, basis: 'City of Billings sewer main 60 m from the parcel' };
const SERVED = { status: 'served', provider: 'City of Billings', basis: 'City of Billings water main 7 m from the parcel', distanceM: 7, cityLimits: 'inside', source: { name: 'Mains', url: 'https://gis.example.test/1' } };
const NONE = { status: 'not_found', provider: null, basis: 'No public water service area, district or main found near the parcel.', source: null };
const NO_PUBLIC = 'Level 5-acre lot near Billings. No public water or sewer; buyer to drill well and install septic.';

// The owner's parcel as the browser holds it: shallow wells (~30-40 ft), favorable soil, 2.8% grade.
function yellowstone(publicUtilities, extra = {}) {
  return {
    parcel: { type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '03092732390050000', _countyDisplay: 'Yellowstone', _stateCode: 'MT' } },
    wells: [30, 32, 36, 39.5, 45].map((d, i) => ({ properties: { CompletedDepth: d, _distance: 0.2 + i * 0.1 } })),
    utility: ['YELLOWSTONE VALLEY ELEC CO-OP'],
    powerIntelligence: { provider: 'YELLOWSTONE VALLEY ELEC CO-OP', distribution: { status: 'no_verified_distance', estimatedDistanceFt: null } },
    flood: { available: true, intersects: true, high: false, zones: ['X'] }, wetlands: { available: true, intersects: false, count: 0 },
    zoningPermits: { zoning: { status: 'gis_match', code: 'RR3' }, permitJurisdiction: { name: 'Yellowstone County' } },
    land: { soil: { available: true, feasibility: 'favorable', mapUnit: 'Brushton-Lonna silt loams' }, terrain: { available: true, gradePct: 2.8, reliefFt: 8 } },
    costContext: { roadAccess: { available: false, status: 'not_configured' }, watershed: { available: false, status: 'not_applicable' } },
    evidence: { status: 'none' },
    ...(publicUtilities ? { publicUtilities: { available: true, ...publicUtilities } } : {}),
    ...extra
  };
}

const PAGE = [
  ['div', { class: 'overview-grid' }, '', [
    ['article', { class: 'card score-card' }, '', [['div', { id: 'scoreMetric', class: 'metric-value' }, '—'], ['div', { id: 'scoreNote' }, ''], ['div', { class: 'score-factor-line' }, '']]],
    ['article', { id: 'developmentCostCard', class: 'card development-cost-card' }, '', [['div', { class: 'cost-value' }, ''], ['div', { class: 'cost-note' }, '']]]
  ]],
  ['article', { class: 'card snapshot-card', 'data-detail': 'wells' }, '', [['span', { id: 'waterGrade' }, ''], ['span', { id: 'waterStatus' }, ''], ['span', { id: 'wellNote' }, '']]],
  ['article', { class: 'card snapshot-card', 'data-detail': 'soil' }, '', [['span', { id: 'soilGrade' }, ''], ['span', { id: 'soilStatus' }, ''], ['span', { id: 'soilNote' }, '']]],
  ['div', { id: 'detailCard' }, '', [['h3', { id: 'resultsTitle' }, ''], ['div', { id: 'results' }]]]
];
const MODULES = ['mls-description-scanner.js', 'screening-inputs.js', 'score-cost.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js'];

function dashboard(last) {
  const page = makeContext({ body: PAGE, clock: makeClock(), fetch: async () => { throw new Error('no network in tests'); }, autoIds: true });
  page.ctx.__last = last;
  page.ctx.__acresxLast = last;
  page.run('var last = __last; var activeTab = "wells"; function renderSummary() {} function renderResults() {}', 'index-inline.js');
  for (const f of MODULES) page.run(readPublic(f), f);
  page.run('renderSummary(last.parcel)');
  const e = page.run('window.AcresXCostModel.estimate()');
  const calc = page.run('window.AcresXScore.calculate()');
  return { page, e, calc, card: page.document.getElementById('developmentCostCard').textContent, U: page.ctx.AcresXUtilities };
}

function report(last) {
  const h = makeLazyContext({ mappedSqm: 2.0 * 4046.86, last });
  h.context.setInterval = () => 0; // mls-description-scanner.js polls the page
  for (const f of ['mls-description-scanner.js', 'flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'buildable-area.js', 'property-report-v2.js']) h.run(readPublic(f));
  h.context.__acresxLast = last;
  h.el('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
  const html = h.opened.at(-1);
  const text = html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
  return { html, text, page3: text.slice(text.indexOf('Costs & next steps')) };
}

test('likely: the private well and septic are the primary estimate, the connection is an alternative, the score is as not served', () => {
  const likely = dashboard(yellowstone({ water: LIKELY_OUT, sewer: LIKELY_SEWER }));
  const none = dashboard(yellowstone({ water: NONE, sewer: { ...NONE } }));
  assert.equal(likely.e.components.well.label, 'Well');
  assert.equal(likely.e.components.septic.label, 'Septic');
  assert.deepEqual([likely.e.low, likely.e.high], [none.e.low, none.e.high], 'the total is the well/septic total');
  assert.deepEqual([likely.calc.score, likely.calc.factors.water.score, likely.calc.factors.soil.score], [none.calc.score, none.calc.factors.water.score, none.calc.factors.soil.score], 'likely scores like not served');
  const alt = likely.e.components.well.alternative;
  assert.deepEqual([alt.low, alt.high], [3000, 15000]);
  assert.equal(alt.text, 'If public water (City of Billings) can serve the parcel: water connection ~$3k–$15k instead of the well — confirm with City of Billings. Outside city limits, city service usually requires annexation or an extension agreement.');
  assert.match(likely.e.components.septic.alternative.text, /^If public sewer \(City of Billings\) can serve the parcel: sewer connection ~\$4k–\$20k instead of the septic system — confirm with City of Billings\. Outside city limits/);
  assert.match(likely.card, /If public water \(City of Billings\) can serve the parcel/, 'the dashboard cost card shows the alternative');
  assert.match(likely.card, /If public sewer \(City of Billings\) can serve the parcel/);
  assert.deepEqual(none.e.alternatives, []);
  assert.doesNotMatch(none.card, /can serve the parcel/);
  // Inside city limits (Billings has no utility map): the same, without the annexation sentence.
  const inCity = dashboard(yellowstone({ water: { ...LIKELY_OUT, cityLimits: 'inside' }, sewer: NONE }));
  assert.doesNotMatch(inCity.e.components.well.alternative.text, /annexation/);
  assert.equal(inCity.e.components.septic.alternative, undefined, 'sewer not found: no sewer alternative');
});

test('served: the connection is the primary estimate and the factor scores as public', () => {
  const served = dashboard(yellowstone({ water: SERVED, sewer: { ...SERVED, basis: 'City of Billings sewer main 7 m from the parcel' } }));
  assert.deepEqual([served.e.components.well.label, served.e.components.well.low, served.e.components.well.high], ['Water connection', 3000, 15000]);
  assert.deepEqual([served.e.components.septic.label, served.e.components.septic.low], ['Sewer connection', 4000]);
  assert.equal(served.e.components.well.alternative, undefined);
  assert.deepEqual(served.e.alternatives, []);
  assert.deepEqual([served.calc.factors.water.score, served.calc.factors.soil.score], [92, 92]);
});

test('not_found: well and septic, no alternative line', () => {
  const none = dashboard(yellowstone({ water: NONE, sewer: { ...NONE } }));
  assert.deepEqual([none.e.components.well.label, none.e.components.septic.label], ['Well', 'Septic']);
  assert.equal(none.e.components.well.alternative, undefined);
  assert.equal(none.U.overviewText(none.page.run('last')), 'Public water: not found · Public sewer: not found');
});

test('a listing that says no public water/sewer is shown as an unverified note; cost and score are unchanged', () => {
  for (const pu of [{ water: LIKELY_OUT, sewer: LIKELY_SEWER }, { water: SERVED, sewer: NONE }, { water: NONE, sewer: { ...NONE } }]) {
    const plain = dashboard(yellowstone(pu));
    const listed = dashboard(yellowstone(pu, { resoListings: { available: true, best: { listingId: 'TEST', publicRemarks: NO_PUBLIC } } }));
    assert.deepEqual([listed.e.low, listed.e.high, listed.e.components.well.label, listed.e.components.septic.label], [plain.e.low, plain.e.high, plain.e.components.well.label, plain.e.components.septic.label], `cost unchanged (${pu.water.status})`);
    assert.equal(listed.calc.score, plain.calc.score, `score unchanged (${pu.water.status})`);
    assert.equal(listed.e.listingNote, 'Listing says: no public water or sewer; well and septic (unverified)');
    assert.match(listed.card, /Listing says: no public water or sewer; well and septic \(unverified\)/);
    assert.match(listed.U.overviewText(listed.page.run('last')), /· Listing says: no public water or sewer; well and septic \(unverified\)$/);
    assert.equal(plain.e.listingNote, '');
  }
  // The web listing search (last.evidence) counts the same way; a listing that says nothing gives no note.
  const web = dashboard(yellowstone({ water: NONE, sewer: NONE }, { evidence: { status: 'found', matchScore: 80, claims: [], matches: [{ title: 'Land for sale', snippet: 'No city sewer. Power at road.' }] } }));
  assert.equal(web.e.listingNote, 'Listing says: no public sewer (unverified)');
  const quiet = dashboard(yellowstone({ water: NONE, sewer: NONE }, { resoListings: { best: { publicRemarks: 'City water and sewer at the street.' } } }));
  assert.equal(quiet.e.listingNote, '');
});

test('report page 3 matches the dashboard: same total, the alternatives under the table, the listing note', () => {
  const last = yellowstone({ water: LIKELY_OUT, sewer: LIKELY_SEWER }, { resoListings: { available: true, best: { listingId: 'TEST', publicRemarks: NO_PUBLIC } } });
  const d = dashboard(last);
  const r = report(last);
  const usd = n => `$${Math.round(n).toLocaleString('en-US')}`;
  assert.ok(r.page3.includes(`Total (matches page 1) ${usd(d.e.low)}–${usd(d.e.high)}`), `report total is the dashboard total ${usd(d.e.low)}–${usd(d.e.high)}`);
  for (const a of d.e.alternatives) assert.ok(r.page3.includes(a.text), `page 3 shows: ${a.text}`);
  assert.match(r.page3, /Alternative, not in the total/);
  assert.match(r.page3, /Listing says: no public water or sewer; well and septic \(unverified\)\. Not used in the estimate or the score\./);
  assert.match(r.page3, /Also ask City of Billings whether public water can serve the parcel \(outside city limits this usually needs annexation or an extension agreement\)/);
  assert.match(r.text, /Public water \/ sewer[^.]*May be available/, 'page 2 card: may be available, not "likely"');
  assert.match(r.text, /Water \/ well/, 'page 2 keeps the private well card');
  // Served: the connection line, no alternative row.
  const served = report(yellowstone({ water: SERVED, sewer: NONE }));
  assert.match(served.page3, /Water connection/);
  assert.doesNotMatch(served.page3, /Alternative, not in the total/);
});

