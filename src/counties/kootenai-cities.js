// Cities inside Kootenai County: who zones a parcel, and where each city's zoning lives.
// Sources (checked live 2026-10-27; see handoff/findings.md):
// - City limits: county layer Data_Layers/18 ("City Limits", really tax code areas). CITY is set
//   only inside a city ('Coeur d Alene', 'Post Falls', ...), blank or null outside.
// - City impact areas: county layer Data_Layers/17. Land in an impact area but outside city limits
//   keeps county zoning (e.g. Athol code; Hauser by its 1999 agreement), so it is shown as info only.
// - Coeur d'Alene and Post Falls publish official zoning layers. The other cities have no live
//   public zoning GIS (their old KCGIS consortium services are offline), so we say city zoning
//   applies and link the city's planning page where one was verified to load.
import { arcgisQuery, spatialParams } from '../shared/arcgis.js';
import { coverageShares, coverageNote, pct } from '../shared/polygon-coverage.js';

export const KC_CITY_LIMITS = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/18';
export const KC_CITY_IMPACT = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/17';
const CDA_ZONING = 'https://gis.cdaid.org/server/rest/services/Share/Planning/MapServer/8';
const POST_FALLS_ZONING = 'https://gis.postfalls.gov/server/rest/services/GIS2/LandUse/MapServer/5';

// Keyed by the layer 18 CITY value, upper-cased. planningUrl only where the page loaded on
// 2026-10-27; Rathdrum's site sits behind a bot check and the others had no reachable site.
const CITIES = {
  'COEUR D ALENE': { name: "City of Coeur d'Alene", planningUrl: 'https://www.cdaid.org/planning',
    zoning: { url: CDA_ZONING, label: 'cda-zoning', agency: "City of Coeur d'Alene GIS", service: 'Share/Planning', layerId: 8, outFields: 'ZONING,ZoningInfo,PUD,Notes,last_edited_date' } },
  'POST FALLS': { name: 'City of Post Falls', planningUrl: 'https://www.postfalls.gov/179/Planning',
    zoning: { url: POST_FALLS_ZONING, label: 'post-falls-zoning', agency: 'City of Post Falls GIS', service: 'GIS2/LandUse', layerId: 5, outFields: 'ZONING,LAST_UPDATED' } },
  HAYDEN: { name: 'City of Hayden', planningUrl: 'https://www.haydenid.gov/departments/planning_/index.php' },
  'SPIRIT LAKE': { name: 'City of Spirit Lake', planningUrl: 'https://www.spiritlakeid.gov/planningandzoning' },
  RATHDRUM: { name: 'City of Rathdrum' },
  'DALTON GARDENS': { name: 'City of Dalton Gardens' },
  'HAYDEN LAKE': { name: 'City of Hayden Lake' },
  ATHOL: { name: 'City of Athol' },
  HARRISON: { name: 'City of Harrison' },
  WORLEY: { name: 'City of Worley' },
  FERNAN: { name: 'Fernan Lake Village' },
  'HAUSER LAKE': { name: 'City of Hauser' },
  HUETTER: { name: 'City of Huetter' },
  'STATE LINE': { name: 'City of State Line' },
  STATELINE: { name: 'City of State Line' } // spelling used by the impact-area layer
};

const cityKey = value => String(value || '').replace(/[^A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

export function cityInfo(cityValue) {
  const key = cityKey(cityValue);
  if (!key) return null;
  return { key, ...(CITIES[key] || { name: `City of ${String(cityValue).trim()}` }) };
}

// Which city (if any) covers most of the parcel. Unincorporated land competes as key ''; a city
// wins only when it covers more of the parcel than unincorporated land and any other city.
export async function findCityJurisdiction(where, samples) {
  const features = await arcgisQuery(KC_CITY_LIMITS, { ...spatialParams(where), outFields: 'CITY' }, { agency: 'Kootenai County GIS', label: 'kootenai-city-limits' });
  const shares = coverageShares(samples, features, a => cityKey(a.CITY));
  const merged = new Map();
  for (const s of shares) merged.set(s.key || '', (merged.get(s.key || '') || 0) + s.share);
  const ranked = [...merged.entries()].sort((a, b) => b[1] - a[1]);
  const [topKey, topShare] = ranked[0] || ['', 1];
  if (!topKey) return null;
  const city = cityInfo(topKey);
  return { ...city, share: topShare, straddles: ranked.length > 1 };
}

export async function findCityImpactArea(where, samples) {
  const features = await arcgisQuery(KC_CITY_IMPACT, { ...spatialParams(where), outFields: 'CITY,ORDINANCE' }, { agency: 'Kootenai County GIS', label: 'kootenai-city-impact' });
  const top = coverageShares(samples, features, a => cityKey(a.CITY)).find(s => s.key);
  if (!top) return null;
  const ordinance = String(top.attributes?.ORDINANCE || '').trim();
  return { city: cityInfo(top.key).name, ...(ordinance ? { ordinance } : {}) };
}

// CdA's ZoningInfo is an HTML link to a zone PDF, but many polygons link another zone's PDF
// (a C-17 polygon linking R-17.pdf). Use the link only when it points at the city's own site
// (cdaid.org or www.cdaid.org, served as https) and its file name matches the zone.
function cdaZonePdf(attrs, code) {
  const href = String(attrs?.ZoningInfo || '').match(/href=["']?([^"'\s>]+)/i)?.[1];
  if (!href) return null;
  let url;
  try { url = new URL(href); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || !/^(www\.)?cdaid\.org$/i.test(url.hostname) || url.port || url.username || url.password) return null;
  url.protocol = 'https:';
  let file;
  try { file = decodeURIComponent(url.pathname.split('/').pop() || ''); } catch { return null; }
  return file.replace(/\.pdf$/i, '').toUpperCase() === code.toUpperCase() ? url.href : null;
}

const NOT_MAPPED_NOTE = "City zoning rules aren't mapped in AcresX yet; see the city's zoning code.";

function cityBase(city) {
  return {
    county: 'Kootenai', state: 'ID', countyStatus: 'kootenai-city-zoning-v1',
    jurisdiction: city.name, permitJurisdiction: { name: city.name }
  };
}
function tail(source) {
  return { comprehensivePlan: {}, urbanGrowthArea: { intersects: false }, overlays: [], permits: [], permitHistory: [], permitHistoryStatus: 'unavailable', source };
}

// Zoning for a parcel inside a city. Cities with a zoning layer get a mapped result; the others
// get an honest "city zoning applies" result. A failing city layer degrades to "unavailable" for
// that city only, still naming the city as the jurisdiction.
export async function getCityZoning(city, where, samples, { parcelAttrs = {}, matchMethod, jurisdictionNote = '' } = {}) {
  const jurisdictionSource = { agency: 'Kootenai County GIS', service: 'NewServices/Data_Layers', layerId: 18, city: city.key, share: Math.round(city.share * 1000) / 1000 };
  const planning = city.planningUrl ? { url: city.planningUrl, urlLabel: `Open ${city.name} planning ↗` } : {};
  if (!city.zoning) {
    const contact = city.planningUrl ? `See the ${city.name} planning page.` : `Contact ${city.name} for its zoning map and code.`;
    return {
      available: false, ...cityBase(city),
      zoning: { status: 'city_jurisdiction', label: `${city.name} zoning – see city`, note: `This parcel is inside ${city.name} limits, so city zoning applies, not Kootenai County zoning. ${city.name} zoning is not available digitally. ${contact}${jurisdictionNote}`, sourceUrl: KC_CITY_LIMITS, sourceLabel: 'Open city limits layer ↗', ...planning },
      ...tail({ agency: 'Kootenai County GIS', service: 'NewServices/Data_Layers', layerId: 18, matchMethod, jurisdictionSource, parcelAttributes: parcelAttrs })
    };
  }
  const z = city.zoning;
  const source = { agency: z.agency, service: z.service, layerId: z.layerId, matchMethod, jurisdictionSource, parcelAttributes: parcelAttrs };
  let features;
  try {
    features = await arcgisQuery(z.url, { ...spatialParams(where), outFields: z.outFields }, { agency: z.agency, label: z.label });
  } catch (error) {
    console.warn(`${city.name} zoning lookup failed`, error);
    return {
      available: false, ...cityBase(city),
      zoning: { status: 'unavailable', label: `${city.name} zoning lookup unavailable`, note: `This parcel is inside ${city.name} limits, so city zoning applies. The city zoning map did not answer (${error?.message || 'request failed'}); check with the city.${jurisdictionNote}`, sourceUrl: z.url, ...planning },
      ...tail({ ...source, error: error?.message || 'City zoning lookup failed' })
    };
  }
  const shares = coverageShares(samples, features, a => String(a.ZONING || '').trim());
  const covered = shares.filter(s => s.key);
  const top = covered[0];
  if (!top) {
    return {
      available: false, ...cityBase(city),
      zoning: { status: 'no_mapped_result', label: `No mapped ${city.name} zoning result`, note: `This parcel is inside ${city.name} limits, but the city zoning map returned no zone here (it may be newly annexed). Check with the city.${jurisdictionNote}`, sourceUrl: z.url, ...planning },
      ...tail(source)
    };
  }
  const code = top.key;
  const attributes = Object.fromEntries(Object.entries(top.attributes || {}).filter(([k]) => k !== 'Shape'));
  const others = covered.slice(1).filter(s => s.share >= 0.05);
  const shareNote = samples.length > 1 ? coverageNote(top, others, 1 - covered.reduce((t, s) => t + s.share, 0), 'city zone') : '';
  const pdf = city.key === 'COEUR D ALENE' ? cdaZonePdf(top.attributes, code) : null;
  const url = pdf || city.planningUrl;
  const allowedBuildings = { title: 'Allowed Buildings / Dwelling Types', zone: code, sourceUrl: url, status: 'not_mapped', uses: [], note: NOT_MAPPED_NOTE };
  return {
    available: true, ...cityBase(city),
    zoning: {
      status: 'gis_match', code, name: code, label: code,
      note: `Mapped zoning designation from the ${city.name} zoning map. City zoning applies inside city limits.${shareNote}${jurisdictionNote}`,
      sourceUrl: z.url, url, urlLabel: pdf ? `Open ${code} zone summary (PDF) ↗` : `Open ${city.name} planning ↗`,
      ...(others.length ? { otherZones: others.map(s => ({ code: s.key, share: Math.round(s.share * 1000) / 1000 })) } : {})
    },
    allowedBuildings, permittedUses: allowedBuildings,
    ...tail({ ...source, attributes })
  };
}
