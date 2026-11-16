// Offline tests: in Montana the permit cost line follows the city limits, not the zoning
// jurisdiction (2026-11-15). Yellowstone parcel 03092732390050000 is under the City of Billings
// zoning jurisdiction (Billings RR3, Zoning/MapServer/7) but outside the Billings city limits
// (Yellowstone/MapServer/30), so building permits are the state (DLI electrical + plumbing) and
// county approach permits, not City of Billings permits; Billings zoning still applies and is
// noted without a county zoning fee. The city-limits answer comes from /api/public-utilities
// (top-level cityLimits, src/services/public-utilities.js). Recorded live fixtures replay
// through a stubbed fetch; the browser scripts run in node:vm (test/ui-harness.js). No network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureUpstream } from '../src/shared/upstream.js';
import { lookupPublicUtilities, PUBLIC_UTILITIES_CACHE_PREFIX } from '../src/services/public-utilities.js';
import { YELLOWSTONE_CITY_LIMITS } from '../src/counties/yellowstone-utilities.js';
import { makeClock, makeContext, makeLazyContext, readPublic } from './ui-harness.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/public-utilities-${name}.json`, import.meta.url), 'utf8'));
let restore;
const realFetch = globalThis.fetch;
before(() => { restore = configureUpstream({ backoffMs: 0, log: () => {} }); });
after(() => { restore(); globalThis.fetch = realFetch; });
function replay(fx, failLayer) {
  globalThis.fetch = async input => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    const layer = `${u.origin}${u.pathname}`;
    if (layer === failLayer) return new Response('down', { status: 503 });
    const hit = fx.responses.find(r => r.url === layer);
    return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { 'Content-Type': 'application/json' } });
  };
}
const LIMITS_SOURCE = { name: 'Yellowstone County city limits (Billings, Laurel, Broadview)', url: YELLOWSTONE_CITY_LIMITS };

// ---- /api/public-utilities cityLimits

test('public-utilities answers carry the city-limits result: outside for 03092732390050000, inside Billings for 03103233201230000', async () => {
  let fx = fixture('yellowstone-03092732390050000');
  replay(fx);
  assert.deepEqual((await lookupPublicUtilities(fx.request)).cityLimits, { status: 'outside', source: LIMITS_SOURCE });
  fx = fixture('yellowstone-03103233201230000');
  replay(fx);
  assert.deepEqual((await lookupPublicUtilities(fx.request)).cityLimits, { status: 'inside', city: 'City of Billings', source: LIMITS_SOURCE });
  fx = fixture('yellowstone-03092732390050000');
  replay(fx, `${YELLOWSTONE_CITY_LIMITS}/query`);
  assert.equal((await lookupPublicUtilities(fx.request)).cityLimits.status, 'unknown', 'the city-limits layer did not answer');
  const none = await lookupPublicUtilities({ state: 'MT', county: 'Nowhere', lat: 45, lon: -108 });
  assert.equal(none.cityLimits, undefined, 'no city-limits layer configured');
  assert.match(PUBLIC_UTILITIES_CACHE_PREFIX, /\/v2\/$/, 'answers cached from the old Billings zoning-jurisdiction layer are not reused');
});

// ---- Cost model permit line

const square = { type: 'Polygon', coordinates: [[[-108.546, 45.7015], [-108.544, 45.7015], [-108.544, 45.7027], [-108.546, 45.7027], [-108.546, 45.7015]]] };
const NONE = { status: 'not_found', provider: null, basis: 'none found', source: null };
// The zoning answer production gives 03092732390050000 (src/counties/yellowstone.js, layer 7).
const BILLINGS_RR3 = { zoning: { status: 'gis_match', code: 'RR3', name: 'RR3 - Rural Residential 3 acres to 9.99 acres' }, jurisdiction: 'City of Billings', permitJurisdiction: { name: 'City of Billings' } };
function last({ cityLimits, zoningPermits = BILLINGS_RR3 } = {}) {
  return {
    parcel: { type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '03092732390050000', _countyDisplay: 'Yellowstone', _stateCode: 'MT' } },
    wells: [30, 32, 36].map((d, i) => ({ properties: { CompletedDepth: d, _distance: 0.2 + i * 0.1 } })), utility: ['YELLOWSTONE VALLEY ELEC CO-OP'],
    flood: { available: true, intersects: false, zones: [] }, wetlands: { available: true, intersects: false, count: 0 },
    zoningPermits, evidence: { status: 'none' },
    land: { soil: { available: true, feasibility: 'favorable' }, terrain: { available: true, gradePct: 2.8, reliefFt: 8 } },
    costContext: { roadAccess: { available: false, status: 'not_configured' }, watershed: { available: false, status: 'not_applicable' } },
    publicUtilities: { available: true, water: NONE, sewer: { ...NONE }, ...(cityLimits ? { cityLimits: { source: LIMITS_SOURCE, ...cityLimits } } : {}) }
  };
}
function estimate(l) {
  const page = makeContext({ body: [], clock: makeClock(), fetch: async () => { throw new Error('no network in tests'); }, autoIds: true });
  page.ctx.__last = l;
  page.run('var last = __last; var activeTab = ""; function renderSummary() {} function renderResults() {}', 'index-inline.js');
  for (const f of ['screening-inputs.js', 'score-cost.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js']) page.run(readPublic(f), f);
  return page.run('window.AcresXCostModel.estimate()');
}

// Yellowstone County (cost-tables.js): DLI electrical $200-$380 + DLI plumbing $247 + county
// approach $75 = $522-$702; + $77 zoning compliance only inside a county zoning district.
test('outside the Billings limits under Billings zoning: state + county permits, Billings zoning noted, no zoning fee', () => {
  const p = estimate(last({ cityLimits: { status: 'outside' } })).components.permits;
  assert.deepEqual([p.label, p.low, p.high, p.jurisdiction], ['Permits (state electrical, plumbing + approach)', 522, 702, 'Yellowstone County']);
  assert.match(p.basis, /Outside City of Billings limits on the county city-limits map, so City of Billings building permits do not apply\./);
  assert.match(p.basis, /City of Billings zoning applies \(RR3\); confirm any zoning permit with the City \(no fee added; the county zoning permit does not apply\)\./);
  assert.doesNotMatch(p.basis, /\$77/);
});

test('inside the Billings limits: the city generic permit range, as before', () => {
  const p = estimate(last({ cityLimits: { status: 'inside', city: 'City of Billings' } })).components.permits;
  assert.deepEqual([p.label, p.low, p.high, p.jurisdiction], ['Permits (building + approach)', 3000, 6000, 'City of Billings']);
});

test('city limits unknown or not loaded: the zoning permit jurisdiction decides, as before', () => {
  for (const cityLimits of [{ status: 'unknown' }, undefined]) {
    const p = estimate(last({ cityLimits })).components.permits;
    assert.deepEqual([p.low, p.high, p.jurisdiction], [3000, 6000, 'City of Billings'], JSON.stringify(cityLimits));
  }
});

test('county land in a county zoning district keeps the $77 zoning compliance permit; inside a city it switches to the city', () => {
  const D16 = { zoning: { status: 'gis_match', code: 'D16' }, jurisdiction: 'Yellowstone County', permitJurisdiction: { name: 'Yellowstone County' } };
  const p = estimate(last({ cityLimits: { status: 'outside' }, zoningPermits: D16 })).components.permits;
  assert.deepEqual([p.low, p.high], [522 + 77, 702 + 77]);
  assert.doesNotMatch(p.basis, /zoning applies; confirm/);
  const annexed = estimate(last({ cityLimits: { status: 'inside', city: 'City of Billings' }, zoningPermits: D16 })).components.permits;
  assert.deepEqual([annexed.low, annexed.high, annexed.jurisdiction], [3000, 6000, 'City of Billings']);
  assert.match(annexed.basis, /Inside City of Billings limits on the county city-limits map\./);
});

test('report page 3 prints the same permit line and total as the dashboard estimate', () => {
  const l = last({ cityLimits: { status: 'outside' } });
  const e = estimate(l);
  const h = makeLazyContext({ mappedSqm: 2.0 * 4046.86, last: l });
  for (const f of ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'buildable-area.js', 'property-report-v2.js']) h.run(readPublic(f));
  h.context.__acresxLast = l;
  h.generate();
  const text = h.opened.at(-1).replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
  const usd = n => `$${Math.round(n).toLocaleString('en-US')}`;
  assert.ok(text.includes(`Permits (state electrical, plumbing + approach)`), 'permit line label');
  assert.ok(text.includes(`${usd(e.components.permits.low)}–${usd(e.components.permits.high)}`), 'permit range');
  assert.ok(text.includes(`Total (matches page 1) ${usd(e.low)}–${usd(e.high)}`), 'total');
  assert.match(text, /Confirm with City of Billings that a home is allowed in RR3/, 'the zoning checklist still names the City (its zoning applies)');
});
