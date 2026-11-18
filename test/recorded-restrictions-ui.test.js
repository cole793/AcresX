// Offline tests for the "Recorded restrictions" card and details (public/recorded-restrictions.js)
// and the report section (public/property-report-v2.js page 3, saved snapshots). The scripts run
// in node:vm with the fake DOMs from test/ui-harness.js; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TITLE_LINE, PLATTED_NOTE, NOT_CHECKED_NOTE } from '../src/services/recorded-restrictions.js';
import { makeLazyContext, makeContext, makeClock, makeFetch, readPublic } from './ui-harness.js';

const square = (lon, lat, d = 0.002) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
const polygon = ring => ({ type: 'Polygon', coordinates: [ring] });
const YC_RING = square(-108.5450, 45.7020);

// ---- Browser: card / details model

const ANSWER_YC = {
  available: true, state: 'MT', county: 'Yellowstone', parcelId: '03092732390050000', status: 'found', matchedOn: 'parcel_outline',
  plat: { status: 'platted', kind: 'subdivision', label: 'Platted subdivision', name: 'HARVEY SUBD', block: '1', lot: '5A', amended: 'AM B:1 L:1A & 5',
    propertyCard: { label: 'Montana Cadastral property record', url: 'https://svc.mt.gov/msl/cadastral/?page=PropertyDetails&geocode=03092732390050000' }, source: { name: 'Montana Cadastral', url: 'https://svc.mt.gov/msl/cadastral/' }, matchedBy: 'parcel_id' },
  agreements: null,
  conservationEasements: { status: 'none', items: [] },
  recorder: { label: 'Yellowstone County Clerk & Recorder document search', url: 'https://crdocs.yellowstonecountymt.gov/recorder/web/' },
  title: TITLE_LINE, notes: [PLATTED_NOTE, NOT_CHECKED_NOTE],
  sources: [{ key: 'mt-cadastral', name: 'Montana Cadastral', status: 'ok' }, { key: 'padus', name: 'PAD-US 4.1 conservation easements (USGS, 2025)', status: 'ok' }], asOf: '2026-11-18'
};
const PAGE_DATA = {
  costContext: { roadAccess: { available: true, status: 'found', distanceFt: 40, road: { name: 'Ranch Ln', public: false, ownership: 'unknown' }, nearestPublic: { road: { name: 'Main St' }, distanceFt: 1320 } } },
  powerIntelligence: { transmissionLine: { available: true, distanceFt: 0, voltageKv: 115 } },
  buildableArea: { mayAlsoRestrict: [{ key: 'buffer', reason: 'Mapped wetland buffers', acres: 1.24, pct: 5 }] },
  resoListings: { best: { status: 'Active', raw: { AssociationYN: true, AssociationFee: 300, AssociationFeeFrequency: 'Annually' } } }
};

function browser(data) {
  const h = makeLazyContext({ last: data });
  h.context.URL = URL;
  h.run(readPublic('recorded-restrictions.js'));
  return h.context.AcresXRestrictions;
}

test('card model: plat headline and lines, flags from data already loaded, the listing HOA as unverified, links only on known hosts', () => {
  const R = browser({ ...PAGE_DATA, recordedRestrictions: ANSWER_YC });
  const d = JSON.parse(JSON.stringify(R.describe({ ...ANSWER_YC, recorder: { ...ANSWER_YC.recorder }, plat: { ...ANSWER_YC.plat, imageLinks: [{ label: 'x', url: 'https://evil.example/a.jpg' }] } }, PAGE_DATA)));
  assert.equal(d.metric, 'Platted');
  assert.equal(d.headline, 'Platted subdivision: Harvey Subd');
  assert.deepEqual(d.platLines, ['Block 1 · Lot 5A', 'Amended plat: AM B:1 L:1A & 5']);
  assert.deepEqual(d.flags.map(f => f.title), ['Road status not mapped', 'Transmission line crosses the parcel', 'Mapped wetland buffer']);
  assert.match(d.flags[0].detail, /Main St at 1,320 ft/);
  assert.equal(d.hoa, 'Listing says HOA: yes, fee $300 annually (unverified)');
  assert.deepEqual(d.links.map(l => new URL(l.url).hostname), ['crdocs.yellowstonecountymt.gov', 'svc.mt.gov']);
  assert.equal(d.title, TITLE_LINE);
  assert.ok(d.notes.includes(PLATTED_NOTE));
  assert.equal(d.easementLine, 'No conservation easement mapped (PAD-US 4.1; not proof there is none)');
  const html = R.detailHtml({ ...ANSWER_YC, plat: { ...ANSWER_YC.plat, name: '<img src=x onerror=alert(1)>' } }, PAGE_DATA);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Order a preliminary title report/);
  assert.match(html, /Listing says HOA: yes/);
});

test('card model: no answer yet still points to the recorder search and a title report', () => {
  const R = browser({});
  assert.match(R.detailHtml(null, {}), /preliminary title report/);
  assert.equal(R.hoa({ resoListings: { best: { status: 'Active' } } }), null);
  assert.equal(R.flags({}).length, 0);
});

// ---- Report page 3 and the snapshot

const REPORT_MODULES = ['report-branding.js', 'flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'buildable-area.js', 'recorded-restrictions.js', 'property-report-v2.js'];
const reportFixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
function reportContext(data) {
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: data });
  h.context.URL = URL;
  const store = new Map();
  h.context.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  for (const f of REPORT_MODULES) h.run(readPublic(f));
  h.context.__acresxLast = data;
  return h;
}
const plain = html => html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

test('report page 3: "Recorded restrictions" section with the plat, flags, HOA claim and title line; saved snapshots render it too; the score is unchanged', () => {
  const data = { ...reportFixture(), ...PAGE_DATA, costContext: { ...(reportFixture().costContext || {}), ...PAGE_DATA.costContext }, recordedRestrictions: ANSWER_YC };
  const h = reportContext(data);
  const R = h.context.AcresXReport;
  const model = R.buildModel('x', data);
  const html = R.renderHtml(model, { brand: null });
  const page3 = html.split('<section class="page ')[3];
  assert.match(page3, /^p3"/);
  const t = plain(page3);
  assert.match(t, /Recorded restrictions/);
  assert.match(t, /Platted subdivision: Harvey Subd/);
  assert.match(t, /Block 1 · Lot 5A/);
  assert.match(t, /Transmission line crosses the parcel/);
  assert.match(t, /Listing says HOA: yes, fee \$300 annually \(unverified\)/);
  assert.match(t, /Order a preliminary title report — it lists recorded easements, covenants \(CC&Rs\) and HOA\./);
  assert.match(t, /Platted subdivision: likely has recorded covenants \(CC&Rs\) and plat easements; review the plat and covenants\./);
  assert.match(t, /crdocs\.yellowstonecountymt\.gov/);

  const snap = R.snapshot(model);
  assert.equal(snap.data.recordedRestrictions.plat.name, 'HARVEY SUBD');
  assert.equal(snap.f.restrictions.headline, 'Platted subdivision: Harvey Subd');
  const fromSnap = plain(R.renderHtml(JSON.parse(JSON.stringify(snap)), { brand: null }).split('<section class="page ')[3]);
  assert.match(fromSnap, /Platted subdivision: Harvey Subd/);
  assert.match(fromSnap, /Order a preliminary title report/);

  const without = { ...data };
  delete without.recordedRestrictions;
  const modelWithout = R.buildModel('x', without);
  assert.deepEqual(modelWithout.score, model.score, 'recorded restrictions never change the score');
  assert.match(plain(R.renderHtml(modelWithout, { brand: null }).split('<section class="page ')[3]), /Recorded restrictions were not checked when this report was generated/);
});

test('the new frontend module is injected, before browser-fallback.js', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const list = source.match(/for\(const s of \[([^\]]+)\]\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.ok(list.includes('recorded-restrictions'));
  assert.equal(list.at(-1), 'browser-fallback');
});

test('dashboard: after the summary renders, the card is added to Zoning & Permits, the parcel outline is sent once per search, and the answer fills the card', async () => {
  const clock = makeClock();
  const { fetch, calls } = makeFetch(clock, { '/api/recorded-restrictions': { body: ANSWER_YC, delay: 50 } });
  const parcel = { type: 'Feature', properties: {}, geometry: polygon(YC_RING) };
  const claims = new Set();
  const sections = { searchId: 1, claim: k => (claims.has(k) ? false : (claims.add(k), true)), settle() {}, isCurrent: () => true, placeholder: () => null };
  const h = makeContext({
    clock, fetch,
    body: [['section', { class: 'dashboard-section' }, '', [['div', { class: 'zoning-grid' }]]], ['select', { id: 'state' }], ['select', { id: 'county' }], ['input', { id: 'parcel' }], ['div', { id: 'results' }], ['h3', { id: 'resultsTitle' }]],
    extra: { AcresXSections: sections }
  });
  h.document.getElementById('state').value = 'MT';
  h.document.getElementById('county').value = 'Yellowstone';
  h.document.getElementById('parcel').value = '03092732390050000';
  h.run('var last = null; var activeTab = "zoning"; function renderSummary() {} function renderResults() {}');
  h.ctx.last = { parcel };
  h.run(readPublic('recorded-restrictions.js'));
  h.run('renderSummary(); renderSummary();');
  await clock.advance(20);
  assert.equal(h.document.getElementById('restrictionsMetric').textContent, 'Checking…');
  await clock.advance(100);
  assert.equal(calls.length, 1, 'one request per search');
  assert.deepEqual(calls[0].body.geometry, parcel.geometry);
  assert.equal(calls[0].body.parcelId, '03092732390050000');
  assert.equal(h.document.querySelector('.snapshot-card[data-detail="restrictions"]').dataset.detail, 'restrictions');
  assert.equal(h.document.getElementById('restrictionsMetric').textContent, 'Platted');
  assert.match(h.document.getElementById('restrictionsNote').textContent, /Harvey Subd/);
  assert.equal(h.ctx.last.recordedRestrictions.plat.name, 'HARVEY SUBD');
  h.run('activeTab = "restrictions"; renderResults();');
  assert.equal(h.document.getElementById('resultsTitle').textContent, 'Recorded restrictions');
  assert.match(h.document.getElementById('results').innerHTML, /Order a preliminary title report/);
});
