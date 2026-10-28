// Stubbed upstream scenarios for every module migrated to src/shared/upstream.js.
//
// Each scenario stubs globalThis.fetch with canned answers (shaped like the live services'
// answers), runs one module call and records its output. The outputs were recorded from the code
// before the migration (main at 4812983) into fixtures/upstream-callers-snapshot.json, and
// test/upstream-callers.test.js checks the migrated code still gives the same outputs.
// For scenarios marked `requests: true`, the sorted list of upstream requests (method, URL, body)
// is part of the snapshot too: a successful lookup must ask the same questions as before.
// Regenerate (only when an output change is intended): UPDATE_SNAPSHOT=1 npm test
import { soilAt } from '../src/services/soils.js';
import { handleExistingWell } from '../src/services/existing-well.js';
import { handleUtilityTerritory } from '../src/services/utility-territory.js';
import { handlePropertyTaxTest } from '../src/services/property-tax-test.js';
import { handlePowerIntelligence } from '../src/services/power-intelligence.js';
import { findMontanaParcel, findYellowstoneParcel } from '../src/states/montana/parcels.js';
import { findMontanaWells } from '../src/states/montana/wells.js';
import { findIdahoWells } from '../src/states/idaho/wells.js';
import { getSpokaneCountyIntelligence } from '../src/counties/spokane.js';
import { getYellowstoneCountyIntelligence } from '../src/counties/yellowstone.js';
import { getGallatinCountyIntelligence } from '../src/counties/gallatin.js';
import { getZoningProfile } from '../src/zoning-counties.js';
import legacyWorker from '../src/worker.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const features = list => jsonResponse({ features: list.map(attributes => ({ attributes })) });
const arcgisError = (code = 400, message = 'Unable to complete operation.') => jsonResponse({ error: { code, message, details: [] } });
const post = (path, body) => new Request(`https://acresx.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function responseOutput(response) {
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, cache: response.headers.get('Cache-Control'), body };
}

const square = (lon, lat, d = 0.001) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
const spokaneParcel = square(-117.40, 47.60);

// ---- USDA soils
const sdaTable = { Table: [['mukey', 'muname', 'compname', 'comppct_r', 'drainagecl', 'hydgrp', 'slope_r'], ['59011', 'Bong coarse sandy loam, 0 to 8 percent slopes', 'Bong', '85', 'Somewhat excessively drained', 'A', '4']] };

// ---- Spokane existing well
const spokaneAssessor = () => features([{ PID_NUM: '47174.9017', owner_name: 'SMITH JOHN A', taxpayer_name: 'SMITH JOHN A', site_address: '123 TEST RD', site_city: 'SPOKANE', site_state: 'WA', site_zip: '99208' }]);
const ecologyWells = () => jsonResponse({ type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-117.3995, 47.6005] }, properties: { ID: 1, WellTagNr: 'BAA123', ProjectName: 'Smith', OwnerName: 'JOHN SMITH', WellAddress: '123 TEST RD', ParcelNumber: '47174.9017', CompletedDepth: 220, WorkCompletionDate: 946684800000, WellProjectType: 'New Well', WellSubType: 'Water', DrillerLicenseNumber: '1234', FlowRateGPM: 12 } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-117.403, 47.603] }, properties: { ID: 2, WellTagNr: 'BAA999', ProjectName: 'Jones', OwnerName: 'JONES', WellAddress: '9 OTHER RD', ParcelNumber: '47174.0001', CompletedDepth: 180, WellProjectType: 'New Well' } }
] });

// ---- HIFLD utility territory
const hifld = () => features([{ NAME: 'AVISTA CORP', TYPE: 'INVESTOR OWNED', STATE: 'WA', YEAR: 2023 }, { NAME: 'INLAND POWER & LIGHT CO', TYPE: 'COOPERATIVE', STATE: 'WA' }]);

// ---- Overpass
const overpass = () => jsonResponse({ elements: [
  { type: 'node', id: 11, lat: 47.6012, lon: -117.3992, tags: { power: 'pole', operator: 'Avista' } },
  { type: 'node', id: 12, lat: 47.6031, lon: -117.3980, tags: { power: 'transformer' } },
  { type: 'way', id: 13, geometry: [{ lat: 47.6011, lon: -117.401 }, { lat: 47.6013, lon: -117.398 }], tags: { power: 'minor_line', voltage: '13200' } }
] });

// ---- Montana parcels (geojson)
const geoFeature = (properties, geometry = square(-108.5, 45.78)) => ({ type: 'Feature', geometry, properties });
const yellowstoneTaxParcel = () => jsonResponse({ type: 'FeatureCollection', features: [geoFeature({ GEOCODE: '03103323101010000', TAX_ID: 'A12345', FULLADD: '1 TEST LN', CityStateZip: 'BILLINGS MT 59101', PropertyCardLink: 'https://svc.mt.gov/msl/cadastral/?geocode=03103323101010000' })] });
const montanaCadastral = () => jsonResponse({ type: 'FeatureCollection', features: [geoFeature({ PARCELID: '06079821101010000', Geocode: '06-0798-21-1-01-01-0000', AddressLine1: '5 RANCH RD', CityStateZip: 'BOZEMAN MT 59715', COUNTY_NM: 'Gallatin', PropertyCardLink: 'https://svc.mt.gov/msl/cadastral/?geocode=06079821101010000' }, square(-111.05, 45.68))] });

// ---- Montana GWIC
const gwic = count => jsonResponse({ features: Array.from({ length: count }, (_, i) => ({
  attributes: { gwicid: 1000 + i, site_name: `SITE ${i}`, total_depth_ft_bgs: 100 + i * 10, static_water_level_ft_bgs: 40 + i, date_completed: '1999-06-01', status: 'Active', construction_type: 'Drilled', site_type: 'WELL', abandoned_flag: i === 0 ? 'Y' : 'N' },
  geometry: { x: -111.05 + i * 0.001, y: 45.68 + i * 0.001 }
})) });

// ---- Idaho wells (geojson)
const idwr = count => jsonResponse({ type: 'FeatureCollection', features: Array.from({ length: count }, (_, i) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [-116.8 + i * 0.001, 47.7] },
  properties: { WellID: 500 + i, PermitID: null, MetalTagNumber: i % 2 ? `D00${i}` : null, ConstructionDate: 1104537600000, Owner: `OWNER ${i}`, WellUse: 'Domestic', CountyName: 'Kootenai', TotalDepth: i === 1 ? 0 : 150 + i, StaticWaterLevel: 60, ProductionRate: 20, WellDocs: `https://idwr.example/well/${500 + i}` }
})) });

// ---- Spokane county intelligence layers
function spokaneLayers(url, { zoning, permits } = {}) {
  const path = url.pathname;
  if (path.includes('ZoningLookup/MapServer/3/')) return zoning ? zoning() : features([{ ZONECLASS: 'RR-5', ZONEDESC: 'Rural Residential 5', ZFILENUM: 'ZE-1-99', DevFileNum: '', DevURL: '' }]);
  if (path.includes('ZoningLookup/MapServer/4/')) return features([{ LANDUSECODE: 'RR', LANDUSEDESC: 'Rural Residential' }]);
  if (path.includes('ZoningLookup/MapServer/2/')) return features([]);
  if (path.includes('PermittingLookup/MapServer/0/')) return features([{ JURISDICTION: 'Spokane County' }]);
  if (path.includes('BPPublic/MapServer/5/')) return permits ? permits() : features([
    { PERMITNUM: 'B-1', PERMITTYPE: 'Residential', STATUS: 'Final', ADDRESS: '123 TEST RD', ISSUEDDATE: 1262304000000 },
    { PERMITNUM: 'B-1', PERMITTYPE: 'Residential', STATUS: 'Final', ADDRESS: '123 TEST RD', ISSUEDDATE: 1262304000000 },
    { PERMITNUM: 'B-2', PERMITTYPE: 'Septic', STATUS: 'Issued', ADDRESS: '123 TEST RD', APPLIEDDATE: '2020-04-02' }
  ]);
  throw new Error(`unexpected Spokane request ${path}`);
}

// ---- Yellowstone zoning layers: layerHits maps "layerId:point|polygon" to attributes.
function yellowstoneLayers(url, layerHits = {}, failing = new Set()) {
  const m = /Zoning\/MapServer\/(\d+)\/query/.exec(url.pathname);
  if (!m) throw new Error(`unexpected Yellowstone request ${url.pathname}`);
  const kind = url.searchParams.get('geometryType') === 'esriGeometryPolygon' ? 'polygon' : 'point';
  const key = `${m[1]}:${kind}`;
  if (failing.has(key)) return new Response('upstream down', { status: 500 });
  return features(layerHits[key] ? [layerHits[key]] : []);
}
const yellowstoneParcel = square(-108.5, 45.78);

// ---- Gallatin
const gallatinLayer = (attrs, status = 200) => () => (attrs ? features([attrs]) : jsonResponse({ features: [] }, status));

const spokaneProfile = getZoningProfile('Spokane');

// Each route: (url: URL, init) -> Response | Promise<Response>, or throws.
export const scenarios = [
  { name: 'soils: map unit found', requests: true, route: () => jsonResponse(sdaTable), run: () => soilAt(-117.4, 47.6) },
  { name: 'soils: empty table', route: () => jsonResponse({}), run: () => soilAt(-117.4, 47.6) },
  { name: 'soils: HTTP 400 with an SDA message', route: () => jsonResponse({ Message: 'Invalid query' }, 400), run: () => soilAt(-117.4, 47.6) },
  { name: 'soils: HTTP 500 with an error body', route: () => jsonResponse({ error: 'SDA overloaded' }, 500), run: () => soilAt(-117.4, 47.6) },
  { name: 'soils: invalid JSON', route: () => new Response('<html>busy</html>', { status: 200 }), run: () => soilAt(-117.4, 47.6) },

  {
    name: 'existing-well: strong parcel match', requests: true,
    route: url => (url.hostname === 'gismo.spokanecounty.org' ? spokaneAssessor() : ecologyWells()),
    run: async () => responseOutput(await handleExistingWell(post('/api/existing-well', { state: 'WA', county: 'Spokane', parcelId: '47174.9017', geometry: spokaneParcel })))
  },
  {
    name: 'existing-well: assessor miss falls back to LIKE query', requests: true,
    route: url => (url.hostname === 'gismo.spokanecounty.org' ? features([]) : ecologyWells()),
    run: async () => responseOutput(await handleExistingWell(post('/api/existing-well', { state: 'WA', county: 'Spokane', parcelId: '47174-9017', geometry: spokaneParcel })))
  },
  {
    name: 'existing-well: assessor ArcGIS error is treated as no assessor record',
    route: url => (url.hostname === 'gismo.spokanecounty.org' ? arcgisError(400, 'Invalid where clause') : ecologyWells()),
    run: async () => responseOutput(await handleExistingWell(post('/api/existing-well', { state: 'WA', county: 'Spokane', parcelId: '47174.9017', geometry: spokaneParcel })))
  },
  {
    name: 'existing-well: Ecology HTTP 500 rejects',
    route: url => (url.hostname === 'gismo.spokanecounty.org' ? spokaneAssessor() : new Response('down', { status: 500 })),
    run: async () => responseOutput(await handleExistingWell(post('/api/existing-well', { state: 'WA', county: 'Spokane', parcelId: '47174.9017', geometry: spokaneParcel })))
  },
  {
    name: 'existing-well: Ecology ArcGIS error rejects',
    route: url => (url.hostname === 'gismo.spokanecounty.org' ? spokaneAssessor() : arcgisError(400, 'Invalid query parameters')),
    run: async () => responseOutput(await handleExistingWell(post('/api/existing-well', { state: 'WA', county: 'Spokane', parcelId: '47174.9017', geometry: spokaneParcel })))
  },

  { name: 'utility-territory: two providers', requests: true, route: () => hifld(), run: async () => responseOutput(await handleUtilityTerritory(post('/api/utility-territory', { lat: 47.6, lon: -117.4 }))) },
  { name: 'utility-territory: HTTP 503', route: () => new Response('busy', { status: 503 }), run: async () => responseOutput(await handleUtilityTerritory(post('/api/utility-territory', { lat: 47.6, lon: -117.4 }))) },
  { name: 'utility-territory: ArcGIS error', route: () => arcgisError(400, 'Invalid geometry'), run: async () => responseOutput(await handleUtilityTerritory(post('/api/utility-territory', { lat: 47.6, lon: -117.4 }))) },
  { name: 'utility-territory: ArcGIS error without message', route: () => jsonResponse({ error: { code: 400 } }), run: async () => responseOutput(await handleUtilityTerritory(post('/api/utility-territory', { lat: 47.6, lon: -117.4 }))) },

  {
    name: 'property-tax: Spokane HTTP 500 rejects',
    route: () => new Response('down', { status: 500 }),
    run: async () => responseOutput(await handlePropertyTaxTest(post('/api/property-assessment', { state: 'WA', county: 'Spokane', parcelId: '47174.9017' })))
  },
  {
    name: 'property-tax: Spokane ArcGIS error without message rejects',
    route: () => jsonResponse({ error: { code: 400 } }),
    run: async () => responseOutput(await handlePropertyTaxTest(post('/api/property-assessment', { state: 'WA', county: 'Spokane', parcelId: '47174.9017' })))
  },
  {
    name: 'property-tax: Montana statewide errors are skipped, county record found', requests: true,
    route: url => (url.hostname === 'gis.dnrc.mt.gov' ? arcgisError(400, 'bad field') : features([{ GEOCODE: '03-1033-23-1-01-01-0000', TAX_ID: 'A12345' }])),
    run: async () => responseOutput(await handlePropertyTaxTest(post('/api/property-assessment', { state: 'MT', county: 'Yellowstone', parcelId: '03103323101010000' })))
  },

  {
    name: 'power: Avista with mapped OSM distribution', requests: true,
    route: () => overpass(),
    run: async () => responseOutput(await handlePowerIntelligence(post('/api/power-intelligence', { providers: ['Avista Corp'], lat: 47.6005, lon: -117.3995, geometry: spokaneParcel, parcelId: '47174.9017' })))
  },
  {
    name: 'power: first Overpass endpoint fails, second answers', requests: true,
    route: url => (url.hostname === 'overpass-api.de' ? new Response('rate limited', { status: 429 }) : overpass()),
    run: async () => responseOutput(await handlePowerIntelligence(post('/api/power-intelligence', { providers: ['Inland Power & Light'], lat: 47.6005, lon: -117.3995, geometry: spokaneParcel })))
  },
  {
    name: 'power: both Overpass endpoints fail',
    route: url => (url.hostname === 'overpass-api.de' ? new Response('rate limited', { status: 429 }) : new Response('gateway', { status: 504 })),
    run: async () => responseOutput(await handlePowerIntelligence(post('/api/power-intelligence', { providers: [], lat: 47.6005, lon: -117.3995 })))
  },

  { name: 'montana parcels: Yellowstone tax parcel', requests: true, route: () => yellowstoneTaxParcel(), run: () => findYellowstoneParcel('03103323101010000') },
  {
    name: 'montana parcels: Yellowstone miss falls back to statewide', requests: true,
    route: url => (url.hostname === 'gis.yellowstonecountymt.gov' ? jsonResponse({ type: 'FeatureCollection', features: [] }) : montanaCadastral()),
    run: () => findYellowstoneParcel('06079821101010000')
  },
  { name: 'montana parcels: statewide parcel', requests: true, route: () => montanaCadastral(), run: () => findMontanaParcel('06079821101010000', 'Gallatin') },
  { name: 'montana parcels: statewide not found', route: () => jsonResponse({ type: 'FeatureCollection', features: [] }), run: () => findMontanaParcel('123', 'Gallatin') },
  { name: 'montana parcels: statewide HTTP 502', route: () => new Response('bad gateway', { status: 502 }), run: () => findMontanaParcel('06079821101010000', 'Gallatin') },
  { name: 'montana parcels: statewide ArcGIS error', route: () => arcgisError(400, 'Invalid field'), run: () => findMontanaParcel('06079821101010000', 'Gallatin') },

  {
    name: 'montana wells: radius grows until 5 wells', requests: true,
    route: url => { const env = JSON.parse(url.searchParams.get('geometry')); return gwic(env.ymax - env.ymin > 0.1 ? 8 : 3); },
    run: () => findMontanaWells({ lat: 45.68, lon: -111.05 })
  },
  { name: 'montana wells: HTTP 500', route: () => new Response('x', { status: 500 }), run: () => findMontanaWells({ lat: 45.68, lon: -111.05 }) },
  { name: 'montana wells: ArcGIS error without message', route: () => jsonResponse({ error: { code: 400 } }), run: () => findMontanaWells({ lat: 45.68, lon: -111.05 }) },

  {
    name: 'idaho wells: radius grows until 5 wells', requests: true,
    route: url => idwr(Number(url.searchParams.get('distance')) >= 10 ? 7 : 2),
    run: () => findIdahoWells({ lat: 47.7, lon: -116.8 })
  },
  { name: 'idaho wells: HTTP 503', route: () => new Response('x', { status: 503 }), run: () => findIdahoWells({ lat: 47.7, lon: -116.8 }) },
  { name: 'idaho wells: ArcGIS error', route: () => arcgisError(500, 'Error performing query operation'), run: () => findIdahoWells({ lat: 47.7, lon: -116.8 }) },

  {
    name: 'spokane: zoning, plan, jurisdiction and permits', requests: true,
    route: url => spokaneLayers(url),
    run: () => getSpokaneCountyIntelligence({ lat: 47.6005, lon: -117.3995, geometry: spokaneParcel, parcelId: '47174.9017', address: '123 TEST RD' }, spokaneProfile)
  },
  {
    name: 'spokane: zoning HTTP 500 and permits ArcGIS error degrade per layer',
    route: url => spokaneLayers(url, { zoning: () => new Response('x', { status: 500 }), permits: () => arcgisError(400, 'Invalid geometry') }),
    run: () => getSpokaneCountyIntelligence({ lat: 47.6005, lon: -117.3995, geometry: spokaneParcel, parcelId: '47174.9017' }, spokaneProfile)
  },
  {
    name: 'spokane: zoning ArcGIS error without message',
    route: url => spokaneLayers(url, { zoning: () => jsonResponse({ error: { code: 400 } }) }),
    run: () => getSpokaneCountyIntelligence({ lat: 47.6005, lon: -117.3995 }, spokaneProfile)
  },

  {
    name: 'yellowstone: county zoning at the parcel center', requests: true,
    route: url => yellowstoneLayers(url, { '7:point': { JURISDICTION: 'Yellowstone County' }, '2:point': { ZONE: 'A-1', ZONE_NAME: 'Agricultural Open Space' } }),
    run: () => getYellowstoneCountyIntelligence({ lat: 45.7805, lon: -108.4995, geometry: yellowstoneParcel })
  },
  {
    name: 'yellowstone: parcel intersection plus entryway', requests: true,
    route: url => yellowstoneLayers(url, { '4:polygon': { ZONING: 'R-96', NAME: 'Residential 9600' }, '1:polygon': { NAME: 'Entryway' } }),
    run: () => getYellowstoneCountyIntelligence({ lat: 45.7805, lon: -108.4995, geometry: yellowstoneParcel })
  },
  {
    name: 'yellowstone: entryway only',
    route: url => yellowstoneLayers(url, { '1:point': { NAME: 'Entryway' } }),
    run: () => getYellowstoneCountyIntelligence({ lat: 45.7805, lon: -108.4995 })
  },
  {
    name: 'yellowstone: failing layers and no match',
    route: url => yellowstoneLayers(url, {}, new Set(['4:point', '8:polygon'])),
    run: () => getYellowstoneCountyIntelligence({ lat: 45.7805, lon: -108.4995, geometry: yellowstoneParcel })
  },

  { name: 'gallatin: zoning district', requests: true, route: gallatinLayer({ ZONING: 'AS', ZONE_NAME: 'Agricultural Suburban' }), run: () => getGallatinCountyIntelligence({ lat: 45.68, lon: -111.05 }) },
  { name: 'gallatin: unzoned polygon', route: gallatinLayer({ ZONING: 'UNZONED', NAME: 'Unzoned' }), run: () => getGallatinCountyIntelligence({ lat: 45.68, lon: -111.05 }) },
  { name: 'gallatin: no polygon', route: gallatinLayer(null), run: () => getGallatinCountyIntelligence({ lat: 45.68, lon: -111.05 }) },
  { name: 'gallatin: HTTP 500', route: () => new Response('x', { status: 500 }), run: () => getGallatinCountyIntelligence({ lat: 45.68, lon: -111.05 }) },
  { name: 'gallatin: ArcGIS error', route: () => arcgisError(400, 'Invalid geometry'), run: () => getGallatinCountyIntelligence({ lat: 45.68, lon: -111.05 }) },

  {
    name: 'legacy worker: /api/arcgis proxy answer', requests: true,
    route: () => features([{ PARCEL: '47174.9017' }]),
    run: async () => responseOutput(await legacyWorker.fetch(post('/api/arcgis', { service: 'parcel', params: { where: "PARCEL='47174.9017'", outFields: 'PARCEL', f: 'json' } }), {}))
  },
  {
    name: 'legacy worker: /api/arcgis proxy ArcGIS error',
    route: () => arcgisError(400, 'Invalid where'),
    run: async () => responseOutput(await legacyWorker.fetch(post('/api/arcgis', { service: 'wells', params: { where: 'x', f: 'json' } }), {}))
  },
  {
    name: 'legacy worker: /api/arcgis proxy HTTP 500',
    route: () => new Response('x', { status: 500 }),
    run: async () => responseOutput(await legacyWorker.fetch(post('/api/arcgis', { service: 'utility', params: { f: 'json' } }), {}))
  },
  {
    name: 'legacy worker: Stevens zoning through the configured service', requests: true,
    route: url => (url.pathname.endsWith('/MapServer') ? jsonResponse({ layers: [{ id: 3, name: 'Zoning Districts' }], tables: [] }) : features([{ ZONE_: 'R-10', ZONE_NAME: 'Rural 10' }])),
    run: async () => responseOutput(await legacyWorker.fetch(post('/api/zoning-permits', { county: 'Stevens', lat: 48.2, lon: -117.9 }), {}))
  }
];

// Runs every scenario with fetch stubbed; returns { [name]: { output, requests? } }.
export async function runScenarios() {
  const realFetch = globalThis.fetch;
  const results = {};
  try {
    for (const scenario of scenarios) {
      const requests = [];
      globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input instanceof Request ? input.url : input));
        const body = init.body == null ? null : String(init.body);
        requests.push(`${(init.method || 'GET').toUpperCase()} ${url.href}${body ? ` BODY ${body}` : ''}`);
        return scenario.route(url, init);
      };
      let output;
      try { output = { ok: await scenario.run() }; } catch (error) { output = { error: error?.message || String(error) }; }
      results[scenario.name] = scenario.requests ? { output, requests: [...new Set(requests)].sort() } : { output };
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  return JSON.parse(JSON.stringify(results));
}
