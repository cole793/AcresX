// City zoning backup layer (src/counties/spokane-cities.js `backupLayer`, queryCityZoningShares):
// when the City of Spokane Valley's own server fails, the older ArcGIS Online copy is asked once
// and its zone is labelled "older copy (2024), verify with the city" and never cached.
// Offline: globalThis.fetch is stubbed. test/fixtures/spokane-zoning-35234.0602.json was recorded
// live (read-only) on 2026-11-13 while arcgis.spokanevalley.org answered HTTP 500 on every path.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureUpstream } from '../src/shared/upstream.js';
import { configureLayerMoves } from '../src/shared/arcgis-layer-move.js';
import { getSpokaneCountyIntelligence } from '../src/counties/spokane.js';
import { configureCityZoningLog } from '../src/counties/spokane-cities.js';
import { getZoningProfile } from '../src/zoning-counties.js';
import { interpretLayer, compareExpected } from '../scripts/validate-county.mjs';

const profile = getZoningProfile('Spokane');
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const realWarn = console.warn;
let calls, restoreUpstream, restoreMoves, restoreLog, store, logs;

const PRIMARY = 'https://arcgis.spokanevalley.org/arcgis/rest/services/ViewerV3/LandUse/MapServer/1';
const BACKUP = 'https://services2.arcgis.com/hYnqO6a7TkujNqEg/arcgis/rest/services/City_of_Spokane_Valley___Zoning_Map_WFL1/FeatureServer/0';
const PRIMARY_Q = /arcgis\.spokanevalley\.org\/arcgis\/rest\/services\/ViewerV3\/LandUse\/MapServer\/1\/query$/;
const BACKUP_Q = /services2\.arcgis\.com\/hYnqO6a7TkujNqEg\/arcgis\/rest\/services\/City_of_Spokane_Valley___Zoning_Map_WFL1\/FeatureServer\/0\/query$/;
const NOTE = "City of Spokane Valley's zoning server did not answer; this zone comes from an older copy (2024). Verify with the city.";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fixture = id => JSON.parse(readFileSync(new URL(`./fixtures/spokane-zoning-${id}.json`, import.meta.url), 'utf8'));
const bodyOf = fx => ({ county: 'Spokane', ...fx.parcel });
const pathOf = url => `${url.hostname}${url.pathname}`;
const VALLEY = fixture('35234.0602');
// The recorded "Application Error" page the city's server answered on 2026-11-13.
const applicationError = () => new Response(VALLEY.primaryDown.body, { status: VALLEY.primaryDown.status, headers: { 'Content-Type': 'text/html' } });

const COMP = { features: [{ attributes: { LANDUSECODE: 'CITY', LANDUSEDESC: 'City' } }] };
const PERMITS = { features: [{ attributes: { PERMITNUM: 'B-1', PERMITTYPE: 'Residential', STATUS: 'Final', ADDRESS: '1 TEST ST' } }] };

// Recorded answers by host+path; `override` (path regex -> Response factory) runs first. The
// 35234.0602 fixture has no primary answer (the server was down), so its primary defaults to the
// recorded 500 page. Anything else unrecorded is an unexpected request (a network error).
function stub(fx, override = []) {
  calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push({ url, init });
    const key = pathOf(url);
    for (const [re, make] of override) if (re.test(key)) return make(url);
    if (fx.responses[key]) return json(fx.responses[key]);
    if (fx === VALLEY && PRIMARY_Q.test(key)) return applicationError();
    if (/CriticalAreasBPPublic\/MapServer\/\d+\/query|ZoningLookup\/MapServer\/[01]\/query/.test(key)) return json({ features: [] });
    if (/ZoningLookup\/MapServer\/4\/query/.test(key)) return json(COMP);
    if (/ZoningLookup\/MapServer\/2\/query/.test(key)) return json({ features: [] });
    if (/BPPublic\/MapServer\/5\/query/.test(key)) return json(PERMITS);
    throw new Error(`unexpected request ${key}`);
  };
}
const asked = re => calls.filter(c => re.test(pathOf(c.url)));

function fakeCache() {
  const map = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = map.get(req.url); return hit ? new Response(hit) : undefined; },
    async put(req, res) { map.set(req.url, await res.text()); }
  } };
  return map;
}

beforeEach(() => {
  store = fakeCache(); logs = []; console.warn = () => {};
  restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} });
  restoreMoves = configureLayerMoves({ log: line => logs.push(JSON.parse(line)) });
  restoreLog = configureCityZoningLog(line => logs.push(JSON.parse(line)));
});
afterEach(() => {
  globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream(); restoreMoves(); restoreLog();
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

function assertExtras(result) {
  assert.equal(result.available, true);
  assert.equal(result.comprehensivePlan.code, 'CITY');
  assert.equal(result.permitHistoryStatus, 'found');
  assert.ok(Array.isArray(result.permits) && result.permits.length);
}

// The "unavailable" answer exactly as it was before the backup existed.
function assertTodayUnavailable(z, message) {
  assert.deepEqual(Object.keys(z).sort(), ['code', 'error', 'jurisdictionType', 'label', 'name', 'note', 'sourceUrl', 'status', 'url', 'urlLabel']);
  assert.equal(z.status, 'unavailable');
  assert.equal(z.code, null);
  assert.equal(z.label, 'City of Spokane Valley zoning lookup unavailable');
  assert.equal(z.note, `This parcel is inside City of Spokane Valley limits, so City of Spokane Valley zoning applies, not Spokane County zoning. The City of Spokane Valley zoning map did not answer (${message}); check with the city.`);
  assert.equal(z.sourceUrl, PRIMARY);
  assert.equal(z.error, message);
}

test('primary 500 (35234.0602, recorded 2026-11-13): the backup copy answers R-3, labelled older copy (2024)', async () => {
  stub(VALLEY);
  const result = await getSpokaneCountyIntelligence(bodyOf(VALLEY), profile);
  assert.equal(result.jurisdiction, 'City of Spokane Valley');
  const z = result.zoning;
  assert.equal(z.status, 'gis_match');
  assert.equal(z.code, 'R-3');
  assert.equal(z.name, 'Single-Family Residential');
  assert.equal(z.source, 'backup');
  assert.equal(z.sourceAsOf, '2024-05-22');
  assert.equal(z.sourceNote, 'older copy (2024), verify with the city');
  assert.equal(z.label, 'City of Spokane Valley zoning – older copy (2024), verify with the city');
  assert.ok(z.note.startsWith(NOTE), z.note);
  assert.match(z.note, /City zoning applies inside city limits, not Spokane County zoning/);
  assert.equal(z.sourceUrl, BACKUP);
  assert.equal(z.primarySourceUrl, PRIMARY);
  assert.equal(z.primaryError, 'City of Spokane Valley GIS returned 500');
  assert.equal(z.sourceField, 'Zoning');
  assert.equal(z.rules, 'not_mapped');
  assert.equal(z.jurisdictionType, 'city');
  assert.equal(asked(PRIMARY_Q).length, 2, 'the primary is asked with its usual one retry');
  assert.equal(asked(BACKUP_Q).length, 1, 'the backup is asked once');
  const params = new URLSearchParams(asked(BACKUP_Q)[0].init?.body || asked(BACKUP_Q)[0].url.search);
  assert.equal(params.get('outFields'), 'Zoning,Zoning_Desg');
  assert.equal(params.get('geometryType'), 'esriGeometryPolygon');
  assert.deepEqual(logs.map(l => l.evt), ['zoning-backup-used']);
  assertExtras(result);
  assert.equal(store.size, 0, 'a backup answer is not cached');
});

test('backup answers are never cached: the next request asks the city server again', async () => {
  stub(VALLEY);
  await getSpokaneCountyIntelligence(bodyOf(VALLEY), profile);
  assert.equal(store.size, 0);
  // The city's server is back (answering with the same zone): the second request must reach it.
  const backupBody = Object.entries(VALLEY.responses).find(([k]) => BACKUP_Q.test(k))[1];
  stub(VALLEY, [[PRIMARY_Q, () => json(backupBody)]]);
  const again = await getSpokaneCountyIntelligence(bodyOf(VALLEY), profile);
  assert.equal(asked(PRIMARY_Q).length, 1, 'not served from cache');
  assert.equal(asked(BACKUP_Q).length, 0);
  assert.equal(again.zoning.code, 'R-3');
  assert.equal(again.zoning.source, undefined, 'a primary answer has no source field (shape unchanged)');
  assert.equal(again.zoning.sourceUrl, PRIMARY);
  assert.match(again.zoning.note, /^Mapped from the City of Spokane Valley official zoning map\./);
  assert.equal(store.size, 1, 'the full primary answer is cached');
});

test('primary OK (45012.1111): the backup is never queried and the answer is unchanged', async () => {
  const fx = fixture('45012.1111');
  stub(fx);
  const result = await getSpokaneCountyIntelligence(bodyOf(fx), profile);
  const z = result.zoning;
  assert.equal(z.status, 'gis_match');
  assert.equal(z.code, 'R-3');
  assert.equal(z.label, 'City of Spokane Valley zoning');
  assert.equal(z.sourceUrl, PRIMARY);
  for (const key of ['source', 'sourceAsOf', 'sourceNote', 'primarySourceUrl', 'primaryError']) assert.equal(key in z, false, key);
  assert.equal(asked(BACKUP_Q).length, 0, 'backup not asked');
  assert.equal(asked(/services2\.arcgis\.com/).length, 0);
  assert.deepEqual(logs, []);
  assert.equal(store.size, 1);
});

test('both fail: today\'s "unavailable" answer, unchanged, and nothing cached', async () => {
  stub(VALLEY, [[BACKUP_Q, () => new Response('down', { status: 503 })]]);
  const result = await getSpokaneCountyIntelligence(bodyOf(VALLEY), profile);
  assertTodayUnavailable(result.zoning, 'City of Spokane Valley GIS returned 500');
  assert.equal(asked(BACKUP_Q).length, 1, 'the backup is asked once, with no retry');
  assert.equal(logs[0].evt, 'zoning-backup-failed');
  assertExtras(result);
  assert.equal(store.size, 0);
});

test('a backup that maps no zone on the parcel is not used: today\'s "unavailable" answer', async () => {
  stub(VALLEY, [[BACKUP_Q, () => json({ features: [] })]]);
  const result = await getSpokaneCountyIntelligence(bodyOf(VALLEY), profile);
  assertTodayUnavailable(result.zoning, 'City of Spokane Valley GIS returned 500');
  assert.equal(logs[0].evt, 'zoning-backup-empty');
});

test('a primary timeout, network error or ArcGIS 500 error body also falls back to the backup', async () => {
  stub(VALLEY, [[PRIMARY_Q, () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }]]);
  const timeout = await getSpokaneCountyIntelligence(bodyOf(VALLEY), profile);
  assert.equal(timeout.zoning.source, 'backup');
  assert.match(timeout.zoning.primaryError, /timed out/);
  stub(VALLEY, [[PRIMARY_Q, () => { throw new TypeError('fetch failed'); }]]);
  const network = await getSpokaneCountyIntelligence(bodyOf(VALLEY), profile);
  assert.equal(network.zoning.source, 'backup');
  assert.equal(network.zoning.code, 'R-3');
  stub(VALLEY, [[PRIMARY_Q, () => json({ error: { code: 500, message: 'Error performing query operation' } })]]);
  const arcgis = await getSpokaneCountyIntelligence(bodyOf(VALLEY), profile);
  assert.equal(arcgis.zoning.source, 'backup');
  assert.equal(arcgis.zoning.primaryError, 'Error performing query operation');
});

test('a primary moved-layer error whose recovery fails falls back to the backup', async () => {
  stub(VALLEY, [
    [PRIMARY_Q, () => json({ error: { code: 400, message: 'Failed to execute query.' } })],
    // The layer-move recovery reads the service metadata: down too.
    [/ViewerV3\/LandUse\/MapServer$/, () => applicationError()]
  ]);
  const result = await getSpokaneCountyIntelligence(bodyOf(VALLEY), profile);
  assert.equal(result.zoning.source, 'backup');
  assert.equal(result.zoning.code, 'R-3');
  assert.deepEqual(logs.map(l => l.evt), ['layer-move-check-failed', 'zoning-backup-used']);
});

test('validator: a backup zone is ok, with zoning.source "backup" in values and detail', () => {
  const res = data => ({ route: '/api/zoning-permits', ok: true, httpStatus: 200, ms: 5, data });
  const backup = interpretLayer('zoning', res({ available: true, county: 'Spokane', jurisdiction: 'City of Spokane Valley', zoning: { status: 'gis_match', code: 'R-3', source: 'backup', sourceAsOf: '2024-05-22' } }));
  assert.equal(backup.status, 'ok');
  assert.equal(backup.values.source, 'backup');
  assert.equal(backup.values.sourceAsOf, '2024-05-22');
  assert.equal(backup.detail, 'R-3 (City of Spokane Valley) [backup: older copy as of 2024-05-22]');
  assert.deepEqual(compareExpected({ zoning: 'ok', 'zoning.code': 'R-3' }, { zoning: backup }), []);
  const primary = interpretLayer('zoning', res({ available: true, county: 'Spokane', jurisdiction: 'City of Spokane Valley', zoning: { status: 'gis_match', code: 'R-3' } }));
  assert.equal(primary.values.source, 'primary');
  assert.equal(primary.detail, 'R-3 (City of Spokane Valley)');
});
