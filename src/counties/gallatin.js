import { fetchWithTimeout } from '../shared/http.js';

// Official Gallatin County zoning service. The layer includes mapped zoning districts
// plus a polygon identifying areas that are unzoned.
const ZONING_LAYER = 'https://services3.arcgis.com/JuknJLoAEm9DTWXh/ArcGIS/rest/services/County_Zoning_Districts/FeatureServer/42';
const GALLATIN_ZONING_GUIDE = 'https://www.gallatinmt.gov/588/Zoning-Guide';

function valueFrom(attrs, candidates) {
  const entries = Object.entries(attrs || {});
  for (const candidate of candidates) {
    const wanted = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const match = entries.find(([key]) => key.toUpperCase().replace(/[^A-Z0-9]/g, '') === wanted);
    if (match && match[1] != null && String(match[1]).trim()) return String(match[1]).trim();
  }
  return '';
}

async function queryPoint(lon, lat) {
  const url = new URL(`${ZONING_LAYER}/query`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', '1=1');
  url.searchParams.set('geometry', `${lon},${lat}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '10');
  const response = await fetchWithTimeout(url, { cf: { cacheTtl: 3600, cacheEverything: true } }, 15000);
  if (!response.ok) throw new Error(`Gallatin zoning service returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Gallatin zoning query failed');
  return data.features || [];
}

export async function getGallatinCountyIntelligence(body) {
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Gallatin zoning requires parcel coordinates.');
  const features = await queryPoint(lon, lat);
  if (!features.length) {
    return {
      available: false, county: 'Gallatin', state: 'MT', countyStatus: 'gallatin-v1',
      jurisdiction: 'Gallatin County', permitJurisdiction: { name: 'Gallatin County' },
      zoning: { status: 'no_mapped_result', label: 'No mapped zoning result found', note: 'Gallatin County GIS returned no zoning polygon at the parcel center. Verify with County Planning.', sourceUrl: ZONING_LAYER, url: GALLATIN_ZONING_GUIDE },
      permits: [], permitHistory: [], permitHistoryStatus: 'unavailable'
    };
  }
  const attrs = features[0].attributes || {};
  const code = valueFrom(attrs, ['ZONING','ZONE','ZONE_CODE','DISTRICT','CODE']);
  const name = valueFrom(attrs, ['ZONE_NAME','ZONING_NAME','DISTRICT_NAME','NAME','LABEL','DESCRIPTION']);
  const text = `${code} ${name}`.trim();
  const unzoned = /UNZONED|NO ZONING/i.test(text);
  const label = unzoned ? 'Unzoned' : ([code, name && name !== code ? name : ''].filter(Boolean).join(' — ') || 'Mapped zoning district');
  return {
    available: true, county: 'Gallatin', state: 'MT', countyStatus: 'gallatin-v1',
    jurisdiction: 'Gallatin County', permitJurisdiction: { name: 'Gallatin County' },
    zoning: {
      status: unzoned ? 'unzoned' : 'gis_match', code: unzoned ? 'UNZONED' : code, name: unzoned ? 'Unzoned area' : name, label,
      note: unzoned ? 'Gallatin County GIS maps this location within its unzoned-area polygon. Verify development requirements with County Planning.' : 'Mapped zoning result from Gallatin County GIS using the parcel center.',
      sourceUrl: ZONING_LAYER, url: GALLATIN_ZONING_GUIDE
    },
    comprehensivePlan: {}, urbanGrowthArea: { intersects: false }, overlays: [], permits: [], permitHistory: [], permitHistoryStatus: 'unavailable',
    source: { agency: 'Gallatin County GIS', service: 'County Zoning Districts', layerId: 42, matchMethod: 'parcel center' }
  };
}
