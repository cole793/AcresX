// Offline tests: the septic/soil card and its details name the Esri SSURGO backup when the soil
// answer came from it (soil.backup, src/services/soils.js). ui-polish.js writes the card note
// first, screening-refinements.js then replaces it with the septic context, so the label has to
// be added there to survive. Runs the real browser scripts in node:vm (test/ui-harness.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, makeContext, readPublic } from './ui-harness.js';

const LABEL = 'Source: USDA SSURGO via Esri (backup — USDA service unavailable)';
const square = { type: 'Polygon', coordinates: [[[-117.4, 47.6], [-117.39, 47.6], [-117.39, 47.61], [-117.4, 47.61], [-117.4, 47.6]]] };
const soil = (over = {}) => ({ available: true, mapUnit: 'Stutler-Springdale complex, 3 to 15 percent slopes', component: 'Stutler', drainage: 'Well drained', hydrologicGroup: 'B', soilSlopePct: 4, feasibility: 'favorable', ...over });
const lastWith = soilAnswer => ({
  parcel: { type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '23123.9051', _countyDisplay: 'Spokane', _stateCode: 'WA' } },
  wells: [], utility: ['Avista'],
  flood: { available: true, category: 'minimal', intersects: true, zones: ['X'] }, wetlands: { available: true, intersects: false, count: 0 },
  zoningPermits: { zoning: { status: 'gis_match', code: 'RT' } }, evidence: { status: 'none' },
  land: { available: true, soil: soilAnswer, terrain: { available: true, gradePct: 1.9, reliefFt: 10 } }
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
const turf = { area: () => 20 * 4046.86, centroid: () => ({ geometry: { coordinates: [-117.395, 47.605] } }) };
// Injection order (src/index.js maybeInjectUiPolish), the soil-card writers among them.
const DASH = ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'ui-polish.js', 'parcel-preview.js', 'score-cost.js', 'snapshot-accordion.js', 'screening-refinements.js', 'parcel-summary-insights.js', 'cost-tables.js', 'local-cost-model.js', 'buildable-area.js', 'public-utilities.js'];

function dashboard(last) {
  const page = makeContext({ body: PAGE, clock: makeClock(), fetch: async () => { throw new Error('no network'); }, autoIds: true, extra: { L, turf } });
  page.ctx.__last = last;
  const lines = readPublic('index.html').split('\n');
  const pick = name => lines.find(l => l.startsWith(`function ${name}(`) || l.startsWith(`const ${name}=`)) || '';
  // renderResults: the soil tab's own markup stands in for index.html's (it sets #results).
  page.run(`var last = __last; var activeTab = "soil"; const $=id=>document.getElementById(id);\n${pick('UTILITY_LOOKUP_FAILED')}\n${pick('utilityText')}\n${pick('gradeWellDepth')}\n${pick('setTraffic')}\n${pick('renderSummary')}\nfunction renderResults() { document.getElementById('results').innerHTML = '<div class="notice">Soil details</div>'; }`, 'index-inline.js');
  for (const f of DASH) page.run(readPublic(f), f);
  page.run('renderSummary(last.parcel)');
  return { page, $: id => page.document.getElementById(id) };
}

test('soil backup: the septic card note ends with the backup source label', () => {
  const d = dashboard(lastWith(soil({ backup: true, source: 'USDA SSURGO via Esri Living Atlas (backup; USDA Soil Data Access unavailable)' })));
  const note = d.$('soilNote').textContent;
  assert.ok(note.endsWith(LABEL), note);
  assert.match(note, /USDA screening only; a site evaluation sets the system type\. Source: USDA SSURGO via Esri/);
  assert.equal(d.$('soilGrade').textContent, 'Favorable', 'the grade is unchanged by the source');
});

test('soil backup: the details tab shows the label once, however often it re-renders', () => {
  const d = dashboard(lastWith(soil({ backup: true })));
  d.page.run('renderResults(); renderResults();');
  const notes = d.$('results').querySelectorAll('.soil-backup-source');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].textContent, LABEL);
});

test('soil from USDA SDA: no backup label on the card or in the details', () => {
  const d = dashboard(lastWith(soil()));
  assert.doesNotMatch(d.$('soilNote').textContent, /Esri|backup/);
  d.page.run('renderResults()');
  assert.equal(d.$('results').querySelectorAll('.soil-backup-source').length, 0);
});

test('soil backup: the label does not change the score', () => {
  const plain = dashboard(lastWith(soil())).page.run('window.AcresXScore.calculate().score');
  const backup = dashboard(lastWith(soil({ backup: true }))).page.run('window.AcresXScore.calculate().score');
  assert.equal(typeof plain, 'number');
  assert.equal(backup, plain);
});
