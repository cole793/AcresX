// Offline tests for the frontend's reading of the flood result (public/flood-status.js) and for
// every page module that turns it into a label or score. Categories, labels and scores are the
// owner-approved table of 2026-10-26 (worst intersecting FEMA zone wins). A limited
// (backup-source, empty) answer must never show as safe or score like a safe parcel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { summarizeFloodRows } from '../src/services/flood.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const helperSource = read('public/flood-status.js');

function loadHelper() {
  const window = {};
  vm.runInNewContext(helperSource, { window });
  return window;
}
const window = loadHelper();
// vm results come from another realm; compare them as plain data.
const plain = v => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
const FX = window.AcresXFlood;

const ESRI = 'Esri USA Flood Hazard Areas';
const FEMA_SOURCE = { provider: 'FEMA NFHL', url: 'https://f' };
const ESRI_SOURCE = { provider: ESRI, url: 'https://e', coverage: 'high-and-moderate-risk-only' };

// A FEMA answer built by the real backend summarizer from raw rows.
const fema = rows => ({ ...summarizeFloodRows(rows), source: FEMA_SOURCE });
const row = (FLD_ZONE, ZONE_SUBTY, SFHA_TF) => ({ FLD_ZONE, ZONE_SUBTY, SFHA_TF });

const xMinimal = fema([row('X', 'AREA OF MINIMAL FLOOD HAZARD', 'F')]);
const xPointTwo = fema([row('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', 'F')]);
const zoneD = fema([row('D', null, 'F')]);
const zoneAE = fema([row('AE', null, 'T')]);
const mixAX = fema([row('X', 'AREA OF MINIMAL FLOOD HAZARD', 'F'), row('AE', null, 'T')]);
const notIncluded = fema([row('AREA NOT INCLUDED', null, 'F')]);
const femaEmpty = fema([]);
const limited = { available: true, intersects: false, high: false, zones: [], zoneDetails: [], category: 'not_mapped', source: { ...ESRI_SOURCE, emptyResult: true } };
const unavailable = { available: false, intersects: false, high: false, zones: [], error: 'down' };
// Older (pre-category) answers, as an earlier cache or browser could still hold them.
const oldBackupAE = { available: true, intersects: true, high: true, zones: ['AE'], source: ESRI_SOURCE };
const oldBackupX = { available: true, intersects: true, high: false, zones: ['X'], source: ESRI_SOURCE };
const oldFemaX = { available: true, intersects: true, high: false, zones: ['X'], source: FEMA_SOURCE };
const oldClear = { available: true, intersects: false, high: false, zones: [] };
const oldLimited = { available: true, intersects: false, high: false, zones: [], source: { ...ESRI_SOURCE, emptyResult: true } };
const oldNotIncluded = { available: true, intersects: true, high: true, zones: ['AREA NOT INCLUDED'], source: FEMA_SOURCE };

// Expected per case: [grade label, score, grade cls, overview, overview cls, detail].
const EXPECTED = new Map([
  [zoneAE, ['High risk', 20, 'red', 'High-risk flood zone', 'warn', 'FEMA zone AE (1% annual chance, Special Flood Hazard Area)']],
  [xPointTwo, ['Moderate risk', 70, 'amber', 'Moderate flood hazard', 'warn', 'FEMA zone X (0.2% annual chance)']],
  [zoneD, ['Undetermined', 55, 'amber', 'Flood risk not determined', 'warn', 'FEMA zone D: flood risk undetermined, verify with FEMA']],
  [xMinimal, ['Minimal', 96, 'green', 'Minimal flood hazard', 'good', 'FEMA zone X (minimal flood hazard)']],
  [femaEmpty, ['Not mapped', 70, 'amber', 'No FEMA flood map', 'warn', 'No FEMA flood map covers this parcel. Verify locally.']],
  [notIncluded, ['Not mapped', 70, 'amber', 'No FEMA flood map', 'warn', 'No FEMA flood map covers this parcel. Verify locally.']],
  [mixAX, ['High risk', 20, 'red', 'High-risk flood zone', 'warn', 'FEMA zone AE (1% annual chance, Special Flood Hazard Area); also zone X']],
  [limited, ['Limited flood data', 50, 'amber', 'Limited flood data', 'warn', 'Not in a mapped high- or moderate-risk flood area (backup source; FEMA unavailable). Verify with FEMA.']],
  [unavailable, ['Unavailable', 50, 'amber', 'Not verified', 'warn', 'FEMA service unavailable']]
]);
const NAMES = new Map([[zoneAE, 'AE'], [xPointTwo, 'X 0.2%'], [zoneD, 'D'], [xMinimal, 'X minimal'], [femaEmpty, 'FEMA empty'],
  [notIncluded, 'AREA NOT INCLUDED'], [mixAX, 'AE + X'], [limited, 'limited'], [unavailable, 'unavailable']]);

test('flood-status: grade, score and detail for every category', () => {
  for (const [flood, [label, score, cls, overview, overviewCls, detail]] of EXPECTED) {
    const name = NAMES.get(flood);
    const { category, ...grade } = plain(FX.grade(flood));
    assert.deepEqual(grade, { score, label, cls, overview, overviewCls, detail }, name);
    assert.equal(FX.score(flood), score, name);
  }
  assert.equal(FX.score(undefined), 50);
  assert.equal(FX.category(undefined), 'unavailable');
});

test('flood-status: categories follow the backend category, limited and unavailable first', () => {
  assert.deepEqual([zoneAE, xPointTwo, zoneD, xMinimal, femaEmpty, notIncluded, mixAX, limited, unavailable].map(FX.category),
    ['high', 'moderate', 'undetermined', 'minimal', 'not_mapped', 'not_mapped', 'high', 'limited', 'unavailable']);
});

test('flood-status: without category, the same rules are derived from zoneDetails or zones', () => {
  const strip = ({ category, ...rest }) => rest;
  const stripAll = ({ category, zoneDetails, ...rest }) => rest;
  for (const flood of [zoneAE, xPointTwo, zoneD, xMinimal, femaEmpty, notIncluded, mixAX]) {
    assert.equal(FX.category(strip(flood)), flood.category, `${NAMES.get(flood)} from zoneDetails`);
    assert.deepEqual(plain(FX.grade(strip(flood))), plain(FX.grade(flood)), NAMES.get(flood));
  }
  // Bare zone codes: an X without a subtype is minimal from FEMA, moderate from the backup layer.
  assert.equal(FX.category(stripAll(xMinimal)), 'minimal');
  assert.equal(FX.category(stripAll(zoneD)), 'undetermined');
  assert.equal(FX.category(oldFemaX), 'minimal');
  assert.equal(FX.category(oldBackupX), 'moderate');
  assert.equal(FX.category(oldBackupAE), 'high');
  assert.equal(FX.category(oldClear), 'not_mapped');
  assert.equal(FX.category(oldLimited), 'limited');
  assert.equal(FX.category(oldNotIncluded), 'not_mapped', 'old high:true on AREA NOT INCLUDED is the bug, not high risk');
  assert.equal(FX.category({ available: true, intersects: true, high: true, zones: [] }), 'high');
  assert.equal(FX.category({ available: true, intersects: true, high: false, zones: [] }), 'undetermined');
});

test('flood-status: frontend rowCategory matches the backend for each zone kind', () => {
  const rows = [row('A', null, 'T'), row('AE', null, 'T'), row('AH', null, null), row('AO', null, null), row('AR', null, null), row('A99', null, null),
    row('V', null, null), row('VE', null, 'T'), row('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', 'F'), row('X', 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE', 'F'),
    row('B', null, 'F'), row('D', null, 'F'), row('X', 'AREA OF MINIMAL FLOOD HAZARD', 'F'), row('X', null, 'F'), row('C', null, 'F'),
    row('AREA NOT INCLUDED', null, 'F'), row('OPEN WATER', null, 'F')];
  for (const r of rows) {
    const backend = summarizeFloodRows([r]);
    const front = FX.category({ ...backend, category: undefined, source: FEMA_SOURCE });
    assert.equal(front, backend.category, `${r.FLD_ZONE} ${r.ZONE_SUBTY || ''}`);
  }
});

test('flood-status: exact user-facing text and backup suffix', () => {
  assert.equal(FX.LIMITED_LABEL, 'Limited flood data');
  assert.equal(FX.LIMITED_TEXT, 'Not in a mapped high- or moderate-risk flood area (backup source; FEMA unavailable). Verify with FEMA.');
  assert.equal(FX.NOT_MAPPED_TEXT, 'No FEMA flood map covers this parcel. Verify locally.');
  assert.equal(FX.backupSuffix(oldBackupX), ' (backup source)');
  assert.equal(FX.backupSuffix(oldFemaX), '');
  assert.deepEqual(plain(FX.grade(oldBackupAE)), { category: 'high', score: 20, label: 'High risk', cls: 'red', overview: 'High-risk flood zone (backup source)', overviewCls: 'warn',
    detail: 'FEMA zone AE (1% annual chance, Special Flood Hazard Area) (backup source)' });
  assert.equal(FX.grade(oldBackupX).detail, 'FEMA zone X (moderate flood hazard) (backup source)');
  assert.equal(FX.BACKUP_PROVIDER, ESRI, 'must match ESRI_PROVIDER in src/services/flood.js');
});

test('flood-status: backup provider name matches the backend constant', async () => {
  const { ESRI_PROVIDER } = await import('../src/services/flood.js');
  assert.equal(FX.BACKUP_PROVIDER, ESRI_PROVIDER);
});

test('flood-status.js is injected first, before every module that uses it', () => {
  const list = read('src/index.js').match(/for\(const s of \[([^\]]+)\]\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.equal(list[0], 'flood-status');
  for (const user of ['parcel-preview', 'score-cost', 'screening-refinements']) assert.ok(list.indexOf(user) > 0, user);
});

// parcel-preview.js: run the real hazardLabel function against each case.
function loadHazardLabel(win) {
  const src = read('public/parcel-preview.js');
  const start = src.indexOf('function hazardLabel(');
  assert.ok(start >= 0, 'hazardLabel not found');
  const end = src.indexOf('\n  }\n', start);
  const label = vm.runInNewContext(`(${src.slice(start, end + 4)})`, { window: win });
  return (...args) => plain(label(...args));
}

test('parcel-preview hazardLabel: each category\'s overview text and class', () => {
  const hazardLabel = loadHazardLabel(window);
  for (const [flood, [, , , overview, overviewCls]] of EXPECTED) {
    assert.deepEqual(hazardLabel(flood, 'flood'), { text: overview, cls: overviewCls }, NAMES.get(flood));
  }
  assert.deepEqual(hazardLabel(oldBackupX, 'flood'), { text: 'Moderate flood hazard (backup source)', cls: 'warn' });
});

test('parcel-preview hazardLabel: does not throw before flood-status.js loads', () => {
  const hazardLabel = loadHazardLabel({});
  assert.deepEqual(hazardLabel(zoneAE, 'flood'), { text: 'High-risk zone mapped', cls: 'warn' });
  assert.deepEqual(hazardLabel(limited, 'flood'), { text: 'Limited flood data', cls: 'warn' });
  assert.deepEqual(hazardLabel(xMinimal, 'flood'), { text: 'Mapped flood zone', cls: 'warn' });
  assert.deepEqual(hazardLabel(femaEmpty, 'flood'), { text: 'No mapped flood hazard', cls: 'good' });
  assert.deepEqual(hazardLabel(unavailable, 'flood'), { text: 'Not verified', cls: 'warn' });
});

// score-cost.js and screening-refinements.js: run the real flood-score lines.
for (const file of ['public/score-cost.js', 'public/screening-refinements.js']) {
  const src = read(file);
  const start = src.indexOf('const FX = window.AcresXFlood;');
  const lineEnd = src.indexOf('\n', src.indexOf('const floodScore', start));
  const floodScoreOf = (win, flood) => vm.runInNewContext(`${src.slice(start, lineEnd)}\nfloodScore`, { window: win, flood });

  test(`${file}: flood score comes from AcresXFlood for every category`, () => {
    assert.ok(start >= 0 && lineEnd > start, 'flood score lines not found');
    assert.match(src.slice(start, lineEnd), /FX\.score\(flood\)/);
    for (const [flood, [, score]] of EXPECTED) assert.equal(floodScoreOf(window, flood), score, NAMES.get(flood));
  });

  test(`${file}: flood score does not throw before flood-status.js loads`, () => {
    assert.equal(floodScoreOf({}, zoneAE), 20);
    assert.equal(floodScoreOf({}, limited), 50);
    assert.equal(floodScoreOf({}, unavailable), 50);
    assert.equal(floodScoreOf({}, femaEmpty), 96);
  });
}

// index.html renderSummary: run the real grade expression and check the flood traffic light uses it.
function loadIndexGrade() {
  const html = read('public/index.html');
  const match = html.match(/const FX=window\.AcresXFlood;const fgx=(.+?);const fg=\{score:fgx\.score,label:fgx\.label,cls:fgx\.cls\};/);
  assert.ok(match, 'flood grade (fgx) must go through window.AcresXFlood');
  assert.match(html, /setTraffic\('flood',fg,fgx\.detail\);setTraffic\('wetland'/);
  return (win, flood) => plain(vm.runInNewContext(`const FX=window.AcresXFlood;(${match[1]})`, { window: win, last: { flood } }));
}

test('index.html renderSummary: each category\'s grade, score and detail', () => {
  const run = loadIndexGrade();
  for (const [flood, [label, score, cls, , , detail]] of EXPECTED) {
    const g = run(window, flood);
    assert.deepEqual({ score: g.score, label: g.label, cls: g.cls, detail: g.detail }, { score, label, cls, detail }, NAMES.get(flood));
  }
});

test('index.html renderSummary: does not throw before flood-status.js loads', () => {
  const run = loadIndexGrade();
  assert.deepEqual(run({}, zoneAE), { score: 25, label: 'High risk', cls: 'red', detail: 'Zones: AE' });
  assert.deepEqual(run({}, limited), { score: 50, label: 'Limited flood data', cls: 'amber', detail: 'Limited flood data. Verify with FEMA.' });
  assert.deepEqual(run({}, unavailable), { score: 50, label: 'Unavailable', cls: 'amber', detail: 'FEMA service unavailable' });
  assert.equal(run({}, undefined).label, 'Unavailable');
});

// Any other page script that reads the flood result object must use the helper.
test('every public script that reads last.flood uses AcresXFlood', () => {
  const files = readdirSync(new URL('../public/', import.meta.url)).filter(f => /\.(js|html)$/.test(f) && f !== 'flood-status.js');
  for (const f of files) {
    const src = read(`public/${f}`);
    if (/last\??\.flood\b/.test(src)) assert.match(src, /AcresXFlood/, `public/${f} reads last.flood without AcresXFlood`);
  }
});
