import { fetchWithTimeout } from '../../shared/http.js';

const GWIC_LAYER_HTTPS = 'https://mbmgmap.mtech.edu/ArcGIS/rest/services/Water/GWIC_wells_map_service_250k_vis/MapServer/0';
const GWIC_LAYER_HTTP = 'http://mbmgmap.mtech.edu/ArcGIS/rest/services/Water/GWIC_wells_map_service_250k_vis/MapServer/0';

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function valueFrom(attrs, candidates) {
  const entries = Object.entries(attrs || {});
  for (const candidate of candidates) {
    const wanted = String(candidate).toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = entries.find(([key]) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '') === wanted);
    if (match && match[1] != null && String(match[1]).trim() !== '') return match[1];
  }
  return null;
}

async function queryEndpoint(base, lat, lon, miles) {
  const latPad = miles / 69;
  const lonPad = miles / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const envelope = {
    xmin: lon - lonPad,
    ymin: lat - latPad,
    xmax: lon + lonPad,
    ymax: lat + latPad,
    spatialReference: { wkid: 4326 }
  };

  const url = new URL(`${base}/query`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', '1=1');
  url.searchParams.set('geometry', JSON.stringify(envelope));
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('resultRecordCount', '2000');

  const response = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'AcresX/0.9 Montana Beta' },
    cf: { cacheTtl: 3600, cacheEverything: true }
  }, 20000);
  if (!response.ok) throw new Error(`GWIC service returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'GWIC query failed');
  return data.features || [];
}

async function queryGwic(lat, lon, miles) {
  try {
    return await queryEndpoint(GWIC_LAYER_HTTPS, lat, lon, miles);
  } catch (httpsError) {
    try {
      return await queryEndpoint(GWIC_LAYER_HTTP, lat, lon, miles);
    } catch {
      throw httpsError;
    }
  }
}

function normalizeFeature(feature) {
  const attrs = feature.attributes || {};
  const geometry = feature.geometry || {};
  const lon = number(geometry.x ?? valueFrom(attrs, ['longitude', 'lon', 'x']));
  const lat = number(geometry.y ?? valueFrom(attrs, ['latitude', 'lat', 'y']));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const gwicId = valueFrom(attrs, ['gwicid', 'gwic_id', 'id']);
  const depth = number(valueFrom(attrs, ['total_depth', 'totaldepth', 'depth']));
  const swl = number(valueFrom(attrs, ['swl', 'static_water_level', 'staticwaterlevel']));
  const siteName = valueFrom(attrs, ['site_name', 'sitename']);
  const reportLink = valueFrom(attrs, ['report_link', 'reportlink']);

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      ID: gwicId != null ? String(gwicId) : '',
      GWICId: gwicId != null ? String(gwicId) : '',
      ProjectName: siteName ? String(siteName) : 'Montana GWIC well',
      CompletedDepth: depth,
      StaticWaterLvl: swl,
      FlowRateGPM: null,
      WorkCompletionDate: null,
      WellProjectType: 'Groundwater well',
      WellSubType: '',
      ReportLink: reportLink ? String(reportLink) : (gwicId ? `https://mbmggwic.mtech.edu/sqlserver/v11/reports/SiteSummary.asp?gwicid=${encodeURIComponent(gwicId)}&agency=mbmg&reqby=M` : ''),
      _source: 'Montana Bureau of Mines and Geology GWIC'
    }
  };
}

export async function findMontanaWells({ lat, lon }) {
  lat = Number(lat);
  lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Montana well search requires parcel coordinates.');

  let miles = 2;
  let normalized = [];
  while (miles <= 64 && normalized.length < 5) {
    const rows = await queryGwic(lat, lon, miles);
    normalized = rows.map(normalizeFeature).filter(Boolean).filter(feature => Number.isFinite(Number(feature.properties.CompletedDepth)) && Number(feature.properties.CompletedDepth) > 0);
    miles *= 2;
  }

  return {
    available: true,
    source: 'Montana Bureau of Mines and Geology — Ground Water Information Center (GWIC)',
    sourceUrl: 'https://mbmggwic.mtech.edu/',
    searchRadiusMiles: miles / 2,
    wells: normalized
  };
}
