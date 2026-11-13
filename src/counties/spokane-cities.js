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
//   Backup (`backupLayer`, used only when the city's own server fails; owner decision 2026-11-13,
//   after arcgis.spokanevalley.org answered HTTP 500 "Application Error" on every path on
//   2026-11-12 and 11-13, CommunityDevelopment/Zoning/MapServer/1 included, so that layer is no
//   backup): https://services2.arcgis.com/hYnqO6a7TkujNqEg/arcgis/rest/services/City_of_Spokane_Valley___Zoning_Map_WFL1/FeatureServer/0
//   Checked read-only (`?f=json`) on 2026-11-13. ArcGIS Online item 50c7914786654c1781d0c9d9ac876d89
//   "City of Spokane Valley - Zoning (Hosted)", owner GIS_SpokaneValley1 ("GIS Admin for City of
//   Spokane Valley"; the same account owns the city's ViewerV3 and Spokane Valley Viewer items),
//   public. Snippet: "Spokane Valley Zoning - Hosted. This data is current as of May 22nd 2024 and
//   reflects the 24-008 CPA." License: "This data is current as of May 22nd 2024. If additional
//   CPA's occur after this date, this data should not be used as the latest/greatest zoning data."
//   Layer 0 "Zoning": editingInfo lastEditDate 1716396747104 (2024-05-22); 31,869 features; fields
//   include Zoning ('R-3'), Zoning_Desg ('Single-Family Residential (R-3)'), Zoning_Desc,
//   Zoning_Ordinance_no (same Zoning / Zoning_Desg as the primary). Point check 2026-11-13 for
//   parcel 35234.0602: .../FeatureServer/0/query?f=json&geometry=-117.331913769,47.642932533&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=Zoning,Zoning_Desg&returnGeometry=false
//   -> Zoning 'R-3', Zoning_Desg 'Single-Family Residential (R-3)' (the primary's answer before the
//   outage). Not used: the viewer's own hosted copy, LandUse_Testing4/FeatureServer/3 (item
//   e9d11533dfc04906b67ce59c80675f96 "Land Use - EVV - Hosted", last edit 2024-05-30, also R-3
//   there), because its license says "This service is not for use directly referencing the Feature
//   Layer." A backup answer is labelled "older copy (2024), verify with the city" and never cached.
// - City of Cheney: https://services.arcgis.com/yP5WvH3YqutU0LDh/arcgis/rest/services/Cheney__WA___Zoning_Map___2025_WFL1/FeatureServer/4
//   "Zoning 2026". The city republished the service around 2026-11-10 and renumbered its layers:
//   0 Building Footprints 2026, 1 Cheney Parcels 2026, 2 Central Cheney Historic District,
//   3 PUD Overlay, 4 Zoning 2026 (`?f=json`, checked 2026-11-10; layer 3 was "Zoning_2025" before,
//   so the old layer-3 query now fails with 400 "Cannot perform query. Invalid query parameters.").
//   Layer 4 fields: RuleID, ZONE ('Single Family Residential'), ZoneCODE ('R-1'), ACREAGE, AREA;
//   last edit 2026-11-10. Service description "Zoning effective March 12th, 2025 w/ passage of
//   Ordinance Y-84; approved on February 10th, 2025." Layer 3 "PUD Overlay" (description "To show
//   the extent of zoning overlays for Planned Unit Developments (PUDs) within the corporate
//   boundaries of the City of Cheney, Washington."; copyright "Community Development Department,
//   City of Cheney"): fields PUDCODE ('PUD') and ZONE (the underlying zone, 'R-1' or 'R-3'); shown
//   as an additive overlay. Point check 2026-11-10 for parcel 13013.2211 (3175 Pheasant St):
//   .../FeatureServer/4/query?f=json&geometry=-117.575987,47.510249&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZoneCODE,ZONE&returnGeometry=false
//   -> ZoneCODE 'R-1', ZONE 'Single Family Residential'; layer 3 with outFields=PUDCODE,ZONE ->
//   'PUD', 'R-1'. Linked from the city's Maps and Planning pages (cityofcheney.org/196/Maps,
//   /192/Planning-Department) through the cheney.maps.arcgis.com zoning app.
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
//
// Renumbered layers: each city layer names the layer it expects (`layerName`). When a query fails
// with a moved-layer error (src/shared/arcgis-layer-move.js: ArcGIS 400 "Invalid query
// parameters", an invalid field, "Layer not found"), the service's `?f=json` is read once, the one
// layer whose name matches and that has every outField is asked instead, a {"evt":"layer-moved"}
// line is logged, and the new id is kept for the rest of the isolate's life. Layer names on
// 2026-11-10: City of Spokane Zoning/FeatureServer has only 5 "Zoning"; Spokane Valley
// ViewerV3/LandUse has 1 "Zoning" and 4 "Zoning Legacy" (hence the exact pattern); Airway Heights
// has only 0 "Current_Zoning_Districts"; Liberty Lake only 0 "2024 Zoning".
import { arcgisQuery, spatialParams } from '../shared/arcgis.js';
import { queryWithLayerRecovery, currentLayerUrl } from '../shared/arcgis-layer-move.js';
import { coverageShares, overlapShares, coverageNote, pct } from '../shared/polygon-coverage.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { hasSpokaneCityRules, spokaneCityCodeLink } from '../zoning/spokane-city-rules.js';

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

const CHENEY_ZONING_SERVICE = 'https://services.arcgis.com/yP5WvH3YqutU0LDh/arcgis/rest/services/Cheney__WA___Zoning_Map___2025_WFL1/FeatureServer';

// Keyed by the jurisdiction layer's NAME, upper-cased. planningUrl only where the page loaded on
// 2026-11-02 (my.spokanecity.org is behind a bot check for scripts; the code link comes from the
// city zoning layer's own description).
const CITIES = {
  SPOKANE: {
    name: 'City of Spokane', planningUrl: 'https://my.spokanecity.org/smc/?Title=17C', planningLabel: 'Open Spokane Municipal Code Title 17C ↗',
    zoning: {
      url: 'https://services.arcgis.com/3PDwyTturHqnGCu0/arcgis/rest/services/Zoning/FeatureServer/5',
      agency: 'City of Spokane GIS', label: 'spokane-city-zoning', sourceField: 'ZoneLabel', layerName: /zoning/i,
      outFields: 'ZoneLabel,ZoneCode,ZoneDesc,ZoneGen,Height,Ordinance',
      code: a => text(a.ZoneLabel) || text(a.ZoneCode),
      name: a => text(a.ZoneDesc),
      extra: a => ({ ...(text(a.ZoneCode) ? { baseZone: text(a.ZoneCode) } : {}), ...(text(a.ZoneGen) ? { zoneCategory: text(a.ZoneGen) } : {}), ...(Number(a.Height) > 0 ? { heightLimitFt: Number(a.Height) } : {}), ...(text(a.Ordinance) ? { ordinance: text(a.Ordinance) } : {}) })
    }
  },
  'SPOKANE VALLEY': {
    name: 'City of Spokane Valley', planningUrl: 'https://www.spokanevalleywa.gov/269/Planning-and-Zoning',
    // codepublishing.com/WA/SpokaneValley now only says the code moved to General Code eCode360.
    codeUrl: 'https://ecode360.com/SP4654',
    zoning: {
      url: 'https://arcgis.spokanevalley.org/arcgis/rest/services/ViewerV3/LandUse/MapServer/1',
      agency: 'City of Spokane Valley GIS', label: 'spokane-valley-zoning', sourceField: 'Zoning', layerName: /^\s*zoning\s*$/i,
      outFields: 'Zoning,Zoning_Desg',
      code: a => text(a.Zoning),
      name: (a, code) => valleyName(a, code),
      // Older ArcGIS Online copy, asked only when the layer above fails (see the top of this file).
      backupLayer: {
        url: 'https://services2.arcgis.com/hYnqO6a7TkujNqEg/arcgis/rest/services/City_of_Spokane_Valley___Zoning_Map_WFL1/FeatureServer/0',
        agency: 'City of Spokane Valley GIS (ArcGIS Online copy)', label: 'spokane-valley-zoning-backup',
        asOf: '2024-05-22', asOfLabel: '2024'
      }
    }
  },
  CHENEY: {
    name: 'City of Cheney', planningUrl: 'https://www.cityofcheney.org/192/Planning-Department',
    zoning: {
      url: `${CHENEY_ZONING_SERVICE}/4`,
      agency: 'City of Cheney GIS', label: 'cheney-zoning', sourceField: 'ZoneCODE', layerName: /zoning/i,
      outFields: 'ZoneCODE,ZONE',
      code: a => text(a.ZoneCODE),
      name: a => text(a.ZONE)
    },
    // City overlays (additive information; never change the zone, the rules or the score).
    overlays: [{
      type: 'planned_unit_development', url: `${CHENEY_ZONING_SERVICE}/3`, layerName: /\bPUD\b|planned unit/i,
      agency: 'City of Cheney GIS', label: 'cheney-pud-overlay', outFields: 'PUDCODE,ZONE',
      key: a => (text(a.PUDCODE) ? `${text(a.PUDCODE)}${text(a.ZONE) ? ` (${text(a.ZONE)})` : ''}` : ''),
      name: key => `Planned Unit Development overlay: ${key}`,
      source: 'City of Cheney PUD Overlay (Community Development Department)', checkedLabel: 'PUD Overlay',
      detail: 'A Planned Unit Development approval can set its own lot sizes, densities and setbacks; check the PUD conditions with the City of Cheney.'
    }]
  },
  'AIRWAY HEIGHTS': {
    name: 'City of Airway Heights', planningUrl: 'https://cawh.org/planning-department-information/',
    zoning: {
      url: 'https://services6.arcgis.com/yrsL3gWPR8ZySnTr/arcgis/rest/services/Current_Zoning_Districts/FeatureServer/0',
      agency: 'City of Airway Heights GIS', label: 'airway-heights-zoning', sourceField: 'Zoning_Dis', layerName: /zoning/i,
      outFields: 'Zoning_Dis',
      code: a => airwayParts(a).code,
      name: a => airwayParts(a).name
    }
  },
  'LIBERTY LAKE': {
    name: 'City of Liberty Lake', planningUrl: 'https://www.libertylakewa.gov/476/Zoning-Information',
    zoning: {
      url: 'https://services.arcgis.com/sAiTgWHcD4FbRdCu/arcgis/rest/services/Liberty_Lake_Zoning/FeatureServer/0',
      agency: 'City of Liberty Lake GIS', label: 'liberty-lake-zoning', sourceField: 'Class_Abv', layerName: /zoning/i,
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
export async function layerShares(url, where, samples, { outFields, keyOf, agency, label, ...queryOptions }) {
  const features = await arcgisQuery(url, { ...spatialParams(where), outFields }, { ...queryOptions, agency, label });
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

const recovery = layer => ({ namePattern: layer.layerName, fields: layer.outFields.split(','), agency: layer.agency, label: layer.label });

// Backup layer queries are short (one 8 s attempt): the primary has already spent its own time.
const BACKUP_QUERY = { timeoutMs: 8000, retries: 0 };
// Quiet under `node --test` (as in src/shared/upstream.js); tests that check the lines pass a logger.
const quietTests = (() => { try { return Boolean(globalThis.process?.env?.NODE_TEST_CONTEXT); } catch { return false; } })();
let logLine = quietTests ? () => {} : line => console.log(line);
// Tests only: capture the backup log lines. Returns a restore function.
export function configureCityZoningLog(logger) {
  const previous = logLine;
  logLine = logger;
  return () => { logLine = previous; };
}

// The city zoning answer: { layerUrl, shares }. layerUrl is the layer that answered (the new URL
// after a moved-layer recovery).
// When the city layer fails (5xx, timeout, network or ArcGIS error, or a moved-layer recovery that
// found nothing) and the city config has a `backupLayer` ({ url, agency, label, asOf, asOfLabel };
// outFields, code and name default to the primary's), the backup is asked once. A backup that
// names a zone answers { layerUrl: backup url, shares, source: 'backup', sourceAsOf, primaryError };
// a failing or empty backup rethrows the primary's error, so the answer is today's "unavailable".
export async function queryCityZoningShares(city, where, samples) {
  const z = city.zoning;
  try {
    const { layerUrl, value } = await queryWithLayerRecovery(
      z.url, url => layerShares(url, where, samples, { outFields: z.outFields, keyOf: a => z.code(a), agency: z.agency, label: z.label }), recovery(z)
    );
    return { layerUrl, shares: value };
  } catch (error) {
    const b = z.backupLayer;
    if (!b || error?.kind === 'cancelled') throw error;
    const primaryError = String(error?.message || 'request failed');
    let shares;
    try {
      shares = await layerShares(b.url, where, samples, { ...BACKUP_QUERY, outFields: b.outFields || z.outFields, keyOf: a => (b.code || z.code)(a), agency: b.agency || z.agency, label: b.label || `${z.label}-backup` });
    } catch (backupError) {
      logLine(JSON.stringify({ evt: 'zoning-backup-failed', label: b.label, primaryError: primaryError.slice(0, 200), backupError: String(backupError?.message || '').slice(0, 200) }));
      throw error;
    }
    if (!shares.some(s => s.key)) {
      logLine(JSON.stringify({ evt: 'zoning-backup-empty', label: b.label, primaryError: primaryError.slice(0, 200) }));
      throw error;
    }
    logLine(JSON.stringify({ evt: 'zoning-backup-used', label: b.label, layer: b.url, asOf: b.asOf, primaryError: primaryError.slice(0, 200) }));
    return { layerUrl: b.url, shares, source: 'backup', sourceAsOf: b.asOf || null, primaryError };
  }
}

// One overlay layer of a city (CITIES[...].overlays): { layerUrl, shares: [{ key, share }] }.
async function queryCityOverlay(layer, where, samples) {
  const { layerUrl, value } = await queryWithLayerRecovery(layer.url, async url => {
    const features = await arcgisQuery(url, { ...spatialParams(where), outFields: layer.outFields }, { agency: layer.agency, label: layer.label });
    return overlapShares(samples, withoutPersonalFields(features), layer.key).map(s => ({ key: s.key, share: round3(s.share) }));
  }, recovery(layer));
  return { layerUrl, shares: value };
}

// The city's overlay layers, one settled answer each ([] for a city without any).
export function queryCityOverlays(city, where, samples, settle) {
  return Promise.all((city?.overlays || []).map(layer => settle(queryCityOverlay(layer, where, samples))));
}

// City overlay entries in the shape of src/counties/spokane-overlays.js overlayResponse, to append
// to its `overlays` / `overlaysUnavailable`. Additive information only.
// `checked` lists the city layers that answered ([{ source: city name, layer: checkedLabel }]).
export function cityOverlayEntries(city, settled) {
  const overlays = [], unavailable = [], checked = [];
  (settled || []).forEach((r, i) => {
    const layer = city?.overlays?.[i];
    if (!layer) return;
    if (r?.status !== 'fulfilled') {
      unavailable.push({ type: layer.type, source: layer.source, sourceUrl: currentLayerUrl(layer.url), error: r?.reason?.message || 'unavailable' });
      return;
    }
    checked.push({ source: city.name, layer: layer.checkedLabel || layer.source });
    for (const s of r.value?.shares || []) {
      overlays.push({ type: layer.type, name: layer.name(s.key), source: layer.source, sourceUrl: r.value.layerUrl || layer.url, share: s.share, detail: layer.detail });
    }
  });
  return { overlays, unavailable, checked };
}

// Adds the city's overlays to the county overlay fields (spokane-overlays.js overlayResponse).
// When a city overlay layer answered, the answer names the city as a source too (additive keys):
// overlayNote "mapped by Spokane County and the City of Cheney", overlaySources ['Spokane County',
// 'City of Cheney'], and cityOverlaysChecked (for the browser's "none mapped" text).
export function withCityOverlays(fields, city, settled) {
  const extra = cityOverlayEntries(city, settled);
  const out = { ...fields, overlays: [...fields.overlays, ...extra.overlays], overlaysUnavailable: [...fields.overlaysUnavailable, ...extra.unavailable] };
  if (!extra.checked.length) return out;
  return {
    ...out,
    overlayNote: String(out.overlayNote || '').replace('mapped by Spokane County', `mapped by Spokane County and the ${city.name}`),
    overlaySources: ['Spokane County', city.name],
    cityOverlaysChecked: extra.checked
  };
}

// " About 70% of the parcel is inside City of X limits; the rest is in Y (about 30%)."
export function jurisdictionNote(decision) {
  if (!decision.others.length) return '';
  const where = decision.city ? `inside ${decision.city.name} limits` : 'in unincorporated Spokane County';
  return ` About ${pct(decision.share)} of the parcel is ${where}; the rest is in ${decision.others.map(o => `${o.name} (about ${pct(o.share)})`).join(', ')}.`;
}

// Whether the city has a rules table with this zone (src/zoning/spokane-city-rules.js). The browser
// asks /api/zoning-rules only when it does; otherwise it shows "rules not mapped" with the link.
function cityRules(city, code) {
  if (hasSpokaneCityRules(city.name, code)) return { rules: 'mapped' };
  const link = spokaneCityCodeLink(city.name);
  return {
    rules: 'not_mapped',
    rulesNote: `Rules for ${code} aren't mapped in AcresX yet; see the ${link?.codeLabel || "city's zoning code"} and verify with the city.`,
    ...(link ? { rulesUrl: link.codeUrl, rulesUrlLabel: `Open ${link.codeLabel} ↗` } : {})
  };
}

function links(city) {
  return city.planningUrl ? { url: city.planningUrl, urlLabel: city.planningLabel || `Open ${city.name} planning ↗` } : {};
}

// The zoning block for a parcel inside a city, town or the air base. Cities with a zoning layer
// get the zone covering most of the parcel; the others get an honest "city zoning applies". A
// failing city layer degrades to "unavailable" for that city only, still naming the city.
// `zoningR` is the settled city-layer answer ({ layerUrl, shares }), or null when the city has no layer.
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
  const layerUrl = zoningR?.value?.layerUrl || currentLayerUrl(z.url);
  if (zoningR?.status !== 'fulfilled') {
    const message = zoningR?.reason?.message || 'request failed';
    return {
      status: 'unavailable', code: null, name: '', jurisdictionType: 'city',
      label: `${city.name} zoning lookup unavailable`,
      note: `${applies} The ${city.name} zoning map did not answer (${message}); check with the city.${note}`,
      sourceUrl: layerUrl, ...links(city), error: message
    };
  }
  const covered = (zoningR.value?.shares || []).filter(s => s.key);
  const top = covered[0];
  if (!top) return { ...seeCity(`The ${city.name} zoning map returned no zone on this parcel (it may be right-of-way or newly annexed).`), sourceUrl: layerUrl, sourceLabel: 'Open city zoning layer ↗' };
  const others = covered.slice(1).filter(s => s.share >= 0.05);
  const uncovered = 1 - covered.reduce((t, s) => t + s.share, 0);
  const shareNote = samples.length > 1 ? coverageNote(top, others, uncovered, 'city zone') : '';
  // From the city's backup layer (queryCityZoningShares): same zone fields, labelled as an older copy.
  const backup = zoningR.value?.source === 'backup' ? z.backupLayer || {} : null;
  const older = backup ? `older copy${backup.asOfLabel ? ` (${backup.asOfLabel})` : ''}` : '';
  const nameOf = backup?.name || z.name;
  return {
    status: 'gis_match', code: top.key, name: nameOf(top.attributes || {}, top.key), jurisdictionType: 'city',
    label: backup ? `${city.name} zoning – ${older}, verify with the city` : `${city.name} zoning`,
    note: backup
      ? `${city.name}'s zoning server did not answer; this zone comes from an ${older}. Verify with the city. City zoning applies inside city limits, not Spokane County zoning. ${verify}${shareNote}${note}`
      : `Mapped from the ${city.name} official zoning map. City zoning applies inside city limits, not Spokane County zoning. ${verify}${shareNote}${note}`,
    ...(backup ? {
      source: 'backup', sourceAsOf: zoningR.value.sourceAsOf || backup.asOf || null, sourceNote: `${older}, verify with the city`,
      primarySourceUrl: currentLayerUrl(z.url), primaryError: zoningR.value.primaryError || 'request failed'
    } : {}),
    sourceUrl: layerUrl, sourceField: backup?.sourceField || z.sourceField, ...links(city),
    ...(city.codeUrl ? { codeUrl: city.codeUrl } : {}),
    ...(z.extra ? z.extra(top.attributes || {}) : {}),
    ...(others.length ? { otherZones: others.map(s => ({ code: s.key, share: s.share })) } : {}),
    ...cityRules(city, top.key)
  };
}
