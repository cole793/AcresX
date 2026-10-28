// Migrated upstream callers must give the same outputs as before the shared client
// (snapshot recorded from main at 4812983; see test/upstream-scenarios.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { runScenarios } from './upstream-scenarios.js';

const snapshotUrl = new URL('./fixtures/upstream-callers-snapshot.json', import.meta.url);

test('migrated upstream callers: outputs (and successful requests) match the pre-migration snapshot', async () => {
  const actual = await runScenarios();
  if (process.env.UPDATE_SNAPSHOT) writeFileSync(snapshotUrl, `${JSON.stringify(actual, null, 2)}\n`);
  const expected = JSON.parse(readFileSync(snapshotUrl, 'utf8'));
  assert.deepEqual(Object.keys(actual), Object.keys(expected), 'scenario list');
  for (const name of Object.keys(expected)) assert.deepEqual(actual[name], expected[name], name);
});
