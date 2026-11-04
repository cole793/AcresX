// Stevens County, WA zoning and permits (/api/zoning-permits). Replaces the legacy generic
// discovery path in src/worker.js (queryZoningCatalog / inspectService at one center point).
//
// Sources, all on https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer
// (checked live, read-only, 2026-11-04; cities and city layers are described in stevens-cities.js):
// - Layer 1 "Stevens County Zoning": fields zoning (Integer), zoningtext, name, type, zoning_nam.
//   Rural districts carry zoning 5/10/20/100/101/103 with zoningtext 'RA-5', 'RA-10', 'RA-20',
//   'NR Forest', 'NR Ag', 'AR-10'. The LAMIRD and UGA districts carry zoning 0 and a blank
//   zoningtext; the district is in name (the community, e.g. 'Lake Spokane'), type (e.g.
//   'R-1 Residential') and zoning_nam ('Lake Spokane R-1 Residential'). The layer has no polygons
//   inside the six incorporated cities and towns. Value -> rules mapping: src/zoning/stevens-rules.js.
// - Layer 8 "Stevens Co Lamird Districts": fields name, type (zoning/zoningtext are null).
//   Description: "The dataset shows the Zoning classifications designated by the Stevens County
//   Development Regulations, Title 3." 33 districts (Arden, Loon Lake, Deer Lake, ... Crossroads and
//   Resort areas). Lake Spokane is NOT on this layer; it is on layer 9.
// - Layer 9 "Stevens Co Urban Growth Areas": fields Name, Type (ZONING/ZONINGText are null).
//   Description: "This dataset shows the Urban Growth Areas (UGA) designated by the Stevens County
//   Comprehensive Plan. The dataset also shows the zoning areas designated by the Stevens County
//   Development Regulations Title 3." UGAs: Addy, Chewelah, Clayton, Colville, Hunters, Kettle
//   Falls, Lake Spokane, Marcus, Matney Industrial, Northwest Alloys Ind, Valley, Valley Industrial.
//   Example: parcel 0763202 (-117.644634, 47.839242) is layer 1 zoning 0 'Lake Spokane R-1
//   Residential' and layer 9 Lake Spokane / R-1 Residential (UGA, not LAMIRD).
//
// Every layer is read across the parcel outline (src/shared/polygon-coverage.js), not at one
// point: the zone covering most of the parcel is reported and others covering 5% or more are
// listed in otherZones (2378200 sits on an RA-10/RA-20 boundary). Jurisdiction comes first: a
// parcel inside a city or town never shows county zoning.
//
// The layer answers (coverage shares, no outlines) are cached for a day only when every layer
// asked answered. One failing layer degrades only its own part of the answer.
import { cachedJson } from '../shared/upstream.js';
import { ringsFromGeometry, samplePoints, coverageNote } from '../shared/polygon-coverage.js';
import { FALLBACK_KINDS, fallbackHint, hintGeometry, isFallbackEligible } from '../shared/fallback.js';
import { getStevensZoneRules, hasStevensRules, stevensRulesKey } from '../zoning/stevens-rules.js';
import {
  STEVENS_ZONING_SERVICE, STEVENS_CITIES, layerShares, queryCityShares, queryCityZoningShares,
  decideJurisdiction, cityZoning, jurisdictionNote
} from './stevens-cities.js';

export const STEVENS_COUNTY_ZONING = `${STEVENS_ZONING_SERVICE}/1`;
export const STEVENS_LAMIRD = `${STEVENS_ZONING_SERVICE}/8`;
export const STEVENS_UGA = `${STEVENS_ZONING_SERVICE}/9`;
// v1: jurisdiction first, whole-parcel shares, LAMIRD and UGA layers.
export const STEVENS_CACHE_PREFIX = 'https://acresx.internal/cache/stevens-intelligence/v1/';
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const COUNTY_ZONING_FIELDS = 'zoning,zoningtext,name,type,zoning_nam';

const text = value => (value == null ? '' : String(value).replace(/\s+/g, ' ').trim());
const settle = promise => promise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));

// One county-layer feature -> its district. Rural districts by number, LAMIRD/UGA districts
// (zoning 0) by type within a named community.
export function countyDistrict(a = {}) {
  const value = Number(a.zoning);
  const label = text(a.zoningtext);
  if (Number.isFinite(value) && value !== 0 && label) {
    const rules = getStevensZoneRules(label);
    return { code: label, name: rules.available ? rules.name : '', numericCode: String(value), rulesMapped: rules.available };
  }
  const type = text(a.type), community = text(a.name);
  if (!type) return null;
  const mapped = hasStevensRules(type);
  return {
    code: mapped ? stevensRulesKey(type) : type,
    name: text(a.zoning_nam) || [community, type].filter(Boolean).join(' '),
    numericCode: Number.isFinite(value) && a.zoning != null ? String(value) : null,
    rulesMapped: mapped, community, districtType: type
  };
}
const countyKey = a => text(a.zoning_nam) || text(a.zoningtext) || [text(a.name), text(a.type)].filter(Boolean).join(' ') || null;
const areaKey = (nameField, typeField) => a => [text(a[nameField]), text(a[typeField])].filter(Boolean).join(' ') || null;

// Likely approvals. Unincorporated land (and an unknown jurisdiction) keeps exactly the list the
// legacy route produced for Stevens (src/worker.js permitList). Inside a city or town its own
// departments handle zoning, building, road-approach, critical-areas, site-analysis and
// manufactured-home review, linked only where a city page was verified (stevens-cities.js;
// Chewelah only); otherwise the reason ends "Contact <city>.". The health-district (NETCHD) and
// state items are the same everywhere. Copied in public/browser-fallback.js (stPermitList).
export function permitList(profile, city = null) {
  const local = !city
    ? {
        planning: profile.planningAgency, building: profile.planningAgency, road: profile.roadAgency, roads: 'a county or state road',
        zoningUrl: profile.zoningMapUrl, permitUrl: profile.permitUrl, planningUrl: profile.planningUrl,
        sitePlanning: 'Stevens County Land Services — Planning', siteUrl: 'https://www.stevenscountywa.gov/21344',
        siteBuilding: 'Stevens County Land Services — Building', placementUrl: 'https://www.stevenscountywa.gov/20898/Building-Permit', contact: ''
      }
    : {
        planning: `${city.name} planning / zoning`, building: `${city.name} building department`, road: `${city.name} public works / streets`, roads: 'a city or state road',
        zoningUrl: city.planningUrl || '', permitUrl: city.planningUrl || '', planningUrl: city.planningUrl || '',
        sitePlanning: `${city.name} planning / zoning`, siteUrl: city.planningUrl || '',
        siteBuilding: `${city.name} building department`, placementUrl: city.planningUrl || '',
        contact: city.planningUrl ? '' : ` Contact ${city.name}.`
      };
  const c = local.contact;
  return [
    { name: 'Land-use / zoning verification', agency: local.planning, status: 'Verify', reason: `Confirm allowed use, setbacks, minimum lot size and overlays before design.${c}`, url: local.zoningUrl },
    { name: 'Building permit', agency: local.building, status: 'Likely', reason: `Normally required for a new residence, shop or other permitted structure.${c}`, url: local.permitUrl },
    { name: 'On-site septic approval', agency: profile.healthAgency, status: 'Likely', reason: 'Needed when the parcel is not served by public sewer. Site and soil evaluation may be required.', url: profile.septicUrl },
    { name: 'Well notice / water review', agency: 'Washington Department of Ecology and local health authority', status: 'Possible', reason: 'Well construction, water availability and drinking-water requirements vary by project and location.', url: 'https://ecology.wa.gov/Water-Shorelines/Water-supply/Wells' },
    { name: 'Driveway / road approach permit', agency: local.road, status: 'Possible', reason: `Often required for a new or modified connection to ${local.roads}.${c}`, url: local.planningUrl },
    { name: 'Critical-areas review', agency: local.planning, status: 'Possible', reason: `Floodplain, wetlands, shorelines, steep slopes or habitat areas can trigger additional review.${c}`, url: local.planningUrl },
    { name: 'Existing septic as-built / permit record search', agency: 'Northeast Tri County Health District', status: 'Not verified', reason: 'Search the public NETCHD portal by parcel or address. A missing online result does not prove no system exists; request a staff search when necessary.', url: 'https://www.netchd.org/227/Sewage-Permit-Record-Search' },
    { name: 'Septic soil / site evaluation', agency: 'Northeast Tri County Health District', status: 'Possible', reason: 'For new on-site sewage systems, obtain site evaluation and design/permit approval. Existing records do not confirm system condition or capacity.', url: 'https://www.netchd.org/226/Applications-Forms-Resources' },
    { name: 'Residential site analysis', agency: local.sitePlanning, status: 'Verify', reason: `Determine whether a site analysis and critical-area/shoreline review is needed before building or placing a manufactured home.${c}`, url: local.siteUrl },
    { name: 'Manufactured/mobile home placement permit', agency: local.siteBuilding, status: 'If applicable', reason: `Manufactured and mobile homes use a placement permit, not the standard residential building permit for IRC modular homes.${c}`, url: local.placementUrl }
  ];
}

// The LAMIRD or UGA covering most of the parcel, from its layer's settled shares (null if none).
function areaInfo(r, nameField, typeField) {
  if (r?.status !== 'fulfilled') return null;
  const top = (r.value || []).find(s => s.key);
  if (!top) return null;
  return { name: text(top.attributes?.[nameField]), type: text(top.attributes?.[typeField]), share: top.share };
}

const UGA_LAYER_QUOTE = '"This dataset shows the Urban Growth Areas (UGA) designated by the Stevens County Comprehensive Plan. The dataset also shows the zoning areas designated by the Stevens County Development Regulations Title 3."';

function urbanGrowthArea(ugaR) {
  const base = { sourceUrl: STEVENS_UGA };
  if (ugaR?.status !== 'fulfilled') return { intersects: false, status: 'unavailable', error: ugaR?.reason?.message || 'unavailable', ...base };
  const uga = areaInfo(ugaR, 'Name', 'Type');
  if (!uga) return { intersects: false, ...base };
  return {
    intersects: true, name: uga.name, type: uga.type, share: uga.share, ...base,
    note: `Inside the ${uga.name} urban growth area (UGA) designated by the Stevens County Comprehensive Plan. The county's UGA layer says: ${UGA_LAYER_QUOTE} Outside city limits, the Stevens County Title 3 district mapped here applies; confirm with Stevens County Land Services, and with the city where the UGA belongs to one, before relying on it.`
  };
}

function lamirdArea(lamirdR) {
  const base = { sourceUrl: STEVENS_LAMIRD };
  if (lamirdR?.status !== 'fulfilled') return { intersects: false, status: 'unavailable', error: lamirdR?.reason?.message || 'unavailable', ...base };
  const lamird = areaInfo(lamirdR, 'name', 'type');
  if (!lamird) return { intersects: false, ...base };
  return { intersects: true, name: lamird.name, type: lamird.type, share: lamird.share, ...base };
}

// Unincorporated parcels (or jurisdiction unknown): Stevens County zoning across the parcel.
function countyZoning(layers, samples, decision, matchMethod, profile, lamird, uga) {
  const { countyZoning: zoningR, lamird: lamirdR, uga: ugaR } = layers;
  const jNote = decision ? jurisdictionNote(decision) : ' The Stevens County city-limits layer did not answer, so AcresX could not confirm the parcel is outside city limits; the county zoning layer has no polygons inside cities.';
  const verify = 'Verify allowed uses, density, setbacks and overlays with Stevens County Land Services.';
  if (zoningR.status !== 'fulfilled') {
    const message = zoningR.reason?.message || 'unavailable';
    return {
      status: 'unavailable', code: null, name: '', label: 'Stevens County zoning lookup unavailable',
      note: `The Stevens County zoning map did not answer (${message}), so this parcel's county zone is not known. Check with Stevens County Land Services.${jNote}`,
      url: profile.zoningMapUrl, sourceUrl: STEVENS_COUNTY_ZONING, error: message
    };
  }
  // The county layer first; where it has no polygon, the LAMIRD or UGA layer's district.
  let source = { url: STEVENS_COUNTY_ZONING, layer: 'county', shares: zoningR.value || [] };
  if (!source.shares.some(s => s.key)) {
    if (lamirdR?.status === 'fulfilled' && lamirdR.value.some(s => s.key)) source = { url: STEVENS_LAMIRD, layer: 'lamird', shares: lamirdR.value };
    else if (ugaR?.status === 'fulfilled' && ugaR.value.some(s => s.key)) source = { url: STEVENS_UGA, layer: 'uga', shares: ugaR.value };
  }
  const districtOf = s => (source.layer === 'county' ? countyDistrict(s.attributes || {}) : source.layer === 'lamird'
    ? countyDistrict({ name: s.attributes?.name, type: s.attributes?.type })
    : countyDistrict({ name: s.attributes?.Name, type: s.attributes?.Type }));
  const covered = source.shares.filter(s => s.key && districtOf(s));
  const top = covered[0];
  if (!top) {
    return {
      status: 'no_match', code: null, name: '', label: 'No mapped zoning result',
      note: `The Stevens County zoning map returned no district ${matchMethod === 'parcel location' ? 'at this parcel location' : 'on this parcel'}. Check with Stevens County Land Services.${jNote}`,
      url: profile.zoningMapUrl, sourceUrl: STEVENS_COUNTY_ZONING
    };
  }
  const d = districtOf(top);
  const others = covered.slice(1).filter(s => s.share >= 0.05);
  const uncovered = 1 - covered.reduce((t, s) => t + s.share, 0);
  const shareNote = samples.length > 1
    ? coverageNote({ key: d.code, share: top.share }, others.map(s => ({ key: districtOf(s).code, share: s.share })), uncovered, 'county zone')
    : '';
  const area = lamird?.intersects ? { kind: 'lamird', ...lamird } : uga?.intersects ? { kind: 'uga', ...uga } : null;
  const areaNote = !d.districtType ? ''
    : area?.kind === 'lamird' ? ` This district is in the ${area.name} LAMIRD (limited area of more intensive rural development).`
      : area?.kind === 'uga' ? ` This district is in the ${area.name} urban growth area (UGA).`
        : '';
  const fromLayer = source.layer === 'county' ? 'the Stevens County zoning map' : source.layer === 'lamird' ? 'the Stevens County LAMIRD districts map' : 'the Stevens County urban growth areas map';
  const rulesNote = d.rulesMapped ? '' : ` Zoning rules for ${d.code} are not mapped in AcresX yet; see Stevens County Code Title 3.`;
  return {
    status: 'gis_match', code: d.code, name: d.name, label: 'Official mapped zoning', jurisdictionType: 'county',
    note: `Mapped from ${fromLayer} (Title 3 districts). ${verify}${areaNote}${rulesNote}${shareNote}${jNote}`,
    url: profile.zoningMapUrl, sourceUrl: source.url,
    sourceField: source.layer === 'county' ? (d.districtType ? 'type' : 'zoningtext') : source.layer === 'lamird' ? 'type' : 'Type',
    ...(d.numericCode != null ? { numericCode: d.numericCode } : {}),
    ...(d.districtType ? { district: { community: d.community, type: d.districtType, ...(area ? { area: area.kind } : {}) } } : {}),
    rules: d.rulesMapped ? 'mapped' : 'not_mapped',
    ...(d.rulesMapped ? {} : { rulesNote: `Rules not mapped for ${d.code}; see Stevens County Code Title 3.` }),
    ...(others.length ? { otherZones: others.map(s => { const o = districtOf(s); return { code: o.code, name: o.name, share: s.share }; }) } : {})
  };
}

function browserFallback(body) {
  const lat = Number(body.lat), lon = Number(body.lon), geometry = hintGeometry(body.geometry);
  return fallbackHint(FALLBACK_KINDS.stevensZoning, {
    parcelId: String(body.parcelId || ''),
    ...(Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : {}),
    ...(geometry ? { geometry } : {})
  });
}

// Query every layer the answer needs. The county, LAMIRD and UGA layers are asked alongside the
// city limits so an unincorporated parcel needs one round trip (4 requests, the per-host cap).
export async function queryStevensLayers(where, samples) {
  const [cities, countyZoningR, lamird, uga] = await Promise.all([
    settle(queryCityShares(where, samples)),
    settle(layerShares(STEVENS_COUNTY_ZONING, where, samples, { outFields: COUNTY_ZONING_FIELDS, keyOf: countyKey, label: 'stevens-zoning' })),
    settle(layerShares(STEVENS_LAMIRD, where, samples, { outFields: 'name,type', keyOf: areaKey('name', 'type'), label: 'stevens-lamird' })),
    settle(layerShares(STEVENS_UGA, where, samples, { outFields: 'Name,Type', keyOf: areaKey('Name', 'Type'), label: 'stevens-uga' }))
  ]);
  const city = cities.status === 'fulfilled' ? decideJurisdiction(cities.value).city : null;
  const cityZoningR = city?.zoning ? await settle(queryCityZoningShares(city, where, samples)) : null;
  return { cities, countyZoning: countyZoningR, lamird, uga, cityZoning: cityZoningR };
}

// The zoning part of the answer from settled layer answers. Shared by the Worker and (copied) by
// public/browser-fallback.js.
export function stevensZoningAnswer(layers, { samples, matchMethod, profile }) {
  const decision = layers.cities.status === 'fulfilled' ? decideJurisdiction(layers.cities.value) : null;
  const city = decision?.city || null;
  const lamird = lamirdArea(layers.lamird);
  const uga = urbanGrowthArea(layers.uga);
  const zoning = city ? cityZoning(city, layers.cityZoning, samples, decision) : countyZoning(layers, samples, decision, matchMethod, profile, lamird, uga);
  const jurisdiction = city ? city.name : 'Stevens County';
  const failed = Object.entries(layers).filter(([, r]) => r && r.status !== 'fulfilled').map(([name]) => name);
  return {
    jurisdiction,
    zoning,
    urbanGrowthArea: uga,
    lamird,
    permitJurisdiction: { name: jurisdiction, sourceUrl: STEVENS_CITIES },
    // The county agency profile (src/zoning-counties.js); inside a city it names the city as the
    // jurisdiction, never the county.
    agencies: city ? { ...profile, jurisdiction } : profile,
    permits: permitList(profile, city),
    zoningMatch: {
      method: matchMethod,
      ...(decision ? { jurisdictionShare: decision.share, otherJurisdictions: decision.others } : { jurisdictionError: layers.cities.reason?.message || 'unavailable' }),
      unavailableLayers: failed
    }
  };
}

export async function getStevensCountyIntelligence(body, profile) {
  const lat = Number(body.lat), lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Valid parcel coordinates are required for Stevens County intelligence.');
  const geometry = body.geometry || null;
  const rings = ringsFromGeometry(geometry);
  const where = { rings, lon, lat };
  const samples = rings ? samplePoints(rings) : [[lon, lat]];
  const matchMethod = rings ? 'parcel area (sampled)' : 'parcel location';

  const layers = await cachedJson(
    STEVENS_CACHE_PREFIX, { lat, lon, geometry }, CACHE_TTL_SECONDS, () => queryStevensLayers(where, samples),
    { isValid: answer => Object.values(answer).every(r => r === null || r.status === 'fulfilled') }
  );
  const part = stevensZoningAnswer(layers, { samples, matchMethod, profile });
  // A browser might get past a failure of the layers that decide zoning (city limits, county or
  // city zoning). LAMIRD/UGA failures only drop information, so they add no hint.
  const decisive = ['cities', 'countyZoning', 'cityZoning'].map(k => layers[k]).filter(r => r && r.status === 'rejected');
  const fallback = decisive.some(r => isFallbackEligible(r.reason)) ? browserFallback(body) : null;
  return {
    available: true, county: 'Stevens', state: 'WA', parcelId: body.parcelId || '', address: body.address || '',
    jurisdiction: part.jurisdiction, countyStatus: 'stevens-official-adapter-v1',
    source: 'Stevens County GIS (Stevens_County_Zoning_Data)', sourceUrl: STEVENS_ZONING_SERVICE,
    zoning: part.zoning,
    urbanGrowthArea: part.urbanGrowthArea,
    lamird: part.lamird,
    permitJurisdiction: part.permitJurisdiction,
    zoningMatch: part.zoningMatch,
    agencies: part.agencies,
    permits: part.permits,
    permitHistory: [],
    permitHistoryStatus: 'not_configured',
    ...(fallback ? { fallback } : {})
  };
}

