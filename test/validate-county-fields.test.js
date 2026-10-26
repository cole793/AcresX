// Offline tests for discovery field handling in scripts/validate-county.mjs: optional zoningField,
// dropping configured fields the layer probe didn't find, and recording the layer's field names.
// fetch is stubbed; nothing touches the network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildMarkdown, summarize, buildDiscoveryStrata, pickVaried, discoverParcels, probeLayer,
  resolveDiscoverFields, MAX_FIELD_NAMES_SHOWN
} from '../scripts/validate-county.mjs';

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; });
afterEach(() => { globalThis.fetch = realFetch; });

const tinyDiscover = { county: 'Testco', state: 'ID', discover: {
  layerUrl: 'https://gis.test/arcgis/rest/services/Parcels/MapServer/0', idField: 'PIN', acresField: 'Acres', zoningField: 'ZONING',
  cityField: 'Loc_City', addressField: 'Loc_Addr', cities: ['Athol'], acreBands: [{ label: 'any' }], perQuery: 5, delayMs: 0
} };

// Field list of the real Kootenai Ownership_Display layer as far as validation run 40389472214
// confirmed it: no ZONING.
const kootenaiLiveFields = ['OBJECTID', 'PIN', 'Acres', 'Loc_City', 'Loc_Addr'].map(name => ({ name }));

// A fake layer that, like ArcGIS, fails any query whose outFields or where names a field it lacks.
const SQL_WORDS = new Set(['AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'UPPER']);
function strictLayer(fieldList, { records = 4 } = {}) {
  const names = fieldList.map(f => f.name);
  const requests = [];
  const fetchImpl = async url => {
    const u = new URL(url), p = u.searchParams;
    requests.push(u);
    if (!u.pathname.endsWith('/query')) return new Response(JSON.stringify({ fields: fieldList }), { headers: { 'Content-Type': 'application/json' } });
    const whereWords = (p.get('where') || '').replace(/'(?:[^']|'')*'/g, '').match(/[A-Za-z_]\w*/g) || [];
    const used = [...(p.get('outFields') || '').split(',').filter(Boolean), ...whereWords.filter(w => !SQL_WORDS.has(w.toUpperCase()))];
    if (used.some(f => !names.includes(f))) return new Response(JSON.stringify({ error: { code: 400, message: 'Failed to execute query.', details: [] } }), { headers: { 'Content-Type': 'application/json' } });
    if (p.get('returnCountOnly')) return new Response(JSON.stringify({ count: 100 }));
    const n = requests.length;
    const value = (name, i) => name === 'Acres' || name === 'ACRES' ? 1 + i : name === 'Loc_City' ? ['Athol', 'Hayden', null, 'Post Falls'][i % 4] : `${name}-${n}-${i}`;
    const features = Array.from({ length: records }, (_, i) => ({ attributes: Object.fromEntries(names.map(name => [name, value(name, i)])) }));
    return new Response(JSON.stringify({ features }));
  };
  return { fetchImpl, requests };
}

const queriesWithFields = requests => requests.filter(u => u.pathname.endsWith('/query') && u.searchParams.get('outFields'));

function diagnosticsMarkdownFor(diagnostics) {
  return buildMarkdown({ county: 'Testco', state: 'ID', baseUrl: 'https://acresx.test', startedAt: 'now', discovered: true, discoveryDiagnostics: diagnostics, results: [], summary: summarize([]) });
}

test('the fake layer rejects unknown fields like the Kootenai server did', async () => {
  const { fetchImpl } = strictLayer(kootenaiLiveFields);
  const bad = await (await fetchImpl(`${tinyDiscover.discover.layerUrl}/query?f=json&where=PIN+IS+NOT+NULL&outFields=PIN,ZONING`)).json();
  assert.equal(bad.error.message, 'Failed to execute query.');
  const good = await (await fetchImpl(`${tinyDiscover.discover.layerUrl}/query?f=json&where=${encodeURIComponent("UPPER(Loc_City) IN ('COEUR D''ALENE')")}&outFields=PIN,Acres`)).json();
  assert.ok(Array.isArray(good.features));
});

test('Kootenai discovery without zoningField samples by acreage band x locality only', async () => {
  const config = JSON.parse(readFileSync(new URL('../validation/counties/kootenai.json', import.meta.url), 'utf8'));
  assert.equal('zoningField' in config.discover, false, 'the Kootenai parcel layer has no ZONING field');
  const { fetchImpl, requests } = strictLayer(kootenaiLiveFields);
  const { parcels, diagnostics } = await discoverParcels({ ...config, discover: { ...config.discover, delayMs: 0 } }, { count: 8, seed: 3, fetchImpl });
  assert.equal(diagnostics[0].ok, true);
  assert.deepEqual(diagnostics[0].fieldsChecked, ['PIN', 'Acres', 'Loc_City', 'Loc_Addr']);
  assert.equal(diagnostics[0].notes, undefined);
  assert.ok(diagnostics.every(x => x.ok), diagnostics.filter(x => !x.ok).map(x => `${x.step}: ${x.error}`).join('; '));
  assert.ok(!diagnostics.some(x => /zoning/i.test(x.step)), 'no distinct-zoning step');
  const withFields = queriesWithFields(requests);
  assert.equal(withFields.length, config.discover.acreBands.length * 2);
  for (const u of withFields) assert.equal(u.searchParams.get('outFields'), 'PIN,Acres,Loc_City,Loc_Addr');
  assert.equal(parcels.length, 8);
  assert.equal(new Set(parcels.map(p => p.countyAttributes.stratum)).size, 8, 'one pick per acreage band x locality stratum');
  for (const p of parcels) {
    assert.equal(p.countyAttributes.zoning, null);
    assert.doesNotMatch(p.label + p.why, /ZONING/);
  }
});

test('pickVaried with zoning off ignores zoning values', () => {
  const candidates = Array.from({ length: 12 }, (_, i) => ({ parcelId: `X${i}`, zoning: null, city: `C${i % 2}`, stratum: `S${i % 3}` }));
  const picked = pickVaried(candidates, 4, 5, { zoning: false });
  assert.equal(new Set(picked.slice(0, 3).map(p => p.countyAttributes.stratum)).size, 3);
  assert.ok(picked.every(p => !/ZONING/.test(p.label + p.why)));
  assert.match(pickVaried(candidates, 1, 5)[0].label, /ZONING blank/, 'zoning stays on by default');
});

test('discovery drops configured fields the probe did not find and notes it', async () => {
  // Configured with ZONING and Loc_Addr, but the layer has neither, and spells Acres as ACRES.
  const fields = ['OBJECTID', 'PIN', 'ACRES', 'Loc_City'].map(name => ({ name }));
  const { fetchImpl, requests } = strictLayer(fields, { records: 2 });
  const { parcels, diagnostics } = await discoverParcels(tinyDiscover, { count: 3, fetchImpl });
  const probe = diagnostics[0];
  assert.equal(probe.ok, false);
  assert.deepEqual(probe.missingFields, ['Acres (layer has ACRES)', 'ZONING', 'Loc_Addr']);
  assert.deepEqual(probe.notes, [
    'acresField Acres is ACRES on the layer; using ACRES',
    "zoningField ZONING is not on the layer; left out of this run's queries",
    "addressField Loc_Addr is not on the layer; left out of this run's queries"
  ]);
  assert.equal(probe.aborted, undefined);
  const withFields = queriesWithFields(requests);
  assert.ok(withFields.length > 0);
  for (const u of withFields) assert.equal(u.searchParams.get('outFields'), 'PIN,ACRES,Loc_City');
  assert.ok(!diagnostics.some(x => x.step === 'distinct-zoning'), 'zoning step skipped once ZONING is dropped');
  assert.ok(diagnostics.slice(1).every(x => x.ok), 'queries succeed after dropping the missing fields');
  assert.ok(parcels.length > 0);
  assert.ok(parcels.every(p => p.countyAttributes.zoning === null && p.countyAttributes.address === null && p.countyAttributes.acres != null));
  assert.match(diagnosticsMarkdownFor(diagnostics), /- Field check: zoningField ZONING is not on the layer; left out of this run's queries/);
});

test('a missing acres or city field is left out of the strata too', () => {
  const { discover: d, notes, abort } = resolveDiscoverFields(tinyDiscover.discover, ['PIN', 'ZONING', 'Loc_Addr']);
  assert.equal(abort, null);
  assert.equal(d.acresField, undefined);
  assert.equal(d.cityField, undefined);
  assert.equal(notes.length, 2);
  const strata = buildDiscoveryStrata({ ...d, acreBands: [{ label: 'small', max: 1 }, { label: 'big', min: 1 }] });
  assert.deepEqual(strata.map(s => s.id), ['any acreage | any locality']);
  assert.equal(strata[0].where, '');
  // Probe failed (no field list): the configured fields are used as they are.
  assert.deepEqual(resolveDiscoverFields(tinyDiscover.discover, null), { discover: tinyDiscover.discover, notes: [], abort: null });
});

test('discovery aborts with a diagnostics error when idField is missing', async () => {
  const fields = ['OBJECTID', 'PARCELNO', 'Acres', 'ZONING', 'Loc_City', 'Loc_Addr'].map(name => ({ name }));
  const { fetchImpl, requests } = strictLayer(fields);
  const { parcels, diagnostics } = await discoverParcels(tinyDiscover, { count: 3, fetchImpl });
  assert.deepEqual(parcels, []);
  assert.equal(requests.length, 1, 'only the probe is sent');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].ok, false);
  assert.equal(diagnostics[0].aborted, true);
  assert.equal(diagnostics[0].error, 'missing fields: PIN');
  assert.deepEqual(diagnostics[0].notes, ['discovery stopped: idField PIN is not on the layer, so no parcel ids can be sampled']);
  assert.match(diagnosticsMarkdownFor(diagnostics), /- Field check: discovery stopped: idField PIN is not on the layer/);
});

test('layer probe records the layer field names, truncated in the markdown', async () => {
  const many = Array.from({ length: 55 }, (_, i) => ({ name: `F${i}` }));
  const probe = await probeLayer(tinyDiscover.discover, { fetchImpl: async () => new Response(JSON.stringify({ fields: [{ name: 'PIN' }, ...many] })) });
  assert.equal(probe.fieldNames.length, 56);
  assert.deepEqual(probe.fieldNames.slice(0, 3), ['PIN', 'F0', 'F1']);
  const line = diagnosticsMarkdownFor([probe]).split('\n').find(l => l.startsWith('- Layer fields'));
  assert.equal(MAX_FIELD_NAMES_SHOWN, 40);
  assert.equal(line, `- Layer fields (56): PIN, ${many.slice(0, 39).map(f => f.name).join(', ')}, ... (+16 more, full list in the discovered JSON)`);

  const small = await probeLayer(tinyDiscover.discover, { fetchImpl: async () => new Response(JSON.stringify({ fields: kootenaiLiveFields })) });
  assert.match(diagnosticsMarkdownFor([small]), /^- Layer fields \(5\): OBJECTID, PIN, Acres, Loc_City, Loc_Addr$/m);

  const down = await probeLayer(tinyDiscover.discover, { fetchImpl: async () => new Response('nope', { status: 503 }) });
  assert.equal(down.fieldNames, null);
  assert.doesNotMatch(diagnosticsMarkdownFor([down]), /Layer fields/);
});
