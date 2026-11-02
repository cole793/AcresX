import { cachedJson, upstreamJson } from '../shared/upstream.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';

// Answers are cached per parcel for a day (Cache API), only when every layer query that ran
// succeeded (a failed layer could hide the controlling zone).
// Owner and mailing fields are removed (src/shared/personal-fields.js) before an answer is
// stored or used, so neither a cache hit nor a fresh answer carries them. Bump the version in the
// prefix whenever the fields requested or stripped change, so no entry in the old shape survives.
export const YELLOWSTONE_CACHE_PREFIX = 'https://acresx.internal/cache/yellowstone-intelligence/v2/';
const CACHE_TTL_SECONDS = 24 * 60 * 60;

const ZONING_SERVICE = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer';
// City-County Planning serves both Billings and Yellowstone County (page loaded 2026-11-02).
const YELLOWSTONE_PLANNING = 'https://www.billingsmt.gov/184/CityCounty-Planning';

const BASE_ZONE_LAYERS = [
  { id: 4, jurisdiction: 'City of Billings', label: 'Billings Zoning' },
  { id: 8, jurisdiction: 'City of Laurel', label: 'Laurel Zoning' },
  { id: 0, jurisdiction: 'Town of Broadview', label: 'Broadview Zoning' },
  { id: 2, jurisdiction: 'Yellowstone County', label: 'Yellowstone County Zoning' }
];

const ENTRYWAY_LAYER = { id: 1, jurisdiction: 'Yellowstone County', label: 'Entryway Zoning District' };

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

function geoJsonToEsriPolygon(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return null;
  return {
    rings: geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat(),
    spatialReference: { wkid: 4326 }
  };
}

async function queryLayer(layerId, { lon, lat, geometry } = {}) {
  const url = new URL(`${ZONING_SERVICE}/${layerId}/query`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', '1=1');

  const esriPolygon = geoJsonToEsriPolygon(geometry);
  if (esriPolygon) {
    url.searchParams.set('geometry', JSON.stringify(esriPolygon));
    url.searchParams.set('geometryType', 'esriGeometryPolygon');
  } else {
    url.searchParams.set('geometry', `${lon},${lat}`);
    url.searchParams.set('geometryType', 'esriGeometryPoint');
  }

  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '10');

  // Was one 15 s attempt; now 9 s + one retry at 6 s (body included).
  const data = await upstreamJson(url, {
    timeoutMs: 9000, retryTimeoutMs: 6000, arcgis: true, label: `yellowstone-zoning-${layerId}`,
    agency: `Yellowstone zoning layer ${layerId}`, arcgisMessage: `Yellowstone zoning layer ${layerId} failed`
  });
  return data.features || [];
}

// Layer 7 ("Zoning Jurisdictions") has no NAME value; its only label is
// ZoningJurisdictions_Entity ('BILLINGS' or 'LAUREL', checked live 2026-11-02). The old generic
// fallback picked the first other non-empty attribute instead, so Billings parcels showed
// jurisdiction "2". Broadview has no polygon there; its zoning layer names it instead.
const JURISDICTION_NAMES = { BILLINGS: 'City of Billings', LAUREL: 'City of Laurel', BROADVIEW: 'Town of Broadview' };

export function jurisdictionFromEntity(value) {
  const key = String(value || '').trim().toUpperCase();
  if (!key) return '';
  return JURISDICTION_NAMES[key] || `City of ${key.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())}`;
}

async function queryJurisdiction(lon, lat, geometry, failures) {
  try {
    let features = await queryLayer(7, { lon, lat });
    if (!features.length && geometry) features = await queryLayer(7, { geometry });
    return jurisdictionFromEntity(features[0]?.attributes?.ZoningJurisdictions_Entity);
  } catch (error) {
    failures.push(error);
    return '';
  }
}

function parseZone(attrs) {
  const code = valueFrom(attrs, ['ZONE','ZONE_CODE','ZONECODE','ZONING','ZONING_CODE','DISTRICT','DISTRICT_NO','DISTRICTNO','CODE','ZONE_ID','ZONEID']);
  const name = valueFrom(attrs, ['ZONE_NAME','ZONENAME','ZONING_NAME','DISTRICT_NAME','DISTRICTNAME','DESCRIPTION','DESC','NAME','LABEL']);
  const fallback = fallbackZoneValue(attrs);
  return {
    code: code || fallback || '',
    name: name && normalize(name) !== normalize(code) ? name : ''
  };
}

async function findBaseZone(lon, lat, geometry, errors) {
  // First use the parcel centroid because that gives one clear controlling zone in most cases.
  for (const layer of BASE_ZONE_LAYERS) {
    try {
      const features = await queryLayer(layer.id, { lon, lat });
      if (features.length) return { layer, attrs: features[0].attributes || {}, matchMethod: 'parcel center' };
    } catch (error) {
      errors.push(`${layer.label} point query: ${error.message}`);
    }
  }

  // If the center point misses, intersect the entire parcel. This catches edge parcels,
  // irregular parcels and polygons that straddle a mapped jurisdiction boundary.
  if (geometry) {
    for (const layer of BASE_ZONE_LAYERS) {
      try {
        const features = await queryLayer(layer.id, { geometry });
        if (features.length) return { layer, attrs: features[0].attributes || {}, matchMethod: 'parcel intersection' };
      } catch (error) {
        errors.push(`${layer.label} parcel query: ${error.message}`);
      }
    }
  }

  return null;
}

async function findEntrywayOverlay(lon, lat, geometry, failures) {
  try {
    let features = await queryLayer(ENTRYWAY_LAYER.id, { lon, lat });
    if (!features.length && geometry) features = await queryLayer(ENTRYWAY_LAYER.id, { geometry });
    return features.length ? { layer: ENTRYWAY_LAYER, attrs: features[0].attributes || {} } : null;
  } catch (error) {
    failures.push(error);
    return null;
  }
}

export async function getYellowstoneCountyIntelligence(body) {
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const geometry = body.geometry || null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Yellowstone zoning requires parcel coordinates.');
  const failures = [];
  return cachedJson(YELLOWSTONE_CACHE_PREFIX, { lat, lon, geometry }, CACHE_TTL_SECONDS,
    async () => withoutPersonalFields(await lookupYellowstone(lon, lat, geometry, failures)),
    { isValid: () => failures.length === 0 });
}

async function lookupYellowstone(lon, lat, geometry, failures) {
  const jurisdictionName = await queryJurisdiction(lon, lat, geometry, failures);
  const errors = [];
  const match = await findBaseZone(lon, lat, geometry, errors);
  failures.push(...errors);
  const entryway = await findEntrywayOverlay(lon, lat, geometry, failures);

  if (!match && entryway) {
    const jurisdiction = jurisdictionName || 'Yellowstone County';
    return {
      available: true,
      county: 'Yellowstone',
      state: 'MT',
      countyStatus: 'yellowstone-v2',
      jurisdiction,
      permitJurisdiction: { name: jurisdiction },
      zoning: {
        status: 'gis_match',
        code: 'ENTRYWAY',
        name: 'Entryway Zoning District',
        label: 'ENTRYWAY — Entryway Zoning District',
        note: 'The parcel intersects Yellowstone County’s Entryway Zoning District. No separate base-zoning polygon was returned, so verify the controlling district and development standards with county planning.',
        sourceUrl: `${ZONING_SERVICE}/${ENTRYWAY_LAYER.id}`,
        url: 'https://gis.yellowstonecountymt.gov/'
      },
      comprehensivePlan: {},
      urbanGrowthArea: { intersects: false },
      overlays: [{ code: 'ENTRYWAY', name: 'Entryway Zoning District' }],
      permits: [],
      permitHistory: [],
      permitHistoryStatus: 'unavailable',
      permitHistoryError: 'Recorded permit-history screening for Yellowstone County is not connected yet.',
      source: { agency: 'Yellowstone County GIS', service: ENTRYWAY_LAYER.label, layerId: ENTRYWAY_LAYER.id }
    };
  }

  if (!match) {
    // Unzoned, but only when every layer answered: a failed layer could hide the controlling zone.
    // Source: the Yellowstone County Zoning Regulations (Dec 2020, billingsmt.gov/DocumentCenter/
    // View/54714) say "This chapter applies to all lands within the Yellowstone County zoning
    // jurisdiction" (Sec. 27-103), and City-County Planning's Special Zoning Districts FAQ
    // (billingsmt.gov/DocumentCenter/View/56399) says "Outside incorporated cities, there are many
    // smaller settlements in Yellowstone County ... Most of these areas do not have any land use
    // plans or development standards other than basic health and sanitary regulations." This
    // service holds every zoning layer the county publishes (Billings, Laurel, Broadview, the
    // special zoning districts 12-20 and Entryway); a parcel in none of them is outside zoning.
    const jurisdiction = jurisdictionName || 'Yellowstone County';
    const allAnswered = failures.length === 0;
    return {
      available: allAnswered,
      county: 'Yellowstone',
      state: 'MT',
      countyStatus: 'yellowstone-v2',
      jurisdiction,
      permitJurisdiction: { name: jurisdiction },
      zoning: allAnswered ? {
        status: 'unzoned',
        code: 'UNZONED',
        name: 'Unzoned area',
        label: 'Unzoned (no county zoning district mapped)',
        note: 'No county zoning district is mapped here; much of rural Yellowstone County is unzoned. Verify with Yellowstone County Planning. AcresX checked the parcel center and the full parcel boundary against the Billings, Laurel, Broadview, special zoning district and Entryway layers.',
        sourceUrl: `${ZONING_SERVICE}`,
        url: YELLOWSTONE_PLANNING
      } : {
        status: 'no_mapped_result',
        label: 'No mapped zoning district found',
        note: 'AcresX checked the parcel center and the full parcel boundary against Yellowstone County, Billings, Laurel, Broadview and Entryway zoning layers, but at least one layer did not answer, so a zone may be missing. Verify with the applicable planning authority before relying on this result.',
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
  const overlays = entryway ? [{ code: 'ENTRYWAY', name: 'Entryway Zoning District' }] : [];
  return {
    available: true,
    county: 'Yellowstone',
    state: 'MT',
    countyStatus: 'yellowstone-v2',
    jurisdiction,
    permitJurisdiction: { name: jurisdiction },
    zoning: {
      status: 'gis_match',
      code: zone.code,
      name: zone.name || match.layer.label,
      label: [zone.code, zone.name].filter(Boolean).join(' — ') || match.layer.label,
      note: `Mapped ${match.layer.label} result from Yellowstone County GIS using ${match.matchMethod}.${entryway ? ' Entryway Zoning District also intersects the parcel.' : ''}`,
      sourceUrl: `${ZONING_SERVICE}/${match.layer.id}`,
      url: 'https://gis.yellowstonecountymt.gov/'
    },
    comprehensivePlan: {},
    urbanGrowthArea: { intersects: false },
    overlays,
    permits: [],
    permitHistory: [],
    permitHistoryStatus: 'unavailable',
    permitHistoryError: 'Recorded permit-history screening for Yellowstone County is not connected yet.',
    source: {
      agency: 'Yellowstone County GIS',
      service: match.layer.label,
      layerId: match.layer.id,
      matchMethod: match.matchMethod
    }
  };
}
