// Offline smoke tests for the Worker. Network is stubbed to fail, so these check routing,
// response shapes and graceful degradation, not live county/government data.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import worker from '../src/index.js';

const publicDir = new URL('../public/', import.meta.url);
const indexHtml = readFileSync(new URL('index.html', publicDir), 'utf8');

const env = {
  ASSETS: { fetch: async () => new Response(indexHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) }
};
const ctx = { waitUntil() {} };

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; });
afterEach(() => { globalThis.fetch = realFetch; });

function post(path, body) {
  return new Request(`https://acresx.test${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}

async function call(request) {
  const response = await worker.fetch(request, env, ctx);
  assert.ok(response instanceof Response, 'handler must return a Response');
  return response;
}

test('homepage is served with injected frontend modules', async () => {
  const response = await call(new Request('https://acresx.test/'));
  assert.equal(response.status, 200);
  const html = await response.text();
  const injected = [...html.matchAll(/<script src="\/([\w-]+\.js)"><\/script>/g)].map(m => m[1]);
  assert.ok(injected.length > 0, 'expected injected scripts');
  for (const file of injected) assert.ok(existsSync(new URL(file, publicDir)), `public/${file} is injected but missing`);
});

test('every script referenced by index.html exists', () => {
  const local = [...indexHtml.matchAll(/<script src="\/?([\w-]+\.js)"/g)].map(m => m[1]);
  for (const file of local) assert.ok(existsSync(new URL(file, publicDir)), `public/${file} is referenced but missing`);
});

test('unknown API route returns JSON 404', async () => {
  const response = await call(post('/api/does-not-exist', {}));
  assert.equal(response.status, 404);
  assert.ok((await response.json()).error);
});

test('unsupported parcel-search state returns JSON 400', async () => {
  const response = await call(post('/api/parcel-search', { state: 'ZZ', county: 'Nowhere', parcelId: '1' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).available, false);
});

// Upstream outages must degrade to a JSON answer, never an exception or an HTML error page.
const point = { lat: 47.6588, lon: -117.426 };
const degradeCases = [
  ['/api/parcel-search', { state: 'MT', county: 'Yellowstone', parcelId: '03092727411010000' }],
  ['/api/parcel-search', { state: 'ID', county: 'Kootenai', parcelId: '0' }],
  ['/api/well-search', { state: 'MT', ...point }],
  ['/api/well-search', { state: 'ID', ...point }],
  ['/api/land-analysis', point],
  ['/api/slope-grid', point],
  ['/api/hazards', { kind: 'wetlands', ...point }],
  ['/api/power-intelligence', { state: 'WA', county: 'Spokane', ...point }],
  ['/api/utility-territory', { state: 'WA', county: 'Spokane', ...point }],
  ['/api/zoning-rules', { state: 'WA', county: 'Spokane', zone: 'R-5' }],
  ['/api/zoning-permits', { county: 'Spokane', ...point }],
  ['/api/zoning-permits', { county: 'Yellowstone', ...point }],
  ['/api/zoning-permits', { county: 'Gallatin', ...point }],
  ['/api/zoning-permits', { county: 'Kootenai', ...point }],
  ['/api/existing-well', { state: 'MT', ...point }],
  ['/api/property-assessment', { state: 'WA', county: 'Spokane', parcelId: '47174.9017' }]
];

for (const [path, body] of degradeCases) {
  test(`${path} ${JSON.stringify(body).slice(0, 60)} answers JSON when upstream is down`, async () => {
    const response = await call(post(path, body));
    assert.match(response.headers.get('Content-Type') || '', /application\/json/);
    assert.equal(typeof (await response.json()), 'object');
  });
}
