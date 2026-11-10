// Spokane County overlay layers for /api/zoning-permits (`overlays`): critical areas, shoreline
// designations and airport zones that sit on top of the base zone. Additive information only: they
// never change the zone, the zoning rules or the buildability score.
//
// Sources, all on Spokane County's own server, checked read-only (`?f=json`) on 2026-11-10:
// - https://gismo.spokanecounty.org/arcgis/rest/services/BPPublic/CriticalAreasBPPublic/MapServer
//   Service document "Critical Areas for Front Counter App" (Spokane County Building & Planning).
//   /0 "Shoreline Designations": copyright "Spokane County ISD-GIS for Spokane County Building and
//      Planning Department". Fields WATERTYPE ('Shoreline Program', 'Water', 'Marsh', 'Island',
//      ...) and DESIGNATION. Only WATERTYPE 'Shoreline Program' rows carry a designation
//      ('Natural', 'Rural Conservancy', 'Shoreline Residential', 'Urban Conservancy'); 'Water' rows
//      are the water body itself (DESIGNATION is the lake name or blank) and are not used. The
//      layer description still calls the designations "Proposed" (text from before the county
//      adopted its Shoreline Master Program update), so the UI says to verify.
//   /1 "50 Year Channel Migration Zones" and /2 "100 Year Channel Migration Zones": field NAME
//      ('50 Year Channel Migration Zone', '100 Year Channel Migration Zone'). Both are asked; the
//      50-year zone is the part the channel is expected to reach sooner.
//   /3 "Critical Aquifer Recharge Areas": field SUSCEPT; the layer's renderer labels 'low' Low,
//      'mod' Moderate and 'cara' High.
//   /5 "Wetland": fields NAME ('PERMANENT MARSH', 'SEASONAL LAKE', ...) and TYP ('Wetland').
//   /6 "Wetland Buffer 190ft" and /7 "Wetland Buffer 250ft": field NAME ('190 Foot Buffer',
//      '250 Foot Buffer'); no layer description. Shown as the mapped buffer distance only: the
//      buffer that actually applies depends on the wetland's rating, set in a delineation.
// - https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer
//   /0 "Airfield Overlay Zone": copyright "City of Spokane Planning Services"; description: airport
//      compatibility zones for Spokane International (SIA) and Felts Field, based on WSDOT Aviation
//      guidelines. Fields AIRPORT ('SIA', 'Felts Field', 'Deer Park', 'FAFB'), ZONENUM, ZONENAME
//      ('Runway Protection Zone', 'Inner Approach/Departure Zone', 'Traffic Pattern Zone',
//      'APZ I', 'Clear Zone', ...). Zones nest, so a parcel can be in several.
//   /1 "FAR Part 77 Restricted Parcels": fields PARCEL, COMMENTS ('Building Height Restrictions due
//      to FAR Part 77 - consult GIS for detailed information').
// Not found on gismo.spokanecounty.org as a regulatory layer: geologically hazardous areas (the
// only one, ISDSDE/LandCapacityAnalysis/MapServer/3, is surficial geology units from a late-1990s
// land-capacity analysis) and fish and wildlife habitat conservation areas. So neither is shown.
//
// One query per layer (9 subrequests, 18 with retries; with the 5 other county layers and a city
// zoning layer the route stays under 30 of the 50-subrequest limit), each read across the parcel outline with
// src/shared/polygon-coverage.js. A failing layer is listed in `unavailable` and only that overlay
// is missing; the rest of the report is unaffected.
import { arcgisQuery, spatialParams } from '../shared/arcgis.js';
import { overlapShares } from '../shared/polygon-coverage.js';

const CA = 'https://gismo.spokanecounty.org/arcgis/rest/services/BPPublic/CriticalAreasBPPublic/MapServer';
const ZL = 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer';

const text = value => (value == null ? '' : String(value).trim());
const AIRPORTS = { SIA: 'Spokane International Airport', 'FELTS FIELD': 'Felts Field', 'DEER PARK': 'Deer Park Airport', FAFB: 'Fairchild Air Force Base' };
const SUSCEPTIBILITY = { LOW: 'low', MOD: 'moderate', CARA: 'high' };

export const SPOKANE_OVERLAY_LAYERS = [
  {
    type: 'shoreline', url: `${CA}/0`, outFields: 'WATERTYPE,DESIGNATION', label: 'spokane-shoreline',
    key: a => (/^shoreline program$/i.test(text(a.WATERTYPE)) ? text(a.DESIGNATION) : ''),
    name: key => `Shoreline designation: ${key}`,
    source: 'Spokane County Shoreline Designations (Building & Planning critical areas map)',
    detail: 'Shoreline Management Act jurisdiction (generally 200 ft landward of the ordinary high water mark); a shoreline permit or exemption may be needed.'
  },
  {
    type: 'channel_migration', url: `${CA}/2`, outFields: 'NAME', label: 'spokane-channel-migration',
    key: a => text(a.NAME) || '100 Year Channel Migration Zone',
    name: key => key,
    source: 'Spokane County Channel Migration Zones (Building & Planning critical areas map)',
    detail: 'Area a river channel may move into; critical-areas review applies.'
  },
  {
    type: 'channel_migration', url: `${CA}/1`, outFields: 'NAME', label: 'spokane-channel-migration-50',
    key: a => text(a.NAME) || '50 Year Channel Migration Zone',
    name: key => key,
    source: 'Spokane County Channel Migration Zones (Building & Planning critical areas map)',
    detail: 'Area a river channel is expected to move into within about 50 years; critical-areas review applies.'
  },
  {
    type: 'aquifer_recharge', url: `${CA}/3`, outFields: 'SUSCEPT', label: 'spokane-cara',
    key: a => SUSCEPTIBILITY[text(a.SUSCEPT).toUpperCase()] || text(a.SUSCEPT).toLowerCase(),
    name: key => `Critical aquifer recharge area: ${key} susceptibility`,
    source: 'Spokane County Critical Aquifer Recharge Areas (Building & Planning critical areas map)',
    detail: 'Septic, stormwater and some land uses can have added standards here.'
  },
  {
    type: 'wetland', url: `${CA}/5`, outFields: 'NAME,TYP', label: 'spokane-county-wetland',
    key: a => text(a.NAME) || text(a.TYP) || 'Wetland',
    name: key => `County-mapped wetland: ${key.toLowerCase()}`,
    source: 'Spokane County Wetland layer (Building & Planning critical areas map)',
    detail: 'Wetland buffers and a delineation may be required before building.'
  },
  {
    type: 'wetland_buffer', url: `${CA}/6`, outFields: 'NAME', label: 'spokane-wetland-buffer-190',
    key: a => text(a.NAME) || '190 Foot Buffer',
    name: key => `Mapped wetland buffer: ${key.toLowerCase()}`,
    source: 'Spokane County Wetland Buffer 190ft (Building & Planning critical areas map)',
    detail: 'Mapped distance from a county wetland; the buffer that applies depends on the wetland rating from a delineation.'
  },
  {
    type: 'wetland_buffer', url: `${CA}/7`, outFields: 'NAME', label: 'spokane-wetland-buffer-250',
    key: a => text(a.NAME) || '250 Foot Buffer',
    name: key => `Mapped wetland buffer: ${key.toLowerCase()}`,
    source: 'Spokane County Wetland Buffer 250ft (Building & Planning critical areas map)',
    detail: 'Mapped distance from a county wetland; the buffer that applies depends on the wetland rating from a delineation.'
  },
  {
    type: 'airport', url: `${ZL}/0`, outFields: 'AIRPORT,ZONENUM,ZONENAME', label: 'spokane-airfield-overlay',
    key: a => { const zone = text(a.ZONENAME); return zone ? `${AIRPORTS[text(a.AIRPORT).toUpperCase()] || text(a.AIRPORT)}: ${zone}` : ''; },
    name: key => `Airfield overlay zone – ${key}`,
    source: 'Airfield Overlay Zone (SCOUT ZoningLookup; maintained by City of Spokane Planning Services)',
    detail: 'Airport compatibility zones can limit density, height and some uses.'
  },
  {
    type: 'airport_height', url: `${ZL}/1`, outFields: 'COMMENTS', label: 'spokane-far-part-77',
    key: () => 'FAR Part 77 height-restricted parcel',
    name: key => key,
    source: 'FAR Part 77 Restricted Parcels (SCOUT ZoningLookup)',
    detail: 'Building height is restricted for airspace safety (FAA Part 77).'
  }
];

// The cached answer for one layer: [{ key, share }] (no outlines, no attributes).
export async function queryOverlayShares(layer, where, samples) {
  const features = await arcgisQuery(layer.url, { ...spatialParams(where), outFields: layer.outFields }, { agency: 'Spokane County GIS', label: layer.label });
  return overlapShares(samples, features, layer.key).map(s => ({ key: s.key, share: Math.round(s.share * 1000) / 1000 }));
}

export function queryOverlays(where, samples, settle) {
  return Promise.all(SPOKANE_OVERLAY_LAYERS.map(layer => settle(queryOverlayShares(layer, where, samples))));
}

// Response fields from the settled per-layer answers (same order as SPOKANE_OVERLAY_LAYERS).
// `overlays`: [{ type, name, source, sourceUrl, share, detail }]; `overlaysUnavailable`: the
// layers that did not answer, so "none listed" is never mistaken for "none there".
export function overlayResponse(settled, city = null) {
  const overlays = [], unavailable = [];
  // Who reviews the overlay: the city (or the base) inside its limits, the county otherwise.
  const verifyWith = city ? city.name : 'Spokane County Building & Planning';
  (settled || []).forEach((r, i) => {
    const layer = SPOKANE_OVERLAY_LAYERS[i];
    if (!layer) return;
    if (r?.status !== 'fulfilled') {
      unavailable.push({ type: layer.type, source: layer.source, sourceUrl: layer.url, error: r?.reason?.message || 'unavailable' });
      return;
    }
    for (const s of r.value || []) {
      overlays.push({ type: layer.type, name: layer.name(s.key), source: layer.source, sourceUrl: layer.url, share: s.share, detail: layer.detail });
    }
  });
  return {
    overlays,
    overlaysUnavailable: unavailable,
    overlayNote: `Overlays are mapped by Spokane County and are screening information only. ${city && !city.federal ? `Inside ${city.name} limits the city's own critical-areas and shoreline rules apply. ` : ''}Verify with ${verifyWith} before design.`
  };
}
