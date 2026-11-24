// Offline tests for pipeline/parity-check.mjs: which stored fields count as different from a
// fresh run, and the live-report deep link it prints. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRow, deepLink, explain, COMPARED } from '../pipeline/parity-check.mjs';

test('parity check: differences and the live-report deep link', () => {
  const stored = { score: 7.548, score_rating: 'Good', score_factors_measured: 7, zoning_code: 'RT', flood_share_pct: 30.2, buildable_acres: 6.78 };
  const fresh = { score: 7.53, rating: 'Good', measured: 7, columns: { zoning_code: 'RT', flood_share_pct: 30.4, buildable_acres: 6.8 } };
  assert.deepEqual(compareRow(stored, fresh), []);
  const moved = compareRow(stored, { ...fresh, score: 7.1, columns: { ...fresh.columns, zoning_code: 'SRR-5' } });
  assert.deepEqual(moved.map(d => d.field), ['score', 'zoning_code']);
  assert.match(deepLink('WA', 'spokane', '23123.9051'), /\/\?state=WA&county=spokane&parcel=23123\.9051&report=1$/);
});

test('the parity check compares the score inputs Explore filters on', () => {
  for (const key of ['zoning_code', 'flood_share_pct', 'wetlands_category', 'slope_mean_pct', 'buildable_acres', 'septic_grade', 'well_depth_ft', 'power_territory_confirmed']) assert.ok(COMPARED.includes(key), key);
});

test('a well depth that moved with the terrain estimate is explained', () => {
  const diffs = [{ field: 'well_depth_ft', stored: 440, fresh: 82.5 }];
  assert.deepEqual(explain(diffs, { stored: 'estimated', fresh: 'wells_unavailable' }), ['well terrain estimate estimated -> wells_unavailable']);
  assert.deepEqual(explain(diffs, { stored: 'estimated', fresh: 'estimated' }), []);
});
