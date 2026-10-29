// Listing/MLS claims are unverified context and must not affect the buildability score (CLAUDE.md).
// Runs renderSummary from public/index.html in node:vm (test/ui-harness.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScore } from './ui-harness.js';

const square = { type: 'Polygon', coordinates: [[[-116.6, 47.3], [-116.59, 47.3], [-116.59, 47.31], [-116.6, 47.31], [-116.6, 47.3]]] };
const parcel = props => ({ type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '47N03W052200', _countyDisplay: 'Kootenai', ...props } });

const scoreLast = evidence => ({
  parcel: parcel({}), wells: [{ properties: { CompletedDepth: 180, _distance: 0.2 } }], utility: ['Avista'],
  zoningPermits: {}, evidence, flood: { available: true, intersects: false, zones: [] },
  wetlands: { available: true, intersects: false, count: 0 },
  land: { soil: { available: true, feasibility: 'favorable' }, terrain: { available: true, gradePct: 4, reliefFt: 12 } }
});

test('buildability score is identical whether a listing is found, not found, or errored', () => {
  const found = renderScore({ last: scoreLast({ status: 'found', summary: 'Listing found', matchScore: 80, matches: [{}], claims: [] }) });
  const none = renderScore({ last: scoreLast({ status: 'none', searchedAddress: '1 Test Rd' }) });
  const error = renderScore({ last: scoreLast({ status: 'error', error: 'Listing search unavailable' }) });
  assert.match(found.score, /^\d+\.\d$/);
  assert.equal(none.score, found.score);
  assert.equal(error.score, found.score);
  // The listing display itself is unchanged and still differs by status.
  assert.equal(found.evidence, 'Listing found'); assert.equal(none.evidence, 'No reliable listing'); assert.equal(error.evidence, 'Not configured');
  assert.notEqual(found.listing, error.listing);
});
