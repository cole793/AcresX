// Jurisdictions inside Spokane County: who zones a parcel, and where each city's zoning lives.
// All sources below were checked live (read-only, `?f=json`) on 2026-11-02.
//
// Jurisdiction (city vs unincorporated):
//   https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/PermittingLookup/MapServer/0
//   "Jurisdictions". Fields: NAME ("Municipality Name"), MUNITYP ("Municipal Type"). The polygons
//   tile the county: NAME is 'Spokane County' (MUNITYP 'Other') for unincorporated land; the cities
//   (MUNITYP 'City') are Airway Heights, Cheney, Deer Park, Liberty Lake, Medical Lake, Millwood,
//   Spokane, Spokane Valley; the towns (MUNITYP 'Town') are Fairfield, Latah, Rockford, Spangle,
//   Waverly; 'Fairchild Air Force Base' is MUNITYP 'Other'. A point inside the City of Spokane
//   returns only 'Spokane' (the county polygon has the cities cut out).
//   SCOUT/ZoningLookup/MapServer (layers 0 Airfield Overlay Zone, 1 FAR Part 77, 2 UGA, 3 Zoning,
//   4 Comprehensive Plan) holds county zoning only (ZONECLASS); OpenData/Planning/0 and
//   BPPublic/BPPublic/7 are the same county zoning. SCOUT/LayersMenu/MapServer/33 is a copy of the
//   City of Spokane zoning ("Zoning (City of Spokane)"); the city's own layer below is used instead.
//
// City zoning layers (official city sources only):
// - City of Spokane: https://services.arcgis.com/3PDwyTturHqnGCu0/arcgis/rest/services/Zoning/FeatureServer/5
//   ArcGIS Online org 3PDwyTturHqnGCu0 is "City of Spokane". Copyright "City of Spokane GIS, City of
//   Spokane Planning Services"; description "Polygons representing the zoning designations for the
//   City of Spokane ... See ... https://my.spokanecity.org/smc/?Title=17C". Fields: ZoneLabel
//   ('NR-35', 'CC4-NC', 'RSF'), ZoneCode ('NR', 'CC4'), ZoneDesc ('Neighborhood Retail'), ZoneGen,
//   Height, Ordinance. Last edit 2026-04-08.
// - City of Spokane Valley: https://arcgis.spokanevalley.org/arcgis/rest/services/ViewerV3/LandUse/MapServer/1
//   The city's own server ("Zoning"; service copyright "CSV"). Fields: Zoning ('R-3', 'MFR', 'POS'),
//   Zoning_Desg ('Single-Family Residential (R-3)'). Latest last_edited_date 2026-05-28 (31,838
//   features). The city's Zoning Map page (spokanevalleywa.gov/445/Zoning-Map) opens the Spokane
//   Valley Viewer, which draws a hosted copy (services2.arcgis.com/hYnqO6a7TkujNqEg/.../
//   LandUse_Testing4/FeatureServer/3) last edited 2024-05-30; CommunityDevelopment/Zoning/MapServer/1
//   ("Official Zoning Ordinance 20-009") was also last edited 2024-05-30. ViewerV3 is the newest.
//   Zoning_Desg is sometimes another zone's text ('I' polygons labelled '... (R-3)'), so it is used
//   as the name only when its parenthesised code matches Zoning.
// - City of Cheney: https://services.arcgis.com/yP5WvH3YqutU0LDh/arcgis/rest/services/Cheney__WA___Zoning_Map___2025_WFL1/FeatureServer/3
//   "Zoning_2025"; copyright "Community Development Department, City of Cheney"; service
//   description "Zoning effective March 12th, 2025 w/ passage of Ordinance Y-84". Linked from the
//   city's Maps and Planning pages (cityofcheney.org/196/Maps, /192/Planning-Department) through
//   the cheney.maps.arcgis.com zoning app. Fields: ZoneCODE ('R-1'), ZONE ('Single Family
//   Residential').
// - City of Airway Heights: https://services6.arcgis.com/yrsL3gWPR8ZySnTr/arcgis/rest/services/Current_Zoning_Districts/FeatureServer/0
//   Org yrsL3gWPR8ZySnTr is "City of Airway Heights, WA GIS" (urlKey cawh); item credits "City of
//   Airway Heights, Spokane County". Field Zoning_Dis ('I-2, Heavy Industrial', 'Open Space').
//   (A WSDOT copy, Airway_Heights_Zoning_Land_Use, is not used.)
// - City of Liberty Lake: https://services.arcgis.com/sAiTgWHcD4FbRdCu/arcgis/rest/services/Liberty_Lake_Zoning/FeatureServer/0
//   Org sAiTgWHcD4FbRdCu is "City of Liberty Lake" (its hub, cityoflibertylake-coll.hub.arcgis.com,
//   is linked from libertylakewa.gov). Layer "2024 Zoning", the zoning layer of the city's
//   "2025 Zoning Map" web map; last edit 2025-09-03. Fields: Class_Abv ('R1', 'M2'), Class_Desc.
// - Medical Lake, Deer Park, Millwood: no public zoning layer found (ArcGIS Online search and the
//   city sites). Medical Lake publishes its zoning map as an image and Deer Park as PDFs. Millwood's
//   site sits behind a bot check, so no page was verified. The towns were not researched.
import { arcgisQuery, spatialParams } from '../shared/arcgis.js';
import { coverageShares, coverageNote, pct } from '../shared/polygon-coverage.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';

export const SPOKANE_JURISDICTIONS = 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/PermittingLookup/MapServer/0';
const UNINCORPORATED = 'SPOKANE COUNTY';

const round3 = n => Math.round(n * 1000) / 1000;
const text = value => (value == null ? '' : String(value).trim());
const squash = value => text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

// "Single-Family Residential (R-3)" -> name, only when the code in brackets is this zone's code.
function valleyName(attrs, code) {
  const desg = text(attrs.Zoning_Desg);
  const m = /^(.*)\(([^)]*)\)\s*$/.exec(desg);
  return m && squash(m[2]) === squash(code) ? m[1].trim() : '';
}
// "I-2, Heavy Industrial" -> code 'I-2', name 'Heavy Industrial'; "Open Space" -> code only.
function airwayParts(attrs) {
  const value = text(attrs.Zoning_Dis);
  const i = value.indexOf(',');
  return i > 0 ? { code: value.slice(0, i).trim(), name: value.slice(i + 1).trim() } : { code: value, name: '' };
}

// Keyed by the jurisdiction layer's NAME, upper-cased. planningUrl only where the page loaded on
// 2026-11-02 (my.spokanecity.org is behind a bot check for scripts; the code link comes from the
// city zoning layer's own description).
const CITIES = {
  SPOKANE: {
    name: 'City of Spokane', planningUrl: 'https://my.spokanecity.org/smc/?Title=17C', planningLabel: 'Open Spokane Municipal Code Title 17C ↗',
    zoning: {
      url: 'https://services.arcgis.com/3PDwyTturHqnGCu0/arcgis/rest/services/Zoning/FeatureServer/5',
      agency: 'City of Spokane GIS', label: 'spokane-city-zoning', sourceField: 'ZoneLabel',
      outFields: 'ZoneLabel,ZoneCode,ZoneDesc,ZoneGen,Height,Ordinance',
      code: a => text(a.ZoneLabel) || text(a.ZoneCode),
      name: a => text(a.ZoneDesc),
      extra: a => ({ ...(text(a.ZoneCode) ? { baseZone: text(a.ZoneCode) } : {}), ...(text(a.ZoneGen) ? { zoneCategory: text(a.ZoneGen) } : {}), ...(Number(a.Height) > 0 ? { heightLimitFt: Number(a.Height) } : {}), ...(text(a.Ordinance) ? { ordinance: text(a.Ordinance) } : {}) })
    }
  },
  'SPOKANE VALLEY': {
    name: 'City of Spokane Valley', planningUrl: 'https://www.spokanevalleywa.gov/269/Planning-and-Zoning',
    codeUrl: 'https://www.codepublishing.com/WA/SpokaneValley/',
    zoning: {
      url: 'https://arcgis.spokanevalley.org/arcgis/rest/services/ViewerV3/LandUse/MapServer/1',
      agency: 'City of Spokane Valley GIS', label: 'spokane-valley-zoning', sourceField: 'Zoning',
      outFields: 'Zoning,Zoning_Desg',
      code: a => text(a.Zoning),
      name: (a, code) => valleyName(a, code)
    }
  },
  CHENEY: {
    name: 'City of Cheney', planningUrl: 'https://www.cityofcheney.org/192/Planning-Department',
    zoning: {
      url: 'https://services.arcgis.com/yP5WvH3YqutU0LDh/arcgis/rest/services/Cheney__WA___Zoning_Map___2025_WFL1/FeatureServer/3',
      agency: 'City of Cheney GIS', label: 'cheney-zoning', sourceField: 'ZoneCODE',
      outFields: 'ZoneCODE,ZONE',
      code: a => text(a.ZoneCODE),
      name: a => text(a.ZONE)
    }
  },
  'AIRWAY HEIGHTS': {
    name: 'City of Airway Heights', planningUrl: 'https://cawh.org/planning-department-information/',
    zoning: {
      url: 'https://services6.arcgis.com/yrsL3gWPR8ZySnTr/arcgis/rest/services/Current_Zoning_Districts/FeatureServer/0',
      agency: 'City of Airway Heights GIS', label: 'airway-heights-zoning', sourceField: 'Zoning_Dis',
      outFields: 'Zoning_Dis',
      code: a => airwayParts(a).code,
      name: a => airwayParts(a).name
    }
  },
  'LIBERTY LAKE': {
    name: 'City of Liberty Lake', planningUrl: 'https://www.libertylakewa.gov/476/Zoning-Information',
    zoning: {
      url: 'https://services.arcgis.com/sAiTgWHcD4FbRdCu/arcgis/rest/services/Liberty_Lake_Zoning/FeatureServer/0',
      agency: 'City of Liberty Lake GIS', label: 'liberty-lake-zoning', sourceField: 'Class_Abv',
      outFields: 'Class_Abv,Class_Desc',
      code: a => text(a.Class_Abv),
      name: a => text(a.Class_Desc)
    }
  },
  'MEDICAL LAKE': { name: 'City of Medical Lake', planningUrl: 'https://medical-lake.org/city-government/planning-zoning-department/' },
  'DEER PARK': { name: 'City of Deer Park', planningUrl: 'https://www.cityofdeerparkwa.com/zoning' },
  MILLWOOD: { name: 'City of Millwood' },
  FAIRFIELD: { name: 'Town of Fairfield' },
  LATAH: { name: 'Town of Latah' },
  ROCKFORD: { name: 'Town of Rockford' },
  SPANGLE: { name: 'Town of Spangle' },
  WAVERLY: { name: 'Town of Waverly' },
  'FAIRCHILD AIR FORCE BASE': { name: 'Fairchild Air Force Base', federal: true }
};

const jurisdictionKey = value => text(value).replace(/\s+/g, ' ').toUpperCase();

export function spokaneCityInfo(nameValue, munityp = '') {
  const key = jurisdictionKey(nameValue);
  if (!key || key === UNINCORPORATED) return null;
  const known = CITIES[key];
  if (known) return { key, ...known };
  const raw = text(nameValue);
  return { key, name: /^town$/i.test(text(munityp)) ? `Town of ${raw}` : /^city$/i.test(text(munityp)) ? `City of ${raw}` : raw };
}

// Spatial query of one layer for the parcel; the answer is reduced to coverage shares
// ([{ key, share, attributes }], largest first) so only small, outline-free data is cached.
export async function layerShares(url, where, samples, { outFields, keyOf, agency, label }) {
  const features = await arcgisQuery(url, { ...spatialParams(where), outFields }, { agency, label });
  return coverageShares(samples, withoutPersonalFields(features), keyOf).map(s => ({
    key: s.key, share: round3(s.share),
    attributes: s.attributes ? Object.fromEntries(Object.entries(s.attributes).filter(([k]) => !/^shape/i.test(k))) : null
  }));
}

export function queryJurisdictionShares(where, samples) {
  return layerShares(SPOKANE_JURISDICTIONS, where, samples, {
    outFields: 'NAME,MUNITYP', keyOf: a => jurisdictionKey(a.NAME), agency: 'Spokane County GIS', label: 'spokane-jurisdiction'
  });
}

// Which jurisdiction covers most of the parcel. Unincorporated land (NAME 'Spokane County', or no
// polygon at all) competes as key ''; a city wins only when it covers more of the parcel than
// unincorporated land and any other city. Returns { city (null = unincorporated), share, others }.
export function decideJurisdiction(shares) {
  const merged = new Map();
  for (const s of shares || []) {
    const key = !s.key || s.key === UNINCORPORATED ? '' : s.key;
    const entry = merged.get(key) || { key, share: 0, attributes: null };
    entry.share += s.share;
    entry.attributes = entry.attributes || s.attributes;
    merged.set(key, entry);
  }
  const ranked = [...merged.values()].sort((a, b) => b.share - a.share);
  const top = ranked[0] || { key: '', share: 1, attributes: null };
  const label = e => (e.key ? spokaneCityInfo(e.key, e.attributes?.MUNITYP).name : 'unincorporated Spokane County');
  const others = ranked.slice(1).filter(e => e.share >= 0.05).map(e => ({ name: label(e), share: round3(e.share) }));
  return {
    city: top.key ? spokaneCityInfo(top.key, top.attributes?.MUNITYP) : null,
    share: round3(Math.min(1, top.share)), attributes: top.attributes || {}, others
  };
}

export function queryCityZoningShares(city, where, samples) {
  const z = city.zoning;
  return layerShares(z.url, where, samples, { outFields: z.outFields, keyOf: a => z.code(a), agency: z.agency, label: z.label });
}

// " About 70% of the parcel is inside City of X limits; the rest is in Y (about 30%)."
export function jurisdictionNote(decision) {
  if (!decision.others.length) return '';
  const where = decision.city ? `inside ${decision.city.name} limits` : 'in unincorporated Spokane County';
  return ` About ${pct(decision.share)} of the parcel is ${where}; the rest is in ${decision.others.map(o => `${o.name} (about ${pct(o.share)})`).join(', ')}.`;
}

function links(city) {
  return city.planningUrl ? { url: city.planningUrl, urlLabel: city.planningLabel || `Open ${city.name} planning ↗` } : {};
}

// The zoning block for a parcel inside a city, town or the air base. Cities with a zoning layer
// get the zone covering most of the parcel; the others get an honest "city zoning applies". A
// failing city layer degrades to "unavailable" for that city only, still naming the city.
// `zoningR` is the settled city-layer answer (shares), or null when the city has no layer.
export function cityZoning(city, zoningR, samples, decision) {
  const note = jurisdictionNote(decision);
  const verify = `Verify allowed uses, density, setbacks and overlays with ${city.name}.`;
  if (city.federal) {
    return {
      status: 'federal_jurisdiction', code: null, name: '', jurisdictionType: 'federal',
      label: `${city.name} – federal land`,
      note: `This parcel is inside ${city.name}, federal land outside Spokane County and city zoning. Land use there is set by the federal government; contact the base.${note}`,
      sourceUrl: SPOKANE_JURISDICTIONS, sourceLabel: 'Open jurisdiction layer ↗'
    };
  }
  const applies = `This parcel is inside ${city.name} limits, so ${city.name} zoning applies, not Spokane County zoning.`;
  const contact = city.planningUrl ? `See the ${city.name} planning or zoning page and verify with the city.` : `Contact ${city.name} for its zoning map and code, and verify with the city.`;
  const seeCity = extra => ({
    status: 'city_jurisdiction', code: null, name: '', jurisdictionType: 'city',
    label: `${city.name} zoning applies – see city`,
    note: `${applies} ${extra} ${contact}${note}`,
    sourceUrl: SPOKANE_JURISDICTIONS, sourceLabel: 'Open jurisdiction layer ↗', ...links(city)
  });
  if (!city.zoning) return seeCity(`${city.name} does not publish a zoning map layer AcresX can read.`);
  const z = city.zoning;
  if (zoningR?.status !== 'fulfilled') {
    const message = zoningR?.reason?.message || 'request failed';
    return {
      status: 'unavailable', code: null, name: '', jurisdictionType: 'city',
      label: `${city.name} zoning lookup unavailable`,
      note: `${applies} The ${city.name} zoning map did not answer (${message}); check with the city.${note}`,
      sourceUrl: z.url, ...links(city), error: message
    };
  }
  const covered = (zoningR.value || []).filter(s => s.key);
  const top = covered[0];
  if (!top) return { ...seeCity(`The ${city.name} zoning map returned no zone on this parcel (it may be right-of-way or newly annexed).`), sourceUrl: z.url, sourceLabel: 'Open city zoning layer ↗' };
  const others = covered.slice(1).filter(s => s.share >= 0.05);
  const uncovered = 1 - covered.reduce((t, s) => t + s.share, 0);
  const shareNote = samples.length > 1 ? coverageNote(top, others, uncovered, 'city zone') : '';
  return {
    status: 'gis_match', code: top.key, name: z.name(top.attributes || {}, top.key), jurisdictionType: 'city',
    label: `${city.name} zoning`,
    note: `Mapped from the ${city.name} official zoning map. City zoning applies inside city limits, not Spokane County zoning. ${verify}${shareNote}${note}`,
    sourceUrl: z.url, sourceField: z.sourceField, ...links(city),
    ...(city.codeUrl ? { codeUrl: city.codeUrl } : {}),
    ...(z.extra ? z.extra(top.attributes || {}) : {}),
    ...(others.length ? { otherZones: others.map(s => ({ code: s.key, share: s.share })) } : {}),
    rules: 'not_mapped', rulesNote: "City zoning rules aren't mapped in AcresX yet; see the city's zoning code."
  };
}
