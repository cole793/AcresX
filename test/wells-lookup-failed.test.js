// Offline tests: a failed wells lookup is marked lookupFailed (public/index.html findWells,
// public/state-selector.js, the progressive-loading.js fallback), so screening-refinements.js
// leaves water out of the score ("not checked") instead of scoring it as "no nearby wells" (40).
// Runs the real browser scripts in node:vm with the fake DOM from test/ui-harness.js. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, makeContext, readPublic } from './ui-harness.js';

const square = { type: 'Polygon', coordinates: [[[-108.546, 45.7015], [-108.544, 45.7015], [-108.544, 45.7027], [-108.546, 45.7027], [-108.546, 45.7015]]] };
const NONE = { status: 'not_found', provider: null, basis: 'none found', source: null };
const last = wells => ({
  parcel: { type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '03092732390050000', _countyDisplay: 'Yellowstone', _stateCode: 'MT' } },
  wells, utility: ['YELLOWSTONE VALLEY ELEC CO-OP'],
  flood: { available: true, intersects: false, zones: [] }, wetlands: { available: true, intersects: false, count: 0 },
  zoningPermits: { zoning: { status: 'gis_match', code: 'RR3' } }, evidence: { status: 'none' },
  land: { soil: { available: true, feasibility: 'favorable' }, terrain: { available: true, gradePct: 2.8, reliefFt: 8 } },
  publicUtilities: { available: true, water: NONE, sewer: { ...NONE } }
});
function score(l) {
  const page = makeContext({ body: [], clock: makeClock(), fetch: async () => { throw new Error('no network in tests'); }, autoIds: true });
  page.ctx.__last = l;
  page.run('var last = __last; var activeTab = ""; function renderSummary() {} function renderResults() {}', 'index-inline.js');
  for (const f of ['screening-inputs.js', 'score-cost.js', 'screening-refinements.js', 'public-utilities.js']) page.run(readPublic(f), f);
  return page.run('window.AcresXScore.calculate()');
}

const indexLines = readPublic('index.html').split('\n');
const pickIndex = (...names) => names.map(name => indexLines.find(l => l.startsWith(`function ${name}(`) || l.startsWith(`async function ${name}(`) || l.startsWith(`const ${name}=`)) || '').join('\n');

test('a failed wells lookup is marked lookupFailed and left out of the score, not scored as "no wells"', async () => {
  const page = makeContext({ body: [], clock: makeClock(), fetch: async () => { throw new Error('network down'); }, extra: { turf: { centroid: () => ({ geometry: { coordinates: [-117.4, 47.6] } }) } } });
  page.run(`${pickIndex('PARCEL_URL', 'WELL_URL', 'arcQuery', 'findWells')}\nwindow.findWells = findWells;`, 'index-inline.js');
  const failed = await page.run('findWells({ type: "Feature", geometry: null, properties: {} })');
  assert.equal(failed.length, 0);
  assert.equal(failed.lookupFailed, true);
  const abort = makeContext({ body: [], clock: makeClock(), fetch: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, extra: { turf: { centroid: () => ({ geometry: { coordinates: [-117.4, 47.6] } }) } } });
  abort.run(`${pickIndex('PARCEL_URL', 'WELL_URL', 'arcQuery', 'findWells')}\nwindow.findWells = findWells;`, 'index-inline.js');
  await assert.rejects(abort.run('findWells({ type: "Feature", geometry: null, properties: {} })'), /aborted/, 'an abort (time limit) still rejects');

  const a = score(last([])), b = score(last(Object.assign([], { lookupFailed: true })));
  assert.equal(a.factors.water.score, 40, 'no wells nearby is a real answer');
  assert.ok(!a.completeness.missing.some(m => m.key === 'water'));
  assert.ok(b.completeness.missing.some(m => m.key === 'water'), 'a failed lookup is "not checked"');
  assert.notEqual(a.score, b.score);
});

test('progressive loading marks a failed or timed-out wells section lookupFailed; state-selector.js does too', () => {
  const src = readPublic('progressive-loading.js');
  const def = /wells: \{ fn: 'findWells', ms: 15000, label: 'wells', fallback: (why => \{[^\n]*\}) \},/.exec(src);
  assert.ok(def, 'wells section fallback');
  const fallback = new Function(`return (${def[1]})`)();
  const err = fallback('error'), late = fallback('timeout');
  assert.deepEqual([err.length, err.lookupFailed, late.lookupFailed, late.timedOut], [0, true, true, true]);
  assert.match(readPublic('state-selector.js'), /const failed = \[\]; failed\.lookupFailed = true;\n\s*return failed;/);
});
