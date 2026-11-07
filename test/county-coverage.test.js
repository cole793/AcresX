// Pins the county coverage registry (src/config/county-coverage.js) to the checklist audits and
// live validation runs of 2026-11-03 (Stevens: 2026-11-07). A change to a level, date, score or capability must change this
// test too, so it shows up in review instead of slipping in with an unrelated edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTY_COVERAGE, COVERAGE_STATUS, getCountyCoverageRegistry } from '../src/config/county-coverage.js';

const V = 'validated', P = 'partial', N = 'not_configured';

const EXPECTED = {
  'ID:Kootenai': {
    level: 2, priority: 1, lastValidated: '2026-11-03', checklistScore: 87, checklistScoreDate: '2026-11-03',
    capabilities: { parcel: V, wells: V, soil: V, terrain: V, flood: V, wetlands: V, utilities: V, assessment: V, tax: N, zoning: V, zoningRules: P }
  },
  'WA:Spokane': {
    level: 2, priority: 1, lastValidated: '2026-11-03', checklistScore: 79, checklistScoreDate: '2026-11-03',
    capabilities: { parcel: V, wells: V, soil: V, terrain: V, flood: V, wetlands: V, utilities: V, assessment: V, tax: N, zoning: V, zoningRules: P }
  },
  'MT:Yellowstone': {
    level: 2, priority: 1, lastValidated: '2026-11-03', checklistScore: 80, checklistScoreDate: '2026-11-03',
    capabilities: { parcel: V, wells: V, soil: V, terrain: V, flood: V, wetlands: V, utilities: V, assessment: V, tax: N, zoning: V, zoningRules: P }
  },
  'MT:Gallatin': {
    level: 2, priority: 2, lastValidated: '2026-11-03', checklistScore: 75, checklistScoreDate: '2026-11-03',
    capabilities: { parcel: V, wells: V, soil: V, terrain: V, flood: V, wetlands: V, utilities: V, assessment: V, tax: N, zoning: V, zoningRules: N }
  },
  'WA:Stevens': {
    level: 2, priority: 2, lastValidated: '2026-11-07', checklistScore: 78, checklistScoreDate: '2026-11-07',
    capabilities: { parcel: V, wells: V, soil: V, terrain: P, flood: V, wetlands: V, utilities: V, assessment: V, tax: N, zoning: V, zoningRules: V }
  }
};

const byKey = Object.fromEntries(COUNTY_COVERAGE.map(c => [c.key, c]));

for (const [key, want] of Object.entries(EXPECTED)) {
  test(`${key} matches its ${want.checklistScoreDate} audit`, () => {
    const county = byKey[key];
    assert.ok(county, `${key} is in the registry`);
    assert.equal(county.level, want.level);
    assert.equal(county.priority, want.priority);
    assert.equal(county.lastValidated, want.lastValidated);
    assert.equal(county.checklistScore, want.checklistScore);
    assert.equal(county.checklistScoreDate, want.checklistScoreDate);
    assert.deepEqual(county.capabilities, want.capabilities);
    assert.ok(county.notes.length > 0, 'has notes');
  });
}

test('no county claims level 3 yet (needs two consecutive clean runs plus owner sign-off)', () => {
  assert.deepEqual(COUNTY_COVERAGE.filter(c => c.level >= 3).map(c => c.key), []);
});

test('Kootenai notes record the first clean run, not a level-3 claim', () => {
  assert.match(byKey['ID:Kootenai'].notes, /^First clean validation run 2026-11-03T23:25Z \(after the terrain fix\); level 3 needs a second consecutive clean run plus owner sign-off/);
});

test('Spokane notes name the WA validation tool run', () => {
  assert.match(byKey['WA:Spokane'].notes, /^Validated with the WA validation tool \(PR #36\) on 2026-11-03\./);
});

test('Stevens notes record the 2026-11-07 run and its sources', () => {
  const notes = byKey['WA:Stevens'].notes;
  assert.match(notes, /^Validation run 2026-11-07T07:42Z: 0 mismatches\./);
  assert.match(notes, /RealPropertyParcels_Public layer, with no tax amount/);
  assert.match(notes, /1998 digitized FEMA FIRM, because FEMA has no digital map/);
  assert.match(notes, /city layers and LAMIRD\/UGA/);
  assert.match(notes, /Terrain was intermittent/);
});

test('counties outside the audit carry no validated claims, date or score', () => {
  const allowed = new Set(Object.values(COVERAGE_STATUS));
  for (const county of COUNTY_COVERAGE) {
    for (const [layer, status] of Object.entries(county.capabilities)) assert.ok(allowed.has(status), `${county.key} ${layer}=${status}`);
    if (EXPECTED[county.key]) continue;
    assert.equal(county.level, 1, county.key);
    assert.equal(county.lastValidated, null, county.key);
    assert.equal(county.checklistScore, null, county.key);
    assert.ok(!Object.values(county.capabilities).includes(V), `${county.key} has no validated layer`);
  }
});

test('registry summary counts levels from the same data', () => {
  const { summary } = getCountyCoverageRegistry();
  assert.equal(summary.total, COUNTY_COVERAGE.length);
  assert.equal(summary.byLevel[2], 5);
  assert.equal(summary.byLevel[3], undefined);
  assert.equal(summary.byLevel[1], COUNTY_COVERAGE.length - 5);
});
