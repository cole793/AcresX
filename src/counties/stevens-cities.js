// Cities and towns inside Stevens County, WA: who zones a parcel, and where each one's zoning lives.
// Every source below was checked live (read-only, `?f=json`, distinct values) on 2026-11-04.
//
// All layers are on the county's own service, "Stevens County Zoning Data"
//   https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer
//   (service description: "Stevens County zoning data provided by Stevens County GIS. This data is
//   updated and maintained solely by Stevens County GIS."). The server sends CORS headers.
//
// - Layer 0 "Cities": field `name` (alias NAME). Six polygons: Chewelah, Colville, Kettle Falls,
//   Marcus, Northport, Springdale. Unincorporated land has no polygon. The county zoning layer
//   (layer 1) has no polygon inside them (e.g. 0231200 in Chewelah, 0000500 in Colville).
// - City zoning layers, one per city (Stevens County GIS copies of the city maps):
//   2 "Chewelah Zoning Districts": `name` ('R1 - Residential', 'RB - Retail Business',
//     'APGC-1', 'Public', 'Street', ...): code before " - ", name after.
//   3 "Colville Zoning Districts": `ZONING` ('R-1', 'C-2', 'R-1-S', 'AF', ...), `NAME`
//     ('Single Family Residential', 'Central Business', ...).
//   4 "Kettle Falls Zoning Districts": `zonecode` ('SFR', 'C1', 'HI', ...), `name`
//     ('Single Family Residential'; one value carries a trailing "\r\n").
//   5 "Springdale Zoning Districts": `parceln` holds the zone code ('R-1', 'R-B', 'A', 'I', 'PF')
//     and `hyperlink` its name ('Residential', 'Retail Business', 'Agri Urban', ...); the renderer
//     labels confirm it ("R-B (Retail Business)"). Layer description: "created from a hard copy
//     map provided ... at the Town of Springdale. This is the zoning for the town."
//   6 "Northport Zoning Districts": `landuse` ('Residential', 'Commercial', 'Industrial',
//     'Multi-Family', 'Open', 'Public', and 'Exempt'). The layer's renderer draws every value but
//     'Exempt', so 'Exempt' polygons are not read as a zone.
//   7 "Marcus Zoning Districts": `name` ('Residential', 'Commercial/Residential', 'Light
//     Industrial', 'Open Space', 'City Owned', and 'Marcus'). The renderer has no 'Marcus' class,
//     so that value is not read as a zone.
// - Planning links only where a page loaded on 2026-11-04: www.cityofchewelah.org (200) and its
//   code at chewelah.municipalcodeonline.com (200). www.colville.wa.us answered 403; no official
//   page was found or loaded for Kettle Falls, Marcus, Northport or Springdale.
import { arcgisQuery, spatialParams } from '../shared/arcgis.js';
import { coverageShares, coverageNote, pct } from '../shared/polygon-coverage.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';

export const STEVENS_ZONING_SERVICE = 'https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer';
export const STEVENS_CITIES = `${STEVENS_ZONING_SERVICE}/0`;
export const STEVENS_AGENCY = 'Stevens County GIS';

const round3 = n => Math.round(n * 1000) / 1000;
const text = value => (value == null ? '' : String(value).replace(/\s+/g, ' ').trim());
const cityLayer = id => `${STEVENS_ZONING_SERVICE}/${id}`;
// "R1 - Residential" -> { code: 'R1', name: 'Residential' }; "APGC-1" -> code only.
function chewelahParts(value) {
  const v = text(value);
  const i = v.indexOf(' - ');
  return i > 0 ? { code: v.slice(0, i).trim(), name: v.slice(i + 3).trim() } : { code: v, name: '' };
}
const NOT_A_ZONE = { NORTHPORT: new Set(['EXEMPT']), MARCUS: new Set(['MARCUS']) };

// Keyed by the Cities layer `name`, upper-cased.
const CITIES = {
  CHEWELAH: {
    name: 'City of Chewelah', planningUrl: 'https://www.cityofchewelah.org/', planningLabel: 'Open City of Chewelah website ↗',
    codeUrl: 'https://chewelah.municipalcodeonline.com/book?type=ordinances',
    zoning: { layerId: 2, outFields: 'name', sourceField: 'name', code: a => chewelahParts(a.name).code, name: a => chewelahParts(a.name).name }
  },
  COLVILLE: {
    name: 'City of Colville',
    zoning: { layerId: 3, outFields: 'ZONING,NAME', sourceField: 'ZONING', code: a => text(a.ZONING), name: a => text(a.NAME) }
  },
  'KETTLE FALLS': {
    name: 'City of Kettle Falls',
    zoning: { layerId: 4, outFields: 'zonecode,name', sourceField: 'zonecode', code: a => text(a.zonecode), name: a => text(a.name) }
  },
  SPRINGDALE: {
    name: 'Town of Springdale',
    zoning: { layerId: 5, outFields: 'parceln,hyperlink', sourceField: 'parceln', code: a => text(a.parceln), name: a => text(a.hyperlink) }
  },
  NORTHPORT: {
    name: 'Town of Northport',
    zoning: { layerId: 6, outFields: 'landuse', sourceField: 'landuse', code: a => text(a.landuse), name: () => '' }
  },
  MARCUS: {
    name: 'Town of Marcus',
    zoning: { layerId: 7, outFields: 'name', sourceField: 'name', code: a => text(a.name), name: () => '' }
  }
};

const cityKey = value => text(value).toUpperCase();

export function stevensCityInfo(nameValue) {
  const key = cityKey(nameValue);
  if (!key) return null;
  return { key, ...(CITIES[key] || { name: `City of ${text(nameValue)}` }) };
}

// Spatial query of one layer for the parcel, reduced to coverage shares ([{ key, share,
// attributes }], largest first) so only small, outline-free data is cached.
export async function layerShares(url, where, samples, { outFields, keyOf, label }) {
  const features = await arcgisQuery(url, { ...spatialParams(where), outFields }, { agency: STEVENS_AGENCY, label });
  return coverageShares(samples, withoutPersonalFields(features), keyOf).map(s => ({
    key: s.key, share: round3(s.share),
    attributes: s.attributes ? Object.fromEntries(Object.entries(s.attributes).filter(([k]) => !/^shape/i.test(k))) : null
  }));
}

export function queryCityShares(where, samples) {
  return layerShares(STEVENS_CITIES, where, samples, { outFields: 'name', keyOf: a => cityKey(a.name), label: 'stevens-cities' });
}

export function queryCityZoningShares(city, where, samples) {
  const z = city.zoning;
  const skip = NOT_A_ZONE[city.key] || new Set();
  return layerShares(cityLayer(z.layerId), where, samples, {
    outFields: z.outFields, label: `stevens-city-zoning-${z.layerId}`,
    keyOf: a => { const code = z.code(a); return code && !skip.has(code.toUpperCase()) ? code : null; }
  });
}

// Which jurisdiction covers most of the parcel. Unincorporated land (no city polygon) competes as
// key ''; a city wins only when it covers more of the parcel than unincorporated land and any
// other city. Returns { city (null = unincorporated), share, others }.
export function decideJurisdiction(shares) {
  const merged = new Map();
  for (const s of shares || []) {
    const key = s.key || '';
    merged.set(key, (merged.get(key) || 0) + s.share);
  }
  const ranked = [...merged.entries()].map(([key, share]) => ({ key, share })).sort((a, b) => b.share - a.share);
  const top = ranked[0] || { key: '', share: 1 };
  const label = e => (e.key ? stevensCityInfo(e.key).name : 'unincorporated Stevens County');
  return {
    city: top.key ? stevensCityInfo(top.key) : null,
    share: round3(Math.min(1, top.share)),
    others: ranked.slice(1).filter(e => e.share >= 0.05).map(e => ({ name: label(e), share: round3(e.share) }))
  };
}

// " About 70% of the parcel is inside City of X limits; the rest is in Y (about 30%)."
export function jurisdictionNote(decision) {
  if (!decision.others.length) return '';
  const where = decision.city ? `inside ${decision.city.name} limits` : 'in unincorporated Stevens County';
  return ` About ${pct(decision.share)} of the parcel is ${where}; the rest is in ${decision.others.map(o => `${o.name} (about ${pct(o.share)})`).join(', ')}.`;
}

function links(city) {
  return {
    ...(city.planningUrl ? { url: city.planningUrl, urlLabel: city.planningLabel || `Open ${city.name} planning ↗` } : {}),
    ...(city.codeUrl ? { codeUrl: city.codeUrl } : {})
  };
}

const CITY_RULES_NOTE = "City zoning rules aren't mapped in AcresX yet; see the city's zoning code.";

// The zoning block for a parcel inside a city or town. `zoningR` is the settled city-layer answer
// (shares). A failing city layer degrades to "unavailable" for that city only, still naming it.
export function cityZoning(city, zoningR, samples, decision) {
  const note = jurisdictionNote(decision);
  const applies = `This parcel is inside ${city.name} limits, so ${city.name} zoning applies, not Stevens County zoning.`;
  const contact = city.planningUrl ? `See ${city.name} and verify with the city.` : `Contact ${city.name} for its zoning map and code, and verify with the city.`;
  const z = city.zoning;
  const sourceUrl = z ? cityLayer(z.layerId) : STEVENS_CITIES;
  const seeCity = extra => ({
    status: 'city_jurisdiction', code: null, name: '', jurisdictionType: 'city',
    label: `${city.name} zoning applies – see city`,
    note: `${applies} ${extra} ${contact}${note}`,
    sourceUrl, sourceLabel: z ? 'Open city zoning layer ↗' : 'Open city limits layer ↗', ...links(city)
  });
  if (!z) return seeCity(`AcresX has no zoning map layer for ${city.name}.`);
  if (zoningR?.status !== 'fulfilled') {
    const message = zoningR?.reason?.message || 'request failed';
    return {
      status: 'unavailable', code: null, name: '', jurisdictionType: 'city',
      label: `${city.name} zoning lookup unavailable`,
      note: `${applies} The ${city.name} zoning map did not answer (${message}); check with the city.${note}`,
      sourceUrl, ...links(city), error: message
    };
  }
  const covered = (zoningR.value || []).filter(s => s.key);
  const top = covered[0];
  if (!top) return seeCity(`The ${city.name} zoning map returned no zone on this parcel (it may be right-of-way or newly annexed).`);
  const others = covered.slice(1).filter(s => s.share >= 0.05);
  const uncovered = 1 - covered.reduce((t, s) => t + s.share, 0);
  const shareNote = samples.length > 1 ? coverageNote(top, others, uncovered, 'city zone') : '';
  return {
    status: 'gis_match', code: top.key, name: z.name(top.attributes || {}), jurisdictionType: 'city',
    label: `${city.name} zoning`,
    note: `Mapped from the ${city.name} zoning map published by Stevens County GIS. City zoning applies inside city limits, not Stevens County zoning. Verify allowed uses, density, setbacks and overlays with ${city.name}.${shareNote}${note}`,
    sourceUrl, sourceField: z.sourceField, ...links(city),
    ...(others.length ? { otherZones: others.map(s => ({ code: s.key, share: s.share })) } : {}),
    rules: 'not_mapped', rulesNote: CITY_RULES_NOTE
  };
}
