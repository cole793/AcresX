// Road centerlines for Gallatin County, MT (driveway length, src/services/road-access.js).
// Checked live with read-only `?f=json` and statistics queries on 2026-11-17.
//
// Gallatin County GIS publishes its base map on ArcGIS Online (the same organization as the
// county zoning layer in src/counties/gallatin.js): "Gallatin Base" FeatureServer layer 2
// "Streets" (18,968 segments, Gallatin County roads plus those of the neighbouring counties near
// the line). The county's own GIS server (gis.gallatin.mt.gov) did not answer. Fields used:
// - DIRPRE, ROADNAME, ROADTYPE, DIRSUF (ROADNAME_CONCAT is the same name in one field).
// - OWNERSHIP (coded): 'COUNTY', 'STATE', 'FEDERAL', 'PUBLIC', 'BOZEMAN', 'BELGRADE', 'MANHATTAN',
//   'THREE FORKS', 'WEST YELLOWSTONE', 'MSU', 'PRIVATE', 'TBD', 'OUT OF COUNTY' (or blank).
// - MAINTENANCE (same codes): who maintains it. Most 'PUBLIC' roads (2,607 of 2,674) are
//   maintained 'PRIVATE' (a public right-of-way kept up by the owners or an HOA); the kind says so.
// - CLASSIFICATION: 'Interstate', 'Arterial', 'Federal highway' or blank.
// - CONDITION: 'EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'ALLEY', 'DRIVEWAY', 'TBD'.
// A road is public when OWNERSHIP is the county, the state, a federal agency, a city or town, or
// 'PUBLIC'. 'PRIVATE' is a private road; 'TBD', 'OUT OF COUNTY', 'MSU' and blank count as not
// public (public status not mapped; `ownership` 'unknown', against 'public' and 'private').
// Interstates and segments mapped as driveways are left out.
// Interstate 90, its ramps and medians are not all classed 'Interstate'; they are the only roads
// owned 'FEDERAL' and maintained 'STATE' (checked with a distinct-name query), so that pair is left
// out too. 'FEDERAL' roads maintained 'FEDERAL' are Forest Service roads.

export const GALLATIN_ROADS_LAYER = 'https://services3.arcgis.com/JuknJLoAEm9DTWXh/ArcGIS/rest/services/Gallatin%20Base/FeatureServer/2';

const text = v => (v == null ? '' : String(v).trim());

const CITIES = new Set(['BOZEMAN', 'BELGRADE', 'MANHATTAN', 'THREE FORKS', 'WEST YELLOWSTONE']);
const PUBLIC_OWNER = new Set(['COUNTY', 'STATE', 'FEDERAL', 'PUBLIC', ...CITIES]);
const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

function maintainedBy(m) {
  if (m === 'PRIVATE') return 'privately maintained';
  if (m === 'COUNTY') return 'county maintained';
  if (m === 'STATE') return 'state maintained';
  if (CITIES.has(m)) return `maintained by ${titleCase(m)}`;
  return 'maintenance not mapped';
}

export function describeGallatinRoad(a = {}) {
  const owner = text(a.OWNERSHIP).toUpperCase();
  const maint = text(a.MAINTENANCE).toUpperCase();
  const cls = text(a.CLASSIFICATION);
  const isPublic = PUBLIC_OWNER.has(owner);
  let kind;
  if (owner === 'PRIVATE') kind = 'private road';
  else if (!isPublic) kind = 'road, public status not mapped';
  else if (cls === 'Federal highway') kind = 'US highway';
  else if (owner === 'COUNTY') kind = maint === 'PRIVATE' ? 'county road, privately maintained' : 'county road';
  else if (owner === 'STATE') kind = 'state road';
  else if (owner === 'FEDERAL') kind = 'federal road (e.g. Forest Service)';
  else if (CITIES.has(owner)) kind = `city street (${titleCase(owner)})`;
  else kind = `public road, ${maintainedBy(maint)}`;
  const name = text(a.ROADNAME_CONCAT) || [text(a.DIRPRE), text(a.ROADNAME), text(a.ROADTYPE), text(a.DIRSUF)].filter(Boolean).join(' ');
  return { name, kind, public: isPublic, ownership: isPublic ? 'public' : owner === 'PRIVATE' ? 'private' : 'unknown' };
}

export const GALLATIN_ROADS = {
  state: 'MT', county: 'Gallatin',
  source: { name: 'Gallatin County GIS road centerlines (Gallatin Base, Streets)', url: GALLATIN_ROADS_LAYER },
  layers: [
    {
      id: 'gallatin-roads', url: GALLATIN_ROADS_LAYER,
      where: "(CLASSIFICATION IS NULL OR CLASSIFICATION <> 'Interstate') AND (CONDITION IS NULL OR CONDITION <> 'DRIVEWAY') AND (OWNERSHIP IS NULL OR MAINTENANCE IS NULL OR OWNERSHIP <> 'FEDERAL' OR MAINTENANCE <> 'STATE')",
      outFields: 'DIRPRE,ROADNAME,ROADTYPE,DIRSUF,ROADNAME_CONCAT,OWNERSHIP,MAINTENANCE,CLASSIFICATION',
      describe: describeGallatinRoad
    }
  ]
};
