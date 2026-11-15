// County coverage badge and trust labels (owner request 2026-11-14: a Flathead parcel, a county
// AcresX has not validated, scored 9.1 "Excellent" with "Confirmed" chips and no sign of the house
// the assessor lists).
// - GET /api/county-coverage (src/services/county-coverage.js) from the registry, offline.
// - public/coverage-trust.js on a fake dashboard: badge, "limited data" score label, existing-
//   structure finding, and the well/zoning chips painted by public/demo-housekeeping.js.
// - public/property-report-v2.js page 1: the badge line, the softened rating and the finding.
// - public/state-selector.js: supported counties grouped first, every county still listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { countyCoverageBody, describeCoverage } from '../src/services/county-coverage.js';
import { COUNTY_COVERAGE } from '../src/config/county-coverage.js';
import { El, makeContext, makeClock, makeLazyContext, readPublic } from './ui-harness.js';

const quiet = { ...console, warn() {} };
const LIMITED = 'Limited coverage — statewide data only, not validated';

// ---- API

test('GET /api/county-coverage: every registry county, with its badge, and no upstream call', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('must not call upstream'); };
  try {
    const response = await worker.fetch(new Request('https://acresx.test/api/county-coverage'), {}, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /application\/json/);
    const body = await response.json();
    assert.equal(body.counties.length, COUNTY_COVERAGE.length);
    const key = c => `${c.state}:${c.county}`;
    assert.deepEqual(body.counties.filter(c => c.supported).map(key).sort(), ['ID:Kootenai', 'MT:Gallatin', 'MT:Yellowstone', 'WA:Spokane', 'WA:Stevens']);
    const by = Object.fromEntries(body.counties.map(c => [key(c), c]));
    assert.equal(by['ID:Kootenai'].coverage.label, 'Validated county');
    assert.equal(by['WA:Spokane'].coverage.label, 'Validated county');
    assert.equal(by['MT:Gallatin'].coverage.label, 'Partially validated');
    assert.equal(by['MT:Flathead'].coverage.label, LIMITED);
    assert.equal(by['MT:Flathead'].coverage.limited, true);
    assert.equal(by['MT:Flathead'].zoningValidated, false);
    assert.equal(by['WA:Spokane'].zoningValidated, true);
  } finally { globalThis.fetch = realFetch; }
});

test('badge explanations say what is missing', () => {
  const by = Object.fromEntries(COUNTY_COVERAGE.map(c => [c.key, c]));
  assert.match(describeCoverage(by['MT:Flathead']).summary, /has not validated this county\. County assessor values, property tax, zoning map and zoning rules sources are not set up; the other layers come from statewide or national data\..*Verify every finding with the county\./);
  assert.match(describeCoverage(by['MT:Gallatin']).summary, /Property tax and zoning rules not set up\./);
  assert.match(describeCoverage(by['WA:Spokane']).summary, /daily validation runs \(last 2026-11-14\)\. Zoning rules partly covered; property tax not set up\./);
  assert.match(describeCoverage(by['ID:Kootenai']).summary, /daily validation runs \(last 2026-11-11\)\. Zoning rules partly covered; property tax not set up\./);
});

// ---- Dashboard

const flathead = (extra = {}) => ({
  parcel: { type: 'Feature', geometry: null, properties: { ORIG_PARCEL_ID: '07396611101010000', _stateCode: 'MT', _countyDisplay: 'Flathead', _stateDisplay: 'Montana' } },
  wells: [{ properties: { CompletedDepth: 120 } }],
  utility: [],
  zoningPermits: { jurisdiction: 'Flathead County', zoning: { status: 'gis_match', code: 'AG-40' } },
  propertyAssessment: { available: true, state: 'MT', statewideRecords: [{ TotalValue: 300000, TotalLandValue: 108840, TotalBuildingValue: 191160, TaxYear: 2026 }] },
  existingWell: { available: false },
  ...extra
});
const spokane = () => {
  const d = JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
  return d;
};

async function dashboard(data, { registry = countyCoverageBody() } = {}) {
  const clock = makeClock();
  const fetch = async url => {
    if (String(url) !== '/api/county-coverage') throw new Error(`unexpected ${url}`);
    if (!registry) return { ok: false, status: 502, json: async () => ({ error: 'down' }) };
    return { ok: true, status: 200, json: async () => registry };
  };
  const card = (detail, kids) => ['button', { class: 'card snapshot-card', 'data-detail': detail }, '', kids];
  const h = makeContext({
    clock, fetch,
    extra: { console: quiet },
    body: [['section', { id: 'dashboard' }, '', [
      ['section', { id: 'propertyOverviewSection' }, '', [['div', { class: 'property-overview-info' }, '', [
        ['div', { class: 'property-overview-eyebrow' }, 'Property overview'],
        ['div', { class: 'property-overview-acres' }, '79 acres'],
        ['div', { id: 'overviewAcreageNote' }]
      ]]]],
      ['div', { class: 'overview-grid' }, '', [['article', { class: 'card metric score-card' }, '', [['div', {}, '', [
        ['div', { id: 'scoreMetric' }, '9.1'], ['div', { id: 'scoreNote' }, 'Excellent buildability · 7-factor screening']
      ]]]]]],
      ['article', { id: 'buildableAreaCard', class: 'card buildable-card' }, 'About 79.0 of 79.3 acres buildable'],
      ['div', { class: 'snapshot-grid' }, '', [card('wells', [['div', { class: 'snapshot-top' }]])]],
      ['div', { class: 'zoning-grid' }, '', [card('zoning', [['div', {}, '', [['strong', {}, 'Zoning']]]])]]
    ]]]
  });
  h.ctx.last = data;
  h.run('function renderSummary(){}');
  for (const f of ['demo-housekeeping.js', 'property-report-v2.js', 'coverage-trust.js']) h.run(readPublic(f), f);
  await h.ctx.AcresXCoverage.ready;
  h.run('renderSummary()');
  await clock.advance(100);
  const $ = id => h.document.getElementById(id);
  const chip = detail => h.document.querySelector(`[data-detail="${detail}"] .snapshot-confidence`)?.textContent;
  const shown = el => (el && !el.hidden ? el.textContent : '');
  return { h, badge: shown($('coverageBadge')), badgeClass: $('coverageBadge')?.className, structure: shown($('existingStructureNote')), buildableNote: shown($('buildableStructureNote')), scoreNote: $('scoreNote').textContent, score: $('scoreMetric').textContent, flag: shown(h.document.querySelector('.coverage-score-flag')), wells: chip('wells'), zoning: chip('zoning') };
}

test('Flathead (limited): badge, "limited data" score label, improvements finding, honest chips', async () => {
  const d = await dashboard(flathead());
  assert.match(d.badge, new RegExp(`^${LIMITED}AcresX has not validated this county`));
  assert.match(d.badgeClass, /tier-limited/);
  assert.equal(d.score, '9.1', 'the score itself is unchanged');
  assert.equal(d.scoreNote, 'Excellent buildability · limited data');
  assert.equal(d.flag, 'County not validated: statewide sources only');
  assert.match(d.structure, /^Assessor lists improvements \(\$191,160\)The parcel may already have a home or buildings\./);
  assert.equal(d.buildableNote, 'Assessor lists improvements ($191,160)Existing buildings are not subtracted from these buildable acres.');
  assert.equal(d.wells, 'Nearby records');
  assert.equal(d.zoning, 'Statewide data — verify');
});

test('Spokane (level 3, zoning validated): "Validated county", "County GIS", no structure note for $0 improvements', async () => {
  const d = await dashboard(spokane());
  assert.match(d.badge, /^Validated county/);
  assert.equal(d.scoreNote, 'Excellent buildability · 7-factor screening');
  assert.equal(d.flag, '');
  assert.equal(d.structure, '');
  assert.equal(d.buildableNote, '');
  assert.equal(d.wells, 'Nearby records', 'a low-confidence nearby match is not an on-parcel record');
  assert.equal(d.zoning, 'County GIS');
});

test('a well record mapped inside the parcel: "On-parcel record" and an existing-structure note', async () => {
  const d = await dashboard(flathead({
    propertyAssessment: { available: true, state: 'MT', statewideRecords: [{ TotalValue: 108840, TotalLandValue: 108840, TotalBuildingValue: 0 }] },
    existingWell: { available: true, match: { evidence: { insideParcel: true } } }
  }));
  assert.equal(d.wells, 'On-parcel record');
  assert.match(d.structure, /^A well record maps to this parcel/);
});

test('registry down: no badge, chips never say "Confirmed", the dashboard still renders', async () => {
  const d = await dashboard(flathead(), { registry: null });
  assert.equal(d.badge, '');
  assert.equal(d.scoreNote, 'Excellent buildability · 7-factor screening');
  assert.equal(d.wells, 'Nearby records');
  assert.equal(d.zoning, 'Mapped — verify');
  assert.match(d.structure, /Assessor lists improvements/, 'the structure finding does not need the registry');
});

// ---- Printable report

const MODULES = ['flood-status.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'property-report-v2.js', 'coverage-trust.js'];
function report(data) {
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: data });
  h.context.console = quiet;
  for (const f of MODULES) h.run(readPublic(f));
  h.context.AcresXCoverage.accept(countyCoverageBody());
  h.el('scoreMetric').textContent = '9.1';
  h.context.__acresxLast = data;
  h.el('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
  const html = h.opened.at(-1);
  return html.split('<section class="page ').slice(1);
}

test('report page 1 (limited county): coverage line, "Excellent · limited data", improvements finding', () => {
  const d = spokane();
  d.parcel.properties = { ...d.parcel.properties, _stateCode: 'MT', _countyDisplay: 'Flathead', _stateDisplay: 'Montana', COUNTY_NM: 'Flathead' };
  d.propertyAssessment = flathead().propertyAssessment;
  const pages = report(d);
  assert.equal(pages.length, 4, 'still 3 pages plus the appendix');
  const p1 = pages[0];
  assert.match(p1, new RegExp(`<p class="coverage cov-limited"><b>${LIMITED}</b>`));
  assert.match(p1, /<div class="score-rating">Excellent · limited data<\/div><\/div><p class="score-why">[^<]+<\/p>/, "the limited-data rating and the score why line both print");
  assert.match(p1, /<div class="flag verify"><b>\?<\/b><div><strong>Assessor lists improvements \(\$191,160\)<\/strong>/);
  assert.equal((p1.match(/<div class="flag /g) || []).length <= 6, true, 'still at most 6 key findings');
});

test('report page 1 (Spokane): "Validated county", no improvements finding', () => {
  const p1 = report(spokane())[0];
  assert.match(p1, /<p class="coverage cov-validated"><b>Validated county<\/b>/);
  assert.match(p1, /<div class="score-rating">Excellent<\/div>/);
  assert.doesNotMatch(p1, /Assessor lists improvements/);
});

// ---- County dropdown

function selector(supported) {
  const listeners = {};
  const h = makeContext({
    clock: makeClock(), fetch: async () => { throw new Error('no fetch'); },
    body: [['form', { id: 'searchForm' }, '', [['select', { id: 'county' }], ['input', { id: 'parcel' }], ['button', { id: 'searchBtn' }]]]],
    extra: {
      addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
      dispatch: type => (listeners[type] || []).forEach(fn => fn())
    }
  });
  h.ctx.Option = class extends El { constructor(text, value) { super('option', h.document); this.textContent = text; this.value = value; } };
  const county = h.document.getElementById('county');
  county.options = [{ value: 'Spokane' }, { value: 'Stevens' }, { value: 'Whitman' }];
  county.add = option => county.appendChild(option);
  h.run(readPublic('state-selector.js'), 'state-selector.js');
  if (supported) h.ctx.AcresXCoverage = { supportedCounties: state => supported[state] || [] };
  const state = h.document.getElementById('state');
  const groups = () => county.children.map(c => (c.tagName === 'OPTGROUP' ? [c.attrs.label ?? c.label, c.children.map(o => o.value)] : c.value));
  return { h, county, state, groups, dispatch: listeners };
}

test('county dropdown: supported counties first, every other county still listed', () => {
  const s = selector({ WA: ['Spokane', 'Stevens'], MT: ['Gallatin', 'Yellowstone'] });
  s.state.value = 'WA';
  s.state.listeners.change[0]();
  const wa = s.groups();
  assert.equal(wa.length, 2);
  assert.equal(wa[0][0], 'Supported counties');
  assert.deepEqual(wa[0][1], ['Spokane', 'Stevens']);
  assert.equal(wa[1][0], 'Other counties (limited coverage)');
  assert.deepEqual(wa[1][1], ['Whitman']);
  s.state.value = 'MT';
  s.state.listeners.change[0]();
  const mt = s.groups();
  assert.equal(mt[0], '', 'MT keeps the "Select a county" prompt');
  assert.deepEqual(mt[1][1], ['Gallatin', 'Yellowstone']);
  assert.ok(mt[2][1].includes('Flathead') && mt[2][1].length === 54, 'the other 54 Montana counties stay searchable');
});

test('county dropdown: flat list until the registry answers, regrouped on "acresx:coverage"', () => {
  const s = selector(null);
  s.state.value = 'WA';
  s.state.listeners.change[0]();
  assert.deepEqual(s.groups(), ['Spokane', 'Stevens', 'Whitman']);
  s.h.ctx.AcresXCoverage = { supportedCounties: () => ['Spokane', 'Stevens'] };
  s.dispatch['acresx:coverage'].forEach(fn => fn());
  assert.equal(s.groups()[0][0], 'Supported counties');
});
