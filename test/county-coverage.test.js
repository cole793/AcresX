// Pins the county coverage registry (src/config/county-coverage.js) to the checklist audits and
// live validation runs of 2026-11-03 (Stevens: 2026-11-07; Kootenai and Yellowstone: level 3 from the
// 2026-11-09 to 11-11 daily runs plus the owner's 2026-11-12 sign-off). A change to a level, date, score or capability must change this
// test too, so it shows up in review instead of slipping in with an unrelated edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTY_COVERAGE, COVERAGE_STATUS, getCountyCoverageRegistry } from '../src/config/county-coverage.js';

const V = 'validated', P = 'partial', N = 'not_configured';

const EXPECTED = {
  'ID:Kootenai': {
    level: 3, priority: 1, lastValidated: '2026-11-11', checklistScore: 87, checklistScoreDate: '2026-11-03',
    capabilities: { parcel: V, wells: V, soil: V, terrain: V, flood: V, wetlands: V, utilities: V, assessment: V, tax: N, zoning: V, zoningRules: P }
  },
  'WA:Spokane': {
    level: 2, priority: 1, lastValidated: '2026-11-03', checklistScore: 79, checklistScoreDate: '2026-11-03',
    capabilities: { parcel: V, wells: V, soil: V, terrain: V, flood: V, wetlands: V, utilities: V, assessment: V, tax: N, zoning: V, zoningRules: P }
  },
  'MT:Yellowstone': {
    level: 3, priority: 1, lastValidated: '2026-11-11', checklistScore: 80, checklistScoreDate: '2026-11-03',
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
  test(`${key} matches its audit (score ${want.checklistScoreDate}, validated ${want.lastValidated})`, () => {
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

test('only Kootenai and Yellowstone claim level 3 (two consecutive clean runs plus owner sign-off)', () => {
  assert.deepEqual(COUNTY_COVERAGE.filter(c => c.level >= 3).map(c => c.key).sort(), ['ID:Kootenai', 'MT:Yellowstone']);
});

test('Kootenai notes record the clean runs and the owner sign-off', () => {
  const notes = byKey['ID:Kootenai'].notes;
  assert.match(notes, /^Level 3 \(checklist section 7\)/);
  assert.match(notes, /run 42716955430/);
  assert.match(notes, /run 42895735135/);
  assert.match(notes, /2026-11-11 \(run 43094606201/);
  assert.match(notes, /Owner signed off on 2026-11-12/);
  assert.match(notes, /0L8210010030/);
  assert.match(notes, /C72150030040/);
});

test('Yellowstone notes record the clean runs and the owner sign-off', () => {
  const notes = byKey['MT:Yellowstone'].notes;
  assert.match(notes, /^Level 3 \(checklist section 7\)/);
  assert.match(notes, /run 42716955430/);
  assert.match(notes, /run 42895735135/);
  assert.match(notes, /2026-11-11 \(run 43094606201/);
  assert.match(notes, /Owner signed off on 2026-11-12/);
  assert.match(notes, /03103233201230000/);
  assert.match(notes, /03072527101010000/);
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
  assert.equal(summary.byLevel[2], 3);
  assert.equal(summary.byLevel[3], 2);
  assert.equal(summary.byLevel[1], COUNTY_COVERAGE.length - 5);
});
