// GET /api/upstream-health: can this Worker reach the servers AcresX depends on?
//
// One tiny read-only request per target, all in parallel, each bounded by 10 s (no retry),
// through the shared client (so each probe is also a Workers Logs line). ArcGIS servers get
// <server>/rest/info?f=json (a few hundred bytes); USDA SDA gets a one-row catalog query; EPQS one
// point. No secrets, no writes, no owner data. Answer:
//   { checkedAt, results: [{ host, name, ok, status, ms, error }] }   (Cache-Control: no-store)
// Cheap enough to call by hand; the app does not call it. Answers are reused for 60 s (below).
import { json } from '../shared/http.js';
import { upstreamJson } from '../shared/upstream.js';

export const HEALTH_TIMEOUT_MS = 10000;

const arcgisInfo = (name, server) => ({ name, url: `${server}/rest/info?f=json`, arcgis: true });

export const HEALTH_TARGETS = [
  arcgisInfo('FEMA NFHL flood', 'https://hazards.fema.gov/arcgis'),
  arcgisInfo('Esri USA Flood Hazard Areas (flood backup)', 'https://services5.arcgis.com/7weheFjxuNkGGiZi/arcgis'),
  // elevation.nationalmap.gov/arcgis/rest/info answered 502 on 2026-10-28 while the ImageServer
  // itself worked, so this probe reads the service we use (about 11 KB).
  { name: 'USGS 3DEP elevation', url: 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer?f=json', arcgis: true },
  { name: 'USGS EPQS elevation point', url: 'https://epqs.nationalmap.gov/v1/json?x=-117.4&y=47.6&wkid=4326&units=Feet&includeDate=false' },
  {
    name: 'USDA Soil Data Access', url: 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest', method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'SELECT TOP 1 areasymbol FROM sacatalog', format: 'JSON' })
  },
  arcgisInfo('USFWS NWI wetlands', 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice'),
  arcgisInfo('Esri GeometryServer (wetlands clip)', 'https://utility.arcgisonline.com/ArcGIS'),
  arcgisInfo('USFS tree canopy', 'https://imagery.geoplatform.gov/iipp'),
  arcgisInfo('HIFLD electric retail territories', 'https://services3.arcgis.com/OYP7N6mAJJCyH6hd/arcgis'),
  arcgisInfo('Spokane County GIS', 'https://gismo.spokanecounty.org/arcgis'),
  arcgisInfo('WA Ecology well reports', 'https://services.arcgis.com/6lCKYNJLvwTXqrmp/ArcGIS'),
  arcgisInfo('Stevens County GIS', 'https://gis.stevenscountywa.gov/server'),
  arcgisInfo('Kootenai County GIS', 'https://map.kcgov.us/arcgis'),
  arcgisInfo("City of Coeur d'Alene GIS", 'https://gis.cdaid.org/server'),
  arcgisInfo('City of Post Falls GIS', 'https://gis.postfalls.gov/server'),
  arcgisInfo('Idaho statewide parcels', 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/ArcGIS'),
  arcgisInfo('IDWR (Idaho wells, parcels)', 'https://gis.idwr.idaho.gov/hosting'),
  arcgisInfo('Montana DNRC cadastral', 'https://gis.dnrc.mt.gov/arcgis'),
  arcgisInfo('Montana GWIC wells', 'https://mbmgmap.mtech.edu/server'),
  arcgisInfo('Yellowstone County GIS', 'https://gis.yellowstonecountymt.gov/arcgis'),
  arcgisInfo('Gallatin County zoning', 'https://services3.arcgis.com/JuknJLoAEm9DTWXh/ArcGIS')
];

async function probe(target, timeoutMs) {
  const host = new URL(target.url).hostname;
  const started = Date.now();
  const meta = {};
  try {
    await upstreamJson(target.url, {
      method: target.method || 'GET', headers: target.headers, body: target.body, arcgis: Boolean(target.arcgis),
      timeoutMs, retries: 0, label: `health:${target.name}`, agency: host, meta
    });
    return { host, name: target.name, ok: true, status: meta.status ?? null, ms: Date.now() - started, error: null };
  } catch (error) {
    return {
      host, name: target.name, ok: false, status: error?.status ?? null, ms: Date.now() - started,
      error: error?.kind ? `${error.kind}: ${error.message}` : String(error?.message || error)
    };
  }
}

export async function checkUpstreamHealth(targets = HEALTH_TARGETS, timeoutMs = HEALTH_TIMEOUT_MS) {
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(targets.map(target => probe(target, timeoutMs)));
  return { checkedAt, results };
}

// The route is public, so one answer is reused for HEALTH_MEMO_MS within an isolate (concurrent
// hits share the run in progress): repeated GETs do not fan out 21 requests to government
// servers each time. checkedAt says how old the answer is.
export const HEALTH_MEMO_MS = 60000;
let memo = null; // { startedAt, promise }

export function resetUpstreamHealthMemo() { memo = null; }

export async function handleUpstreamHealth() {
  const now = Date.now();
  if (!memo || now - memo.startedAt >= HEALTH_MEMO_MS) {
    const promise = checkUpstreamHealth();
    memo = { startedAt: now, promise };
    promise.catch(() => { if (memo?.promise === promise) memo = null; });
  }
  return json(await memo.promise, 200, 'no-store');
}
