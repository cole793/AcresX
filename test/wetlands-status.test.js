// Offline tests for the frontend's reading of the wetlands result (public/wetlands-status.js) and
// for every page module that turns it into a label or score. The overview label and the score
// card must agree: "present" only with a measured, meaningful overlap; a null coverage is
// "not measured", never 0%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { wetlandCategory, PRESENT_MIN_ACRES, PRESENT_MIN_PCT, PRESENT_FLOOR_ACRES, WETLAND_CATEGORIES } from '../src/services/wetlands.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(read('public/wetlands-status.js'), { window });
const WX = window.AcresXWetlands;
const plain = v => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

// Answers as src/services/wetlands.js builds them.
const base = { available: true, types: ['Riverine'], parcelAcres: 9.99, coverageMethod: 'NWI polygons clipped to parcel', coverageEstimated: false };
const present = { ...base, intersects: true, count: 1, coveragePct: 4.738, wetlandAcres: 0.4733, category: 'present', overlapAcres: 0.4733, nearby: false, overlapCount: 1 };
const presentBig = { ...base, intersects: true, count: 16, coveragePct: 70.5, wetlandAcres: 35.89, category: 'present', overlapAcres: 35.89, nearby: false, overlapCount: 16 };
const present11 = { ...base, parcelAcres: 1.977, intersects: true, count: 3, coveragePct: 11.19, wetlandAcres: 0.2212, category: 'present', overlapAcres: 0.2212, nearby: false, overlapCount: 3 };
// 162 ac parcel, 0.06 ac overlap: present by acres, 0.037% of the parcel.
const presentTiny = { ...base, parcelAcres: 162, intersects: true, count: 1, coveragePct: 0.037, wetlandAcres: 0.06, category: 'present', overlapAcres: 0.06, nearby: false, overlapCount: 1 };
const nearby = { ...base, intersects: true, count: 1, coveragePct: 0.01, wetlandAcres: 0.0003, category: 'nearby', overlapAcres: 0.0003, nearby: true, overlapCount: 1 };
const touch = { ...base, intersects: true, count: 1, coveragePct: 0, wetlandAcres: 0, category: 'nearby', overlapAcres: 0, nearby: true, overlapCount: 0 };
const none = { ...base, intersects: false, count: 0, types: [], coveragePct: 0, wetlandAcres: 0, coverageMethod: 'NWI polygon intersection', category: 'none', overlapAcres: 0, nearby: false, overlapCount: 0 };
const unmeasured = { ...base, intersects: true, count: 3, coveragePct: null, wetlandAcres: null, coverageMethod: 'NWI intersection presence only', coverageEstimated: true, category: 'unmeasured', overlapAcres: null, nearby: false, overlapCount: null };
const unavailable = { available: false, intersects: false, count: 0, types: [], error: 'down', category: 'unavailable' };
// What production returned before this fix (and what an old cache can still hold): no category,
// coverage null because the clip request was malformed.
const oldNullCoverage = { available: true, intersects: true, count: 1, types: ['Riverine'], coveragePct: null, wetlandAcres: null, parcelAcres: 9.99, coverageMethod: 'NWI intersection presence only', coverageEstimated: true };
const oldNone = { available: true, intersects: false, count: 0, types: [], coveragePct: 0, wetlandAcres: 0, parcelAcres: 4.78, coverageMethod: 'NWI polygon intersection' };
const legacyFallback = { available: false };

// [name, result, category, score, grade label, grade cls, overview, overview cls, detail, note]
const CASES = [
  ['present 4.7%', present, 'present', 90, 'Mapped on parcel', 'amber', 'Mapped wetlands present', 'warn', '1 mapped wetland feature · 4.7% of parcel · 0.47 ac', 'Mapped wetlands: 4.7% of parcel · 0.47 ac'],
  ['present 11.2% (47N03W052200)', present11, 'present', 80, 'Mapped on parcel', 'amber', 'Mapped wetlands present', 'warn', '3 mapped wetland features · 11.2% of parcel · 0.22 ac', 'Mapped wetlands: 11.2% of parcel · 0.22 ac'],
  ['present 70%', presentBig, 'present', 22, 'Mapped on parcel', 'amber', 'Mapped wetlands present', 'warn', '16 mapped wetland features · 70.5% of parcel · 35.89 ac', 'Mapped wetlands: 70.5% of parcel · 35.89 ac'],
  ['present <0.1% on a 162 ac parcel', presentTiny, 'present', 90, 'Mapped on parcel', 'amber', 'Mapped wetlands present', 'warn', '1 mapped wetland feature · <0.1% of parcel · 0.06 ac', 'Mapped wetlands: <0.1% of parcel · 0.06 ac'],
  ['nearby sliver', nearby, 'nearby', 92, 'Nearby only', '', 'Wetland nearby (not on parcel)', '', 'Mapped NWI wetland at the parcel edge, not on the parcel (overlap under 0.001 ac). Check setbacks with the county.', 'Mapped wetlands: nearby only, not on parcel'],
  ['boundary touch', touch, 'nearby', 92, 'Nearby only', '', 'Wetland nearby (not on parcel)', '', 'Mapped NWI wetland at the parcel edge, not on the parcel. Check setbacks with the county.', 'Mapped wetlands: nearby only, not on parcel'],
  ['none', none, 'none', 96, 'None mapped', 'green', 'No mapped wetlands', 'good', 'No NWI wetland intersects parcel', 'Mapped wetlands: none detected'],
  ['unmeasured', unmeasured, 'unmeasured', 55, 'Mapped, extent unknown', 'amber', 'Mapped wetlands (extent not measured)', 'warn', '3 mapped wetland features on or touching the parcel; overlap not measured', 'Mapped wetlands detected · coverage percentage unavailable'],
  ['unavailable', unavailable, 'unavailable', 50, 'Unavailable', 'amber', 'Not verified', 'warn', 'NWI service unavailable', 'Mapped wetlands: unavailable'],
  ['old null coverage', oldNullCoverage, 'unmeasured', 55, 'Mapped, extent unknown', 'amber', 'Mapped wetlands (extent not measured)', 'warn', '1 mapped wetland feature on or touching the parcel; overlap not measured', 'Mapped wetlands detected · coverage percentage unavailable'],
  ['old none', oldNone, 'none', 96, 'None mapped', 'green', 'No mapped wetlands', 'good', 'No NWI wetland intersects parcel', 'Mapped wetlands: none detected'],
  ['browser fallback', legacyFallback, 'unavailable', 50, 'Unavailable', 'amber', 'Not verified', 'warn', 'NWI service unavailable', 'Mapped wetlands: unavailable']
];

test('wetlands-status: grade, score, overview, detail and note for every case', () => {
  for (const [name, w, category, score, label, cls, overview, overviewCls, detail, note] of CASES) {
    assert.deepEqual(plain(WX.grade(w)), { category, score, label, cls, overview, overviewCls, detail, note }, name);
    assert.equal(WX.score(w), score, name);
  }
  assert.equal(WX.category(undefined), 'unavailable');
  assert.equal(WX.score(undefined), 50);
});

test('wetlands-status: the label and the coverage note never disagree', () => {
  for (const [name, w] of CASES) {
    const g = WX.grade(w);
    if (g.overview === 'Mapped wetlands present') assert.doesNotMatch(g.note, /: 0\.0% of parcel/, name);
    if (/0\.0% of parcel/.test(g.note)) assert.notEqual(g.category, 'present', name);
  }
});

test('wetlands-status: without category, the backend thresholds are applied to the numbers', () => {
  assert.equal(WX.PRESENT_MIN_ACRES, PRESENT_MIN_ACRES);
  assert.equal(WX.PRESENT_MIN_PCT, PRESENT_MIN_PCT);
  assert.equal(WX.PRESENT_FLOOR_ACRES, PRESENT_FLOOR_ACRES);
  assert.deepEqual(plain(WX.CATEGORIES), WETLAND_CATEGORIES);
  const samples = [[0, 0], [0.0003, 0.01], [0.009, 4], [0.013, 0.66], [0.02, 0.4], [0.02, 0.5], [0.049, 0.1], [0.05, 0.01], [0.47, 4.7], [35, 70], [null, null]];
  for (const [acres, pct] of samples) {
    const backend = wetlandCategory({ intersects: true, overlapAcres: acres, coveragePct: pct });
    const w = { available: true, intersects: true, count: 1, wetlandAcres: acres, coveragePct: pct };
    assert.equal(WX.category(w), backend, `${acres} ac, ${pct}%`);
  }
  assert.equal(WX.category({ available: true, intersects: false }), wetlandCategory({ intersects: false }));
  for (const c of WETLAND_CATEGORIES) assert.equal(WX.category({ ...present, category: c }), c);
});

test('wetlands-status.js is injected before every module that uses it', () => {
  const list = read('src/index.js').match(/for\(const s of \[([^\]]+)\]\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
  const at = list.indexOf('wetlands-status');
  assert.ok(at >= 0, 'wetlands-status must be in the injection list');
  for (const user of ['parcel-preview', 'score-cost', 'screening-refinements']) assert.ok(list.indexOf(user) > at, user);
  assert.equal(list[0], 'flood-status', 'flood-status stays first');
});

// parcel-preview.js: the real hazardLabel function.
function loadHazardLabel(win) {
  const src = read('public/parcel-preview.js');
  const start = src.indexOf('function hazardLabel(');
  const end = src.indexOf('\n  }\n', start);
  const label = vm.runInNewContext(`(${src.slice(start, end + 4)})`, { window: win });
  return (...args) => plain(label(...args));
}

test('parcel-preview hazardLabel: wetlands overview text and class for every case', () => {
  const hazardLabel = loadHazardLabel(window);
  for (const [name, w, , , , , overview, overviewCls] of CASES) {
    assert.deepEqual(hazardLabel(w, 'wetlands'), { text: overview, cls: overviewCls }, name);
  }
});

test('parcel-preview hazardLabel: wetlands does not throw before wetlands-status.js loads', () => {
  const hazardLabel = loadHazardLabel({});
  assert.deepEqual(hazardLabel(present, 'wetlands'), { text: 'Mapped wetlands present', cls: 'warn' });
  assert.deepEqual(hazardLabel(none, 'wetlands'), { text: 'No mapped wetlands', cls: 'good' });
  assert.deepEqual(hazardLabel(unavailable, 'wetlands'), { text: 'Not verified', cls: 'warn' });
});

// score-cost.js: the real wetlands-score lines.
test('score-cost.js: wetlands score comes from AcresXWetlands, with a fallback', () => {
  const src = read('public/score-cost.js');
  const start = src.indexOf('const WX = window.AcresXWetlands;');
  const end = src.indexOf('\n', src.indexOf('const wetlandsScore', start));
  assert.ok(start >= 0 && end > start, 'wetlands score lines not found');
  const run = (win, wetlands) => vm.runInNewContext(`${src.slice(start, end)}\nwetlandsScore`, { window: win, wetlands });
  for (const [name, w, , score] of CASES) assert.equal(run(window, w), score, name);
  assert.equal(run({}, present), 42);
  assert.equal(run({}, none), 96);
  assert.equal(run({}, unavailable), 50);
});

// screening-refinements.js: the real wetlandsScore function and the score-card note.
function loadRefinements() {
  const src = read('public/screening-refinements.js');
  const fnStart = src.indexOf('  function wetlandsScore(');
  const fnEnd = src.indexOf('\n  }\n', fnStart);
  const noteStart = src.indexOf('    const w = last?.wetlands || {};');
  const noteEnd = src.indexOf(';\n', src.indexOf('wetlandNote.textContent =', noteStart));
  assert.ok(fnStart >= 0 && noteStart >= 0, 'screening-refinements wetlands code not found');
  const numberFn = 'function number(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }';
  const score = (win, w) => vm.runInNewContext(`${numberFn}\n${src.slice(fnStart, fnEnd + 4)}\nwetlandsScore(w)`, { window: win, w });
  const note = (win, w) => vm.runInNewContext(`${numberFn}\nconst wetlandNote = {};\n${src.slice(noteStart, noteEnd + 1)}\nwetlandNote.textContent`, { window: win, last: { wetlands: w } });
  return { score, note };
}

test('screening-refinements.js: wetlands score and score-card note match the label', () => {
  const { score, note } = loadRefinements();
  for (const [name, w, , s, , , , , , n] of CASES) {
    assert.equal(score(window, w), s, name);
    assert.equal(note(window, w), n, name);
  }
});

test('screening-refinements.js: without the helper, null coverage is not 0% (the reported bug)', () => {
  const { score, note } = loadRefinements();
  assert.equal(score({}, oldNullCoverage), 55, 'was 90: Number(null) read as 0%');
  assert.equal(note({}, oldNullCoverage), 'Mapped wetlands detected · coverage percentage unavailable', 'was "0.0% of parcel · 0.00 ac"');
  assert.equal(score({}, present), 90);
  assert.equal(note({}, present), 'Mapped wetlands: 4.7% of parcel · 0.47 ac');
  assert.equal(score({}, none), 96);
  assert.equal(note({}, presentTiny), 'Mapped wetlands: <0.1% of parcel · 0.06 ac');
});

// index.html renderSummary: the real wetlands grade expression and its traffic light.
function loadIndexGrade() {
  const html = read('public/index.html');
  const match = html.match(/const WX=window\.AcresXWetlands;const wgx=(.+?);const wetg=\{score:wgx\.score,label:wgx\.label,cls:wgx\.cls\};/);
  assert.ok(match, 'wetlands grade (wgx) must go through window.AcresXWetlands');
  assert.match(html, /setTraffic\('wetland',wetg,wgx\.detail\)/);
  return (win, wetlands) => plain(vm.runInNewContext(`const WX=window.AcresXWetlands;(${match[1]})`, { window: win, last: { wetlands } }));
}

test('index.html renderSummary: wetlands grade, score and detail for every case', () => {
  const run = loadIndexGrade();
  for (const [name, w, , score, label, cls, , , detail] of CASES) {
    const g = run(window, w);
    assert.deepEqual({ score: g.score, label: g.label, cls: g.cls, detail: g.detail }, { score, label, cls, detail }, name);
  }
});

test('index.html renderSummary: wetlands does not throw before wetlands-status.js loads', () => {
  const run = loadIndexGrade();
  assert.deepEqual(run({}, present), { score: 45, label: 'Mapped', cls: 'amber', detail: '1 mapped wetland feature' });
  assert.deepEqual(run({}, none), { score: 95, label: 'None mapped', cls: 'green', detail: 'No NWI wetland intersects parcel' });
  assert.equal(run({}, undefined).label, 'Unavailable');
});

test('every public script that reads the wetlands result uses AcresXWetlands', () => {
  const files = readdirSync(new URL('../public/', import.meta.url)).filter(f => /\.(js|html)$/.test(f) && f !== 'wetlands-status.js');
  for (const f of files) {
    const src = read(`public/${f}`);
    if (/last\??\.wetlands\b/.test(src)) assert.match(src, /AcresXWetlands/, `public/${f} reads last.wetlands without AcresXWetlands`);
  }
});
