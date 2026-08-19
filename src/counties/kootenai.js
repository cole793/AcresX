import { fetchWithTimeout } from '../shared/http.js';

const KC_ZONING = 'https://gis.kcgov.us/arcgis/rest/services/KC_Dynamic_Layers/MapServer/24';
const KC_PLANNING = 'https://www.kcgov.us/230/Planning';

function normalizeKey(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function valueFrom(attrs, candidates) {
  const entries = Object.entries(attrs || {});
  for (const candidate of candidates) {
    const wanted = normalizeKey(candidate);
    const match = entries.find(([key]) => normalizeKey(key) === wanted);
    if (match && match[1] != null && String(match[1]).trim()) return String(match[1]).trim();
  }
  return '';
}

function usefulZoneValue(attrs) {
  const preferred = valueFrom(attrs, [
    'ZONE_NAME','ZONENAME','ZONING','ZONE','ZONE_CODE','ZONECODE','DISTRICT','DISTRICT_NAME','CLASS','CLASSIFICATION','DESCRIPTION','DESC','LANDUSE','LAND_USE'
  ]);
  if (preferred && preferred.length > 1) return preferred;

  // Kootenai's layer has changed schemas over time. Prefer a meaningful zoning-looking
  // string and explicitly reject one-character flags such as "X".
  const ignored = /OBJECTID|GLOBALID|SHAPE|AREA|LENGTH|CREATED|EDITED|STATUS|ACTIVE|FLAG|LABEL/i;
  const values = Object.entries(attrs || {})
    .filter(([key, value]) => !ignored.test(key) && value != null)
    .map(([, value]) => String(value).trim())
    .filter(value => value.length > 1 && value.length < 120);

  const countyZone = values.find(value => /^(COUNTY[-\s])|\b(AG|AGRICULT|RURAL|COMMERCIAL|INDUSTRIAL|RESIDENTIAL|SUBURBAN)\b/i.test(value));
  return countyZone || values[0] || '';
}

async function queryPoint(lon, lat) {
  const url = new URL(`${KC_ZONING}/query`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', '1=1');
  url.searchParams.set('geometry', `${lon},${lat}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '10');

  const response = await fetchWithTimeout(url, {
    cf: { cacheTtl: 1800, cacheEverything: true }
  }, 20000);
  if (!response.ok) throw new Error(`Kootenai County zoning service returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Kootenai County zoning query failed');
  return data.features || [];
}

export async function getKootenaiCountyIntelligence(body) {
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Kootenai zoning requires parcel coordinates.');

  const features = await queryPoint(lon, lat);
  if (!features.length) {
    return {
      available: false,
      county: 'Kootenai', state: 'ID', countyStatus: 'kootenai-v1',
      jurisdiction: 'Kootenai County', permitJurisdiction: { name: 'Kootenai County' },
      zoning: {
        status: 'no_mapped_result',
        label: 'No mapped zoning result found',
        note: 'Kootenai County GIS returned no zoning polygon at the parcel center. Verify with Community Development.',
        sourceUrl: KC_ZONING,
        url: KC_PLANNING
      },
      permits: [], permitHistory: [], permitHistoryStatus: 'unavailable'
    };
  }

  const attrs = features[0].attributes || {};
  const zone = usefulZoneValue(attrs);
  return {
    available: Boolean(zone),
    county: 'Kootenai', state: 'ID', countyStatus: 'kootenai-v1',
    jurisdiction: 'Kootenai County', permitJurisdiction: { name: 'Kootenai County' },
    zoning: {
      status: zone ? 'gis_match' : 'unavailable',
      code: zone,
      name: zone,
      label: zone || 'Mapped zoning result unavailable',
      note: zone ? 'Mapped zoning designation from Kootenai County’s official zoning layer using the parcel center.' : 'The county zoning layer intersected the parcel, but AcresX could not identify a meaningful zoning field.',
      sourceUrl: KC_ZONING,
      url: KC_PLANNING
    },
    comprehensivePlan: {}, urbanGrowthArea: { intersects: false }, overlays: [],
    permits: [], permitHistory: [], permitHistoryStatus: 'unavailable',
    source: { agency: 'Kootenai County GIS', service: 'KC Dynamic Layers — Zoning', layerId: 24, matchMethod: 'parcel center', attributes: attrs }
  };
}
