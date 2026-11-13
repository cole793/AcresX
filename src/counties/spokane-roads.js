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
//   Highways, arterials and collectors count as public anywhere; local streets and alleys count as
//   public inside a city (a private lane inside city limits would count as public: an accepted
//   limit of this layer); easement, unimproved and unincorporated local roads count as private
//   or unknown.
// Both public and private roads are returned (src/services/road-access.js measures the driveway
// to the nearest road of any kind and also reports the nearest public road).
// Freeways and ramps are left out: a home cannot take access from them.

const BASE = 'https://gismo.spokanecounty.org/arcgis/rest/services/OpenData/Transportation/MapServer';
export const SPOKANE_ENGINEERING_STREETS = `${BASE}/0`;
export const SPOKANE_PUBLIC_SAFETY_STREETS = `${BASE}/1`;

const text = v => (v == null ? '' : String(v).trim());

const PUBLIC_JUR = new Set(['County', 'City/municipal']);
const ARTERIAL = new Set(['Highway', 'Major Arterial', 'Minor Arterial', 'Collector']);

export const SPOKANE_ROADS = {
  state: 'WA', county: 'Spokane',
  source: { name: 'Spokane County GIS road centerlines (Engineering Streets, Public Safety Streets)', url: BASE },
  layers: [
    {
      // Every traveled road in the road log, public or private (proposed and unclassified ones left out).
      id: 'spokane-engineering-streets', url: SPOKANE_ENGINEERING_STREETS,
      where: "JurDesc IS NOT NULL AND JurDesc NOT IN ('Proposed or projected; not traveled','None')",
      outFields: 'RoadName,JurDesc',
      describe: a => {
        const jur = text(a.JurDesc);
        const isPublic = PUBLIC_JUR.has(jur);
        return { name: text(a.RoadName), kind: jur === 'County' ? 'county road' : jur === 'City/municipal' ? 'city street' : /private/i.test(jur) ? 'private road' : `non-county road (${jur})`, public: isPublic };
      }
    },
    {
      // The E911 centerline: highways and arterials anywhere, local streets and alleys (public inside
      // a city), and easement / unimproved roads (private access).
      id: 'spokane-public-safety-streets', url: SPOKANE_PUBLIC_SAFETY_STREETS,
      where: "(BuildStatus IS NULL OR BuildStatus NOT IN ('Vacated','Pending')) AND RoadClass IN ('Highway','Major Arterial','Minor Arterial','Collector','Local','Alley','Easement','Unimproved')",
      outFields: 'FullName,RoadClass,Jurisdiction',
      describe: a => {
        const cls = text(a.RoadClass), jur = text(a.Jurisdiction);
        const inCity = jur && jur !== 'Spokane County';
        const isPublic = ARTERIAL.has(cls) || ((cls === 'Local' || cls === 'Alley') && inCity);
        const kind = ARTERIAL.has(cls) ? cls.toLowerCase() : cls === 'Easement' ? 'easement road (private access)' : cls === 'Unimproved' ? 'unimproved road' : isPublic ? `city street (${jur})` : 'local road (public status not mapped)';
        return { name: text(a.FullName), kind, public: isPublic };
      }
    }
  ]
};
