import { fetchWithTimeout } from '../shared/http.js';

// Official Gallatin County zoning service. Layer 42 contains the county zoning
// districts and an explicit polygon for areas that are unzoned.
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
  // Use a form-encoded POST instead of a long GET. This has proven more reliable
  // through Cloudflare and avoids ArcGIS geometry parsing differences.
  const params = new URLSearchParams();
  params.set('f', 'json');
  params.set('where', '1=1');
  params.set('geometry', JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
  params.set('geometryType', 'esriGeometryPoint');
  params.set('inSR', '4326');
  params.set('spatialRel', 'esriSpatialRelIntersects');
  params.set('outFields', '*');
  params.set('returnGeometry', 'false');
  params.set('resultRecordCount', '10');

  const response = await fetchWithTimeout(`${ZONING_LAYER}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: params.toString()
  }, 15000);
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
      available: true,
      county: 'Gallatin', state: 'MT', countyStatus: 'gallatin-v2',
      jurisdiction: 'Gallatin County', permitJurisdiction: { name: 'Gallatin County' },
      zoning: {
        status: 'no_mapped_result',
        label: 'No mapped zoning district',
        note: 'No Gallatin County zoning polygon intersects the parcel center. This may be an unzoned location or an area requiring Planning Department verification.',
        sourceUrl: ZONING_LAYER,
        url: GALLATIN_ZONING_GUIDE
      },
      comprehensivePlan: {}, urbanGrowthArea: { intersects: false }, overlays: [], permits: [], permitHistory: [], permitHistoryStatus: 'unavailable',
      source: { agency: 'Gallatin County GIS', service: 'County Zoning Districts', layerId: 42, matchMethod: 'parcel center' }
    };
  }

  const attrs = features[0].attributes || {};
  const code = valueFrom(attrs, ['ZONING','ZONE','ZONE_CODE','ZONECODE','DISTRICT','DISTRICT_CODE','CODE','ZONINGDISTRICT']);
  const name = valueFrom(attrs, ['ZONE_NAME','ZONING_NAME','ZONENAME','DISTRICT_NAME','DISTRICTNAME','NAME','LABEL','DESCRIPTION','ZONINGDISTRICTNAME']);
  const allText = Object.values(attrs).filter(v => v != null).map(String).join(' ');
  const text = `${code} ${name} ${allText}`.trim();
  const unzoned = /\bUNZONED\b|\bNO ZONING\b/i.test(text);
  const label = unzoned ? 'Unzoned' : ([code, name && name !== code ? name : ''].filter(Boolean).join(' — ') || 'Mapped zoning district');

  return {
    available: true,
    county: 'Gallatin', state: 'MT', countyStatus: 'gallatin-v2',
    jurisdiction: 'Gallatin County', permitJurisdiction: { name: 'Gallatin County' },
    zoning: {
      status: unzoned ? 'unzoned' : 'gis_match',
      code: unzoned ? 'UNZONED' : code,
      name: unzoned ? 'Unzoned area' : name,
      label,
      note: unzoned
        ? 'Gallatin County GIS maps this location within its unzoned-area polygon. Verify development requirements with County Planning.'
        : 'Mapped zoning result from Gallatin County GIS using the parcel center.',
      sourceUrl: ZONING_LAYER,
      url: GALLATIN_ZONING_GUIDE
    },
    comprehensivePlan: {}, urbanGrowthArea: { intersects: false }, overlays: [], permits: [], permitHistory: [], permitHistoryStatus: 'unavailable',
    source: { agency: 'Gallatin County GIS', service: 'County Zoning Districts', layerId: 42, matchMethod: 'parcel center', attributes: attrs }
  };
}
