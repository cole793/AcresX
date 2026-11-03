import { cachedJson } from '../shared/upstream.js';
import { arcgisQuery, spatialParams } from '../shared/arcgis.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { ringsFromGeometry, samplePoints, coverageShares, coverageNote, pct } from '../shared/polygon-coverage.js';

// Who zones a Gallatin County parcel, read across the parcel outline (not only its center).
// Sources (checked live 2026-11-02 with ?f=json):
// - County zoning: Gallatin County GIS County_Zoning_Districts/FeatureServer/42. Fields OBJECTID,
//   OBJECTID_1, INNERZONE (zone code, e.g. 'R-5'), DISTRICT_N (zoning district, e.g.
//   'BEAR CANYON'), LANDUSE ('RURAL RESIDENTIAL'), ZONED ('R-5 RESIDENTIAL'), ZONED_ABV. Land
//   outside every district is one polygon with INNERZONE 'UNZ', ZONED 'UNZONED'. Cities have no
//   polygon here, which is why parcels in Bozeman came back "no mapped zoning district".
//   'ROAD' and 'WATER' polygons are rights of way and water inside a few districts, not zones.
// - City limits: Gallatin County GIS Gallatin_Incorporated_Cities_and_Towns/FeatureServer/267
//   ("Other Gallatin County Towns"): one polygon each for Bozeman, Belgrade, Three Forks,
//   Manhattan and West Yellowstone (NAME, TYPE 'City'/'Town'). The Montana State Library server
//   (gisservicemt.gov) answered only an HTML placeholder page, so it is not used.
// - Bozeman zoning: City of Bozeman GIS Open_Data/Zoning/FeatureServer/0 ("Zoning 2025"), field
//   ZONING (e.g. 'R-1', 'B-2M'); last edited 2025-12-31. The other four towns publish no zoning
//   service, so the answer is "city zoning applies" with the planning page.
// Answers are cached for a day (Cache API) only when every query that ran succeeded. Owner and
// mailing fields are removed (src/shared/personal-fields.js) before an answer is stored or used.
// Bump the version in the prefix whenever the fields requested or stripped change.
export const GALLATIN_CACHE_PREFIX = 'https://acresx.internal/cache/gallatin-zoning/v3/';
const CACHE_TTL_SECONDS = 24 * 60 * 60;

export const GALLATIN_ZONING_LAYER = 'https://services3.arcgis.com/JuknJLoAEm9DTWXh/ArcGIS/rest/services/County_Zoning_Districts/FeatureServer/42';
export const GALLATIN_CITY_LIMITS = 'https://services3.arcgis.com/JuknJLoAEm9DTWXh/ArcGIS/rest/services/Gallatin_Incorporated_Cities_and_Towns/FeatureServer/267';
export const BOZEMAN_ZONING = 'https://gisweb.bozeman.net/arcgis/rest/services/Open_Data/Zoning/FeatureServer/0';
const GALLATIN_ZONING_GUIDE = 'https://www.gallatinmt.gov/588/Zoning-Guide';
const COUNTY_AGENCY = 'Gallatin County GIS';

// Keyed by the layer 267 NAME, upper-cased. Planning pages: Three Forks loaded on 2026-11-02.
// Bozeman, Belgrade and West Yellowstone answer automated requests with a bot check (Akamai /
// Cloudflare 403), so those URLs were confirmed from search results for the city's own site.
// Manhattan's site did not answer and no planning page was found, so it gets no link.
const CITIES = {
  BOZEMAN: { name: 'City of Bozeman', planningUrl: 'https://www.bozemanmt.gov/departments/community-development/planning',
    zoning: { url: BOZEMAN_ZONING, label: 'bozeman-zoning', agency: 'City of Bozeman GIS', service: 'Open_Data/Zoning', layerId: 0, outFields: 'ZONING' } },
  BELGRADE: { name: 'City of Belgrade', planningUrl: 'https://www.belgrademt.gov/210/Planning-and-Zoning' },
  'THREE FORKS': { name: 'City of Three Forks', planningUrl: 'https://www.threeforksmontana.us/zoning-and-planning' },
  MANHATTAN: { name: 'Town of Manhattan' },
  'WEST YELLOWSTONE': { name: 'Town of West Yellowstone', planningUrl: 'https://westyellowstone.gov/' }
};

const text = value => String(value ?? '').trim();
const cityKey = value => text(value).replace(/\s+/g, ' ').toUpperCase();
const titleCase = value => text(value).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
const round3 = n => Math.round(n * 1000) / 1000;
const NON_ZONES = new Set(['ROAD', 'WATER']);

// 'BEAR CANYON' -> 'Bear Canyon zoning district'; 'ZONING DISTRICT 1' -> 'Zoning District 1'.
export function districtLabel(value) {
  const name = titleCase(value);
  if (!name) return '';
  return /zoning district/i.test(name) ? name.replace(/zoning district/i, 'Zoning District') : `${name} zoning district`;
}

function cityInfo(attrs) {
  const key = cityKey(attrs?.NAME);
  if (!key) return null;
  const type = /town/i.test(text(attrs?.TYPE)) ? 'Town' : 'City';
  return { key, ...(CITIES[key] || { name: `${type} of ${titleCase(key)}` }) };
}

// A zone is told apart by code and district: 'PL' in Big Sky and 'PL' in Hebgen Lake are
// different districts' rules. Unzoned land is one key.
function zoneKey(attrs) {
  const code = text(attrs.INNERZONE).toUpperCase();
  if (!code || NON_ZONES.has(code)) return '';
  if (code === 'UNZ' || /^UNZONED$/i.test(text(attrs.ZONED))) return 'Unzoned';
  const district = titleCase(attrs.DISTRICT_N);
  return district ? `${text(attrs.INNERZONE)} (${district})` : text(attrs.INNERZONE);
}

function base(jurisdiction) {
  return { county: 'Gallatin', state: 'MT', countyStatus: 'gallatin-v3', jurisdiction, permitJurisdiction: { name: jurisdiction } };
}
function tail(source) {
  return { comprehensivePlan: {}, urbanGrowthArea: { intersects: false }, overlays: [], permits: [], permitHistory: [], permitHistoryStatus: 'unavailable', source };
}

export async function getGallatinCountyIntelligence(body) {
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Gallatin zoning requires parcel coordinates.');
  const rings = ringsFromGeometry(body.geometry);
  const failures = [];
  return cachedJson(GALLATIN_CACHE_PREFIX, { lon, lat, rings }, CACHE_TTL_SECONDS,
    async () => withoutPersonalFields(await lookupGallatin(lon, lat, rings, failures)),
    { isValid: () => failures.length === 0 });
}

async function lookupGallatin(lon, lat, rings, failures) {
  const where = { rings, lon, lat };
  const samples = rings ? samplePoints(rings) : [[lon, lat]];
  const matchMethod = rings ? 'parcel area (sampled)' : 'parcel location';
  const query = (url, outFields, label, agency) => arcgisQuery(url, { ...spatialParams(where), outFields }, { agency, label });

  // County zoning starts alongside city limits; it is only needed when the parcel is not in a city.
  const countyZoning = query(GALLATIN_ZONING_LAYER, 'INNERZONE,DISTRICT_N,LANDUSE,ZONED', 'gallatin-zoning', 'Gallatin zoning service')
    .then(features => ({ features }), error => ({ error }));

  let city = null, cityLimitsUnavailable = false;
  try {
    city = findCity(samples, await query(GALLATIN_CITY_LIMITS, 'NAME,TYPE', 'gallatin-city-limits', COUNTY_AGENCY));
  } catch (error) {
    cityLimitsUnavailable = true;
    failures.push(error);
    console.warn('Gallatin city limits lookup failed; using county zoning', error);
  }
  if (city) return cityResult(city, query, samples, matchMethod, failures);

  const { features, error } = await countyZoning;
  if (error) { failures.push(error); throw error; } // src/index.js turns this into a 502 "unavailable" answer.
  return countyResult(features, samples, matchMethod, cityLimitsUnavailable);
}

// The city (if any) covering most of the parcel. Unincorporated land competes as key ''; a city
// wins only when it covers more of the parcel than unincorporated land and any other city.
function findCity(samples, features) {
  const merged = new Map();
  for (const s of coverageShares(samples, features, a => cityKey(a.NAME))) merged.set(s.key || '', { share: (merged.get(s.key || '')?.share || 0) + s.share, attributes: s.attributes });
  const ranked = [...merged.entries()].sort((a, b) => b[1].share - a[1].share);
  const [topKey, top] = ranked[0] || ['', null];
  if (!topKey) return null;
  return { ...cityInfo(top.attributes || { NAME: topKey }), share: top.share, straddles: ranked.length > 1 };
}

async function cityResult(city, query, samples, matchMethod, failures) {
  const jurisdictionSource = { agency: COUNTY_AGENCY, service: 'Gallatin_Incorporated_Cities_and_Towns', layerId: 267, city: city.key, share: round3(city.share) };
  const straddleNote = city.straddles ? ` About ${pct(city.share)} of the parcel is inside ${city.name} limits; the rest may fall under Gallatin County zoning.` : '';
  const planning = city.planningUrl ? { url: city.planningUrl, urlLabel: `Open ${city.name} planning ↗` } : {};
  const contact = city.planningUrl ? `See the ${city.name} planning page.` : `Contact ${city.name} for its zoning map and code.`;
  if (!city.zoning) {
    return {
      available: false, ...base(city.name),
      zoning: { status: 'city_jurisdiction', label: `${city.name} zoning applies`, note: `This parcel is inside ${city.name} limits, so ${city.name} zoning applies, not Gallatin County zoning. ${city.name} does not publish its zoning map as a GIS service. ${contact}${straddleNote}`, sourceUrl: GALLATIN_CITY_LIMITS, sourceLabel: 'Open city limits layer ↗', ...planning },
      ...tail({ agency: COUNTY_AGENCY, service: 'Gallatin_Incorporated_Cities_and_Towns', layerId: 267, matchMethod, jurisdictionSource })
    };
  }
  const z = city.zoning;
  const source = { agency: z.agency, service: z.service, layerId: z.layerId, matchMethod, jurisdictionSource };
  let features;
  try {
    features = await query(z.url, z.outFields, z.label, z.agency);
  } catch (error) {
    failures.push(error);
    console.warn(`${city.name} zoning lookup failed`, error);
    return {
      available: false, ...base(city.name),
      zoning: { status: 'unavailable', label: `${city.name} zoning lookup unavailable`, note: `This parcel is inside ${city.name} limits, so ${city.name} zoning applies. The city zoning map did not answer (${error?.message || 'request failed'}); check with the city.${straddleNote}`, sourceUrl: z.url, ...planning },
      ...tail({ ...source, error: error?.message || 'City zoning lookup failed' })
    };
  }
  const covered = coverageShares(samples, features, a => text(a.ZONING)).filter(s => s.key);
  const top = covered[0];
  if (!top) {
    return {
      available: false, ...base(city.name),
      zoning: { status: 'no_mapped_result', label: `${city.name} zoning applies (no zone mapped here)`, note: `This parcel is inside ${city.name} limits, so ${city.name} zoning applies, but the city zoning map returned no zone here (it may be newly annexed). ${contact}${straddleNote}`, sourceUrl: z.url, ...planning },
      ...tail(source)
    };
  }
  const others = covered.slice(1).filter(s => s.share >= 0.05);
  const shareNote = samples.length > 1 ? coverageNote(top, others, 1 - covered.reduce((t, s) => t + s.share, 0), 'city zone') : '';
  return {
    available: true, ...base(city.name),
    zoning: {
      status: 'gis_match', code: top.key, name: top.key, label: top.key,
      note: `Mapped zoning designation from the ${city.name} zoning map. City zoning applies inside city limits.${shareNote}${straddleNote}`,
      sourceUrl: z.url, ...planning,
      ...(others.length ? { otherZones: others.map(s => ({ code: s.key, share: round3(s.share) })) } : {})
    },
    ...tail({ ...source, attributes: { ZONING: top.key } })
  };
}

function countyResult(features, samples, matchMethod, cityLimitsUnavailable) {
  const shares = coverageShares(samples, features, zoneKey);
  const covered = shares.filter(s => s.key);
  const top = covered[0];
  const cityNote = cityLimitsUnavailable ? ' The Gallatin County city-limits layer did not answer, so the parcel may be inside a city, where city zoning applies; check with the city or Gallatin County Planning.' : '';
  const source = { agency: COUNTY_AGENCY, service: 'County Zoning Districts', layerId: 42, matchMethod };
  if (!top) {
    return {
      available: false, ...base('Gallatin County'),
      zoning: {
        status: 'no_mapped_result',
        label: cityLimitsUnavailable ? 'No county zoning found here; the parcel may be inside a city — city limits lookup unavailable' : 'No mapped zoning district',
        // Seen live on 2026-11-02 (06101033302010000, 06110827101470000): gaps in layer 42 with
        // neither a district nor the unzoned polygon, outside the mapped city limits.
        note: `Gallatin County GIS maps neither a zoning district nor its unzoned area at ${matchMethod === 'parcel location' ? 'the parcel location' : 'this parcel'}. That can mean the land was left out of a district map or was recently annexed into a city. Verify with Gallatin County Planning.${cityNote}`,
        sourceUrl: GALLATIN_ZONING_LAYER, url: GALLATIN_ZONING_GUIDE
      },
      ...tail(source)
    };
  }
  const others = covered.slice(1).filter(s => s.share >= 0.05);
  const shareNote = samples.length > 1 ? coverageNote(top, others, 1 - covered.reduce((t, s) => t + s.share, 0), 'county zone') : '';
  const otherZones = others.length ? { otherZones: others.map(s => ({ code: s.key, share: round3(s.share) })) } : {};
  const attrs = top.attributes || {};
  const attributes = { INNERZONE: text(attrs.INNERZONE), DISTRICT_N: text(attrs.DISTRICT_N), LANDUSE: text(attrs.LANDUSE), ZONED: text(attrs.ZONED) };
  if (top.key === 'Unzoned') {
    return {
      available: true, ...base('Gallatin County'),
      zoning: {
        status: 'unzoned', code: 'UNZONED', name: 'Unzoned area', label: 'Unzoned',
        note: `Gallatin County GIS maps this parcel within its unzoned-area polygon. Verify development requirements with County Planning.${shareNote}${cityNote}`,
        sourceUrl: GALLATIN_ZONING_LAYER, url: GALLATIN_ZONING_GUIDE, ...otherZones
      },
      ...tail({ ...source, attributes })
    };
  }
  const code = attributes.INNERZONE;
  const name = attributes.ZONED && attributes.ZONED.toUpperCase() !== code.toUpperCase() ? attributes.ZONED : '';
  const district = districtLabel(attributes.DISTRICT_N);
  const landUse = titleCase(attributes.LANDUSE);
  return {
    available: true, ...base('Gallatin County'),
    zoning: {
      status: 'gis_match', code, name: name || code,
      label: [code, name].filter(Boolean).join(' — '),
      ...(district ? { district } : {}), ...(landUse ? { landUse } : {}),
      note: `Mapped zoning from Gallatin County GIS${district ? ` (${district})` : ''}.${shareNote}${cityNote}`,
      sourceUrl: GALLATIN_ZONING_LAYER, url: GALLATIN_ZONING_GUIDE, ...otherZones
    },
    ...tail({ ...source, attributes })
  };
}
