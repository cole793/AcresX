// Offline tests for the local development-cost model (public/cost-tables.js +
// public/local-cost-model.js, owner request 2026-11-12) and its server route
// (POST /api/cost-context: src/services/road-access.js, src/states/washington/wria.js).
// The browser scripts run in node:vm with the fake DOM from test/ui-harness.js; the route runs
// against a stubbed fetch. Nothing touches a county, state or utility server.
//
// Expected dollar amounts are worked out by hand from the cited tariff/fee sheets (see the
// comments), not from the model's own helpers, so a formula change (for example dropping the
// Avista allowance) fails here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, makeContext, makeLazyContext, readPublic } from './ui-harness.js';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { lookupRoadAccess, roadConfig } from '../src/services/road-access.js';
import { lookupWria, WA_WRIA_LAYER } from '../src/states/washington/wria.js';
import { KOOTENAI_ROADS_LAYER } from '../src/counties/kootenai-roads.js';
import { SPOKANE_ENGINEERING_STREETS, SPOKANE_PUBLIC_SAFETY_STREETS } from '../src/counties/spokane-roads.js';

const square = { type: 'Polygon', coordinates: [[[-117.4, 47.6], [-117.399, 47.6], [-117.399, 47.601], [-117.4, 47.601], [-117.4, 47.6]]] };
const STATE = { Spokane: 'WA', Stevens: 'WA', Kootenai: 'ID', Gallatin: 'MT', Yellowstone: 'MT' };

// A parcel's facts. Defaults: no wells, limited soil, 4% grade, no public utilities, no power data.
function facts({ county = 'Spokane', provider = '', distanceFt, distStatus = 'utility_published_proximity', water, sewer, soil = 'limited', grade = 4,
  jurisdiction, uga = false, overlays = [], road, wria, wells = [], existingWell, terrainAvailable = true } = {}) {
  const ctx = {};
  if (road !== undefined) ctx.roadAccess = road;
  if (wria !== undefined) ctx.watershed = wria;
  return {
    parcel: { type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: 'TEST-1', _countyDisplay: county, _stateCode: STATE[county] === 'WA' ? undefined : STATE[county] } },
    wells, utility: provider ? [provider] : [],
    flood: { available: true, intersects: false, zones: [] }, wetlands: { available: true, intersects: false, count: 0 },
    zoningPermits: { zoning: { status: 'gis_match', code: 'R' }, permitJurisdiction: { name: jurisdiction ?? (county === 'Kootenai' ? 'Kootenai County' : `${county} County`) }, urbanGrowthArea: { intersects: uga }, overlays },
    evidence: { status: 'none' },
    land: { soil: { available: true, feasibility: soil }, terrain: { available: terrainAvailable, gradePct: grade, reliefFt: 10 } },
    ...(provider ? { powerIntelligence: { provider, distribution: { status: distanceFt == null ? 'no_published_line_nearby' : distStatus, estimatedDistanceFt: distanceFt ?? null } } } : {}),
    ...(water || sewer ? { publicUtilities: { water: water || NONE, sewer: sewer || NONE } } : {}),
    ...(existingWell ? { existingWell } : {}),
    ...(Object.keys(ctx).length ? { costContext: ctx } : {})
  };
}
const NONE = { status: 'not_found', provider: null, basis: 'none found' };
const SERVED = provider => ({ status: 'served', provider, basis: `${provider} main 7 m from the parcel`, source: { name: 'Mains', url: 'https://gis.example.test/3' } });
const ROAD = (distanceFt, name = 'Test Rd', extra = {}) => ({ available: true, status: 'found', distanceFt, road: { name, kind: 'county road', public: true }, nearestPublic: { distanceFt, road: { name, kind: 'county road', public: true } }, source: { name: 'County road centerlines', url: 'https://gis.example.test/roads' }, ...extra });
const PRIVATE_ROAD = (distanceFt, publicFt) => ROAD(distanceFt, 'Whispering Spring Ln', { road: { name: 'Whispering Spring Ln', kind: 'private road', public: false }, nearestPublic: publicFt == null ? null : { distanceFt: publicFt, road: { name: 'Little Spokane Dr', kind: 'county road', public: true } }, searchedFt: 2640 });

const PAGE = [
  ['div', { class: 'overview-grid' }, '', [
    ['article', { class: 'card score-card' }, '', [['div', { id: 'scoreMetric', class: 'metric-value' }, '—'], ['div', { id: 'scoreNote' }, '']]],
    ['article', { id: 'developmentCostCard', class: 'card development-cost-card' }, '', [['div', { class: 'cost-value' }, ''], ['div', { class: 'cost-note' }, '']]]
  ]],
  ['div', { id: 'detailCard' }, '', [['h3', { id: 'resultsTitle' }, ''], ['div', { id: 'results' }]]]
];
// The score and cost modules in their injection order (src/index.js maybeInjectUiPolish).
function page(last, { withModel = true } = {}) {
  const clock = makeClock();
  const p = makeContext({ body: PAGE, clock, fetch: async () => { throw new Error('no network in tests'); } });
  p.ctx.__last = last;
  p.run('var last = __last; var activeTab = "wells"; function renderSummary() {} function renderResults() {}', 'index-inline.js');
  const files = ['score-cost.js', 'screening-refinements.js', ...(withModel ? ['cost-tables.js', 'local-cost-model.js'] : []), 'public-utilities.js'];
  for (const f of files) p.run(readPublic(f), f);
  p.run('renderSummary(last.parcel)');
  const est = () => p.run('window.AcresXCostModel.estimate()');
  return { ...p, est, $: id => p.document.getElementById(id), score: () => p.document.getElementById('scoreMetric').textContent };
}
const estimate = (opts, o) => page(facts(opts), o).est();

// ---- Power

// Avista Schedule 51 (2026-05-15), one home, assumed 100 ft service:
//   overhead basic    = 5,952 + 12.04 d + 5,222 + 5.56 x 100 = 11,730 + 12.04 d
//   underground basic = 2,754 + 14.31 d + 9,134 + 10.78 x 100 = 12,966 + 14.31 d
//   secondary circuit, high end only: overhead + 2,466; underground + 688 + 13.18 x 100 = + 2,006
//   cost = max(0, basic - allowance); WA allowance $7,210, ID $2,755.
// Low = the cheaper of overhead and underground without a secondary; high = the dearest of the four.
const OH = d => 11730 + 12.04 * d, UG = d => 12966 + 14.31 * d;
const OH2 = d => OH(d) + 2466, UG2 = d => UG(d) + 688 + 13.18 * 100;
for (const [county, provider, allowance] of [['Spokane', 'Avista Utilities', 7210], ['Kootenai', 'Avista Corp', 2755]]) {
  test(`Avista ${STATE[county]} power: Schedule 51 range minus the $${allowance} allowance, secondary in the high end`, () => {
    for (const d of [0, 500, 1320, 2640]) {
      const e = estimate({ county, provider, distanceFt: d }).components.electric;
      const lows = [OH(d), UG(d)].map(x => Math.round(x - allowance));
      const highs = [OH(d), UG(d), OH2(d), UG2(d)].map(x => Math.round(x - allowance));
      assert.deepEqual([e.low, e.high], [Math.min(...lows), Math.max(...highs)], `${county} at ${d} ft`);
      assert.equal(e.quoteRecommended, true);
      assert.match(e.basis, new RegExp(`Avista ${STATE[county] === 'WA' ? 'Washington' : 'Idaho'} Schedule 51`));
      assert.match(e.basis, new RegExp(`${d.toLocaleString('en-US')} ft of new primary`));
      assert.match(e.basis, /secondary circuit, used only if Avista's design needs one \(overhead \$2,466; underground \$688 \+ \$13\.18\/ft over an assumed 100 ft\)/);
      assert.match(e.basis, /applies to homes meeting Avista's usage conditions \(at least (4,800|2,500) kWh a year of new load\)/);
      assert.match(e.basis, /A \$150 design fee, if Avista charged one up front, is credited/);
      assert.ok(e.sources.some(s => s.asOf === '2026-05-15' && s.verified), 'rate sheet date');
    }
  });
}

test('Avista hand-checked values at 500 ft: WA $10,540-$14,917; ID $14,995-$19,372', () => {
  // WA: 11,730 + 6,020 - 7,210 = 10,540; 12,966 + 7,155 + 2,006 - 7,210 = 14,917. ID: the same - 2,755.
  const wa = estimate({ county: 'Spokane', provider: 'Avista Utilities', distanceFt: 500 }).components.electric;
  const id = estimate({ county: 'Kootenai', provider: 'Avista Utilities', distanceFt: 500 }).components.electric;
  assert.deepEqual([wa.low, wa.high], [10540, 14917]);
  assert.deepEqual([id.low, id.high], [14995, 19372]);
  assert.equal(id.allowance, 2755);
  assert.equal(wa.allowance, 7210);
  // Idaho cites the filed tariff and the IPUC order that approved it as filed.
  assert.ok(id.sources.some(s => /Order No\. 37042/.test(s.name) && /Final_Order_No_37042\.pdf$/.test(s.url)));
  assert.ok(id.sources.some(s => /as filed in case AVU-E-26-02; effective 2026-05-15/.test(s.name)));
  assert.ok(!wa.sources.some(s => /37042/.test(s.name)));
});

test('Avista with the distance unknown: a labeled 100-1,320 ft range', () => {
  const wa = estimate({ county: 'Spokane', provider: 'Avista Utilities' }).components.electric;
  assert.deepEqual([wa.low, wa.high], [Math.round(OH(100) - 7210), Math.round(UG2(1320) - 7210)]);
  assert.match(wa.basis, /Distance to Avista's line not mapped/);
  assert.equal(wa.confidence, 'Low');
  const id = estimate({ county: 'Kootenai', provider: 'Avista Utilities' }).components.electric;
  assert.deepEqual([id.low, id.high], [Math.round(OH(100) - 2755), Math.round(UG2(1320) - 2755)]);
});

test('Kootenai Electric: $750 engineering fee plus a labeled generic range', () => {
  const near = estimate({ county: 'Kootenai', provider: 'Kootenai Electric Cooperative', distanceFt: 400, distStatus: 'osm_mapped_proximity' }).components.electric;
  assert.deepEqual([near.low, near.high], [3500 + 400 * 14, 6000 + 400 * 22]);
  assert.match(near.basis, /KEC prices each job; get a KEC estimate/);
  assert.match(near.basis, /\$750 engineering fee/);
  assert.ok(near.sources.some(s => /Kootenai Electric/.test(s.name) && s.verified));
  assert.ok(near.sources.some(s => !s.verified), 'the generic part is marked unverified');
  const far = estimate({ county: 'Kootenai', provider: 'Kootenai Electric Cooperative' }).components.electric;
  assert.deepEqual([far.low, far.high], [5000, 25000]);
});

// Inland Power estimator, recorded 2026-11-12 (cost-tables.js power.inland.points): at each
// recorded distance the cheapest-dearest design; linear between distances; meter = line distance + 100 ft.
//   100 ft (short designs, nearest facility not a transformer): $8,000-$9,200; transformer: $1,600-$2,700
//   200 ft: $10,300-$14,400 · 400 ft: $11,700-$17,800 · 1,000 ft: $15,600-$28,100 · 2,640 ft: $30,900-$55,700
test('Inland Power: its online estimator, interpolated, with the transformer case and the 2,640 ft limit', () => {
  const at = d => estimate({ county: 'Spokane', provider: 'Inland Power & Light', distanceFt: d, distStatus: 'osm_mapped_proximity' }).components.electric;
  const e300 = at(300);
  assert.deepEqual([e300.low, e300.high], [11700, 17800]);
  assert.match(e300.basis, /Inland Power online estimator, recorded 2026-11-12/);
  assert.match(e300.basis, /excludes trenching, conduit and vaults/);
  assert.ok(e300.sources.some(s => s.url === 'https://www.inlandpower.com/residential-service-estimator' && s.asOf === '2026-11-12' && s.verified));
  const e0 = at(0);
  assert.deepEqual([e0.low, e0.high], [8000, 9200]);
  assert.match(e0.basis, /if it is a transformer: \$1,600-\$2,700/);
  const far = at(3000);
  assert.deepEqual([far.low, far.high], [30900, 55700]);
  assert.match(far.basis, /Beyond the estimator's 2,640 ft limit/);
  // Unknown distance: 200 ft to 1,420 ft to the meter; 1,420 ft = 1,000 + 420/1,640 of the way to 2,640.
  const u = estimate({ county: 'Spokane', provider: 'Inland Power & Light' }).components.electric;
  assert.deepEqual([u.low, u.high], [10300, Math.round(28100 + (55700 - 28100) * 420 / 1640)]);
  assert.equal(u.confidence, 'Low');
  // Kootenai has no Inland table: generic.
  const k = estimate({ county: 'Kootenai', provider: 'Inland Power & Light', distanceFt: 300, distStatus: 'osm_mapped_proximity' }).components.electric;
  assert.deepEqual([k.low, k.high], [3500 + 300 * 14, 6000 + 300 * 22]);
});

test('Modern, Vera and unknown providers: generic, "no published tariff found"', () => {
  for (const provider of ['Modern Electric Water Co', 'Vera Water & Power']) {
    const e = estimate({ county: 'Spokane', provider, distanceFt: 300, distStatus: 'osm_mapped_proximity' }).components.electric;
    assert.deepEqual([e.low, e.high], [3500 + 300 * 14, 6000 + 300 * 22]);
    assert.match(e.basis, new RegExp(`${provider.replace(/[&]/g, '\\&')}: no published line-extension tariff found`));
  }
  const none = estimate({ county: 'Spokane' }).components.electric;
  assert.deepEqual([none.low, none.high], [5000, 25000]);
  assert.match(none.basis, /Serving utility not identified/);
});

// ---- Water / sewer connections

test('connection fees per provider: published fee + a labeled service-line allowance', () => {
  const W = { low: 1000, high: 4000 }, S = { low: 1500, high: 6000 };
  const cases = [
    ['Spokane', 'water', 'City of Spokane', 3475, 3475 + W.low, 3475 + W.high],
    ['Spokane', 'sewer', 'City of Spokane', 4887, 4887 + S.low, 4887 + S.high],
    ['Kootenai', 'water', "City of Coeur d'Alene (CDA Water)", 12303, 12303 + W.low, 12303 + 7116],
    ['Kootenai', 'water', 'CDA Water', 12303, 12303 + W.low, 12303 + 7116],
    ['Kootenai', 'sewer', "City of Coeur d'Alene", 6665, 6665 + S.low, 6665 + S.high],
    ['Kootenai', 'water', 'Post Falls Water', 3260, 3260 + W.low, 3260 + W.high],
    ['Kootenai', 'sewer', 'City of Post Falls', 7725, 7725 + S.low, 7725 + S.high],
    ['Kootenai', 'sewer', 'City of Hayden', 10404, 10404 + S.low, 10404 + S.high]
  ];
  for (const [county, service, provider, fee, low, high] of cases) {
    const c = estimate({ county, [service]: SERVED(provider) }).components[service === 'water' ? 'well' : 'septic'];
    assert.deepEqual([c.low, c.high], [low, high], `${provider} ${service}`);
    assert.match(c.basis, new RegExp(`\\$${fee.toLocaleString('en-US')}`));
    assert.match(c.basis, /unsourced; get a contractor quote/);
    assert.ok(c.sources.some(s => s.verified && s.url), `${provider} source`);
  }
});

test('Post Falls impact fees go on the permits line, labeled as not water or sewer', () => {
  const p = estimate({ county: 'Kootenai', jurisdiction: 'City of Post Falls' }).components.permits;
  assert.deepEqual([p.low, p.high], [3000 + 14594, 6000 + 14594]);
  assert.match(p.basis, /impact fees \(parks, public safety, streets, multimodal, fire, EMS; not water or sewer\): \$14,594/);
});

test('unknown providers keep the generic connection range, labeled', () => {
  const w = estimate({ county: 'Kootenai', water: SERVED('North Kootenai water district') }).components.well;
  assert.deepEqual([w.label, w.low, w.high], ['Water connection', 3000, 15000]);
  assert.match(w.basis, /Generic connection range: no published fee sourced for North Kootenai water district/);
  const s = estimate({ county: 'Kootenai', sewer: SERVED('Hayden Lake sewer district') }).components.septic;
  assert.deepEqual([s.label, s.low, s.high], ['Sewer connection', 4000, 20000]);
});

// ---- Septic, well

test('septic: SRHD $1,890 exact (draft 2026 noted), installed system labeled; PHD fee not added', () => {
  const s = estimate({ county: 'Spokane', soil: 'limited' }).components.septic;
  assert.deepEqual([s.low, s.high], [14500 + 1890, 22000 + 1890]);
  assert.equal(s.septicPermitFees, 1890);
  assert.match(s.basis, /2026 schedule is a proposed draft/);
  assert.match(s.basis, /no official installed-cost source; get installer quotes/);
  const k = estimate({ county: 'Kootenai', soil: 'favorable' }).components.septic;
  assert.deepEqual([k.low, k.high], [7500, 11500]);
  assert.match(k.basis, /Panhandle Health District/);
  // No double counting: the old "permits/testing" allowance is gone and no SRHD fee is on the permits line.
  const e = estimate({ county: 'Spokane' });
  assert.deepEqual(Object.keys(e.components).sort(), ['driveway', 'electric', 'permits', 'septic', 'sitework', 'well']);
  assert.doesNotMatch(e.components.permits.basis, /SRHD/);
});

test('well: exact Ecology $200 / IDWR $75 fee + depth range, driller quote recommended', () => {
  const wells = [210, 190, 200].map(d => ({ properties: { CompletedDepth: d } }));
  const wa = estimate({ county: 'Spokane', wells, wria: { available: true, number: 57, name: 'Middle Spokane' } }).components.well;
  assert.deepEqual([wa.low, wa.high], [200 * 42 + 3500 + 200, 200 * 60 + 5500 + 200 + 180]);
  assert.match(wa.basis, /driller quote recommended/);
  assert.match(wa.basis, /Ecology notice of intent/);
  const id = estimate({ county: 'Kootenai', wells }).components.well;
  assert.deepEqual([id.low, id.high], [200 * 42 + 3500 + 75, 200 * 60 + 5500 + 75]);
  assert.match(id.basis, /IDWR drilling permit \(domestic\) \$75/);
});

test('well in WRIA 55 adds the $500 surcharge + $3,000-$5,000 mitigation certificate; WRIA 54/56/57 add nothing', () => {
  const base = estimate({ county: 'Spokane', wria: { available: true, number: 57, name: 'Middle Spokane' } }).components.well;
  const w55 = estimate({ county: 'Spokane', wria: { available: true, number: 55, name: 'Little Spokane', source: { name: 'WA Ecology WRIA', url: 'https://example.test' } } }).components.well;
  assert.deepEqual([w55.low - base.low, w55.high - base.high], [3500, 5500]);
  assert.match(w55.basis, /ESSB 6091 WRIA 55 surcharge \$500/);
  assert.match(w55.basis, /Package A \$3,000 or B \$5,000/);
  for (const n of [54, 56]) assert.equal(estimate({ county: 'Spokane', wria: { available: true, number: n, name: 'x' } }).components.well.low, base.low);
  const down = estimate({ county: 'Spokane', wria: { available: false, status: 'source_unavailable' } }).components.well;
  assert.equal(down.low, base.low);
  assert.match(down.basis, /Watershed \(WRIA\) not checked/);
  // Public water: no well, so no WRIA charge.
  const pw = estimate({ county: 'Spokane', water: SERVED('City of Spokane'), wria: { available: true, number: 55, name: 'Little Spokane' } }).components.well;
  assert.doesNotMatch(pw.basis, /WRIA/);
});

// ---- Permits

test('permits: Kootenai County 2026 formula, City of Spokane 2025 table, Spokane County BP-04 + BP-04P, generic elsewhere', () => {
  // Kootenai: valuation 2,000 x 196.82 + 500 x 75.04 = 431,160; permit 993.75 + 5.60 x 332 = 2,852.95;
  // x 1.30 + 141 + 176 = 4,025.84; + $250 approach (PFHD placeholder); high adds the $187 site-disturbance review.
  const k = estimate({ county: 'Kootenai' }).components.permits;
  assert.deepEqual([k.low, k.high], [Math.round(4025.835 + 250), Math.round(4025.835 + 187 + 250)]);
  assert.match(k.basis, /Assumes a 2,000 sf home with a 500 sf attached garage \(an assumption/);
  assert.match(k.basis, /placeholder/);
  assert.ok(k.sources.some(s => /Resolution No\. 2026-62/.test(s.name) && s.url === 'https://www.kcgov.us/DocumentCenter/View/24018'));
  // City of Spokane: $3,560.05-$4,703.80 by valuation + $32.10 residential approach.
  const c = estimate({ county: 'Spokane', jurisdiction: 'City of Spokane' }).components.permits;
  assert.deepEqual([c.low, c.high], [Math.round(3560.05 + 32.10), Math.round(4703.80 + 32.10)]);
  assert.match(c.basis, /owner-provided City schedule/);
  // Spokane County, rural, septic: 138.29 + 89.70 + 936.88 + 6.50 = 1,171.37 building; + plumbing 139.23
  // + mechanical 192.53 + planning 411.36 + septic review 164.54 + 56.57 = 2,135.60.
  const r = estimate({ county: 'Spokane', jurisdiction: 'Spokane County' }).components.permits;
  assert.deepEqual([r.low, r.high], [2136, 2136]);
  assert.match(r.basis, /building permit \$1,171.37/);
  assert.match(r.basis, /Plumbing permit, county worked example \(typical home, 17 fixtures\) \$139.23/);
  assert.match(r.basis, /Mechanical permit, county worked example \(typical home\) \$192.53/);
  assert.match(r.basis, /Outside the mapped Urban Growth Area/);
  // UGA with public sewer: planning $246.81, no septic review: 1,171.37 + 139.23 + 192.53 + 246.81 = 1,749.94.
  const u = estimate({ county: 'Spokane', jurisdiction: 'Spokane County', uga: true, sewer: SERVED('Spokane County Utilities') }).components.permits;
  assert.deepEqual([u.low, u.high], [1750, 1750]);
  // Shoreline / wetland-buffer overlays: information only.
  const o = estimate({ county: 'Spokane', jurisdiction: 'Spokane County', overlays: [{ type: 'shoreline' }, { type: 'wetland_buffer' }] }).components.permits;
  assert.equal(o.low, r.low);
  assert.match(o.basis, /information only \(not added\): Shoreline exemption \$1,151.82.*Buffer adjustment \$822.73/);
  // Unsourced city.
  const v = estimate({ county: 'Spokane', jurisdiction: 'City of Spokane Valley' }).components.permits;
  assert.deepEqual([v.low, v.high], [3000, 6000]);
  assert.match(v.basis, /City of Spokane Valley: building permit fee schedule not sourced/);
});

// ---- Driveway, site work

test('driveway: measured length x local DOT $/ft; unknown length -> labeled 100-500 ft range', () => {
  // 12 ft x 0.5 ft / 27 x 1.5 = 0.3333 t/ft; 12 x 0.5 / 27 = 0.2222 cy/ft.
  const id = (agg, exc) => agg / 3 + exc * 2 / 9;
  const k = estimate({ county: 'Kootenai', road: ROAD(300) }).components.driveway;
  assert.deepEqual([k.low, k.high], [Math.round(300 * id(29, 21)), Math.round(300 * id(34.2, 24))]);
  assert.match(k.basis, /300 ft straight line from the parcel interior point/);
  assert.match(k.basis, /Materials at highway-bid prices; small jobs cost more/);
  assert.match(k.basis, /Culvert not included/);
  const s = estimate({ county: 'Spokane', road: ROAD(300) }).components.driveway;
  assert.deepEqual([s.low, s.high], [Math.round(300 * id(32, 37)), Math.round(300 * id(45, 50))]);
  for (const road of [{ available: false, status: 'source_unavailable' }, undefined]) {
    const u = estimate({ county: 'Kootenai', road }).components.driveway;
    assert.deepEqual([u.low, u.high], [Math.round(100 * id(29, 21)), Math.round(500 * id(34.2, 24))]);
    assert.match(u.basis, /range for a 100-500 ft driveway/);
  }
});

// Coordinator follow-up 2026-11-12: measure to the nearest road of any kind; a long distance is a
// range from 100 ft; the length is capped at 1,500 ft with an access note.
test('driveway: private roads, long distances and the 1,500 ft cap', () => {
  const id = (agg, exc) => agg / 3 + exc * 2 / 9;
  const lo = id(29, 21), hi = id(34.2, 24);
  // The nearest road is private: its exact length, with the access note and the public road named.
  const p = estimate({ county: 'Kootenai', road: PRIVATE_ROAD(240, 2482) }).components.driveway;
  assert.deepEqual([p.low, p.high], [Math.round(240 * lo), Math.round(240 * hi)]);
  // Under 50 ft: the 50 ft minimum allowance.
  const short = estimate({ county: 'Kootenai', road: PRIVATE_ROAD(1, 2482) }).components.driveway;
  assert.deepEqual([short.low, short.high], [Math.round(50 * lo), Math.round(50 * hi)]);
  assert.match(short.basis, /Driveway 50 ft \(minimum allowance\)/);
  assert.equal(short.lengthFt, 50);
  assert.match(p.basis, /The nearest public road is Little Spokane Dr at 2,482 ft/);
  assert.match(p.basis, /a private road or easement likely serves this parcel; verify access/);
  // Only a public road, over 1,000 ft: "100 ft to N ft", verify the access route.
  const long = estimate({ county: 'Kootenai', road: ROAD(1265) }).components.driveway;
  assert.deepEqual([long.low, long.high], [Math.round(100 * lo), Math.round(1265 * hi)]);
  assert.match(long.basis, /the range is 100 ft to 1,265 ft\. Verify the access route\./);
  assert.deepEqual([...long.lengthRangeFt], [100, 1265]);
  // Over the 1,500 ft cap.
  const cap = estimate({ county: 'Kootenai', road: ROAD(2482) }).components.driveway;
  assert.deepEqual([cap.low, cap.high], [Math.round(100 * lo), Math.round(1500 * hi)]);
  assert.match(cap.basis, /Capped at 1,500 ft: a private road or easement likely serves this parcel; verify access\./);
  // No road at all within the search: 100 ft to the cap.
  const none = estimate({ county: 'Kootenai', road: { available: true, status: 'none_within', distanceFt: null, nearestPublic: null, searchedFt: 2640 } }).components.driveway;
  assert.deepEqual([none.low, none.high], [Math.round(100 * lo), Math.round(1500 * hi)]);
  assert.match(none.basis, /No mapped road within 2,640 ft.*a private road or easement likely serves this parcel; verify access/);
  // At 1,000 ft exactly: still the measured length.
  const edge = estimate({ county: 'Kootenai', road: ROAD(1000) }).components.driveway;
  assert.deepEqual([edge.low, edge.high], [Math.round(1000 * lo), Math.round(1000 * hi)]);
});

test('site work: slope tiers as pad earthwork x local excavation $/cy + allowance', () => {
  const s = estimate({ county: 'Kootenai', grade: 4 }).components.sitework;
  assert.deepEqual([s.low, s.high], [1500 + 89 * 21, 3000 + 178 * 24]);
  const steep = estimate({ county: 'Spokane', grade: 18 }).components.sitework;
  assert.deepEqual([steep.low, steep.high], [1500 + 622 * 37, 3000 + 1067 * 50]);
  assert.match(steep.basis, /very steep/);
});

// ---- Other counties, score, listings

test('other counties keep the generic estimate, labeled "local prices not yet sourced"', () => {
  for (const county of ['Stevens', 'Gallatin', 'Yellowstone']) {
    const p = page(facts({ county, provider: 'Avista Utilities', distanceFt: 500 }));
    const generic = p.run('window.__acresxScreeningCostEstimate()');
    const e = p.est();
    assert.equal(e.local, false);
    assert.deepEqual([e.low, e.high], [generic.low, generic.high], county);
    assert.equal(e.coverageNote, 'Generic regional ranges; local prices not yet sourced for this county.');
    const without = page(facts({ county, provider: 'Avista Utilities', distanceFt: 500 }), { withModel: false });
    const before = without.$('developmentCostCard').textContent, now = p.$('developmentCostCard').textContent;
    assert.ok(now.startsWith(before), 'the card is unchanged apart from the added label');
    assert.equal(now.slice(before.length), 'Generic regional ranges; local prices not yet sourced for this county.');
  }
});

test('the score does not read the cost estimate; listing claims change neither', () => {
  for (const county of ['Spokane', 'Kootenai', 'Stevens']) {
    const opts = { county, provider: 'Avista Utilities', distanceFt: 2000 };
    assert.equal(page(facts(opts)).score(), page(facts(opts), { withModel: false }).score(), county);
    const a = facts(opts), b = facts(opts);
    a.evidence = { status: 'found', claims: [{ label: 'Power at the road' }, { label: 'Septic approved' }] };
    assert.equal(JSON.stringify(page(a).est()), JSON.stringify(page(b).est()));
  }
});

// ---- Display

test('cost details show each line with basis, as-of date, source link, unverified marks and quote badges', () => {
  const p = page(facts({ county: 'Kootenai', provider: 'Avista Utilities', distanceFt: 500, road: ROAD(250) }));
  const card = p.$('developmentCostCard');
  assert.match(card.textContent, /Local prices for Kootenai County, ID \(sourced 2026-11-12\)/);
  assert.match(card.textContent, /Screening estimate, not a quote/);
  card.onclick();
  const html = p.$('results').innerHTML;
  assert.match(html, /href="https:\/\/www\.myavista\.com\/[^"]+id-schedule-51\.pdf"/);
  assert.match(html, /as of 2026-05-15/);
  assert.match(html, /Kootenai County Resolution No\. 2026-62/);
  assert.match(html, /cost-quote-badge">Get a quote/);
  assert.match(html, /unverified/);
  assert.match(html, /Screening estimate, not a quote\./);
  assert.equal((html.match(/class="result-item cost-line"/g) || []).length, 6);
});

test('the printable report shows the same lines with sources and dates', () => {
  const data = facts({ county: 'Spokane', provider: 'Avista Utilities', distanceFt: 500, jurisdiction: 'City of Spokane' });
  const h = makeLazyContext({ mappedSqm: 1000, last: data });
  for (const f of ['cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'acreage.js', 'property-report-v2.js']) h.run(readPublic(f));
  h.context.__acresxLast = data;
  h.el('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
  const html = h.opened.at(-1);
  assert.match(html, /<strong>Power \(Avista line extension\)<\/strong><sup class="ref">\[\d+(, \d+)*\]<\/sup><\/td><td><span class="tag fee">Published fee<\/span>/);
  assert.match(html, /<li value="\d+">Avista Utilities, Washington Schedule 51 \(Tariff WN U-28\), as of 2026-05-15/);
  assert.match(html, /Permits \(building \+ approach\)/);
  assert.match(html, /Local prices for Spokane County, WA/);
  assert.match(html, /AcresX planning allowance \(no official source\) \(unverified\)/);
  assert.match(html, /Estimate — get a quote/);
});

// ---- /api/cost-context

let restore;
const realFetch = globalThis.fetch;
before(() => { restore = configureUpstream({ backoffMs: 0, log: () => {} }); });
after(() => { restore(); globalThis.fetch = realFetch; });
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
// A road running north-south 0.002 deg of longitude east of the point (about 492 ft at 47.7 N).
const LAT = 47.7, LON = -116.8;
const roadFeature = (attrs, dLon = 0.002) => ({ attributes: attrs, geometry: { paths: [[[LON + dLon, LAT - 0.01], [LON + dLon, LAT + 0.01]]] } });
function stub(routes) {
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const layer = `${url.origin}${url.pathname.replace(/\/query$/, '')}`;
    const ring = Number(url.searchParams.get('distance'));
    calls.push({ layer, ring, where: url.searchParams.get('where') });
    const r = routes[layer];
    if (!r) throw new Error(`unexpected ${layer}`);
    return typeof r === 'function' ? r(ring) : r.clone();
  };
  return calls;
}

test('road access: Kootenai nearest road of any kind, then searches on for the nearest public road', async () => {
  // A private lane in the first ring; the public road only in the 2,640 ft ring.
  const calls = stub({ [KOOTENAI_ROADS_LAYER]: ring => json({ features: [
    ...(ring >= 330 ? [roadFeature({ ST_NAME: 'BIRDSONG', ST_TYPE: 'LN', CARTO_TYPE: 'LOCAL ROAD', STATUS: 'PRIVATE' }, 0.0005)] : []),
    ...(ring >= 2640 ? [roadFeature({ ST_NAME: 'TWINLOW', ST_TYPE: 'RD', CARTO_TYPE: 'LOCAL ROAD', STATUS: 'PUBLIC' }, 0.008)] : [])
  ] }) });
  const r = await lookupRoadAccess({ state: 'ID', county: 'Kootenai', lat: LAT, lon: LON });
  assert.equal(r.status, 'found');
  assert.ok(Math.abs(r.distanceFt - 123) < 5, `about 123 ft, got ${r.distanceFt}`);
  assert.deepEqual(r.road, { name: 'BIRDSONG LN', kind: 'private local road', public: false });
  assert.equal(r.nearestPublic.road.name, 'TWINLOW RD');
  assert.ok(Math.abs(r.nearestPublic.distanceFt - 1966) < 20, `about 1,966 ft, got ${r.nearestPublic.distanceFt}`);
  assert.deepEqual(calls.map(c => c.ring), [330, 1320, 2640]);
  assert.match(calls[0].where, /STATUS IN \('PUBLIC','PRIVATE','MIXED'\)/);
  // A public road in the first ring stops the search there.
  const one = stub({ [KOOTENAI_ROADS_LAYER]: () => json({ features: [roadFeature({ ST_NAME: 'BEST', ST_TYPE: 'RD', CARTO_TYPE: 'LOCAL ROAD', STATUS: 'PUBLIC' }, 0.0005)] }) });
  const q = await lookupRoadAccess({ state: 'ID', county: 'Kootenai', lat: LAT, lon: LON });
  assert.deepEqual([q.road.public, q.nearestPublic.distanceFt, one.length], [true, q.distanceFt, 1]);
});

test('road access: Spokane asks both street layers; a failed layer makes the answer unavailable', async () => {
  stub({
    [SPOKANE_ENGINEERING_STREETS]: json({ features: [roadFeature({ RoadName: 'Far Rd', JurDesc: 'County' }, 0.003)] }),
    [SPOKANE_PUBLIC_SAFETY_STREETS]: json({ features: [roadFeature({ FullName: 'N Near St', RoadClass: 'Local', Jurisdiction: 'Spokane' })] })
  });
  const r = await lookupRoadAccess({ state: 'WA', county: 'Spokane', lat: LAT, lon: LON });
  assert.deepEqual([r.status, r.road.name], ['found', 'N Near St']);
  stub({ [SPOKANE_ENGINEERING_STREETS]: json({ features: [] }), [SPOKANE_PUBLIC_SAFETY_STREETS]: new Response('down', { status: 503 }) });
  const down = await lookupRoadAccess({ state: 'WA', county: 'Spokane', lat: LAT, lon: LON });
  assert.deepEqual([down.available, down.status], [false, 'source_unavailable']);
  stub({ [KOOTENAI_ROADS_LAYER]: json({ features: [] }) });
  const none = await lookupRoadAccess({ state: 'ID', county: 'Kootenai', lat: LAT, lon: LON });
  assert.deepEqual([none.status, none.distanceFt, none.searchedFt], ['none_within', null, 2640]);
  assert.equal(roadConfig('MT', 'Gallatin'), null);
  assert.equal((await lookupRoadAccess({ state: 'MT', county: 'Gallatin', lat: LAT, lon: LON })).status, 'not_configured');
});

test('POST /api/cost-context: road access plus the WRIA in Washington; degrades per part', async () => {
  stub({
    [SPOKANE_ENGINEERING_STREETS]: json({ features: [roadFeature({ RoadName: 'Vista Dr', JurDesc: 'County' })] }),
    [SPOKANE_PUBLIC_SAFETY_STREETS]: json({ features: [] }),
    [WA_WRIA_LAYER]: json({ features: [{ attributes: { WRIA_NR: 55, WRIA_NM: 'Little Spokane' } }] }),
    [KOOTENAI_ROADS_LAYER]: json({ features: [roadFeature({ ST_NAME: 'X', CARTO_TYPE: 'LOCAL ROAD' })] })
  });
  const post = body => worker.fetch(new Request('https://acresx.test/api/cost-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), {}, { waitUntil() {} });
  const wa = await (await post({ state: 'WA', county: 'Spokane', lat: LAT, lon: LON })).json();
  assert.equal(wa.roadAccess.road.name, 'Vista Dr');
  assert.deepEqual([wa.watershed.number, wa.watershed.name], [55, 'Little Spokane']);
  const id = await (await post({ state: 'ID', county: 'Kootenai', lat: LAT, lon: LON })).json();
  assert.equal(id.watershed.status, 'not_applicable');
  stub({ [WA_WRIA_LAYER]: new Response('no', { status: 500 }) });
  const w = await lookupWria({ lat: LAT, lon: LON });
  assert.deepEqual([w.available, w.status], [false, 'source_unavailable']);
});

test('cost-tables.js and local-cost-model.js are injected, in order, after the score/cost modules', async () => {
  const src = readPublic('../src/index.js');
  const list = /for\(const s of \[([^\]]+)\]\)/.exec(src)[1].split(',').map(s => s.trim().replace(/'/g, ''));
  const at = name => list.indexOf(name);
  assert.ok(at('cost-tables') > at('screening-refinements') && at('local-cost-model') === at('cost-tables') + 1);
  assert.ok(at('local-cost-model') < at('property-report-v2'));
  assert.equal(at('spokane-cost-model'), -1);
});
