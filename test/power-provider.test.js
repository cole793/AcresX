// Electric utility (power provider) on the property page, offline. Washington parcels use
// /api/utility-territory (HIFLD retail territories) like Idaho and Montana; the dead Ecology CPR
// layer and the county guess table ("Avista Utilities" for all of Spokane) are gone. Federal power
// marketing administrations (BPA, WAPA) are wholesale/transmission and are not shown as the
// provider. A failed lookup shows "Not identified — contact the county" and scores like an
// unidentified utility. Also: the overview location line names the parcel's real state.
//
// Runs the real findUtility/renderSummary from public/index.html with the real ui-polish.js
// (power-intelligence follow-up), parcel-preview.js, screening-refinements.js (score) and
// progressive-loading.js in node:vm, with the fake DOM, clock and fetch from test/ui-harness.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, makeContext, makeFetch, readPublic, acresToSqm } from './ui-harness.js';

const NOT_IDENTIFIED_FAILED = 'Not identified — contact the county';

const indexLines = readPublic('index.html').split('\n');
const pickIndex = (...names) => names.map(name => {
  const line = indexLines.find(l => l.startsWith(`function ${name}(`) || l.startsWith(`async function ${name}(`) || l.startsWith(`const ${name}=`));
  assert.ok(line, `index.html defines ${name}`);
  return line;
}).join('\n');

const INLINE = `
let last = { parcel: null, wells: [], utility: [], evidence: null };
let activeTab = 'wells';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '');
${pickIndex('WHOLESALE_POWER', 'UTILITY_LOOKUP_FAILED', 'retailProviders', 'utilityText', 'rankedProviders', 'findUtility', 'gradeWellDepth', 'setTraffic', 'renderSummary')}
function renderMap() {}
function renderResults() {}
async function findParcel() { return JSON.parse(JSON.stringify(__parcel)); }
async function findWells() { return [{ properties: { CompletedDepth: 180, _distance: 0.2 } }]; }
async function findListingEvidence() { return { status: 'none', matches: [] }; }
async function findFlood() { return { available: true, intersects: false, high: false, zones: ['X'] }; }
async function findWetlands() { return { available: true, intersects: false, count: 0 }; }
async function findZoningPermits() { return { available: true, zoning: { status: 'gis_match', code: 'RR-10' }, permits: [] }; }
async function findLandAnalysis() { return { available: true, soil: { available: true, feasibility: 'favorable', mapUnit: 'Garrison' }, terrain: { available: true, gradePct: 4.2, reliefFt: 12 } }; }
`;

const square = [[[0, 0], [1, 0], [1, 1], [0, 0]]];
const PARCELS = {
  // Spokane city: Modern Electric Water Company territory.
  spokaneCity: { state: 'WA', county: 'Spokane', point: [-117.42, 47.66], properties: { ORIG_PARCEL_ID: '35183.0101', COUNTY_NM: 'Spokane' } },
  // Rural north Spokane: Inland Power plus BPA (wholesale) in the HIFLD answer.
  spokaneRural: { state: 'WA', county: 'Spokane', point: [-117.2, 47.9], properties: { ORIG_PARCEL_ID: '28094.9001', COUNTY_NM: 'Spokane' } },
  stevens: { state: 'WA', county: 'Stevens', point: [-117.9, 48.3], properties: { ORIG_PARCEL_ID: '1234567', COUNTY_NM: 'Stevens' } },
  kootenai: { state: 'ID', county: 'Kootenai', point: [-116.78, 47.68], properties: { ORIG_PARCEL_ID: '47N03W052200', _countyDisplay: 'Kootenai', _stateCode: 'ID', _stateDisplay: 'Idaho' } },
  gallatin: { state: 'MT', county: 'Gallatin', point: [-111.1, 45.7], properties: { ORIG_PARCEL_ID: '06079815101010000', COUNTY_NM: 'Gallatin', _countyDisplay: 'Gallatin', _stateCode: 'MT', _stateDisplay: 'Montana' } },
  yellowstone: { state: 'MT', county: 'Yellowstone', point: [-108.5, 45.8], properties: { ORIG_PARCEL_ID: 'A12345', COUNTY_NM: 'Yellowstone', _countyDisplay: 'Yellowstone', _stateCode: 'MT', _stateDisplay: 'Montana' } }
};

// What /api/utility-territory answers live (HIFLD, checked 2026-11-02), keyed by point.
const TERRITORY = {
  '-117.42,47.66': ['MODERN ELECTRIC WATER COMPANY'],
  '-117.2,47.9': ['BONNEVILLE POWER ADMINISTRATION', 'INLAND POWER & LIGHT COMPANY'],
  '-117.9,48.3': ['AVISTA CORP'],
  '-116.78,47.68': ['AVISTA CORP', 'KOOTENAI ELECTRIC COOPERATIVE'],
  '-111.1,45.7': ['NORTHWESTERN ENERGY LLC - (MT)'],
  '-108.5,45.8': ['YELLOWSTONE VALLEY ELEC CO-OP', 'WAPA-- WESTERN AREA POWER ADMINISTRATION', 'NORTHWESTERN ENERGY LLC - (MT)']
};
const territoryOk = body => {
  const providers = TERRITORY[`${body.lon},${body.lat}`] || [];
  return { body: { available: true, source: 'DOE / ORNL HIFLD Electric Retail Service Territories', providers, matches: providers.map(name => ({ name })) } };
};
// The same territory rule as src/services/power-intelligence.js: Avista and the generic adapter
// confirm the territory, Inland Power does not, and an overlap the ranking did not resolve is
// never confirmed.
const powerIntelligence = body => {
  const provider = String(body.providers?.[0] || '');
  const alsoListed = (body.providers || []).slice(1);
  const overlap = alsoListed.length > 0 && body.providerRanking?.resolved !== true;
  const confirmed = overlap ? false : /\bavista\b/i.test(provider) ? true : /\binland\s+power/i.test(provider) ? false : true;
  return { delay: 50, body: { available: true, provider, alsoListed, providerRanking: body.providerRanking, territory: { confirmed }, distribution: {} } };
};

function setup(key, territoryRoute = territoryOk) {
  const parcel = PARCELS[key];
  const clock = makeClock();
  const { fetch, calls } = makeFetch(clock, { '/api/utility-territory': territoryRoute, '/api/power-intelligence': powerIntelligence });
  const turf = { centroid: () => ({ geometry: { coordinates: parcel.point } }), area: () => acresToSqm(5) };
  const layer = { addTo() { return this; }, removeFrom() {}, getBounds: () => ({ isValid: () => false }) };
  const L = { map: () => ({ fitBounds() {}, invalidateSize() {} }), tileLayer: () => layer, geoJSON: () => layer };
  const __parcel = { type: 'Feature', properties: parcel.properties, geometry: { type: 'Polygon', coordinates: square } };
  const body = [
    ['div', { id: 'status', class: 'status' }], ['section', { id: 'emptyState' }],
    ['section', { id: 'dashboard', class: 'dashboard' }, '', [
      ['section', { id: 'propertyOverviewSection' }, '', [['div', { id: 'overviewLocation' }, '—'], ['strong', { id: 'overviewUtility' }, '—']]],
      ['div', { class: 'overview-grid' }, '', [['article', { class: 'card score-card' }, '', [
        ['div', { id: 'scoreMetric', class: 'metric-value' }, '—'], ['div', { id: 'scoreNote' }, ''], ['div', { class: 'score-factor-line' }, '']
      ]]]],
      ['article', { class: 'card snapshot-card', 'data-detail': 'power' }, '', [['div', { id: 'utilityMetric' }, '—'], ['span', { id: 'powerStatus' }, '']]],
      ['article', { id: 'detailCard' }, '', [['h3', { id: 'resultsTitle' }], ['div', { id: 'results' }]]]
    ]],
    ['select', { id: 'state' }], ['select', { id: 'county' }], ['input', { id: 'parcel' }], ['button', { id: 'searchBtn' }, 'Analyze property']
  ];
  const { ctx, document, run } = makeContext({ body, clock, fetch, extra: { turf, L, __parcel }, autoIds: true });
  document.getElementById('state').value = parcel.state;
  document.getElementById('county').value = parcel.county;
  document.getElementById('parcel').value = parcel.properties.ORIG_PARCEL_ID;
  run(INLINE, 'index-inline.js');
  // Injection order (src/index.js maybeInjectUiPolish); progressive-loading.js wraps last.
  for (const f of ['flood-status.js', 'wetlands-status.js', 'acreage.js', 'ui-polish.js', 'parcel-preview.js', 'screening-refinements.js', 'progressive-loading.js']) run(readPublic(f), f);
  const text = id => document.getElementById(id).textContent;
  async function search() {
    await ctx.AcresXProgress.search();
    await clock.advance(1000);
  }
  const powerChip = () => (text('scoreMetric') && document.querySelector('.score-factor-line').innerHTML.match(/Power (\d+)/) || [])[1];
  return { clock, ctx, document, run, text, calls, search, powerChip, last: () => run('last') };
}

test('a Spokane city parcel shows Modern Electric from /api/utility-territory, not Avista', async () => {
  const t = setup('spokaneCity');
  await t.search();
  assert.equal(t.text('utilityMetric'), 'MODERN ELECTRIC WATER COMPANY');
  assert.equal(t.text('overviewUtility'), 'MODERN ELECTRIC WATER COMPANY');
  const lookup = t.calls.filter(c => c.path === '/api/utility-territory');
  assert.equal(lookup.length, 1);
  assert.deepEqual({ ...lookup[0].body }, { state: 'WA', county: 'Spokane', lat: 47.66, lon: -117.42 });
  assert.ok(lookup[0].signal, 'the lookup carries the section time-limit signal');
  // The dead Ecology CPR layer (/api/arcgis service "utility") is no longer requested.
  assert.equal(t.calls.filter(c => c.path === '/api/arcgis').length, 0);
  // Power intelligence and the score get the same provider.
  const power = t.calls.filter(c => c.path === '/api/power-intelligence');
  assert.equal(power.length, 1);
  assert.deepEqual([...power[0].body.providers], ['MODERN ELECTRIC WATER COMPANY']);
  assert.equal(t.powerChip(), '78');
});

test('a Stevens parcel shows Avista (the old county table showed nothing)', async () => {
  const t = setup('stevens');
  await t.search();
  assert.equal(t.text('utilityMetric'), 'AVISTA CORP');
  assert.equal(t.text('overviewUtility'), 'AVISTA CORP');
  assert.equal(t.text('overviewLocation'), 'Stevens County, Washington');
  const power = t.calls.filter(c => c.path === '/api/power-intelligence');
  assert.deepEqual([...power[0].body.providers], ['AVISTA CORP']);
  assert.equal(t.powerChip(), '78');
});

test('BPA (wholesale) is dropped: a rural Spokane parcel shows Inland Power, and power intelligence gets Inland first', async () => {
  const t = setup('spokaneRural');
  await t.search();
  assert.equal(t.text('utilityMetric'), 'INLAND POWER & LIGHT COMPANY');
  assert.equal(t.text('overviewUtility'), 'INLAND POWER & LIGHT COMPANY');
  const power = t.calls.filter(c => c.path === '/api/power-intelligence');
  assert.deepEqual([...power[0].body.providers], ['INLAND POWER & LIGHT COMPANY']);
  // Inland Power's adapter does not confirm the territory: 70, the "territory found" score.
  assert.equal(t.powerChip(), '70');
});

test('Montana and Idaho use the same filter: WAPA is dropped in Yellowstone, Kootenai keeps both retail providers', async () => {
  // These answers carry no ranking (an older API answer): both names show as an open overlap.
  const y = setup('yellowstone');
  await y.search();
  assert.equal(y.text('utilityMetric'), 'YELLOWSTONE VALLEY ELEC CO-OP or NORTHWESTERN ENERGY LLC - (MT) (overlapping territories)');
  assert.equal(y.calls.find(c => c.path === '/api/utility-territory').body.state, 'MT');
  const k = setup('kootenai');
  await k.search();
  assert.equal(k.text('utilityMetric'), 'AVISTA CORP or KOOTENAI ELECTRIC COOPERATIVE (overlapping territories)');
  assert.equal(k.calls.find(c => c.path === '/api/utility-territory').body.state, 'ID');
});

// /api/utility-territory answers with the ranking (src/services/provider-ranking.js), shaped as
// the live answers recorded 2026-11-10 (test/fixtures/utility-territory-ranking.json).
const CDA_NOTE = "Avista is most likely: Avista's published distribution map shows a line about 127 ft from the parcel point (Idaho Code 61-332C gives a new service to the supplier with the nearest existing line within 1,320 ft). KOOTENAI ELECTRIC COOPERATIVE also has mapped territory here — confirm with both.";
const rankedCda = () => ({ body: {
  available: true, providers: ['AVISTA CORP', 'KOOTENAI ELECTRIC COOPERATIVE'],
  primary: { name: 'AVISTA CORP', rank: 1, basis: 'avista_line_nearby', resolved: false, confidence: 'low', note: CDA_NOTE },
  alsoListed: ['KOOTENAI ELECTRIC COOPERATIVE'], wholesale: []
} });
const unresolvedBillings = () => ({ body: {
  available: true, providers: ['NORTHWESTERN ENERGY LLC - (MT)', 'YELLOWSTONE VALLEY ELEC CO-OP', 'WAPA-- WESTERN AREA POWER ADMINISTRATION'],
  primary: { name: 'NORTHWESTERN ENERGY LLC - (MT)', rank: 1, basis: 'unresolved_overlap', resolved: false, confidence: 'low', note: 'NORTHWESTERN ENERGY LLC - (MT) and YELLOWSTONE VALLEY ELEC CO-OP both have mapped territory here and no official source available to AcresX separates them, so the order shown is not a likelihood — confirm with both.' },
  alsoListed: ['YELLOWSTONE VALLEY ELEC CO-OP'], wholesale: ['WAPA-- WESTERN AREA POWER ADMINISTRATION']
} });

test('a ranked Coeur d\'Alene overlap shows Avista first with Kootenai Electric "also listed", and power intelligence and the score use Avista', async () => {
  const t = setup('kootenai', rankedCda);
  await t.search();
  assert.equal(t.text('utilityMetric'), 'AVISTA CORP · also listed: KOOTENAI ELECTRIC COOPERATIVE');
  assert.equal(t.text('overviewUtility'), 'AVISTA CORP · also listed: KOOTENAI ELECTRIC COOPERATIVE');
  const utility = t.last().utility;
  assert.equal(utility.primary, 'AVISTA CORP');
  assert.deepEqual([...utility.alsoListed], ['KOOTENAI ELECTRIC COOPERATIVE']);
  assert.equal(utility.resolved, false);
  const power = t.calls.filter(c => c.path === '/api/power-intelligence');
  assert.equal(power.length, 1);
  assert.deepEqual([...power[0].body.providers], ['AVISTA CORP', 'KOOTENAI ELECTRIC COOPERATIVE']);
  assert.deepEqual({ ...power[0].body.providerRanking }, { basis: 'avista_line_nearby', resolved: false, note: CDA_NOTE });
  // An open overlap is not a confirmed territory: 70, not 78.
  assert.equal(t.powerChip(), '70');
  // The power tab names the primary, lists the other and gives the reason.
  t.run("activeTab = 'power'; renderResults();");
  const html = t.document.getElementById('results').innerHTML;
  assert.match(html, /<strong>AVISTA CORP<\/strong>/);
  assert.match(html, /Most likely provider\. Also listed: KOOTENAI ELECTRIC COOPERATIVE\./);
  assert.match(html, /confirm with both/);
});

test('an unresolved Billings overlap lists NorthWestern and Yellowstone Valley in order without calling either most likely; WAPA is dropped', async () => {
  const t = setup('yellowstone', unresolvedBillings);
  await t.search();
  assert.equal(t.text('utilityMetric'), 'NORTHWESTERN ENERGY LLC - (MT) or YELLOWSTONE VALLEY ELEC CO-OP (overlapping territories)');
  const power = t.calls.filter(c => c.path === '/api/power-intelligence');
  assert.deepEqual([...power[0].body.providers], ['NORTHWESTERN ENERGY LLC - (MT)', 'YELLOWSTONE VALLEY ELEC CO-OP']);
  assert.equal(t.powerChip(), '70');
  t.run("activeTab = 'power'; renderResults();");
  const html = t.document.getElementById('results').innerHTML;
  assert.match(html, /Overlapping territories \(listed first, not ranked\)\. Also listed: YELLOWSTONE VALLEY ELEC CO-OP\./);
  assert.doesNotMatch(html, /Most likely provider/);
});

for (const [why, route] of [
  ['an HTTP error', () => ({ status: 502, body: { error: 'Utility territory service returned 503.' } })],
  ['available:false', () => ({ body: { available: false, error: 'Utility territory lookup failed' } })],
  ['a network failure', null]
]) {
  test(`a utility-territory failure (${why}) shows "${NOT_IDENTIFIED_FAILED}", not Avista, and scores as unidentified`, async () => {
    const t = setup('spokaneCity', route || (() => { throw new Error('Failed to fetch'); }));
    await t.search();
    assert.equal(t.text('utilityMetric'), NOT_IDENTIFIED_FAILED);
    assert.equal(t.text('overviewUtility'), NOT_IDENTIFIED_FAILED);
    assert.doesNotMatch(t.text('utilityMetric') + t.text('overviewUtility') + t.text('powerStatus'), /avista/i);
    const utility = t.last().utility;
    assert.equal(utility.length, 0, 'no provider reaches the score');
    assert.equal(utility.lookupFailed, true);
    assert.equal(t.calls.filter(c => c.path === '/api/power-intelligence').length, 0, 'no power intelligence without a provider');
    assert.equal(t.powerChip(), '45');
    assert.equal(t.ctx.AcresXSections.status('utility'), 'done');
  });
}

test('an empty territory answer (no failure) still reads plain "Not identified"', async () => {
  const t = setup('spokaneCity', () => ({ body: { available: true, providers: [], matches: [] } }));
  await t.search();
  assert.equal(t.text('utilityMetric'), 'Not identified');
  assert.equal(t.powerChip(), '45');
});

test('the overview location line names the parcel state: Kootenai is Idaho, Gallatin is Montana, Spokane is Washington', async () => {
  const k = setup('kootenai');
  await k.search();
  assert.equal(k.text('overviewLocation'), 'Kootenai County, Idaho');
  const g = setup('gallatin');
  await g.search();
  assert.equal(g.text('overviewLocation'), 'Gallatin County, Montana');
  const s = setup('spokaneCity');
  await s.search();
  assert.equal(s.text('overviewLocation'), 'Spokane County, Washington');
});

test('index.html no longer calls the Ecology CPR layer or guesses a provider by county; state-selector.js no longer overrides findUtility', () => {
  const html = readPublic('index.html');
  assert.doesNotMatch(html, /gis\.ecology\.wa\.gov\/serverext\/rest\/services\/CPR/);
  assert.doesNotMatch(html, /COUNTY_UTILITY_FALLBACK/);
  assert.doesNotMatch(readPublic('state-selector.js'), /findUtility\s*=/);
});
