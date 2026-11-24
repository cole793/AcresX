// Offline tests for public/score-core.js (R1-R3 of docs/explore-index.md section 8): the score
// rules in one classic script with no DOM access, loadable in Node through node:vm as
// globalThis.AcresXScoreCore, with the page's window helpers as thin wrappers over it.
//
// R2: the fixtures in test/fixtures/score-core-fixtures.js (one per county shape: steep, flood,
// wetland, no zoning, public utilities, missing inputs ...) have their scores recorded in
// test/fixtures/score-core-expected.json, captured from the code before the refactor. Any change
// to a weight, threshold or factor changes one of them: bump SCORE_RULES_VERSION in
// public/score-core.js and re-record the expected file (both together).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeLazyContext, readPublic } from './ui-harness.js';
import { FIXTURES, summarize } from './fixtures/score-core-fixtures.js';

const EXPECTED = JSON.parse(readFileSync(new URL('./fixtures/score-core-expected.json', import.meta.url), 'utf8'));
const plain = v => JSON.parse(JSON.stringify(v));

// A bare context: no window, no document. Anything the core reads from the page would throw here.
function loadCore() {
  const context = vm.createContext({});
  vm.runInContext(readPublic('score-core.js'), context, { filename: 'score-core.js' });
  return context.AcresXScoreCore;
}
const core = loadCore();

function fixture(name) {
  const last = FIXTURES[name]();
  const sections = last.sections || {};
  delete last.sections;
  return { last, sections };
}

// "factors.flood.score: 39.9 -> 41.2" for every field that differs.
function differences(actual, expected, path = '') {
  if (actual === expected) return [];
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const keys = [...new Set([...Object.keys(actual), ...Object.keys(expected)])];
    return keys.flatMap(k => differences(actual[k], expected[k], path ? `${path}.${k}` : k));
  }
  return [`${path}: ${JSON.stringify(expected)} -> ${JSON.stringify(actual)}`];
}

test('score-core.js loads in Node without a DOM, as globalThis.AcresXScoreCore', () => {
  assert.equal(typeof core, 'object');
  assert.equal(core.SCORE_RULES_VERSION, 1);
  assert.deepEqual(plain(core.WEIGHTS), { water: 15, soil: 20, terrain: 20, flood: 15, wetlands: 10, power: 10, zoning: 10 });
  for (const name of ['calculate', 'factors', 'missingInputs', 'buildableCheck']) assert.equal(typeof core[name], 'function', name);
  for (const part of ['wellDepth', 'septic', 'terrain', 'flood', 'wetlands', 'utilities']) {
    const fn = core[part].score || core[part].stats || core[part].waterScore;
    assert.equal(typeof fn, 'function', part);
  }
  const code = readPublic('score-core.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bdocument\b|\bwindow\.|\blast\b/, 'no DOM, window or page-global reads');
});

test('the recorded fixture scores belong to this SCORE_RULES_VERSION', () => {
  assert.equal(EXPECTED.rulesVersion, core.SCORE_RULES_VERSION,
    'test/fixtures/score-core-expected.json was recorded for another SCORE_RULES_VERSION: re-record it together with the bump in public/score-core.js');
  assert.deepEqual(Object.keys(EXPECTED.cases).sort(), Object.keys(FIXTURES).sort(), 'every fixture has a recorded score');
  assert.ok(Object.keys(FIXTURES).length >= 10);
});

for (const name of Object.keys(FIXTURES)) {
  test(`score fixture ${name}: same score as recorded (bump SCORE_RULES_VERSION on any change)`, () => {
    const { last, sections } = fixture(name);
    const actual = plain(summarize(core.calculate(last, { sectionStatus: n => sections[n] })));
    const diff = differences(actual, EXPECTED.cases[name]);
    assert.ok(!diff.length,
      `The score of fixture "${name}" changed:\n  ${diff.join('\n  ')}\n` +
      'A weight, threshold or factor rule changed. If that is intended, bump SCORE_RULES_VERSION in public/score-core.js ' +
      'and re-record test/fixtures/score-core-expected.json (rulesVersion and cases) in the same change.');
  });
}

test('the fixtures cover each county and each shape the score handles', () => {
  const all = Object.keys(FIXTURES).map(name => ({ name, ...fixture(name) }));
  const counties = new Set(all.map(f => f.last.parcel.properties._countyDisplay));
  assert.deepEqual([...counties].sort(), ['Gallatin', 'Kootenai', 'Spokane', 'Stevens', 'Yellowstone']);
  const r = name => EXPECTED.cases[name];
  assert.ok(r('stevens_steep').factors.terrain.score < 50 && r('stevens_steep').buildableCap != null, 'steep, tight homesite');
  assert.ok(r('kootenai_flood_share').factors.flood.score < 50, 'flood share');
  assert.equal(r('kootenai_flood_unmeasured').factors.flood.score, 20, 'flood category');
  assert.ok(r('gallatin_wetland').factors.wetlands.score < 90, 'wetland');
  assert.equal(r('yellowstone_no_zoning').factors.zoning.score, 52, 'no zoning');
  assert.equal(r('spokane_public_utilities').factors.water.score, 92, 'public water served');
  assert.equal(r('yellowstone_likely_utilities').factors.water.score, 40, 'likely public water is not counted');
  assert.equal(r('missing_inputs_provisional').rating, 'Provisional', 'missing inputs');
  assert.deepEqual(r('sections_timeout_pending').completeness.retry, ['land', 'wetlands'], 'section states');
});

// The page (thin wrappers over the core): the same result as the core for every fixture.
const PAGE = ['score-core.js', 'flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'score-cost.js', 'screening-refinements.js', 'buildable-area.js', 'public-utilities.js'];
for (const name of Object.keys(FIXTURES)) {
  test(`page wrappers for ${name}: window.AcresXScore and the layer helpers answer what the core answers`, () => {
    const { last, sections } = fixture(name);
    const h = makeLazyContext({ last });
    h.context.AcresXSections = { status: n => sections[n] };
    for (const f of PAGE) h.run(readPublic(f));
    const w = h.context;
    const expected = summarize(core.calculate(fixture(name).last, { sectionStatus: n => sections[n] }));
    assert.deepEqual(plain(summarize(w.AcresXScore.calculate())), plain(expected));
    assert.deepEqual(plain(w.AcresXScore.missingInputs()), plain(core.missingInputs(fixture(name).last, n => sections[n])));
    assert.equal(w.AcresXFlood.score(last.flood), core.flood.score(last.flood));
    assert.equal(w.AcresXFlood.shareScore(last.flood), core.flood.shareScore(last.flood));
    assert.equal(w.AcresXWetlands.score(last.wetlands), core.wetlands.score(last.wetlands));
    assert.equal(w.AcresXWetlands.grade(last.wetlands).score, core.wetlands.score(last.wetlands));
    assert.equal(w.AcresXTerrain.score(last.land?.terrain?.gradePct), core.terrain.score(last.land?.terrain?.gradePct));
    assert.deepEqual(plain(w.AcresXWellDepth.stats(last)), plain(core.wellDepth.stats(last)));
    assert.deepEqual(plain(w.AcresXWellDepth.grade(w.AcresXWellDepth.stats(last))), plain(core.wellDepth.grade(core.wellDepth.stats(last))));
    assert.equal(w.AcresXUtilities.waterScore(40, last), core.utilities.waterScore(40, last));
    assert.equal(w.AcresXUtilities.septicScore(38, last), core.utilities.septicScore(38, last));
    if (last.land?.soil) assert.deepEqual(plain(w.AcresXSeptic.classify(last.land.soil)), plain(core.septic.classify(last.land.soil)));
  });
}

test('injection order: score-core.js first, before every script that uses it; the shared report loads it too', () => {
  const list = readPublic('../src/index.js').match(/for\(const s of \[([^\]]+)\]\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.equal(list[0], 'score-core');
  for (const user of ['flood-status', 'screening-inputs', 'wetlands-status', 'score-cost', 'screening-refinements', 'public-utilities', 'property-report-v2']) {
    assert.ok(list.indexOf(user) > 0, `${user} after score-core`);
  }
  const shared = readPublic('shared-report.html');
  assert.ok(shared.indexOf('<script src="/score-core.js"></script>') >= 0, 'shared-report.html loads score-core.js');
  assert.ok(shared.indexOf('/score-core.js') < shared.indexOf('/public-utilities.js'), 'before public-utilities.js');
});

test('score-cost.js keeps no score of its own (R3): the card renders from screening-refinements.js', () => {
  const src = readPublic('score-cost.js');
  for (const gone of [/const WEIGHTS\b/, /function scoreFactors\b/, /function calculateScore\b/]) assert.doesNotMatch(src, gone);
  assert.match(src, /AcresXScore\?\.renderCard\?\.\(\)/);
});

test('the helpers say clearly when score-core.js did not load first', () => {
  for (const file of ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'screening-refinements.js', 'public-utilities.js']) {
    const context = vm.createContext({ window: {} });
    assert.throws(() => vm.runInContext(readPublic(file), context), /score-core\.js must load before/, file);
  }
});
