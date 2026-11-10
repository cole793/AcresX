// Offline check of the hand-checked expected values saved in validation/counties/kootenai.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareExpected } from '../scripts/validate-county.mjs';

const config = JSON.parse(readFileSync(new URL('../validation/counties/kootenai.json', import.meta.url), 'utf8'));

test('Kootenai has hand-checked zoning, flood and assessor class for at least 4 parcels', () => {
  const checked = config.parcels.filter(p => p.expected?.['zoning.code'] && typeof p.expected['flood.high'] === 'boolean' && p.expected['assessment.propertyClass']);
  assert.ok(checked.length >= 4, `${checked.length} parcels`);
  const byId = Object.fromEntries(config.parcels.map(p => [p.parcelId, p]));
  // Zone X/D are not expected: the Esri flood fallback holds high/moderate-risk zones only.
  assert.equal(byId['47N02W035500'].expected['flood.zones'], 'AE');
  for (const p of checked) if (p.expected['flood.zones']) assert.equal(p.expected['flood.high'], true, p.parcelId);
  assert.equal(byId.C72150030040.expected['zoning.code'], 'R-12');
  assert.equal(byId.C72150030040.expected['zoning.jurisdiction'], "City of Coeur d'Alene");
  assert.equal(byId['0L8210010030'].expected['zoning.code'], 'RURAL');
  for (const p of checked) assert.match(p.why, /map\.kcgov\.us\/arcgis\/rest\/services\/Assessor_Layers\/MapServer\/\d+\/query/);
  // Values from the 2026-11-01 live run match these expectations.
  const layers = {
    zoning: { status: 'ok', values: { code: 'R-12', jurisdiction: "City of Coeur d'Alene" } },
    flood: { status: 'ok', values: { high: false, zones: ['X'] } },
    assessment: { status: 'ok', values: { propertyClass: '541' } },
    // Live run of /api/public-utilities on 2026-11-09 (in-process Worker).
    publicUtilities: { status: 'ok', values: { water: 'served', waterProviders: ["City of Coeur d'Alene (CDA Water)", 'CDA Water'], sewer: 'served', sewerPublic: true } }
  };
  assert.deepEqual(compareExpected(byId.C72150030040.expected, layers), []);
});
