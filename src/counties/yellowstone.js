import { cachedJson } from '../shared/upstream.js';
import { arcgisQuery, spatialParams } from '../shared/arcgis.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { ringsFromGeometry, samplePoints, coverageShares, coverageNote } from '../shared/polygon-coverage.js';

// Answers are cached per parcel for a day (Cache API), only when every layer query that ran
// succeeded (a failed layer could hide the controlling zone).
// Owner and mailing fields are removed (src/shared/personal-fields.js) before an answer is
// stored or used, so neither a cache hit nor a fresh answer carries them. Bump the version in the
// prefix whenever the fields requested or stripped change, so no entry in the old shape survives.
// v3: layers are read across the parcel outline with named fields only.
export const YELLOWSTONE_CACHE_PREFIX = 'https://acresx.internal/cache/yellowstone-intelligence/v3/';
const CACHE_TTL_SECONDS = 24 * 60 * 60;

const ZONING_SERVICE = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer';
// City-County Planning serves both Billings and Yellowstone County (pages loaded 2026-11-02). The
// Zoning Information page links each special zoning district's regulations.
const YELLOWSTONE_PLANNING = 'https://www.billingsmt.gov/184/CityCounty-Planning';
const YELLOWSTONE_ZONING_INFO = 'https://www.billingsmt.gov/755/Zoning-Information';

// Earlier layers win where polygons overlap. Layer 2 holds the county's special zoning districts
// 12-20 (CODE 'D16', DIST_NO 16, Name '16'); the city layers hold ZONE_CODE / ZONE_NAME.
const BASE_ZONE_LAYERS = [
  { id: 4, jurisdiction: 'City of Billings', label: 'Billings Zoning' },
  { id: 8, jurisdiction: 'City of Laurel', label: 'Laurel Zoning' },
  { id: 0, jurisdiction: 'Town of Broadview', label: 'Broadview Zoning' },
  { id: 2, jurisdiction: 'Yellowstone County', label: 'Yellowstone County Zoning', special: true }
];
const LAYER_BY_ID = Object.fromEntries(BASE_ZONE_LAYERS.map(l => [l.id, l]));
// Field lists checked live 2026-11-02 (`<layer>?f=json`). Layer 1 (Entryway) has no attribute
// besides ids and edit stamps, so only its presence is read.
const ZONE_FIELDS = 'ZONE_CODE,ZONE_NAME,CODE,DIST_NO,Name';
const JURISDICTION_LAYER = 7;
const ENTRYWAY_LAYER = { id: 1, jurisdiction: 'Yellowstone County', label: 'Entryway Zoning District' };

const text = value => String(value ?? '').trim();
const round3 = n => Math.round(n * 1000) / 1000;

function queryLayer(layerId, where, extra = {}) {
  // Was 9 s + one retry at 6 s; same budget through the shared ArcGIS helper.
  return arcgisQuery(`${ZONING_SERVICE}/${layerId}`, { ...spatialParams(where), ...extra }, {
    agency: `Yellowstone zoning layer ${layerId}`, label: `yellowstone-zoning-${layerId}`,
    arcgisMessage: `Yellowstone zoning layer ${layerId} failed`, timeoutMs: 9000, retryTimeoutMs: 6000
  });
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

// { code, name, label } for one zoning feature. Special districts read "Special Zoning District
// 16" (code D16) instead of the layer's bare "D16 — 16".
export function parseZone(attrs, layer) {
  if (layer?.special) {
    const number = text(attrs.DIST_NO) || text(attrs.Name) || text(attrs.CODE).replace(/^D/i, '');
    const code = text(attrs.CODE) || (number ? `D${number}` : '');
    const name = number ? `Special Zoning District ${number}` : '';
    return { code, name, label: name || code };
  }
  const code = text(attrs.ZONE_CODE) || text(attrs.Name) || text(attrs.CODE);
  const rawName = text(attrs.ZONE_NAME);
  const name = rawName && rawName.toUpperCase() !== code.toUpperCase() ? rawName : '';
  return { code, name, label: [code, name].filter(Boolean).join(' — ') };
}

export async function getYellowstoneCountyIntelligence(body) {
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Yellowstone zoning requires parcel coordinates.');
  const rings = ringsFromGeometry(body.geometry);
  const failures = [];
  return cachedJson(YELLOWSTONE_CACHE_PREFIX, { lat, lon, rings }, CACHE_TTL_SECONDS,
    async () => withoutPersonalFields(await lookupYellowstone(lon, lat, rings, failures)),
    { isValid: () => failures.length === 0 });
}

async function lookupYellowstone(lon, lat, rings, failures) {
  const where = { rings, lon, lat };
  const samples = rings ? samplePoints(rings) : [[lon, lat]];
  const matchMethod = rings ? 'parcel area (sampled)' : 'parcel location';
  const kind = rings ? 'parcel' : 'point';
  const errors = [];

  // Every layer at once, each read across the parcel outline (or at the point without one).
  const settle = (promise, label) => promise.catch(error => { errors.push(`${label} ${kind} query: ${error.message}`); failures.push(error); return null; });
  const [jurisdictionFeatures, entrywayFeatures, ...zoneAnswers] = await Promise.all([
    settle(queryLayer(JURISDICTION_LAYER, where, { outFields: 'ZoningJurisdictions_Entity' }), 'Zoning Jurisdictions'),
    settle(queryLayer(ENTRYWAY_LAYER.id, where, { outFields: 'OBJECTID', returnGeometry: 'false' }), ENTRYWAY_LAYER.label),
    ...BASE_ZONE_LAYERS.map(layer => settle(queryLayer(layer.id, where, { outFields: ZONE_FIELDS }), layer.label))
  ]);

  const jurisdictionName = majorityJurisdiction(samples, jurisdictionFeatures || []);
  const entryway = Boolean(entrywayFeatures?.length);
  // In layer order, so where zones overlap the earlier layer covers the sample point.
  const zoneFeatures = BASE_ZONE_LAYERS.flatMap((layer, i) => (zoneAnswers[i] || []).map(f => ({ attributes: { ...(f.attributes || {}), __layer: layer.id }, geometry: f.geometry })));
  const covered = coverageShares(samples, zoneFeatures, a => {
    const code = parseZone(a, LAYER_BY_ID[a.__layer]).code;
    return code ? `${a.__layer}:${code}` : '';
  }).filter(s => s.key);
  const top = covered[0];

  if (!top && entryway) {
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

  if (!top) {
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
    const checked = rings ? 'the full parcel boundary' : 'the parcel location';
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
        note: `No county zoning district is mapped here; much of rural Yellowstone County is unzoned. Verify with Yellowstone County Planning. AcresX checked ${checked} against the Billings, Laurel, Broadview, special zoning district and Entryway layers.`,
        sourceUrl: `${ZONING_SERVICE}`,
        url: YELLOWSTONE_PLANNING
      } : {
        status: 'no_mapped_result',
        label: 'No mapped zoning district found',
        note: `AcresX checked ${checked} against Yellowstone County, Billings, Laurel, Broadview and Entryway zoning layers, but at least one layer did not answer, so a zone may be missing. Verify with the applicable planning authority before relying on this result.`,
        sourceUrl: `${ZONING_SERVICE}`
      },
      permits: [],
      permitHistory: [],
      permitHistoryStatus: 'unavailable',
      permitHistoryError: 'Yellowstone permit-history adapter has not been connected yet.',
      errors
    };
  }

  const layer = LAYER_BY_ID[top.attributes.__layer];
  const zone = parseZone(top.attributes, layer);
  const display = s => { const a = s.attributes || {}; const z = parseZone(a, LAYER_BY_ID[a.__layer]); return LAYER_BY_ID[a.__layer]?.special ? z.name || z.code : z.code; };
  const others = covered.slice(1).filter(s => s.share >= 0.05);
  const shareNote = samples.length > 1
    ? coverageNote({ key: display(top), share: top.share }, others.map(s => ({ key: display(s), share: s.share })), 1 - covered.reduce((t, s) => t + s.share, 0), 'zoning district')
    : '';
  const jurisdiction = jurisdictionName || layer.jurisdiction;
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
      name: zone.name || layer.label,
      label: zone.label || layer.label,
      note: `Mapped ${layer.label} result from Yellowstone County GIS using ${matchMethod}.${shareNote}${entryway ? ' Entryway Zoning District also intersects the parcel.' : ''}`,
      sourceUrl: `${ZONING_SERVICE}/${layer.id}`,
      url: layer.special ? YELLOWSTONE_ZONING_INFO : 'https://gis.yellowstonecountymt.gov/',
      ...(others.length ? { otherZones: others.map(s => ({ code: display(s), share: round3(s.share) })) } : {})
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
      service: layer.label,
      layerId: layer.id,
      matchMethod
    }
  };
}

// The zoning jurisdiction (layer 7) covering most of the parcel, or '' when most of it is outside
// every jurisdiction polygon.
function majorityJurisdiction(samples, features) {
  const merged = new Map();
  for (const s of coverageShares(samples, features, a => text(a.ZoningJurisdictions_Entity).toUpperCase())) merged.set(s.key || '', (merged.get(s.key || '') || 0) + s.share);
  const [topKey] = [...merged.entries()].sort((a, b) => b[1] - a[1])[0] || [''];
  return jurisdictionFromEntity(topKey);
}
