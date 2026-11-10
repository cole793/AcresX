// City of Cheney zoning after the city renumbered its service (2026-11-10), and the moved-layer
// recovery for the Spokane city zoning layers (src/shared/arcgis-layer-move.js, used by
// src/counties/spokane-cities.js).
// Offline: globalThis.fetch is stubbed. test/fixtures/spokane-zoning-13013.2211.json holds the
// live answers recorded read-only on 2026-11-10 for parcel 13013.2211 (3175 Pheasant St, Cheney):
// jurisdiction, county zoning, Cheney layer 4 "Zoning 2026" (R-1), layer 3 "PUD Overlay", the old
// layer-3 zoning query's 400 error, and the service and layer `?f=json` metadata.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureUpstream } from '../src/shared/upstream.js';
import { configureLayerMoves, looksLikeMovedLayer, splitLayerUrl, currentLayerUrl, queryWithLayerRecovery } from '../src/shared/arcgis-layer-move.js';
import { getSpokaneCountyIntelligence } from '../src/counties/spokane.js';
import { spokaneCityInfo } from '../src/counties/spokane-cities.js';
import { getZoningProfile } from '../src/zoning-counties.js';

const profile = getZoningProfile('Spokane');
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const realWarn = console.warn;
let calls, restoreUpstream, restoreMoves, logs, store;

const fx = JSON.parse(readFileSync(new URL('./fixtures/spokane-zoning-13013.2211.json', import.meta.url), 'utf8'));
const body = { county: 'Spokane', ...fx.parcel };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const pathOf = url => `${url.hostname}${url.pathname}`;

const SERVICE = 'https://services.arcgis.com/yP5WvH3YqutU0LDh/arcgis/rest/services/Cheney__WA___Zoning_Map___2025_WFL1/FeatureServer';
const SERVICE_KEY = SERVICE.replace('https://', '');
const LAYER3 = `${SERVICE}/3`, LAYER4 = `${SERVICE}/4`;
const COMP = { features: [{ attributes: { LANDUSECODE: 'CITY', LANDUSEDESC: 'City' } }] };
const PERMITS = { features: [{ attributes: { PERMITNUM: 'B-1', PERMITTYPE: 'Residential', STATUS: 'Final' } }] };

// Query params of a GET or form-POST request.
async function paramsOf(input, init) {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : '');
  const params = new URLSearchParams(url.search);
  for (const [k, v] of new URLSearchParams(typeof raw === 'string' ? raw : String(raw || ''))) params.set(k, v);
  return { url, params };
}

// Recorded answers: a Cheney layer-3 query asking for ZoneCODE (the old configuration) gets the
// live 400 error; with PUDCODE it gets the PUD answer. `metadata` maps host+path -> ?f=json body.
// `override` ([path regex, (params) -> Response]) is checked first.
function stub({ override = [], metadata = fx.metadata } = {}) {
  calls = [];
  globalThis.fetch = async (input, init) => {
    const { url, params } = await paramsOf(input, init);
    const key = pathOf(url);
    calls.push({ key, params });
    for (const [re, make] of override) if (re.test(key)) return make(params);
    if (key === `${SERVICE_KEY}/3/query` && /ZoneCODE/.test(params.get('outFields') || '')) return json(fx.oldLayerZoningQuery);
    if (fx.responses[key]) return json(fx.responses[key]);
    if (metadata[key]) return json(metadata[key]);
    if (/CriticalAreasBPPublic\/MapServer\/\d+\/query|ZoningLookup\/MapServer\/[01]\/query/.test(key)) return json({ features: [] });
    if (/ZoningLookup\/MapServer\/4\/query/.test(key)) return json(COMP);
    if (/ZoningLookup\/MapServer\/2\/query/.test(key)) return json({ features: [] });
    if (/BPPublic\/MapServer\/5\/query/.test(key)) return json(PERMITS);
    throw new Error(`unexpected request ${key}`);
  };
}
const asked = re => calls.filter(c => re.test(c.key));
const metadataCalls = () => calls.filter(c => c.key === SERVICE_KEY || /FeatureServer\/\d+$/.test(c.key));
const events = name => logs.map(line => JSON.parse(line)).filter(e => e.evt === name);

function fakeCache() {
  const map = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = map.get(req.url); return hit ? new Response(hit) : undefined; },
    async put(req, res) { map.set(req.url, await res.text()); }
  } };
  return map;
}

// Point the (shared) Cheney zoning config back at layer 3, as it was before the fix, for one test.
const cheneyZoning = spokaneCityInfo('Cheney').zoning;
const fixedUrl = cheneyZoning.url;
function configureOldLayer3() { cheneyZoning.url = LAYER3; }

beforeEach(() => {
  store = fakeCache(); logs = [];
  console.warn = () => {};
  restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} });
  restoreMoves = configureLayerMoves({ log: line => logs.push(line) });
});
afterEach(() => {
  globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream(); restoreMoves();
  cheneyZoning.url = fixedUrl;
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

function assertExtras(result) {
  assert.equal(result.available, true);
  assert.equal(result.comprehensivePlan.code, 'CITY');
  assert.equal(result.permitHistoryStatus, 'found');
}

test('Cheney parcel 13013.2211: zoning R-1 from layer 4 "Zoning 2026", PUD overlay listed, no metadata read', async () => {
  assert.equal(fixedUrl, LAYER4);
  stub();
  const result = await getSpokaneCountyIntelligence(body, profile);
  assert.equal(result.jurisdiction, 'City of Cheney');
  const z = result.zoning;
  assert.equal(z.status, 'gis_match');
  assert.equal(z.code, 'R-1');
  assert.equal(z.name, 'Single Family Residential');
  assert.equal(z.jurisdictionType, 'city');
  assert.equal(z.sourceUrl, LAYER4);
  assert.equal(z.sourceField, 'ZoneCODE');
  assert.match(z.note, /City of Cheney official zoning map/);
  assertExtras(result);
  // The PUD Overlay (layer 3) is an additive overlay entry, named with the underlying zone.
  const pud = result.overlays.filter(o => o.type === 'planned_unit_development');
  assert.equal(pud.length, 1);
  assert.equal(pud[0].name, 'Planned Unit Development overlay: PUD (R-1)');
  assert.equal(pud[0].sourceUrl, LAYER3);
  assert.ok(pud[0].share > 0.9, String(pud[0].share)); // recorded outlines: about 95% of the lot
  assert.match(pud[0].source, /City of Cheney/);
  assert.deepEqual(result.overlaysUnavailable, []);
  // Layer 4 asked for ZoneCODE,ZONE; layer 3 only for PUDCODE,ZONE; no metadata, no move logged.
  const zoningQuery = asked(/FeatureServer\/4\/query$/);
  assert.equal(zoningQuery.length, 1);
  assert.equal(zoningQuery[0].params.get('outFields'), 'ZoneCODE,ZONE');
  assert.deepEqual(asked(/FeatureServer\/3\/query$/).map(c => c.params.get('outFields')), ['PUDCODE,ZONE']);
  assert.equal(metadataCalls().length, 0);
  assert.equal(logs.length, 0);
  assert.equal(store.size, 1, 'a full answer is cached');
});

test('the recorded old layer-3 query is the live 400 "Invalid query parameters" error, which counts as a moved layer', () => {
  assert.equal(fx.oldLayerZoningQuery.error.code, 400);
  assert.equal(fx.oldLayerZoningQuery.error.message, 'Cannot perform query. Invalid query parameters.');
  assert.equal(looksLikeMovedLayer({ kind: 'arcgis', code: 400, message: fx.oldLayerZoningQuery.error.message }), true);
  assert.equal(looksLikeMovedLayer({ kind: 'arcgis', code: 400, message: 'Failed to execute query.' }), true);
  assert.equal(looksLikeMovedLayer({ kind: 'arcgis', code: 404, message: 'Layer not found' }), true);
  assert.equal(looksLikeMovedLayer({ kind: 'arcgis', code: 400, message: 'Invalid URL' }), true);
  assert.equal(looksLikeMovedLayer({ kind: 'http', status: 400, message: 'x returned 400' }), true);
  assert.equal(looksLikeMovedLayer({ kind: 'arcgis', code: 500, message: 'Error performing query operation' }), false);
  assert.equal(looksLikeMovedLayer({ kind: 'arcgis', code: 498, message: 'Invalid token.' }), false);
  assert.equal(looksLikeMovedLayer({ kind: 'http', status: 500 }), false);
  assert.equal(looksLikeMovedLayer({ kind: 'timeout', message: 'timed out' }), false);
  assert.deepEqual(splitLayerUrl(LAYER3), { service: SERVICE, id: 3 });
  assert.equal(splitLayerUrl('https://example.com/rest/services/x'), null);
});

test('moved layer: a layer-3 400 error, then the service metadata, then layer 4 answers R-1; the move is logged and remembered', async () => {
  configureOldLayer3();
  stub();
  const result = await getSpokaneCountyIntelligence(body, profile);
  const z = result.zoning;
  assert.equal(z.status, 'gis_match');
  assert.equal(z.code, 'R-1');
  assert.equal(z.name, 'Single Family Residential');
  assert.equal(z.sourceUrl, LAYER4, 'the source link is the layer that answered');
  assertExtras(result);
  // Order: old layer 3 zoning query (400, not retried), service ?f=json, layer 4 ?f=json, layer 4 query.
  const zoningCalls = calls.filter(c => c.key.startsWith(SERVICE_KEY) && !(c.key.endsWith('/3/query') && c.params.get('outFields') === 'PUDCODE,ZONE'));
  assert.deepEqual(zoningCalls.map(c => c.key.replace(SERVICE_KEY, '')), ['/3/query', '', '/4', '/4/query']);
  assert.equal(zoningCalls[1].params.get('f'), 'json');
  // Only "Zoning 2026" matches /zoning/i, so the PUD Overlay's metadata is never read.
  assert.equal(asked(/FeatureServer\/3$/).length, 0);
  const [moved] = events('layer-moved');
  assert.ok(moved, 'layer-moved logged');
  assert.equal(moved.label, 'cheney-zoning');
  assert.equal(moved.from, LAYER3);
  assert.equal(moved.to, LAYER4);
  assert.equal(moved.name, 'Zoning 2026');
  assert.match(moved.error, /Invalid query parameters/);
  assert.equal(currentLayerUrl(LAYER3), LAYER4);
  assert.equal(store.size, 1, 'the recovered answer is cached');

  // The next parcel in this isolate goes straight to layer 4: no layer-3 zoning query, no metadata.
  store.clear();
  stub();
  const again = await getSpokaneCountyIntelligence(body, profile);
  assert.equal(again.zoning.code, 'R-1');
  assert.equal(again.zoning.sourceUrl, LAYER4);
  assert.equal(asked(/FeatureServer\/3\/query$/).filter(c => /ZoneCODE/.test(c.params.get('outFields'))).length, 0);
  assert.equal(metadataCalls().length, 0);
  assert.equal(events('layer-moved').length, 1);
});

test('moved layer: the recovery works through queryWithLayerRecovery directly (layer 3 -> 4)', async () => {
  stub();
  const seen = [];
  const run = async url => {
    seen.push(url);
    const res = await fetch(`${url}/query?f=json&outFields=ZoneCODE,ZONE`);
    const data = await res.json();
    if (data.error) throw Object.assign(new Error(data.error.message), { kind: 'arcgis', code: data.error.code });
    return data.features.map(f => f.attributes.ZoneCODE);
  };
  const out = await queryWithLayerRecovery(LAYER3, run, { namePattern: /zoning/i, fields: ['ZoneCODE', 'ZONE'], agency: 'City of Cheney GIS', label: 'test' });
  assert.deepEqual(out, { layerUrl: LAYER4, value: ['R-1'] });
  assert.deepEqual(seen, [LAYER3, LAYER4]);
});

test('recovery that finds no matching layer fails cleanly: only city zoning is "unavailable" with the original error, nothing cached, no second metadata read', async () => {
  configureOldLayer3();
  // The service as if the zoning layer were gone (only the non-zoning layers are left).
  const metadata = { ...fx.metadata, [SERVICE_KEY]: { ...fx.metadata[SERVICE_KEY], layers: fx.metadata[SERVICE_KEY].layers.filter(l => !/zoning/i.test(l.name)) } };
  stub({ metadata });
  const result = await getSpokaneCountyIntelligence(body, profile);
  const z = result.zoning;
  assert.equal(z.status, 'unavailable');
  assert.equal(z.code, null);
  assert.equal(z.label, 'City of Cheney zoning lookup unavailable');
  assert.match(z.note, /City of Cheney zoning applies/);
  assert.match(z.error, /Cannot perform query\. Invalid query parameters\./);
  assert.equal(z.sourceUrl, LAYER3);
  assertExtras(result);
  assert.equal(result.overlays.filter(o => o.type === 'planned_unit_development').length, 1, 'the PUD overlay still answers');
  assert.equal(asked(/FeatureServer\/4/).length, 0, 'no layer 4 read');
  assert.equal(events('layer-move-not-found').length, 1);
  assert.equal(events('layer-moved').length, 0);
  assert.equal(store.size, 0, 'a degraded answer is not cached');
  // Within the recheck window the service is not asked again.
  stub({ metadata });
  const again = await getSpokaneCountyIntelligence(body, profile);
  assert.equal(again.zoning.status, 'unavailable');
  assert.equal(metadataCalls().length, 0);
});

test('recovery whose metadata read fails, or whose retry fails, degrades only city zoning', async () => {
  configureOldLayer3();
  stub({ override: [[new RegExp(`^${SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), () => new Response('down', { status: 503 })]] });
  const result = await getSpokaneCountyIntelligence(body, profile);
  assert.equal(result.zoning.status, 'unavailable');
  assert.match(result.zoning.error, /Invalid query parameters/);
  assertExtras(result);
  const [failed] = events('layer-move-check-failed');
  assert.ok(failed);
  assert.match(failed.metadataError, /returned 503/);
  assert.equal(asked(new RegExp(`^${SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)).length, 1, 'metadata read once, not retried');

  // A fresh isolate: the metadata answers, but the new layer fails too.
  restoreMoves(); restoreMoves = configureLayerMoves({ log: line => logs.push(line) });
  logs.length = 0;
  stub({ override: [[/FeatureServer\/4\/query$/, () => json({ error: { code: 500, message: 'Error performing query operation' } })]] });
  const second = await getSpokaneCountyIntelligence(body, profile);
  assert.equal(second.zoning.status, 'unavailable');
  assert.match(second.zoning.error, /Error performing query operation/);
  assert.equal(events('layer-move-retry-failed').length, 1);
  assert.equal(currentLayerUrl(LAYER3), LAYER3, 'a failed retry is not remembered');
  assertExtras(second);
});

test('recovery picks nothing when two layers match (ambiguous) and never runs for non-moved errors', async () => {
  configureOldLayer3();
  const twin = { ...fx.metadata[`${SERVICE_KEY}/4`], id: 5, name: 'Zoning 2026 copy' };
  const metadata = {
    ...fx.metadata,
    [SERVICE_KEY]: { ...fx.metadata[SERVICE_KEY], layers: [...fx.metadata[SERVICE_KEY].layers, { id: 5, name: 'Zoning 2026 copy', type: 'Feature Layer' }] },
    [`${SERVICE_KEY}/5`]: twin
  };
  stub({ metadata });
  const result = await getSpokaneCountyIntelligence(body, profile);
  assert.equal(result.zoning.status, 'unavailable');
  assert.equal(events('layer-move-not-found').length, 1);
  assert.equal(asked(/FeatureServer\/[45]\/query$/).length, 0);

  // A 500 from the (fixed) layer 4 is an outage, not a move: no metadata read.
  cheneyZoning.url = fixedUrl;
  restoreMoves(); restoreMoves = configureLayerMoves({ log: line => logs.push(line) });
  logs.length = 0;
  stub({ override: [[/FeatureServer\/4\/query$/, () => json({ error: { code: 500, message: 'Error performing query operation' } })]] });
  const outage = await getSpokaneCountyIntelligence(body, profile);
  assert.equal(outage.zoning.status, 'unavailable');
  assert.equal(metadataCalls().length, 0);
  assert.equal(logs.length, 0);
});

test('every Spokane city zoning layer has a layer-name pattern for the recovery, and Spokane Valley skips "Zoning Legacy"', () => {
  for (const name of ['Spokane', 'Spokane Valley', 'Cheney', 'Airway Heights', 'Liberty Lake']) {
    const z = spokaneCityInfo(name).zoning;
    assert.ok(z.layerName instanceof RegExp, name);
    assert.ok(splitLayerUrl(z.url), name);
  }
  const valley = spokaneCityInfo('Spokane Valley').zoning.layerName;
  assert.equal(valley.test('Zoning'), true);
  assert.equal(valley.test('Zoning Legacy'), false);
  assert.equal(spokaneCityInfo('Cheney').zoning.layerName.test('Zoning 2026'), true);
  assert.equal(spokaneCityInfo('Cheney').zoning.layerName.test('PUD Overlay'), false);
});
