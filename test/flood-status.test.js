// Offline tests for the frontend's reading of the flood result (public/flood-status.js) and for
// every page module that turns it into a label or score. A limited (backup-source, empty) answer
// must never show as "Clear" or score like a clear parcel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
const limited = { available: true, intersects: false, high: false, zones: [], source: { provider: ESRI, url: 'https://e', coverage: 'high-and-moderate-risk-only', emptyResult: true } };
const backupAE = { available: true, intersects: true, high: true, zones: ['AE'], source: { provider: ESRI, url: 'https://e', coverage: 'high-and-moderate-risk-only' } };
const backupX = { available: true, intersects: true, high: false, zones: ['X'], source: { provider: ESRI, url: 'https://e', coverage: 'high-and-moderate-risk-only' } };
const femaClear = { available: true, intersects: false, high: false, zones: [], source: { provider: 'FEMA NFHL', url: 'https://f' } };
const femaX = { available: true, intersects: true, high: false, zones: ['X'], source: { provider: 'FEMA NFHL', url: 'https://f' } };
const legacyClear = { available: true, intersects: false, high: false, zones: [] };
const unavailable = { available: false, intersects: false, high: false, zones: [], error: 'down' };

test('flood-status: limited answers are detected and score 50', () => {
  assert.equal(FX.isLimited(limited), true);
  assert.equal(FX.isLimited(femaClear), false);
  assert.equal(FX.isLimited(legacyClear), false);
  assert.equal(FX.isLimited(unavailable), false);
  const scale = { high: 20, mapped: 55, clear: 96 };
  assert.equal(FX.score(limited, scale), 50);
  assert.equal(FX.score(unavailable, scale), 50);
  assert.equal(FX.score(undefined, scale), 50);
  assert.equal(FX.score(femaClear, scale), 96);
  assert.equal(FX.score(legacyClear, scale), 96);
  assert.equal(FX.score(femaX, scale), 55);
  assert.equal(FX.score(backupAE, scale), 20);
});

test('flood-status: exact user-facing text', () => {
  assert.equal(FX.LIMITED_LABEL, 'Limited flood data');
  assert.equal(FX.LIMITED_TEXT, 'Not in a mapped high- or moderate-risk flood area (backup source; FEMA unavailable). Verify with FEMA.');
  assert.equal(FX.backupSuffix(backupX), ' (backup source)');
  assert.equal(FX.backupSuffix(femaX), '');
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
test('parcel-preview hazardLabel: limited is a warning, never "No mapped flood hazard"', () => {
  const src = read('public/parcel-preview.js');
  const start = src.indexOf('function hazardLabel(');
  assert.ok(start >= 0, 'hazardLabel not found');
  const end = src.indexOf('\n  }\n', start);
  const label = vm.runInNewContext(`(${src.slice(start, end + 4)})`, { window });
  const hazardLabel = (...args) => plain(label(...args));
  assert.deepEqual(hazardLabel(limited, 'flood'), { text: 'Limited flood data', cls: 'warn' });
  assert.deepEqual(hazardLabel(backupAE, 'flood'), { text: 'High-risk zone mapped (backup source)', cls: 'warn' });
  assert.deepEqual(hazardLabel(backupX, 'flood'), { text: 'Mapped flood zone (backup source)', cls: 'warn' });
  assert.deepEqual(hazardLabel(femaX, 'flood'), { text: 'Mapped flood zone', cls: 'warn' });
  assert.deepEqual(hazardLabel(femaClear, 'flood'), { text: 'No mapped flood hazard', cls: 'good' });
  assert.deepEqual(hazardLabel(unavailable, 'flood'), { text: 'Not verified', cls: 'warn' });
});

// score-cost.js and screening-refinements.js: the flood score must come from the helper.
for (const file of ['public/score-cost.js', 'public/screening-refinements.js']) {
  test(`${file}: flood score goes through AcresXFlood.score (limited scores 50)`, () => {
    const src = read(file);
    const line = src.split('\n').find(l => /const floodScore\s*=/.test(l));
    assert.ok(line, 'floodScore line not found');
    assert.match(line, /window\.AcresXFlood\.score\(flood,/);
    const scale = vm.runInNewContext(`(${line.match(/\{[^}]+\}/)[0]})`);
    assert.equal(window.AcresXFlood.score(limited, scale), 50);
    assert.equal(window.AcresXFlood.score(legacyClear, scale), 96);
  });
}

// index.html renderSummary: run the real grade and detail expressions against each case.
test('index.html renderSummary: limited shows "Limited flood data" (amber, 50) and the limited text', () => {
  const html = read('public/index.html');
  const fgMatch = html.match(/const FX=window\.AcresXFlood;const fg=([^;]+);/);
  assert.ok(fgMatch, 'flood grade (fg) must go through window.AcresXFlood');
  const detailMatch = html.match(/setTraffic\('flood',fg,(.+?)\);setTraffic\('wetland'/);
  assert.ok(detailMatch, 'flood setTraffic not found');
  const run = (expr, flood) => plain(vm.runInNewContext(`const FX=window.AcresXFlood;(${expr})`, { window, last: { flood } }));
  assert.deepEqual(run(fgMatch[1], limited), { score: 50, label: 'Limited flood data', cls: 'amber' });
  assert.equal(run(detailMatch[1], limited), 'Not in a mapped high- or moderate-risk flood area (backup source; FEMA unavailable). Verify with FEMA.');
  assert.deepEqual(run(fgMatch[1], backupAE), { score: 25, label: 'High risk', cls: 'red' });
  assert.equal(run(detailMatch[1], backupAE), 'Zones: AE (backup source)');
  assert.deepEqual(run(fgMatch[1], femaClear), { score: 95, label: 'Clear', cls: 'green' });
  assert.equal(run(detailMatch[1], femaClear), 'No FEMA flood hazard intersects parcel');
  assert.equal(run(detailMatch[1], femaX), 'Zones: X');
  assert.deepEqual(run(fgMatch[1], unavailable), { score: 50, label: 'Unavailable', cls: 'amber' });
  assert.equal(run(detailMatch[1], unavailable), 'FEMA service unavailable');
});

// Any other page script that reads the flood result object must use the helper.
test('every public script that reads last.flood uses AcresXFlood', async () => {
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(new URL('../public/', import.meta.url)).filter(f => /\.(js|html)$/.test(f) && f !== 'flood-status.js');
  for (const f of files) {
    const src = read(`public/${f}`);
    if (/last\??\.flood\b/.test(src)) assert.match(src, /AcresXFlood/, `public/${f} reads last.flood without AcresXFlood`);
  }
});
