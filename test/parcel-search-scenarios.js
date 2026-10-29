// /api/parcel-search scenarios outside Kootenai (other Idaho counties, Montana), run against a
// Worker module with fetch stubbed. test/fixtures/parcel-search-legacy-snapshot.json holds what
// the Worker at 2d12331 (before the Kootenai county-layer change) answered; idaho-parcels.test.js
// checks the current Worker still answers exactly the same. To re-record, import an older
// src/index.js and write JSON.stringify(await runParcelScenarios(worker), null, 1).

const square = [[[-116.2, 43.6], [-116.19, 43.6], [-116.19, 43.61], [-116.2, 43.61], [-116.2, 43.6]]];
const adaFeature = (id = 'R1234560010') => ({
  type: 'Feature', geometry: { type: 'Polygon', coordinates: square },
  properties: {
    OBJECTID: 7, PARCEL_ID: id, FP_ID: null, County: 'Ada', WEBSITE: 'https://adacounty.id.gov/assessor/',
    ASR_ACRES: 4.5, OWNER1: 'TEST OWNER ONE', OWNER2: '', MAIL_ADD1: '1 MAIL ST', MAIL_CITY: 'BOISE',
    SITE_ADD: '100 TEST RD', SITE_CITY: 'BOISE', SITE_ZIP: '83702', ASR_CATS: '12', VAL_LAND: 100000, VAL_IMPVTS: 50000, VAL_TOTAL: 150000
  }
});
const mtFeature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-111, 45.6], [-110.99, 45.6], [-110.99, 45.61], [-111, 45.6]]] }, properties: { PARCELID: '06079830101010000', Geocode: '06-0798-30-1-01-01-0000', AddressLine1: '1 MT RD', CityStateZip: 'BOZEMAN, MT 59715', OwnerName: 'MT OWNER', PropertyCardLink: 'https://svc.mt.gov/card' } };
const ysFeature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-108.5, 45.7], [-108.49, 45.7], [-108.49, 45.71], [-108.5, 45.7]]] }, properties: { GEOCODE: '03092727411010000', TAX_ID: 'A123', OWNER: 'YS OWNER' } };

const geojson = features => new Response(JSON.stringify({ type: 'FeatureCollection', features }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const hostOf = url => (url.includes('Public_Idaho_Parcels_') ? 'idaho' : url.includes('gis.dnrc.mt.gov') ? 'mt' : url.includes('yellowstonecountymt') ? 'yellowstone' : 'other');

// Each scenario: request body, and a handler (host, where, callIndex) -> Response.
export const parcelScenarios = [
  { name: 'Ada hit on first variant', body: { state: 'ID', county: 'Ada', parcelId: 'R1234560010' }, reply: host => host === 'idaho' ? geojson([adaFeature()]) : null },
  { name: 'Ada hit on compact variant', body: { state: 'ID', county: 'Ada County', parcelId: 'r12345-60010' }, reply: (host, where) => host === 'idaho' ? geojson(where.includes("'R1234560010'") ? [adaFeature()] : []) : null },
  { name: 'Ada not found', body: { state: 'ID', county: 'Ada', parcelId: 'NOPE1' }, reply: host => host === 'idaho' ? geojson([]) : null },
  { name: 'Ada upstream 500', body: { state: 'ID', county: 'Ada', parcelId: 'R1' }, reply: host => host === 'idaho' ? new Response('down', { status: 500 }) : null },
  { name: 'Ada ArcGIS error body', body: { state: 'ID', county: 'Ada', parcelId: 'R1' }, reply: host => host === 'idaho' ? new Response(JSON.stringify({ error: { code: 400, message: 'Failed to execute query.' } }), { status: 200 }) : null },
  { name: 'Ada two parcels match', body: { state: 'ID', county: 'Ada', parcelId: 'R1234560010' }, reply: host => host === 'idaho' ? geojson([adaFeature(), { ...adaFeature(), properties: { ...adaFeature().properties, County: 'Canyon' } }]) : null },
  { name: 'Idaho no county', body: { state: 'ID', county: '', parcelId: 'R1234560010' }, reply: host => host === 'idaho' ? geojson([adaFeature()]) : null },
  { name: 'Gallatin cadastral hit', body: { state: 'MT', county: 'Gallatin', parcelId: '06079830101010000' }, reply: host => host === 'mt' ? geojson([mtFeature]) : null },
  { name: 'Gallatin not found', body: { state: 'MT', county: 'Gallatin', parcelId: '1' }, reply: host => host === 'mt' ? geojson([]) : null },
  { name: 'Yellowstone tax parcel hit', body: { state: 'MT', county: 'Yellowstone', parcelId: '03092727411010000' }, reply: host => host === 'yellowstone' ? geojson([ysFeature]) : null },
  { name: 'Yellowstone miss -> cadastral', body: { state: 'MT', county: 'Yellowstone', parcelId: '06079830101010000' }, reply: host => host === 'yellowstone' ? geojson([]) : host === 'mt' ? geojson([mtFeature]) : null }
];

// Kootenai answered by IDWR (statewide layer misses). At 2d12331 this was the normal Kootenai path;
// now it is the last fallback (county layer down, statewide misses). Recorded in
// test/fixtures/parcel-search-kootenai-idwr-base.json.
export const idwrFeature = {
  type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-116.6, 47.3], [-116.6, 47.31], [-116.59, 47.31], [-116.59, 47.3], [-116.6, 47.3]]] },
  properties: { OBJECTID: 609238, PIN: '47N03W052200', COUNTY: 'Kootenai', OWNER: 'TEST OWNER', Shape__Area: 8008.75, Shape__Length: 494.7 }
};
export const kootenaiIdwrScenario = {
  name: 'Kootenai statewide miss -> IDWR', body: { state: 'ID', county: 'Kootenai', parcelId: '47N03W052200' },
  reply: (host, where, n, url) => host === 'idaho' ? geojson([]) : url.includes('gis.idwr.idaho.gov') ? geojson([idwrFeature]) : url.includes('map.kcgov.us') ? new Response('bad gateway', { status: 502 }) : null
};

export async function runParcelScenarios(worker, scenarios = parcelScenarios) {
  const realFetch = globalThis.fetch;
  const results = [];
  try {
    for (const scenario of scenarios) {
      const requests = [];
      globalThis.fetch = async input => {
        const url = String(input instanceof Request ? input.url : input);
        const host = hostOf(url); const params = new URL(url).searchParams;
        requests.push({ host, where: params.get('where'), outFields: params.get('outFields') });
        const response = scenario.reply(host, params.get('where') || '', requests.length, url);
        if (!response) throw new Error(`unexpected request to ${host}`);
        return response;
      };
      const request = new Request('https://acresx.test/api/parcel-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scenario.body) });
      const response = await worker.fetch(request, { ASSETS: { fetch: async () => new Response('') } }, { waitUntil() {} });
      results.push({ name: scenario.name, status: response.status, cache: response.headers.get('Cache-Control'), body: await response.json(), requests });
    }
  } finally { globalThis.fetch = realFetch; }
  return results;
}
