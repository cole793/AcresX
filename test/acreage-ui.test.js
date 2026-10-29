// Offline UI tests (node:vm, fake DOM in test/ui-harness.js): assessor vs mapped acreage in the
// overview (public/parcel-preview.js) and the report's Parcel Size and density warning
// (public/property-report-v2.js), via public/acreage.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOverview, renderReport, acresToSqm } from './ui-harness.js';

const NOTE = 'Assessor and mapped acreage differ; verify with the county.';
const square = { type: 'Polygon', coordinates: [[[-116.6, 47.3], [-116.59, 47.3], [-116.59, 47.31], [-116.6, 47.31], [-116.6, 47.3]]] };
const parcel = props => ({ type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '47N03W052200', _countyDisplay: 'Kootenai', ...props } });

// Assessor and mapped figures: close (10 vs 9.8), far apart (47N03W052200: 2.888 vs 1.977),
// mapped only (no ACRES), assessor only (outline area unavailable).
const cases = {
  close: { parcel: parcel({ ACRES: 10 }), mappedSqm: acresToSqm(9.8) },
  far: { parcel: parcel({ ACRES: 2.888 }), mappedSqm: acresToSqm(1.977409) },
  mappedOnly: { parcel: parcel({}), mappedSqm: acresToSqm(1.977409) },
  assessorOnly: { parcel: parcel({ ACRES: 2.888 }), mappedSqm: null }
};

test('overview: both acreages close -> both shown, no note', () => {
  assert.deepEqual(renderOverview(cases.close), { acres: '10.00', detail: '10.00 ac (assessor) · 9.80 ac mapped', note: '' });
});

test('overview: both acreages far apart -> both shown with the verify note', () => {
  assert.deepEqual(renderOverview(cases.far), { acres: '2.89', detail: '2.89 ac (assessor) · 1.98 ac mapped', note: NOTE });
});

test('overview: mapped only -> mapped acreage labeled as mapped, as before', () => {
  const sqft = Math.round(acresToSqm(1.977409) * 10.7639104167).toLocaleString();
  assert.deepEqual(renderOverview(cases.mappedOnly), { acres: '1.98', detail: `${sqft} sq ft · mapped area`, note: '' });
});

test('overview: assessor only -> assessor acreage labeled', () => {
  assert.deepEqual(renderOverview(cases.assessorOnly), { acres: '2.89', detail: '2.89 ac (assessor) · mapped area unavailable', note: '' });
});

test('overview: Montana cadastral TotalAcres counts as assessor acreage', () => {
  const result = renderOverview({ parcel: parcel({ TotalAcres: 20 }), mappedSqm: acresToSqm(19.9) });
  assert.equal(result.detail, '20.00 ac (assessor) · 19.90 ac mapped');
});

const parcelSize = html => /<span>Parcel Size<\/span><strong>([^<]*)<\/strong>(?:<small class="acreage-note">([^<]*)<\/small>)?/.exec(html).slice(1);
const densityNote = html => /Parcel area is ([^,]*), while the screening references/.exec(html)?.[1] ?? null;
const report = (c, density = '') => renderReport({ data: { parcel: c.parcel, wells: [], utility: [], zoningDevelopmentPotential: density ? { density } : undefined }, mappedSqm: c.mappedSqm });

test('report Parcel Size: both close / far apart / mapped only / assessor only', () => {
  assert.deepEqual(parcelSize(report(cases.close)), ['10.00 ac (assessor) · 9.80 ac mapped', undefined]);
  assert.deepEqual(parcelSize(report(cases.far)), ['2.89 ac (assessor) · 1.98 ac mapped', NOTE]);
  assert.deepEqual(parcelSize(report(cases.mappedOnly)), ['1.98 ac mapped', undefined]);
  assert.deepEqual(parcelSize(report(cases.assessorOnly)), ['2.89 ac (assessor)', undefined]);
});

test('report density warning uses assessor acres when present, else mapped', () => {
  const density = '1 dwelling per 10 acres';
  // Assessor 10 ac (not under 10) wins over mapped 9.8 ac: no warning.
  assert.equal(densityNote(report(cases.close, density)), null);
  assert.equal(densityNote(report(cases.far, density)), '2.89 acres (assessor)');
  assert.equal(densityNote(report(cases.mappedOnly, density)), '1.98 acres (mapped)');
  assert.equal(densityNote(report(cases.assessorOnly, density)), '2.89 acres (assessor)');
});
