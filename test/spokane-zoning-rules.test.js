// Spokane County zoning rules are for unincorporated land only: a city zone code never gets them,
// on the server (src/services/zoning-rules.js) or in the browser (public/zoning-potential.js).
// Offline: no upstream requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { handleZoningRules } from '../src/services/zoning-rules.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const rules = body => handleZoningRules(new Request('https://acresx.test/api/zoning-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).then(r => r.json());

test('zoning rules: a city zone code never gets Spokane County rules, even when the letters match', async () => {
  // 'RC' is a Spokane County zone and a Spokane Valley zone (Regional Commercial in both).
  const county = await rules({ county: 'Spokane', zoneCode: 'RC', jurisdiction: 'Spokane County' });
  assert.equal(county.available, true);
  assert.equal(county.county, 'Spokane');
  // No jurisdiction sent (older clients): county rules as before.
  assert.equal((await rules({ county: 'Spokane', zoneCode: 'RC' })).available, true);
  // 'Spokane' is what the legacy fallback route names the City of Spokane.
  for (const jurisdiction of ['City of Spokane Valley', 'City of Spokane', 'Spokane', 'Town of Rockford']) {
    const city = await rules({ county: 'Spokane', zoneCode: 'RC', jurisdiction });
    assert.equal(city.available, false, jurisdiction);
    assert.equal(city.status, 'zone_not_mapped');
    assert.match(city.note, /City zoning rules aren't mapped/);
  }
});

test('public/zoning-potential.js does not ask for Spokane County rules for a city zone', async () => {
  const source = readFileSync(new URL('../public/zoning-potential.js', import.meta.url), 'utf8');
  const run = zoningPermits => {
    const requests = [];
    const context = {
      last: { zoningPermits, parcel: { properties: { _countyDisplay: 'Spokane' } } },
      renderSummary() {}, activeTab: 'summary',
      fetch: async (url, init) => { requests.push(JSON.parse(init.body)); return json({ available: false }); },
      document: { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    context.renderSummary();
    return new Promise(resolve => setImmediate(() => resolve(requests)));
  };
  assert.deepEqual(await run({ county: 'Spokane', jurisdiction: 'City of Spokane Valley', zoning: { status: 'gis_match', code: 'RC', jurisdictionType: 'city' } }), []);
  assert.deepEqual(await run({ county: 'Spokane', jurisdiction: 'Spokane', zoning: { status: 'gis_match', code: 'RC' } }), [], 'legacy city name');
  const county = await run({ county: 'Spokane', jurisdiction: 'Spokane County', zoning: { status: 'gis_match', code: 'RC' } });
  assert.equal(county.length, 1);
  assert.equal(county[0].zoneCode, 'RC');
});
