import { fetchWithTimeout } from '../shared/http.js';

const ZONING_SERVICE = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer';

const ZONE_LAYERS = [
  { id: 4, jurisdiction: 'City of Billings', label: 'Billings Zoning' },
  { id: 8, jurisdiction: 'City of Laurel', label: 'Laurel Zoning' },
  { id: 0, jurisdiction: 'Town of Broadview', label: 'Broadview Zoning' },
  { id: 2, jurisdiction: 'Yellowstone County', label: 'Yellowstone County Zoning' }
];

function normalize(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function valueFrom(attrs, candidates) {
  const entries = Object.entries(attrs || {});
  for (const candidate of candidates) {
    const wanted = normalize(candidate);
    const match = entries.find(([key]) => normalize(key) === wanted);
    if (match && match[1] != null && String(match[1]).trim()) return String(match[1]).trim();
  }
  return '';
}

function fallbackZoneValue(attrs) {
  const ignored = /OBJECTID|GLOBALID|SHAPE|CREATED|EDITED|USER|DATE|AREA|LENGTH/i;
  for (const [key, value] of Object.entries(attrs || {})) {
    if (ignored.test(key) || value == null || String(value).trim() === '') continue;
    const text = String(value).trim();
    if (text.length <= 100) return text;
  }
  return '';
}

async function queryLayer(layerId, lon, lat) {
  const url = new URL(`${ZONING_SERVICE}/${layerId}/query`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', '1=1');
  url.searchParams.set('geometry', `${lon},${lat}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '5');

  const response = await fetchWithTimeout(url, {
    cf: { cacheTtl: 3600, cacheEverything: true }
  }, 15000);
  if (!response.ok) throw new Error(`Yellowstone zoning layer ${layerId} returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || `Yellowstone zoning layer ${layerId} failed`);
  return data.features || [];
}

async function queryJurisdiction(lon, lat) {
  try {
    const features = await queryLayer(7, lon, lat);
    const attrs = features[0]?.attributes || {};
    return valueFrom(attrs, ['JURISDICTION','JURISDICT','NAME','AGENCY','ENTITY','CITY']) || fallbackZoneValue(attrs);
  } catch {
    return '';
  }
}

function parseZone(attrs) {
  const code = valueFrom(attrs, ['ZONE','ZONE_CODE','ZONECODE','ZONING','ZONING_CODE','DISTRICT','CODE','ZONE_ID']);
  const name = valueFrom(attrs, ['ZONE_NAME','ZONENAME','ZONING_NAME','DISTRICT_NAME','DESCRIPTION','DESC','NAME','LABEL']);
  const fallback = fallbackZoneValue(attrs);
  return {
    code: code || fallback || '',
    name: name && normalize(name) !== normalize(code) ? name : ''
  };
}

export async function getYellowstoneCountyIntelligence(body) {
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Yellowstone zoning requires parcel coordinates.');

  const jurisdictionName = await queryJurisdiction(lon, lat);
  let match = null;
  const errors = [];

  for (const layer of ZONE_LAYERS) {
    try {
      const features = await queryLayer(layer.id, lon, lat);
      if (features.length) {
        match = { layer, attrs: features[0].attributes || {} };
        break;
      }
    } catch (error) {
      errors.push(`${layer.label}: ${error.message}`);
    }
  }

  if (!match) {
    return {
      available: false,
      county: 'Yellowstone',
      state: 'MT',
      countyStatus: 'yellowstone-v1',
      jurisdiction: jurisdictionName || 'Yellowstone County',
      permitJurisdiction: { name: jurisdictionName || 'Yellowstone County' },
      zoning: {
        status: 'no_mapped_result',
        label: 'No mapped zoning result',
        note: 'No county, Billings, Laurel, or Broadview zoning polygon was returned at the parcel center.',
        sourceUrl: `${ZONING_SERVICE}`
      },
      permits: [],
      permitHistory: [],
      permitHistoryStatus: 'unavailable',
      permitHistoryError: 'Yellowstone permit-history adapter has not been connected yet.',
      errors
    };
  }

  const zone = parseZone(match.attrs);
  const jurisdiction = jurisdictionName || match.layer.jurisdiction;
  return {
    available: true,
    county: 'Yellowstone',
    state: 'MT',
    countyStatus: 'yellowstone-v1',
    jurisdiction,
    permitJurisdiction: { name: jurisdiction },
    zoning: {
      status: 'gis_match',
      code: zone.code,
      name: zone.name || match.layer.label,
      label: [zone.code, zone.name].filter(Boolean).join(' — ') || match.layer.label,
      note: `Mapped ${match.layer.label} result from Yellowstone County GIS.`,
      sourceUrl: `${ZONING_SERVICE}/${match.layer.id}`,
      url: 'https://gis.yellowstonecountymt.gov/'
    },
    comprehensivePlan: {},
    urbanGrowthArea: { intersects: false },
    permits: [],
    permitHistory: [],
    permitHistoryStatus: 'unavailable',
    permitHistoryError: 'Recorded permit-history screening for Yellowstone County is not connected yet.',
    source: {
      agency: 'Yellowstone County GIS',
      service: match.layer.label,
      layerId: match.layer.id
    }
  };
}
