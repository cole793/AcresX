// Offline tests for the soil backup (src/services/soils.js): when USDA Soil Data Access has an
// outage (HTTP 5xx, network error, timeout, non-JSON page), the Esri Living Atlas copy of SSURGO
// answers in the same shape. Network is stubbed; the backup answer is a recording of the live
// layer at the Spokane parcel 23123.9051 (2026-11-17, while SDA answered 502).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureUpstream } from '../src/shared/upstream.js';
import {
  soilAt, isSdaOutage, mapBackupSoil, ESRI_SSURGO_LAYER, SOIL_BACKUP_SOURCE, SDA_SOURCE, SOIL_BACKUP_VINTAGE
} from '../src/services/soils.js';
import { handleLandAnalysis } from '../src/services/land-analysis.js';

const backupFixture = JSON.parse(readFileSync(new URL('./fixtures/esri-ssurgo-spokane-23123.9051.json', import.meta.url), 'utf8'));
// The SDA answer for the same parcel (test/fixtures/report-spokane-23123.9051.json, land.soil).
const sdaTable = { Table: [['mukey', 'muname', 'compname', 'comppct_r', 'drainagecl', 'hydgrp', 'slope_r'], ['85981', 'Stutler-Springdale complex, 3 to 15 percent slopes', 'Stutler', '55', 'Well drained', 'B', '4']] };
const CENTER = [-117.44865899017529, 47.49467375246862];

const realFetch = globalThis.fetch;
let calls = [];
let restore;
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const badGateway = () => new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
const isSda = url => url.startsWith('https://sdmdataaccess.sc.egov.usda.gov/');
const isBackup = url => url.startsWith(`${ESRI_SSURGO_LAYER}/query`);
function stubFetch({ sda, backup, other = () => new Response('down', { status: 503 }) }) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    if (isSda(url)) return sda(url, init);
    if (isBackup(url)) return backup(url, init);
    return other(url, init);
  };
}
const count = pred => calls.filter(c => pred(c.url)).length;

beforeEach(() => { calls = []; restore = configureUpstream({ backoffMs: 0, log: () => {} }); });
afterEach(() => { restore(); globalThis.fetch = realFetch; });

// What the Spokane parcel's soil card showed from SDA on 2026-11-15.
const SDA_ANSWER = {
  available: true, mapUnit: 'Stutler-Springdale complex, 3 to 15 percent slopes', component: 'Stutler', componentPct: 55,
  drainage: 'Well drained', hydrologicGroup: 'B', soilSlopePct: 4, feasibility: 'favorable'
};

test('soil: SDA 502 -> the Esri SSURGO backup answers, mapped to the same shape and grade as SDA', async () => {
  stubFetch({ sda: badGateway, backup: () => jsonResponse(backupFixture) });
  const soil = await soilAt(...CENTER);
  for (const [key, value] of Object.entries(SDA_ANSWER)) assert.deepEqual(soil[key], value, key);
  assert.equal(soil.source, SOIL_BACKUP_SOURCE);
  assert.equal(soil.source, 'USDA SSURGO via Esri Living Atlas (backup; USDA Soil Data Access unavailable)');
  assert.equal(soil.backup, true);
  assert.equal(soil.fallbackFrom, 'USDA soil service returned 502 with an invalid response.');
  assert.equal(soil.septicRating, 'Very limited');
  assert.deepEqual(soil.slopeRangePct, { low: 3, high: 15 });
  assert.equal(soil.sourceUrl, ESRI_SSURGO_LAYER);
  assert.equal(soil.vintage, SOIL_BACKUP_VINTAGE);
  // SDA was asked twice (one retry on 5xx), then one backup query.
  assert.equal(count(isSda), 2);
  assert.equal(count(isBackup), 1);
  const ask = new URL(calls.find(c => isBackup(c.url)).url);
  assert.equal(calls.find(c => isBackup(c.url)).init.method, 'GET');
  assert.equal(ask.searchParams.get('geometry'), `${CENTER[0]},${CENTER[1]}`);
  assert.equal(ask.searchParams.get('geometryType'), 'esriGeometryPoint');
  assert.equal(ask.searchParams.get('inSR'), '4326');
  assert.equal(ask.searchParams.get('returnGeometry'), 'false');
  assert.equal(ask.searchParams.get('resultRecordCount'), null, 'resultRecordCount makes this layer take >25 s');
  for (const field of ['muname', 'compname', 'comppct_r', 'drclassdcd', 'hydgrpdcd', 'slopegraddcp', 'engstafdcd']) {
    assert.ok(ask.searchParams.get('outFields').split(',').includes(field), field);
  }
});

test('soil: SDA network error or non-JSON outage page also uses the backup', async () => {
  stubFetch({ sda: () => { throw new TypeError('fetch failed'); }, backup: () => jsonResponse(backupFixture) });
  assert.equal((await soilAt(...CENTER)).backup, true);
  calls = [];
  stubFetch({ sda: () => new Response('<html>Service Unavailable</html>', { status: 200 }), backup: () => jsonResponse(backupFixture) });
  const soil = await soilAt(...CENTER);
  assert.equal(soil.backup, true);
  assert.equal(soil.fallbackFrom, 'USDA soil service returned 200 with an invalid response.');
});

test('soil: SDA answers -> its answer, and the backup is never called', async () => {
  stubFetch({ sda: () => jsonResponse(sdaTable), backup: () => { throw new Error('backup must not be called'); } });
  const soil = await soilAt(...CENTER);
  assert.deepEqual(soil, { ...SDA_ANSWER, source: SDA_SOURCE });
  assert.equal(count(isBackup), 0);
});

test('soil: SDA "no map unit" and 4xx answers are not outages, so the backup is not asked', async () => {
  stubFetch({ sda: () => jsonResponse({}), backup: () => jsonResponse(backupFixture) });
  await assert.rejects(soilAt(...CENTER), /No USDA soil map unit was returned/);
  stubFetch({ sda: () => jsonResponse({ Message: 'Invalid query' }, 400), backup: () => jsonResponse(backupFixture) });
  await assert.rejects(soilAt(...CENTER), /USDA soil service returned 400/);
  assert.equal(count(isBackup), 0);
});

test('soil: SDA and the backup both fail -> one error naming both; the backup gets one retry', async () => {
  stubFetch({ sda: badGateway, backup: () => new Response('busy', { status: 503 }) });
  await assert.rejects(soilAt(...CENTER), error => {
    assert.equal(error.message, 'USDA soil service returned 502 with an invalid response.; backup (Esri SSURGO copy): Esri SSURGO soil layer returned 503');
    return true;
  });
  assert.equal(count(isBackup), 2);
  calls = [];
  stubFetch({ sda: badGateway, backup: () => jsonResponse({ features: [] }) });
  await assert.rejects(soilAt(...CENTER), /backup \(Esri SSURGO copy\): No SSURGO map unit was returned/);
  stubFetch({ sda: badGateway, backup: () => jsonResponse({ error: { code: 500, message: 'Unable to complete operation.' } }) });
  await assert.rejects(soilAt(...CENTER), /backup \(Esri SSURGO copy\): Unable to complete operation/);
});

test('land-analysis: both soil sources down -> only the soil layer is unavailable (score stays Incomplete)', async () => {
  stubFetch({ sda: badGateway, backup: badGateway, other: () => new Response('down', { status: 503 }) });
  const geometry = { type: 'Polygon', coordinates: [[[-117.45, 47.494], [-117.447, 47.494], [-117.447, 47.4953], [-117.45, 47.4953], [-117.45, 47.494]]] };
  const response = await handleLandAnalysis(new Request('https://acresx.test/api/land-analysis', { method: 'POST', body: JSON.stringify({ geometry }) }), {}, { waitUntil() {} });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.soil.available, false);
  assert.match(body.soil.error, /^USDA soil service returned 502 with an invalid response\.; backup \(Esri SSURGO copy\): /);
  assert.deepEqual(Object.keys(body).sort(), ['available', 'landCover', 'soil', 'terrain']);
});

test('land-analysis: SDA down, backup up -> soil available from the backup', async () => {
  stubFetch({ sda: badGateway, backup: () => jsonResponse(backupFixture) });
  const geometry = { type: 'Polygon', coordinates: [[[-117.45, 47.494], [-117.447, 47.494], [-117.447, 47.4953], [-117.45, 47.4953], [-117.45, 47.494]]] };
  const response = await handleLandAnalysis(new Request('https://acresx.test/api/land-analysis', { method: 'POST', body: JSON.stringify({ geometry }) }), {}, { waitUntil() {} });
  const body = await response.json();
  assert.equal(body.available, true);
  assert.equal(body.soil.available, true);
  assert.equal(body.soil.source, SOIL_BACKUP_SOURCE);
  assert.equal(body.soil.feasibility, 'favorable');
});

test('isSdaOutage: 5xx, timeout, network and invalid JSON are outages; 4xx, too large and plain errors are not', () => {
  for (const error of [{ kind: 'http', status: 502 }, { kind: 'http', status: 500 }, { kind: 'timeout' }, { kind: 'network' }, { kind: 'json' }]) assert.equal(isSdaOutage(error), true, JSON.stringify(error));
  for (const error of [{ kind: 'http', status: 400 }, { kind: 'http', status: 404 }, { kind: 'too_large' }, { kind: 'cancelled' }, new Error('No USDA soil map unit was returned.'), null]) assert.equal(isSdaOutage(error), false, JSON.stringify(error));
});

test('mapBackupSoil: grades with the SDA rule; falls back to slope_r; empty values become null', () => {
  const limited = mapBackupSoil({ muname: 'Wet loam', compname: 'Wet', comppct_r: 80, drclassdcd: 'Poorly drained', hydgrpdcd: 'C/D', slope_r: 2 });
  assert.equal(limited.feasibility, 'limited');
  assert.equal(limited.soilSlopePct, 2);
  const steep = mapBackupSoil({ muname: 'Steep', drclassdcd: 'Well drained', hydgrpdcd: 'B', slopegraddcp: 40, slope_r: 30 });
  assert.equal(steep.soilSlopePct, 40, 'dominant component slope first, like SDA');
  assert.equal(steep.feasibility, 'limited');
  const water = mapBackupSoil({ muname: 'Water', compname: 'Water', comppct_r: 100, drclassdcd: null, hydgrpdcd: null, slopegraddcp: null, slope_r: null });
  assert.deepEqual([water.drainage, water.hydrologicGroup, water.soilSlopePct, water.slopeRangePct, water.feasibility], ['', '', null, null, 'moderate']);
});
