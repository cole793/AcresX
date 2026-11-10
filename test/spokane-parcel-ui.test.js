// Offline test of the browser parcel lookup for Spokane (public/state-selector.js window.findParcel):
// the county layer through /api/parcel-search first, the statewide WA lookup (findParcel in
// public/index.html, stubbed here) when that has no parcel. Runs in a node:vm context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeContext, makeClock, readPublic } from './ui-harness.js';

const countyParcel = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-117.1, 47.7], [-117.09, 47.7], [-117.09, 47.71], [-117.1, 47.7]]] }, properties: { ORIG_PARCEL_ID: '57344.0125', _countyDisplay: 'Spokane', ACRES: 0.35 } };

function page(answer) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    const a = typeof answer === 'function' ? answer() : answer;
    return { ok: (a.status || 200) < 400, status: a.status || 200, json: async () => a.body };
  };
  const h = makeContext({
    clock: makeClock(), fetch,
    body: [['form', { id: 'searchForm' }, '', [['select', { id: 'county' }], ['input', { id: 'parcel' }], ['button', { id: 'searchBtn' }]]]],
    extra: { Option: class { constructor(text, value) { this.text = text; this.value = value; } } }
  });
  const county = h.document.getElementById('county');
  county.options = [{ value: 'Spokane' }, { value: 'Stevens' }];
  county.add = option => county.options.push(option);
  // The statewide lookup from public/index.html.
  h.run(`var statewide = []; function findParcel(county, input) { statewide.push([county, input]); return Promise.resolve({ type: 'Feature', properties: { ORIG_PARCEL_ID: 'statewide' } }); }`);
  h.run(readPublic('state-selector.js'), 'state-selector.js');
  h.document.getElementById('state').value = 'WA';
  return { h, calls, statewide: () => h.ctx.statewide, find: (c, input) => h.ctx.window.findParcel(c, input) };
}

test('Spokane parcel search: the county layer answer is used, and the statewide layer is not asked', async () => {
  const p = page({ body: { available: true, state: 'WA', county: 'Spokane', parcel: countyParcel } });
  const parcel = await p.find('Spokane', ' 573440125 ');
  assert.equal(parcel.properties.ORIG_PARCEL_ID, '57344.0125');
  assert.deepEqual(p.calls, [{ url: '/api/parcel-search', body: { state: 'WA', county: 'Spokane', parcelId: '573440125' } }]);
  assert.equal(p.statewide().length, 0);
});

test('Spokane parcel search: a miss, an error answer, an HTTP failure or a network error falls back to the statewide lookup', async () => {
  const answers = [
    { body: { available: false, parcel: null, note: 'No match' } },
    { body: { available: false, parcel: null, error: 'Spokane County parcel layer timed out' } },
    { status: 502, body: { error: 'Request failed' } },
    { body: { available: true, parcel: { type: 'Feature', geometry: null, properties: {} } } }, // no outline
    () => { throw new TypeError('Failed to fetch'); }
  ];
  for (const answer of answers) {
    const p = page(answer);
    p.h.ctx.console = { ...console, warn() {} };
    const parcel = await p.find('Spokane', '35204-2729');
    assert.equal(parcel.properties.ORIG_PARCEL_ID, 'statewide');
    assert.deepEqual([...p.statewide()].map(x => [...x]), [['Spokane', '35204-2729']], 'the statewide lookup gets the input as typed');
  }
});

test('other WA counties go straight to the statewide lookup', async () => {
  const p = page(() => { throw new Error('must not be called'); });
  await p.find('Stevens', '0231200');
  assert.equal(p.calls.length, 0);
  assert.deepEqual([...p.statewide()].map(x => [...x]), [['Stevens', '0231200']]);
});
