// Migrated upstream callers must give the same outputs as before the shared client
// (snapshot recorded from main at 4812983; see test/upstream-scenarios.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { runScenarios } from './upstream-scenarios.js';

const snapshotUrl = new URL('./fixtures/upstream-callers-snapshot.json', import.meta.url);

test('migrated upstream callers: outputs (and successful requests) match the pre-migration snapshot', async () => {
  const actual = await runScenarios();
  if (process.env.UPDATE_SNAPSHOT) writeFileSync(snapshotUrl, `${JSON.stringify(actual, null, 2)}\n`);
  const expected = JSON.parse(readFileSync(snapshotUrl, 'utf8'));
  assert.deepEqual(Object.keys(actual), Object.keys(expected), 'scenario list');
  for (const name of Object.keys(expected)) assert.deepEqual(actual[name], expected[name], name);
});

// src/counties/kootenai.js and src/states/idaho/parcels.js are being changed in open PRs #21 and
// #22, so they were not edited here; their `cf` options are dropped at runtime by fetchWithTimeout
// (test/upstream.test.js checks that). Remove them from this list when those files move to the shared client.
const CF_ALLOWED = new Set(['src/counties/kootenai.js', 'src/states/idaho/parcels.js']);
function sourceFiles(dir) {
  return readdirSync(new URL(`../${dir}/`, import.meta.url)).flatMap(name => {
    const rel = `${dir}/${name}`;
    return statSync(new URL(`../${rel}`, import.meta.url)).isDirectory() ? sourceFiles(rel) : rel.endsWith('.js') ? [rel] : [];
  });
}
test('no source file asks for cf edge caching (except the two files in open PRs)', () => {
  const offenders = sourceFiles('src').filter(file => {
    if (CF_ALLOWED.has(file)) return false;
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
    return /cacheEverything|cacheTtl|\bcf\s*:\s*\{/.test(code);
  });
  assert.deepEqual(offenders, []);
});

// reso-listings.js (MLS provider and OAuth token calls) is not migrated yet.
test('no module but the shared client calls fetch directly', () => {
  const direct = sourceFiles('src').filter(file => !['src/shared/upstream.js', 'src/services/reso-listings.js'].includes(file))
    .filter(file => /(^|[^.\w])fetch\(/.test(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/async fetch\(/g, '')));
  assert.deepEqual(direct, []);
});

