// Public road centerlines for Spokane County, WA (driveway length, src/services/road-access.js).
// Checked live with read-only `?f=json` queries on 2026-11-12.
//
// Spokane County OpenData/Transportation (gismo.spokanecounty.org):
// - Layer 0 "Engineering Streets": the county road log. JurDesc says who owns the road:
//   'County', 'City/municipal', 'County, non-County Road', 'Private Road', 'Not known/private road',
//   'Proposed or projected; not traveled', 'None'. Only 'County' and 'City/municipal' are public
//   roads here. It has no state highways and no City of Spokane streets (a point in the city,
//   -117.390737,47.644811, has no segment within 1,000 ft).
// - Layer 1 "Public Safety Streets": the E911 centerline for every jurisdiction. It has no
//   public/private field, only RoadClass ('Local', 'Collector', 'Minor Arterial', 'Major Arterial',
//   'Highway', 'Freeway', 'Freeway Ramp', 'Other Ramp', 'Alley', 'Easement', 'Unimproved',
//   'Public Safety Only', 'Other', 'Unknown'), Jurisdiction (a city name, 'Spokane County' or a
//   neighbouring county) and BuildStatus ('Established', 'Pending', 'Vacated', 'Unknown', 'None').
//   It is used for (a) highways and arterials anywhere and (b) local streets inside a city, where
//   streets are taken as public (a private lane inside city limits would count as public: an
//   accepted limit of this layer).
// Freeways and ramps are left out: a home cannot take access from them.

const BASE = 'https://gismo.spokanecounty.org/arcgis/rest/services/OpenData/Transportation/MapServer';
export const SPOKANE_ENGINEERING_STREETS = `${BASE}/0`;
export const SPOKANE_PUBLIC_SAFETY_STREETS = `${BASE}/1`;

const text = v => (v == null ? '' : String(v).trim());

export const SPOKANE_ROADS = {
  state: 'WA', county: 'Spokane',
  source: { name: 'Spokane County GIS road centerlines (Engineering Streets, Public Safety Streets)', url: BASE },
  layers: [
    {
      id: 'spokane-engineering-streets', url: SPOKANE_ENGINEERING_STREETS,
      where: "JurDesc IN ('County','City/municipal')",
      outFields: 'RoadName,JurDesc',
      describe: a => ({ name: text(a.RoadName), kind: text(a.JurDesc) === 'County' ? 'county road' : 'city street' })
    },
    {
      id: 'spokane-public-safety-streets', url: SPOKANE_PUBLIC_SAFETY_STREETS,
      where: "(BuildStatus IS NULL OR BuildStatus NOT IN ('Vacated','Pending')) AND (RoadClass IN ('Highway','Major Arterial','Minor Arterial','Collector') OR (RoadClass = 'Local' AND Jurisdiction <> 'Spokane County'))",
      outFields: 'FullName,RoadClass,Jurisdiction',
      describe: a => ({ name: text(a.FullName), kind: text(a.RoadClass) === 'Local' ? `city street (${text(a.Jurisdiction)})` : text(a.RoadClass).toLowerCase() })
    }
  ]
};
