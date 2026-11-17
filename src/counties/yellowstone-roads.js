// Road centerlines for Yellowstone County, MT (driveway length, src/services/road-access.js).
// Checked live with read-only `?f=json` and statistics queries on 2026-11-17.
//
// Yellowstone County GIS, Yellowstone/MapServer layer 40 "All roads" (gis.yellowstonecountymt.gov).
// The layer description: "Road centerlines for Yellowstone County. Includes public and private
// roads." (15,376 segments). Fields used:
// - STRLABEL: the full road name ('MOLT RD', 'S 56TH ST W').
// - Rd_Symbl: the map symbol class. The service's own layers 3 "Federal/State/Arterial" and
//   2 "Local/Private Roads" label it: 1 'Interstate', 2 'Feder/StateHwy', 3 'County Rd, Collector',
//   4 'Principal Arterial', 5 'Local Street or Rd', 6 'Ramp', 99 'Undeveloped Rd', 10 'Private Rd'
//   (7, 8 segments in Billings, has no label).
// - OWNER: who owns the right-of-way: 'DEDICATED' (dedicated public right-of-way on a plat),
//   'COUNTY', 'STATE', 'STATE SECONDARY', 'FEDERAL', 'BILLINGS', 'LAUREL', 'BROADVIEW',
//   'TOWNSITE', 'BOR TOWNSITE', 'JOINT', 'PUBLIC ESMT' (and spellings), 'PRIVATE', 'PRIVATE ESMT',
//   and a few others ('UPPE', 'INTERNAL', 'VACATE', 'CROW TRIBE', 'CUSTER', 'BNSF') whose public
//   status is not stated.
// - RDCLASS: 'STREETS', 'COLLECTOR', 'MINOR ARTERIAL', 'PRINCIPAL ARTERIAL', 'STATE SECONDARY',
//   'STATE HWY', 'US HWY', 'INTERSTATE', 'RAMP'.
// - LIFESTAT: 'ACTIVE' | 'PLACEHOLDER'.
// JURISDTN is not used: private roads (Rd_Symbl 10) mostly carry 'COUNTY' or 'BILLINGS' there,
// so it names the area, not who maintains the road.
//
// A road is public when it is not a private road (Rd_Symbl 10) and OWNER is a public owner
// listed below. Private roads, private easements and owners whose status is not stated count as
// not public (the kind says which; `ownership` is 'public', 'private' or 'unknown').
// Interstates, ramps, undeveloped (unbuilt) roads and placeholder segments are left out: a home
// cannot take access from them.

export const YELLOWSTONE_ROADS_LAYER = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Yellowstone/MapServer/40';

const text = v => (v == null ? '' : String(v).trim());

const PUBLIC_OWNER = new Set(['DEDICATED', 'COUNTY', 'STATE', 'STATE SECONDARY', 'FEDERAL', 'BILLINGS', 'LAUREL', 'BROADVIEW',
  'TOWNSITE', 'BOR TOWNSITE', 'JOINT', 'PUBLIC', 'PUBLIC ESMT', 'PUBLIC EASEMENT', 'PUBLIC ESMNT']);
const CITY_OWNER = new Set(['BILLINGS', 'LAUREL', 'BROADVIEW']);
const CLASS_KIND = { 'US HWY': 'US highway', 'STATE HWY': 'state highway', 'STATE SECONDARY': 'state secondary road', 'PRINCIPAL ARTERIAL': 'principal arterial', 'MINOR ARTERIAL': 'minor arterial', COLLECTOR: 'collector' };
const title = s => s.charAt(0) + s.slice(1).toLowerCase();

export function describeYellowstoneRoad(a = {}) {
  const owner = text(a.OWNER).toUpperCase();
  const cls = text(a.RDCLASS).toUpperCase();
  const privateRoad = Number(a.Rd_Symbl) === 10 || /^PRIVATE/.test(owner);
  const isPublic = !privateRoad && PUBLIC_OWNER.has(owner);
  let kind;
  if (privateRoad) kind = owner === 'PRIVATE ESMT' ? 'private easement road' : 'private road';
  else if (!isPublic) kind = 'road, public status not mapped';
  else if (CLASS_KIND[cls]) kind = CLASS_KIND[cls];
  else if (owner === 'COUNTY') kind = 'county road';
  else if (CITY_OWNER.has(owner)) kind = `city street (${title(owner)})`;
  else if (/^PUBLIC/.test(owner)) kind = 'public easement road';
  else if (owner === 'STATE' || owner === 'FEDERAL') kind = `${owner.toLowerCase()} road`;
  else kind = 'local road, dedicated public right-of-way';
  return { name: text(a.STRLABEL), kind, public: isPublic, ownership: isPublic ? 'public' : privateRoad ? 'private' : 'unknown' };
}

export const YELLOWSTONE_ROADS = {
  state: 'MT', county: 'Yellowstone',
  source: { name: 'Yellowstone County GIS road centerlines (All roads)', url: YELLOWSTONE_ROADS_LAYER },
  layers: [
    {
      id: 'yellowstone-roads', url: YELLOWSTONE_ROADS_LAYER,
      where: "LIFESTAT = 'ACTIVE' AND Rd_Symbl IN (2,3,4,5,10)",
      outFields: 'STRLABEL,Rd_Symbl,RDCLASS,OWNER',
      describe: describeYellowstoneRoad
    }
  ]
};
