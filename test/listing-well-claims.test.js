// Listing well claims (public/mls-description-scanner.js) and the well card headline.
// - The scanner's negative/future check and the well count used `\\b` inside regex literals, so
//   neither ever matched: "No well; buyer to drill" showed "Well reported" and "two wells" no count.
// - A recorded well on the parcel (/api/existing-well, public/existing-well.js) keeps the card
//   headline; the listing claim is a secondary, unverified line, whichever script ran first.
// Listing claims are unverified context and never change the score. Offline, node:vm fake DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, makeContext, makeFetch, readPublic } from './ui-harness.js';

const square = { type: 'Polygon', coordinates: [[[-108.2, 45.95], [-108.197, 45.95], [-108.197, 45.953], [-108.2, 45.953], [-108.2, 45.95]]] };
const RECORDED = { available: true, state: 'MT', status: 'strong_match', confidence: 'High', score: 65, summary: 'Recorded well on this parcel (GWIC #161578, 25 ft, 1994)',
  match: { source: 'gwic', gwicId: '161578', completedDepth: 25, completionYear: 1994, evidence: { onParcel: true, insideParcel: true } } };
const NEARBY = { available: true, state: 'MT', status: 'possible_match', confidence: 'Low', score: 30, summary: 'Possible well record near this parcel (low confidence)',
  match: { source: 'gwic', gwicId: '9', completedDepth: 180, evidence: { onParcel: false, insideParcel: false, nearParcel: true } } };
const LINE = 'Listing also reports an existing well (seller/broker statement, unverified)';

function page({ remarks, existingWell }) {
  const clock = makeClock();
  const { fetch, calls } = makeFetch(clock, { '/api/existing-well': { body: existingWell || { available: false, status: 'not_supported' } } });
  const h = makeContext({
    clock, fetch, extra: { console: { ...console, warn() {}, info() {} } },
    body: [['div', { id: 'state' }], ['div', { id: 'county' }], ['div', { id: 'results' }],
      ['button', { class: 'card snapshot-card', 'data-detail': 'wells' }, '', [
        ['div', { class: 'snapshot-top' }], ['div', { id: 'wellMetric' }, '30 ft'], ['div', { id: 'waterStatus' }, 'Median nearby well depth'], ['div', { id: 'wellNote' }],
        ['span', { class: 'snapshot-details-btn' }, 'Details']]]]
  });
  h.ctx.__last = {
    parcel: { type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '03000000000000000', _countyDisplay: 'Yellowstone', _stateCode: 'MT' } },
    wells: [], resoListings: remarks ? { best: { listingId: 'L1', publicRemarks: remarks } } : null
  };
  h.run('var last = __last; window.__acresxLast = last; var activeTab = "overview"; function renderSummary() {} function renderResults() {}', 'index-inline.js');
  const $ = id => h.document.getElementById(id);
  const card = () => h.document.querySelector('.snapshot-card[data-detail="wells"]');
  return {
    h, clock, calls,
    scanner: () => h.run(readPublic('mls-description-scanner.js'), 'mls-description-scanner.js'),
    existingWell: async () => { h.run(readPublic('existing-well.js'), 'existing-well.js'); h.run('renderSummary(last.parcel)'); await clock.advance(100); },
    tick: () => h.run('window.AcresXListingWell.refresh()'),
    metric: () => $('wellMetric').textContent,
    status: () => $('waterStatus').textContent,
    listingHeadline: () => card().classList.contains('mls-well-reported'),
    secondary: () => card().querySelectorAll('.mls-well-secondary').map(e => e.textContent)
  };
}

// ---- Phrases

function claims(remarks) {
  const p = page({});
  p.scanner();
  const out = p.h.run(`window.AcresXListingWell.claims(${JSON.stringify(remarks)})`);
  return out && { kind: out.kind, count: out.count };
}

test('positive phrasings: an existing well, with the count when the listing gives one', () => {
  assert.deepEqual(claims('Private well and septic in place. Fenced pasture.'), { kind: 'existing', count: null });
  assert.deepEqual(claims('Domestic well on property, drilled 2004.'), { kind: 'existing', count: null });
  assert.deepEqual(claims('Property has two wells and a shop.'), { kind: 'existing', count: 2 });
  assert.deepEqual(claims('Includes 3 wells for stock water.'), { kind: 'existing', count: 3 });
  assert.deepEqual(claims('One existing well serves the home.'), { kind: 'existing', count: 1 });
});

test('negative phrasings: no existing well is reported', () => {
  for (const remarks of ['No well on the property.', 'Bare land sold without a well.', 'No existing well; power at road.', 'Needs a well and septic.', 'A new well is required.']) {
    assert.equal(claims(remarks), null, remarks);
  }
});

test('future phrasings: a well to be drilled is not an existing well', () => {
  for (const remarks of ['Well to be drilled by buyer.', 'Well will be drilled before closing.', 'Buyer to drill well and install septic.', 'Proposed well site staked.', 'Drill a well and build your dream home.']) {
    assert.equal(claims(remarks), null, remarks);
  }
});

test('shared or community wells are reported as shared, never as this parcel\'s own well', () => {
  assert.deepEqual(claims('Shared well with the neighbor; agreement recorded.'), { kind: 'shared', count: null });
  assert.deepEqual(claims('Community well serves all lots.'), { kind: 'shared', count: null });
  assert.deepEqual(claims('Private well plus a shared well agreement.'), { kind: 'shared', count: null });
});

// ---- The card headline

test('listing only (no recorded well): the listing claim takes the headline, marked for verification', async () => {
  const p = page({ remarks: 'Private well and septic in place.', existingWell: NEARBY });
  p.scanner();
  await p.existingWell();
  p.tick();
  assert.equal(p.metric(), 'Well reported');
  assert.match(p.status(), /Matched listing reports existing well · Verify on property/);
  assert.equal(p.listingHeadline(), true);
  assert.deepEqual(p.secondary(), []);
});

test('a shared-well listing headline says so', () => {
  const p = page({ remarks: 'Shared well with neighbor.' });
  p.scanner();
  assert.equal(p.metric(), 'Shared well reported');
  assert.match(p.status(), /shared well · Verify agreement and location/);
});

test('a negative listing ("no well") leaves the card alone', () => {
  const p = page({ remarks: 'No well; buyer to drill.' });
  p.scanner();
  assert.equal(p.metric(), '30 ft');
  assert.equal(p.listingHeadline(), false);
});

for (const order of ['scanner first', 'existing well first']) {
  test(`recorded well on the parcel + listing claim (${order}): the recorded well keeps the headline, the claim is a secondary unverified line`, async () => {
    const p = page({ remarks: 'Private well and septic in place.', existingWell: RECORDED });
    if (order === 'scanner first') {
      p.scanner();
      assert.equal(p.metric(), 'Well reported', 'before the well answer arrives the listing shows');
      await p.existingWell();
    } else {
      await p.existingWell();
      p.scanner();
    }
    p.tick(); // the scanner's next poll changes nothing
    assert.equal(p.metric(), 'Existing well · 25 ft');
    assert.equal(p.status(), 'Well coordinates mapped within parcel · Verify record');
    assert.equal(p.listingHeadline(), false);
    assert.deepEqual(p.secondary(), [LINE]);
  });
}
