import { fetchWithTimeout } from '../../shared/http.js';

// Current Montana Bureau of Mines and Geology GWIC Boreholes layer.
// This layer contains point geometry plus total depth, static water level,
// completion date and GWIC identifiers in one queryable feature layer.
const GWIC_BOREHOLES = 'https://mbmgmap.mtech.edu/server/rest/services/Water_Resources/GWIC_Database/FeatureServer/4';

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

async function queryGwic(lat, lon, miles) {
  const latPad = miles / 69;
  const lonPad = miles / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const envelope = {
    xmin: lon - lonPad,
    ymin: lat - latPad,
    xmax: lon + lonPad,
    ymax: lat + latPad,
    spatialReference: { wkid: 4326 }
  };

  const url = new URL(`${GWIC_BOREHOLES}/query`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', 'total_depth_ft_bgs IS NOT NULL AND total_depth_ft_bgs > 0');
  url.searchParams.set('geometry', JSON.stringify(envelope));
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outFields', 'gwicid,site_name,latitude,longitude,total_depth_ft_bgs,static_water_level_ft_bgs,date_completed,status,construction_type,site_type,abandoned_flag');
  url.searchParams.set('resultRecordCount', '2000');

  const response = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'AcresX/0.9 Montana Beta' },
    cf: { cacheTtl: 3600, cacheEverything: true }
  }, 20000);

  if (!response.ok) throw new Error(`GWIC Boreholes service returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'GWIC Boreholes query failed');
  return data.features || [];
}

function normalizeFeature(feature) {
  const attrs = feature.attributes || {};
  const geometry = feature.geometry || {};
  const lon = number(geometry.x ?? valueFrom(attrs, ['longitude', 'lon', 'x']));
  const lat = number(geometry.y ?? valueFrom(attrs, ['latitude', 'lat', 'y']));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const gwicId = valueFrom(attrs, ['gwicid', 'gwic_id', 'id']);
  const depth = number(valueFrom(attrs, ['total_depth_ft_bgs', 'total_depth', 'totaldepth', 'depth']));
  const swl = number(valueFrom(attrs, ['static_water_level_ft_bgs', 'swl', 'static_water_level', 'staticwaterlevel']));
  const siteName = valueFrom(attrs, ['site_name', 'sitename']);
  const completed = valueFrom(attrs, ['date_completed', 'completion_date', 'completed_date']);
  const status = valueFrom(attrs, ['status']);
  const constructionType = valueFrom(attrs, ['construction_type']);
  const siteType = valueFrom(attrs, ['site_type']);
  const abandoned = String(valueFrom(attrs, ['abandoned_flag']) || '').trim().toUpperCase();
  if (['Y', 'YES', 'TRUE'].includes(abandoned)) return null;

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      ID: gwicId != null ? String(gwicId) : '',
      GWICId: gwicId != null ? String(gwicId) : '',
      WellTagNr: gwicId != null ? String(gwicId) : '',
      ProjectName: siteName ? String(siteName) : 'Montana GWIC well',
      FileName: gwicId != null ? `GWIC ${gwicId}` : '',
      CompletedDepth: depth,
      StaticWaterLvl: swl,
      FlowRateGPM: null,
      WorkCompletionDate: completed,
      WellProjectType: siteType ? String(siteType) : 'Groundwater well',
      WellSubType: constructionType ? String(constructionType) : '',
      Status: status ? String(status) : '',
      ReportLink: gwicId ? `https://mbmggwic.mtech.edu/sqlserver/v11/reports/SiteSummary.asp?gwicid=${encodeURIComponent(gwicId)}&agency=mbmg&reqby=M` : '',
      _source: 'Montana Bureau of Mines and Geology GWIC — Boreholes'
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
    normalized = rows
      .map(normalizeFeature)
      .filter(Boolean)
      .filter(feature => Number.isFinite(Number(feature.properties.CompletedDepth)) && Number(feature.properties.CompletedDepth) > 0);
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
