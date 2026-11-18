// Offline tests for POST /api/recorded-restrictions (src/services/recorded-restrictions.js, the
// county adapters src/counties/*-restrictions.js, src/states/montana/restrictions.js and
// src/services/padus-easements.js). The card and report section are in
// test/recorded-restrictions-ui.test.js.
// Network is stubbed: upstream answers are sanitized fixtures in test/fixtures/restrictions/
// (named plat fields only) or canned objects; owner fields are planted to check they never leak.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { PERSONAL_FIELD } from '../src/shared/personal-fields.js';
import { interiorPoint, parcelRings, featureShares, MIN_OVERLAP_SHARE } from '../src/shared/restrictions.js';
import { pointInRings } from '../src/shared/polygon-coverage.js';
import { RESTRICTIONS_CACHE_PREFIX, TITLE_LINE, PLATTED_NOTE, NOT_CHECKED_NOTE } from '../src/services/recorded-restrictions.js';
import { kootenaiPlat, parseKootenaiLegal } from '../src/counties/kootenai-restrictions.js';
import { stevensLegalPlat, stevensHolderType, stevensEasement } from '../src/counties/stevens-restrictions.js';
import { parseMontanaLegal } from '../src/states/montana/restrictions.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/restrictions/${name}`, import.meta.url), 'utf8'));
const env = { ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
const ctx = { waitUntil() {} };
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const EMPTY = { features: [] };
const PLANTED = { OwnerName: 'PLACEHOLDER OWNER', OwnerAddress1: '1 PLACEHOLDER MAIL ST', CareOfTaxpayer: 'PLACEHOLDER', OWNER: 'PLACEHOLDER OWNER', MAILADDRESS1: '1 PLACEHOLDER MAIL ST', file_as_na: 'PLACEHOLDER OWNER', addr_line1: '1 PLACEHOLDER MAIL ST', Own_Name: 'PLACEHOLDER OWNER' };
const withPlanted = body => ({ ...body, features: body.features.map(f => ({ ...f, attributes: { ...f.attributes, ...PLANTED } })) });

// A 0.002 x 0.002 degree square parcel (about 160 m x 220 m) and helpers.
const square = (lon, lat, d = 0.002) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
const polygon = ring => ({ type: 'Polygon', coordinates: [ring] });
const esri = (attributes, ring) => ({ attributes, geometry: { rings: [ring], spatialReference: { wkid: 4326 } } });

const realFetch = globalThis.fetch, realWarn = console.warn, realCaches = globalThis.caches;
let requested = [], restoreUpstream;
function params(url, init) {
  const out = new URLSearchParams(url.search);
  if (typeof init?.body === 'string') for (const [k, v] of new URLSearchParams(init.body)) out.set(k, v);
  return out;
}
function stub(handler) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const p = params(url, init);
    requested.push({ url, p });
    return handler(url, p);
  };
}
beforeEach(() => {
  requested = [];
  globalThis.fetch = async () => { throw new Error('network disabled in tests'); };
  console.warn = () => {};
  restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} });
  delete globalThis.caches;
});
afterEach(() => {
  globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream();
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

async function call(body) {
  const response = await worker.fetch(new Request('https://acresx.test/api/recorded-restrictions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env, ctx);
  return { status: response.status, body: await response.json() };
}
function allKeys(value, keys = []) {
  if (Array.isArray(value)) value.forEach(v => allKeys(v, keys));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.push(k); allKeys(v, keys); }
  return keys;
}
function assertClean(body) {
  assert.deepEqual(allKeys(body).filter(k => PERSONAL_FIELD.test(k)), []);
  assert.doesNotMatch(JSON.stringify(body), /PLACEHOLDER/);
  for (const r of requested) {
    const fields = (r.p.get('outFields') || '').split(',').filter(Boolean);
    assert.ok(!fields.includes('*'), `${r.url.pathname} asks for every field`);
    assert.deepEqual(fields.filter(f => PERSONAL_FIELD.test(f)), [], `${r.url.pathname} asks for an owner field`);
  }
}
const isLayer = (url, path) => url.pathname.includes(path);
const neverClaimsNone = body => {
  assert.ok(body.notes.includes(NOT_CHECKED_NOTE));
  assert.doesNotMatch(JSON.stringify(body), /no (recorded )?restrictions|no easements exist|free of (easements|restrictions)/i);
};

// ---- Gallatin

const GAL_RING = square(-111.0170, 45.5985);
function gallatinUpstream({ platview = () => jsonResponse(withPlanted(fixture('gallatin-platview-06069905302080000.json'))) } = {}) {
  return (url, p) => {
    if (isLayer(url, 'Parcel_Platview')) return platview(url, p);
    if (url.hostname === 'gis.dnrc.mt.gov') return jsonResponse(withPlanted(fixture('mt-cadastral-06069905302080000.json')));
    if (url.hostname === 'services.arcgis.com' || url.hostname === 'mslgis.mt.gov') return jsonResponse(EMPTY);
    throw new Error(`unexpected ${url.href}`);
  };
}

test('Gallatin 06069905302080000: COS 1103K, tract 8A-2, from Parcel_Platview by GEOCODE', async () => {
  stub(gallatinUpstream());
  const { status, body } = await call({ state: 'MT', county: 'Gallatin', parcelId: '06069905302080000', geometry: polygon(GAL_RING) });
  assert.equal(status, 200);
  assert.equal(body.status, 'found');
  assert.equal(body.plat.status, 'surveyed');
  assert.equal(body.plat.kind, 'certificate_of_survey');
  assert.equal(body.plat.record, 'COS 1103K');
  assert.equal(body.plat.tract, '8A-2');
  assert.equal(body.plat.surveyDate, '1997-02-06');
  assert.equal(body.plat.matchedBy, 'parcel_id');
  assert.equal(body.recorder.url, 'https://eagleweb.gallatin.mt.gov/recorder/web/');
  assert.equal(body.title, TITLE_LINE);
  assert.equal(body.conservationEasements.status, 'none');
  const platview = requested.find(r => isLayer(r.url, 'Parcel_Platview'));
  assert.equal(platview.p.get('where'), "GEOCODE='06069905302080000'");
  assert.equal(platview.p.get('geometry'), null, 'matched by parcel ID, not geometry');
  assert.ok(!requested.some(r => r.url.hostname === 'gis.dnrc.mt.gov'), 'cadastral only as the fallback');
  neverClaimsNone(body);
  assertClean(body);
});

test('Gallatin degrades to Montana Cadastral when Parcel_Platview fails; only that source is marked unavailable', async () => {
  stub(gallatinUpstream({ platview: () => jsonResponse({ error: 'down' }, 503) }));
  const { status, body } = await call({ state: 'MT', county: 'Gallatin', parcelId: '06069905302080000', geometry: polygon(GAL_RING) });
  assert.equal(status, 200);
  assert.equal(body.status, 'partial');
  assert.equal(body.plat.record, 'COS 1103K');
  assert.equal(body.plat.tract, '8A-2');
  assert.match(body.plat.legalDescription, /C\.O\.S\. 1103K/);
  assert.equal(body.plat.propertyCard.url, 'https://svc.mt.gov/msl/cadastral/?page=PropertyDetails&geocode=06069905302080000');
  assert.deepEqual(body.sources.filter(s => s.status === 'unavailable').map(s => s.key), ['gallatin-platview']);
  assertClean(body);
});

test('Gallatin plat-book image links are kept only on ftp.gallatin.mt.gov', async () => {
  const row = { ...fixture('gallatin-platview-06069905302080000.json').features[0].attributes, L0GIS_OwnerParcel_CLASS: 'MAJOR SUBDIVISION', SUB_NAME: 'GRIZZLY PARK ADDITION', L0GIS_OwnerParcel_RECORD: 'J-194', L0GIS_OwnerParcel_LOT: 'LOT 17', L0GIS_OwnerParcel_BLOCK: '4',
    plat_url_sub: 'https://ftp.gallatin.mt.gov/PLAT%20BOOKS/A.jpg | http://ftp.gallatin.mt.gov/B.jpg | https://evil.example/C.jpg' };
  stub(gallatinUpstream({ platview: () => jsonResponse({ features: [{ attributes: row }] }) }));
  const { body } = await call({ state: 'MT', county: 'Gallatin', parcelId: '06006234370500000', geometry: polygon(GAL_RING) });
  assert.equal(body.plat.kind, 'major_subdivision');
  assert.equal(body.plat.name, 'GRIZZLY PARK ADDITION');
  assert.equal(body.plat.lot, '17');
  assert.equal(body.plat.block, '4');
  assert.deepEqual(body.plat.imageLinks, [{ label: 'County plat book page', url: 'https://ftp.gallatin.mt.gov/PLAT%20BOOKS/A.jpg' }]);
  assert.ok(body.notes.includes(PLATTED_NOTE));
});

// ---- Yellowstone (interior point vs boundary touch)

const YC_RING = square(-108.5450, 45.7020);
test('Yellowstone 03092732390050000: Harvey Subd Block 1 Lot 5A; the county layer is asked at one interior point, never with the whole outline', async () => {
  stub((url, p) => {
    if (url.hostname === 'gis.dnrc.mt.gov') return jsonResponse(withPlanted(fixture('mt-cadastral-03092732390050000.json')));
    if (isLayer(url, 'Tax_and_Legal_Parcels/MapServer/1')) {
      // The whole outline would also return the neighbours' lots (boundary touch).
      return jsonResponse(withPlanted(fixture(p.get('geometryType') === 'esriGeometryPoint' ? 'yellowstone-legal-point.json' : 'yellowstone-legal-polygon.json')));
    }
    if (url.hostname === 'services.arcgis.com' || url.hostname === 'mslgis.mt.gov') return jsonResponse(EMPTY);
    throw new Error(`unexpected ${url.href}`);
  });
  const { body } = await call({ state: 'MT', county: 'Yellowstone', parcelId: '03092732390050000', geometry: polygon(YC_RING) });
  assert.equal(body.status, 'found');
  assert.equal(body.plat.status, 'platted');
  assert.equal(body.plat.name, 'HARVEY SUBD');
  assert.equal(body.plat.block, '1');
  assert.equal(body.plat.lot, '5A');
  assert.equal(body.plat.amended, 'AM B:1 L:1A & 5');
  assert.equal(body.recorder.url, 'https://crdocs.yellowstonecountymt.gov/recorder/web/');
  assert.ok(body.notes.includes(PLATTED_NOTE));
  const county = requested.find(r => isLayer(r.url, 'Tax_and_Legal_Parcels'));
  assert.equal(county.p.get('geometryType'), 'esriGeometryPoint');
  const pt = JSON.parse(county.p.get('geometry'));
  assert.ok(pointInRings(pt.x, pt.y, [YC_RING]), 'the point is inside the parcel');
  neverClaimsNone(body);
  assertClean(body);
});

test('interiorPoint: inside the parcel, away from its edges, and never inside a neighbour sharing the boundary', () => {
  // An L-shaped parcel; its vertex average (0.0012, 0.0012) sits near the inner corner.
  const L = [[0, 0], [0.004, 0], [0.004, 0.001], [0.001, 0.001], [0.001, 0.004], [0, 0.004], [0, 0]];
  const pt = interiorPoint([L]);
  assert.ok(pointInRings(pt.lon, pt.lat, [L]));
  const neighbour = [[0.001, 0.001], [0.004, 0.001], [0.004, 0.004], [0.001, 0.004], [0.001, 0.001]];
  assert.ok(!pointInRings(pt.lon, pt.lat, [neighbour]));
  const square4 = square(10, 40, 0.004);
  const c = interiorPoint([square4]);
  assert.ok(Math.abs(c.lon - 10.002) < 0.0008 && Math.abs(c.lat - 40.002) < 0.0008, 'near the middle of a square');
  assert.equal(interiorPoint(null), null);
  assert.equal(parcelRings({ type: 'Polygon', coordinates: [[[500, 0], [501, 0], [501, 1], [500, 0]]] }), null, 'not lon/lat');
});

test('featureShares: a polygon that only touches the boundary covers 0% and is dropped; half overlap is about 50%', () => {
  const parcel = square(0, 0);
  const touching = esri({ n: 1 }, square(0.002, 0));
  const half = esri({ n: 2 }, [[0.001, -0.001], [0.003, -0.001], [0.003, 0.003], [0.001, 0.003], [0.001, -0.001]]);
  const [t, h] = featureShares([parcel], [touching, half]);
  assert.ok(t.share < MIN_OVERLAP_SHARE);
  assert.ok(Math.abs(h.share - 0.5) < 0.08, `half share ${h.share}`);
});

// ---- Stevens

const ST_RING = square(-117.6850, 48.2860);
function stevensUpstream({ subdivisions = EMPTY, easements = EMPTY, legalStatus = 200 } = {}) {
  return (url) => {
    if (isLayer(url, 'RealPropertyParcels_Public/MapServer/0')) return legalStatus === 200 ? jsonResponse(withPlanted(fixture('stevens-parcel-0434200.json'))) : jsonResponse({}, legalStatus);
    if (isLayer(url, 'Assessors_Data_Share/MapServer/7')) return jsonResponse(subdivisions);
    if (isLayer(url, 'Assessors_Data_Share/MapServer/21')) return jsonResponse(easements);
    if (url.hostname === 'services.arcgis.com') return jsonResponse(EMPTY);
    throw new Error(`unexpected ${url.href}`);
  };
}

test('Stevens 0434200: a patented mining claim (legal description), not a plat; no county conservation easement', async () => {
  stub(stevensUpstream());
  const { body } = await call({ state: 'WA', county: 'Stevens', parcelId: '0434200', geometry: polygon(ST_RING) });
  assert.equal(body.status, 'found');
  assert.equal(body.plat.kind, 'mining_claim');
  assert.equal(body.plat.record, 'Mineral Survey #1179');
  assert.match(body.plat.legalDescription, /^MINES PATENTED SURVEY #1179/);
  assert.equal(body.conservationEasements.status, 'none');
  assert.equal(body.recorder.url, 'https://selfservice.stevenscountywa.gov/web/');
  const legal = requested.find(r => isLayer(r.url, 'RealPropertyParcels_Public'));
  assert.equal(legal.p.get('where'), "PARCELN='0434200'");
  assert.equal(legal.p.get('outFields'), 'PARCELN,legal_desc');
  assert.equal(requested.find(r => isLayer(r.url, 'MapServer/7')).p.get('geometryType'), 'esriGeometryPoint');
  assertClean(body);
});

test('Stevens: a mapped subdivision gives the plat name and plat book; a county conservation easement over the parcel is reported with its share', async () => {
  stub(stevensUpstream({ subdivisions: fixture('stevens-subdivision-sample.json'), easements: { features: [esri({ PARCELN: '0434200', COMMENT: 'DNR easement', ...PLANTED }, square(-117.6851, 48.2859, 0.0025))] } }));
  const { body } = await call({ state: 'WA', county: 'Stevens', parcelId: '434200', geometry: polygon(ST_RING) });
  assert.equal(body.plat.status, 'platted');
  assert.equal(body.plat.name, 'Buckleys Addition - Corrected');
  assert.equal(body.plat.platBook, 'A-5, B-85');
  assert.equal(body.plat.recordedDate, '1952-04-30');
  assert.equal(body.conservationEasements.status, 'found');
  assert.equal(body.conservationEasements.items[0].sharePct, 100);
  // COMMENT is free text that could name a person: only its holder category is returned.
  assert.equal(body.conservationEasements.items[0].holderType, 'State agency');
  assert.equal(body.conservationEasements.items[0].note, undefined);
  assert.doesNotMatch(JSON.stringify(body), /DNR easement/);
  assert.ok(body.notes.some(n => /conservation easement is mapped/.test(n)));
  assertClean(body);
});

test('Stevens easement COMMENT: a holder category only, never the free text (it could name a person)', () => {
  assert.equal(stevensHolderType('DNR easement'), 'State agency');
  assert.equal(stevensHolderType('WDFW conservation easement'), 'State agency');
  assert.equal(stevensHolderType('US Fish and Wildlife Service'), 'Federal agency');
  assert.equal(stevensHolderType('Inland Northwest Land Conservancy'), 'Nonprofit / land trust');
  assert.equal(stevensHolderType('Stevens County Conservation District'), 'Special district');
  assert.equal(stevensHolderType('Stevens County'), 'Local government');
  assert.equal(stevensHolderType('John Q Placeholder'), null);
  assert.equal(stevensHolderType(''), null);
  const e = stevensEasement({ COMMENT: 'Easement to John Q Placeholder', PARCELN: '0434200' }, 0.5);
  assert.equal(e.holderType, null);
  assert.ok(!('note' in e));
  assert.doesNotMatch(JSON.stringify(e), /Placeholder/);
});

test('Stevens legal descriptions are read conservatively', () => {
  assert.equal(stevensLegalPlat('LOT 3 BLK 2 SMITH ADDITION TO COLVILLE').status, 'platted');
  assert.equal(stevensLegalPlat('SHORT PLAT 12-34 LOT 2').kind, 'short_plat');
  assert.equal(stevensLegalPlat('NE4 NW4 SEC 12 TWP 30 RGE 40 EX RD').kind, 'metes_and_bounds');
  assert.equal(stevensLegalPlat(''), null);
});

// ---- Spokane

const SP_RING = square(-117.4500, 47.4930);
function spokaneUpstream({ plats = EMPTY, lots = EMPTY, agreements = EMPTY, failPlats = false } = {}) {
  return (url) => {
    if (isLayer(url, 'OpenData/Property/MapServer/3')) return failPlats ? jsonResponse({}, 500) : jsonResponse(plats);
    if (isLayer(url, 'OpenData/Property/MapServer/2')) return failPlats ? jsonResponse({}, 500) : jsonResponse(lots);
    if (isLayer(url, 'SCOUT/LayersMenu/MapServer/31')) return jsonResponse(agreements);
    if (url.hostname === 'services.arcgis.com') return jsonResponse(EMPTY);
    throw new Error(`unexpected ${url.href}`);
  };
}

test('Spokane 23123.9051: no plat or lot at the interior point -> not in a recorded plat; no development agreement', async () => {
  stub(spokaneUpstream());
  const { body } = await call({ state: 'WA', county: 'Spokane', parcelId: '23123.9051', geometry: polygon(SP_RING) });
  assert.equal(body.status, 'found');
  assert.equal(body.plat.status, 'unplatted');
  assert.equal(body.plat.kind, 'metes_and_bounds');
  assert.deepEqual(body.agreements, []);
  assert.equal(body.recorder.url, 'https://recording.spokanecounty.org/recorder/web/');
  assert.ok(body.notes.some(n => /Not in a recorded plat/.test(n)));
  neverClaimsNone(body);
  assertClean(body);
});

test('Spokane: a short plat, and a development agreement over the parcel is kept while one only touching the boundary is dropped', async () => {
  const da = fixture('spokane-development-agreement.json').features[0].attributes;
  stub(spokaneUpstream({
    plats: fixture('spokane-plat-short-plat.json'),
    lots: { features: [{ attributes: { Lot_Num: '2', Block_Num: null, Plat_Name: 'SP 78-065', Vacated: 'N' } }] },
    agreements: { features: [esri(da, square(-117.4501, 47.4929, 0.003)), esri({ ...da, FILENUM: 'NEIGHBOUR' }, square(-117.4480, 47.4930))] }
  }));
  const { body } = await call({ state: 'WA', county: 'Spokane', parcelId: '12345.6789', geometry: polygon(SP_RING) });
  assert.equal(body.plat.kind, 'short_plat');
  assert.equal(body.plat.name, 'SP 78-065');
  assert.equal(body.plat.lot, '2');
  assert.equal(body.agreements.length, 1);
  assert.deepEqual({ ...body.agreements[0], source: undefined }, { kind: 'development_agreement', label: 'Development agreement', fileNumber: '04-CPA-11', recordingNumber: '5881801', zoneClass: 'MU', recordingDate: '2010-03-08', sharePct: 100, source: undefined });
  assert.ok(body.notes.some(n => /development agreement/.test(n)));
});

test('Spokane: when the plat layers fail, the plat degrades to unknown and the rest still answers', async () => {
  stub(spokaneUpstream({ failPlats: true }));
  const { status, body } = await call({ state: 'WA', county: 'Spokane', parcelId: '23123.9051', geometry: polygon(SP_RING) });
  assert.equal(status, 200);
  assert.equal(body.status, 'partial');
  assert.equal(body.plat.status, 'unknown');
  assert.equal(body.conservationEasements.status, 'none');
  assert.deepEqual(body.agreements, []);
});

// ---- Kootenai (no Kootenai request)

test('Kootenai 50N04W323200: township PIN -> metes and bounds, with no request to a Kootenai server', async () => {
  stub(url => { if (url.hostname === 'services.arcgis.com') return jsonResponse(EMPTY); throw new Error(`unexpected ${url.href}`); });
  const { body } = await call({ state: 'ID', county: 'Kootenai', parcelId: '50N04W323200', geometry: polygon(square(-116.873, 47.640)), legal: 'W400 FT-N2-NW EX TX#S & EX RW' });
  assert.equal(body.status, 'found');
  assert.equal(body.plat.kind, 'metes_and_bounds');
  assert.equal(body.recorder.url, 'https://recorder.kcgov.us/RealEstate/SearchEntry.aspx');
  assert.deepEqual([...new Set(requested.map(r => r.url.hostname))], ['services.arcgis.com']);
});

test('Kootenai platted parcels: plat name, lot and block from the legal description; PIN alone says platted', () => {
  assert.deepEqual(parseKootenaiLegal('HUMBIRD ACRES, LT 3 BLK 1  1052N04W'), { name: 'HUMBIRD ACRES', lot: '3', block: '1', tract: null });
  const p = kootenaiPlat('C72150030040', 'PARK PLACE, LT 4 BLK 3');
  assert.equal(p.status, 'platted');
  assert.equal(p.name, 'PARK PLACE');
  assert.equal(kootenaiPlat('081900010030', null).status, 'platted');
  assert.equal(kootenaiPlat('P00000032775', 'TAX#4020 EX TX#S, PTN VAC COMPTON ST'), null);
});

test('Montana legal parsing: block, lot, tract and amended', () => {
  assert.deepEqual(parseMontanaLegal('HARVEY SUBD, S32, T01 S, R26 E, BLOCK 1, Lot 5A, AMD (25)'), { block: '1', lot: '5A', tract: null, amended: true });
  assert.equal(parseMontanaLegal('S05, T03 S, R06 E, C.O.S. 1103K, PARCEL 8A-2, ACRES 10.001').tract, '8A-2');
});

// ---- PAD-US and Montana State Library easements

test('PAD-US and Montana State Library: an easement over half the parcel is reported with its share and holder; one touching the boundary is not', async () => {
  const pad = fixture('padus-easement-gallatin.json').features[0].attributes;
  const msl = fixture('mt-easement-gallatin.json').features[0].attributes;
  const half = [[GAL_RING[0][0] + 0.001, GAL_RING[0][1] - 0.001], [GAL_RING[0][0] + 0.004, GAL_RING[0][1] - 0.001], [GAL_RING[0][0] + 0.004, GAL_RING[0][1] + 0.003], [GAL_RING[0][0] + 0.001, GAL_RING[0][1] + 0.003], [GAL_RING[0][0] + 0.001, GAL_RING[0][1] - 0.001]];
  stub((url, p) => {
    if (isLayer(url, 'Parcel_Platview')) return jsonResponse(fixture('gallatin-platview-06069905302080000.json'));
    if (url.hostname === 'services.arcgis.com') {
      assert.equal(p.get('where'), "Category='Easement'");
      return jsonResponse({ features: [esri({ ...pad, ...PLANTED }, half), esri({ ...pad, Unit_Nm: 'Neighbour easement' }, square(GAL_RING[0][0] - 0.002, GAL_RING[0][1]))] });
    }
    if (url.hostname === 'mslgis.mt.gov') return jsonResponse({ features: [esri(msl, half)] });
    throw new Error(`unexpected ${url.href}`);
  });
  const { body } = await call({ state: 'MT', county: 'Gallatin', parcelId: '06069905302080000', geometry: polygon(GAL_RING) });
  const items = body.conservationEasements.items;
  assert.equal(body.conservationEasements.status, 'found');
  assert.equal(items.length, 2);
  assert.equal(items[0].name, 'Gallatin Valley Land Trust 306101002.EAS.2685');
  assert.equal(items[0].holderType, 'Nonprofit / land trust');
  assert.ok(Math.abs(items[0].sharePct - 50) <= 8, `share ${items[0].sharePct}`);
  assert.equal(items[1].holder, 'Gallatin Valley Land Trust');
  assert.equal(items[1].deedRef, '2553504');
  assert.equal(items[1].date, '2016-08-05');
  assert.ok(body.notes.some(n => /conservation easement is mapped/.test(n)));
  assertClean(body);
});

// ---- Degrade, errors, cache

test('every upstream down: HTTP 200, available false, plat unknown, and still the recorder link and title line', async () => {
  stub(() => jsonResponse({}, 503));
  const { status, body } = await call({ state: 'MT', county: 'Yellowstone', parcelId: '03092732390050000', geometry: polygon(YC_RING) });
  assert.equal(status, 200);
  assert.equal(body.available, false);
  assert.equal(body.status, 'unavailable');
  assert.equal(body.plat.status, 'unknown');
  assert.equal(body.conservationEasements.status, 'unavailable');
  assert.equal(body.recorder.url, 'https://crdocs.yellowstonecountymt.gov/recorder/web/');
  assert.equal(body.title, TITLE_LINE);
  neverClaimsNone(body);
});

test('bad requests: missing parcel number, oversized body, bad JSON -> 400', async () => {
  assert.equal((await call({ state: 'MT', county: 'Gallatin' })).status, 400);
  assert.equal((await call('{nope')).status, 400);
  assert.equal((await call({ state: 'MT', county: 'Gallatin', parcelId: '1', pad: 'x'.repeat(310000) })).status, 400);
});

test('an unsupported county with a point checks only PAD-US and says not_supported', async () => {
  stub(url => { if (url.hostname === 'services.arcgis.com') return jsonResponse(EMPTY); throw new Error(`unexpected ${url.href}`); });
  const { body } = await call({ state: 'WA', county: 'King', parcelId: '1', lat: 47.6, lon: -122.3 });
  assert.equal(body.status, 'not_supported');
  assert.equal(body.plat, null);
  assert.equal(body.conservationEasements.status, 'none');
});

function fakeCache() {
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? new Response(hit) : undefined; },
    async put(req, res) { store.set(req.url, await res.text()); }
  } };
  return store;
}

test('cache: a complete answer is stored 30 days under the versioned prefix and served again; a partial one is not stored', async () => {
  const store = fakeCache();
  stub(spokaneUpstream());
  await call({ state: 'WA', county: 'Spokane', parcelId: '23123.9051', geometry: polygon(SP_RING) });
  const keys = [...store.keys()];
  assert.equal(keys.length, 1);
  assert.equal(RESTRICTIONS_CACHE_PREFIX, 'https://acresx.internal/cache/recorded-restrictions/v2/');
  assert.ok(keys[0].startsWith(RESTRICTIONS_CACHE_PREFIX));
  assert.match(store.get(keys[0]), /metes_and_bounds/);
  const before = requested.length;
  const again = await call({ state: 'WA', county: 'Spokane', parcelId: '23123.9051', geometry: polygon(SP_RING) });
  assert.equal(requested.length, before, 'served from the cache');
  assert.equal(again.body.plat.kind, 'metes_and_bounds');

  store.clear();
  stub(spokaneUpstream({ failPlats: true }));
  await call({ state: 'WA', county: 'Spokane', parcelId: '23123.9051', geometry: polygon(SP_RING) });
  assert.equal(store.size, 0, 'partial answers are not cached');
});
