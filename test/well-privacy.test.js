// Well records never reach the browser with an owner name or a street address (owner decision,
// 2026-10-29; well addresses 2026-11-18: a well's street address identifies its owner's home).
// The stubbed state services below answer with owner and address fields planted on every record,
// even ones AcresX does not ask for, for each state (WA Ecology, IDWR, MBMG GWIC), and the
// well routes' answers are checked for those fields and values. No network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { PERSONAL_FIELD, withoutPersonalFields } from '../src/shared/personal-fields.js';
import { TERRAIN_TILES_URL, clearTerrainTileMemo } from '../src/services/terrain-tiles.js';
import { ELEVATION_IMAGE_SERVICE } from '../src/services/elevation.js';
import { configureUpstream } from '../src/shared/upstream.js';

const LAT = 47.5, LON = -117.4;
const PLANTED = { owner: 'PLANTED OWNER SMITH', address: '987 PLANTED WELL RD' };
const PLANTED_VALUE = /PLANTED/;
const ADDRESS_OR_OWNER_KEY = /owner|address|addr|site_name|taxpayer|mail/i;
const ALLOWED_KEYS = new Set(['ownerMatch', 'ownerSimilarity', 'partialOwnerMatch', 'addressMatch', 'siteAddress']);

const GWIC = 'https://mbmgmap.mtech.edu/server/rest/services/Water_Resources/GWIC_Database/FeatureServer/4/query';
const IDWR = 'https://gis.idwr.idaho.gov/hosting/rest/services/Groundwater/Wells/FeatureServer/0/query';
const ECOLOGY = 'https://services.arcgis.com/6lCKYNJLvwTXqrmp/ArcGIS/rest/services/WR/FeatureServer/9/query';
const SPOKANE_ASSESSOR = 'https://gismo.spokanecounty.org/arcgis/rest/services/Assessor/SCOUTSimple/MapServer/0/query';

const near = i => [LON + 0.001 * (i + 1), LAT + 0.0005 * (i + 1)];
const gwic = () => ({ features: Array.from({ length: 6 }, (_, i) => ({ geometry: { x: near(i)[0], y: near(i)[1] }, attributes: {
  gwicid: 1000 + i, latitude: near(i)[1], longitude: near(i)[0], total_depth_ft_bgs: 100 + i, static_water_level_ft_bgs: 40, site_type: 'WELL', status: 'NEW WELL',
  site_name: PLANTED.owner, OwnerName: PLANTED.owner, WellAddress: PLANTED.address, driller_name: PLANTED.owner, altitude_ft_amsl: null, geomethod: 'NAV-GPS'
} })) });
const idwr = () => ({ type: 'FeatureCollection', features: Array.from({ length: 6 }, (_, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: near(i) }, properties: {
  WellID: 2000 + i, TotalDepth: 120 + i, StaticWaterLevel: 50, WellUse: 'Domestic', CountyName: 'Kootenai',
  Owner: PLANTED.owner, WellAddress: PLANTED.address, WellOwner: PLANTED.owner, OwnerAddress: PLANTED.address
} })) });
const ecology = () => ({ type: 'FeatureCollection', features: Array.from({ length: 6 }, (_, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: near(i) }, properties: {
  ID: 3000 + i, WellTagNr: `BAA${i}`, CompletedDepth: String(140 + i), StaticWaterLvl: '45', WellProjectType: 'Water', ParcelNumber: '23123.9051',
  OwnerName: PLANTED.owner, WellAddress: PLANTED.address
} })) });
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls, restoreUpstream;
beforeEach(() => {
  clearTerrainTileMemo();
  delete globalThis.caches;
  restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} });
  calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    const body = init.body ?? (typeof input === 'object' && input.body ? await input.clone().text() : undefined);
    calls.push({ url: decodeURIComponent(`${url} ${body ?? ''}`) });
    if (url.startsWith(GWIC)) return json(gwic());
    if (url.startsWith(IDWR)) return json(idwr());
    if (url.startsWith(ECOLOGY)) return json(ecology());
    if (url.startsWith(SPOKANE_ASSESSOR)) return json({ features: [{ attributes: { PID_NUM: '23123.9051', owner_name: PLANTED.owner, taxpayer_name: PLANTED.owner, site_address: '1 SITE RD', site_city: 'SPOKANE' } }] });
    if (url.startsWith(TERRAIN_TILES_URL)) return new Response('', { status: 404 });
    if (url.startsWith(`${ELEVATION_IMAGE_SERVICE}/getSamples`)) {
      const points = JSON.parse(new URLSearchParams(String(body)).get('geometry')).points;
      return json({ samples: points.map((_, i) => ({ locationId: i, value: '700' })) });
    }
    return new Response('not stubbed', { status: 404 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; restoreUpstream(); if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches; });

const post = (path, body) => worker.fetch(new Request(`https://acresx.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), {}, { waitUntil() {} });
const keysOf = value => (Array.isArray(value) ? value.flatMap(keysOf) : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]) : []);
function assertClean(body, where) {
  const leaked = [...new Set(keysOf(body).filter(k => !ALLOWED_KEYS.has(k) && ADDRESS_OR_OWNER_KEY.test(k)))];
  assert.deepEqual(leaked, [], `${where}: owner/address field names`);
  assert.doesNotMatch(JSON.stringify(body), PLANTED_VALUE, `${where}: owner/address values`);
}
const asked = host => calls.filter(c => c.url.startsWith(host)).map(c => c.url).join('\n');

test('the personal-field filter covers well address and owner fields in all three states', () => {
  for (const key of ['WellAddress', 'wellAddress', 'Well_Address', 'WellAddr1', 'WellOwner', 'WELL_OWNER', 'OwnerName', 'Owner', 'OwnerAddress', 'site_name', 'SITE_NAME'])
    assert.ok(PERSONAL_FIELD.test(key), key);
  for (const key of ['WellID', 'WellTagNr', 'WellUse', 'WellDocs', 'WellProjectType', 'SITUS_ADDRESS', 'site_type', 'ZONE_NAME', 'NAME'])
    assert.ok(!PERSONAL_FIELD.test(key), key);
  assert.deepEqual(withoutPersonalFields({ properties: { WellID: 1, WellAddress: 'x', WellOwner: 'y' } }), { properties: { WellID: 1 } });
});

for (const state of ['MT', 'ID']) {
  test(`/api/well-search ${state}: no well owner or address fields, and none requested`, async () => {
    const response = await post('/api/well-search', { state, lat: LAT, lon: LON });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.wells.length > 0);
    assertClean(body, `well-search ${state}`);
    assert.doesNotMatch(asked(state === 'MT' ? GWIC : IDWR), /outFields=[^&\s]*(WellAddress|Owner|site_name)/);
  });
}

test('/api/arcgis wells (the WA well list): owner and address stripped even when every field is asked for', async () => {
  const response = await post('/api/arcgis', { service: 'wells', params: { f: 'geojson', where: '1=1', outFields: '*' } });
  const body = await response.json();
  assert.ok(body.features?.length > 0, JSON.stringify(body).slice(0, 200));
  assertClean(body, 'arcgis wells');
});

for (const state of ['WA', 'ID', 'MT']) {
  test(`/api/well-depth-terrain ${state}: no well owner or address fields, and none requested`, async () => {
    const response = await post('/api/well-depth-terrain', { state, lat: LAT, lon: LON });
    const body = await response.json();
    assert.equal(body.available, true, JSON.stringify(body).slice(0, 300));
    assert.ok(body.estimate.wells.length > 0);
    assertClean(body, `well-depth-terrain ${state}`);
    const host = { WA: ECOLOGY, ID: IDWR, MT: GWIC }[state];
    assert.doesNotMatch(asked(host), /outFields=[^&\s]*(WellAddress|Owner|site_name)/);
  });
}

test('/api/existing-well: the well address is compared server-side, never returned', async () => {
  const geometry = { type: 'Polygon', coordinates: [[[LON, LAT], [LON + 0.01, LAT], [LON + 0.01, LAT + 0.01], [LON, LAT + 0.01], [LON, LAT]]] };
  const response = await post('/api/existing-well', { state: 'WA', county: 'Spokane', parcelId: '23123.9051', geometry });
  const body = await response.json();
  assert.equal(body.available, true);
  assert.ok(body.match, 'a match (parcel number) is found');
  assert.equal('wellAddress' in body.match, false);
  assert.doesNotMatch(JSON.stringify(body), /987 PLANTED WELL RD/);
  assert.doesNotMatch(JSON.stringify(body), /PLANTED OWNER/);
  assert.match(asked(ECOLOGY), /WellAddress/, 'still requested for the address comparison');
});
