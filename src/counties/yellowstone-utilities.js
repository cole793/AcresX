// Public water and sewer sources for Yellowstone County, MT (src/services/public-utilities.js).
// Every layer below was checked live (`?f=json`, distinct values and test-parcel queries,
// read-only) on 2026-11-09. Only the named fields are requested.
// - Montana MSDI water and sewer districts (src/states/montana/water-sewer-districts.js):
//   Lockwood, Huntley, Heights Water District, Custer, Worden-Ballantine, ...
// - Yellowstone County "Water/Sewer Districts":
//     https://gis.yellowstonecountymt.gov/arcgis/rest/services/Water_Sewer_Irrigation_Districts/MapServer/27
//   Fields DISTRICT, TYPE ('W/S' = water and sewer, 'WATER').
// - Lockwood: same service, layers 18 "Lockwood Water Service Area" (no attributes but ids), 19
//   "Lockwood Sewer District" and 20 "Lockwood Water/Sewer District" (DISTRICT, TYPE 'W/S' or '').
// - Nothing is reachable for the City of Billings, Laurel or Broadview water and sewer systems, so
//   inside their limits both services are "likely" (never "served": no main or service-area map).
// - City limits: Yellowstone County "City Limits" (annexation polygons):
//     https://gis.yellowstonecountymt.gov/arcgis/rest/services/Yellowstone/MapServer/30
//   Field Name: 'BILLINGS' | 'LAUREL' | 'BROADVIEW' | 'COUNTY' (county islands, skipped). Checked
//   live 2026-11-15: BILLINGS sums to 46.6 sq mi, matching the Montana MSDI incorporated-city
//   boundary for Billings (46.4 sq mi, MapServer/3 of msdi_administrative_boundaries_map_v1).
//   This replaced Zoning/MapServer/7 "Zoning Jurisdictions" (owner bug 2026-11-15): that layer is
//   the City of Billings ZONING jurisdiction, 373 km2 (144 sq mi), about three times the city, so
//   rural parcels such as 03092732390050000 (Harvey Subd, Billings RR3 zoning, about 2-3 km
//   outside the city limits) came back "likely" for city water and sewer and were priced as
//   connections. The zoning adapter keeps using layer 7 for zoning, which is what it describes.
import { MSDI_WATER_SOURCE, MSDI_SEWER_SOURCE } from '../states/montana/water-sewer-districts.js';
import { jurisdictionFromEntity } from './yellowstone.js';
import { cityLimitsFindings, districtFindings, text, titleCase } from '../shared/utility-findings.js';

const DISTRICTS = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Water_Sewer_Irrigation_Districts/MapServer';
export const YELLOWSTONE_WATER_SEWER_DISTRICTS = `${DISTRICTS}/27`;
export const LOCKWOOD_WATER_SERVICE_AREA = `${DISTRICTS}/18`;
export const LOCKWOOD_SEWER_DISTRICT = `${DISTRICTS}/19`;
export const LOCKWOOD_WATER_SEWER_DISTRICT = `${DISTRICTS}/20`;
export const YELLOWSTONE_CITY_LIMITS = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Yellowstone/MapServer/30';
const AGENCY = 'Yellowstone County GIS';

const servicesOfType = (type, fallback) => {
  const t = text(type).toUpperCase();
  if (t === 'W/S') return ['water', 'sewer'];
  if (t === 'WATER') return ['water'];
  if (t === 'SEWER') return ['sewer'];
  return fallback;
};
const districtLabel = value => titleCase(value).replace(/\bW\/s\b/i, 'Water & Sewer');

// fixedName: the layer has no name field (layer 18). typeDecides: TYPE picks the services (layers
// 27 and 20); layer 19 is a sewer district although its TYPE reads 'W/S'.
const districtSource = (id, name, url, services, { fixedName = '', typeDecides = false } = {}) => ({
  id, name, agency: AGENCY, url, services, kind: 'area', outFields: fixedName ? 'OBJECTID' : 'DISTRICT,TYPE',
  read: rows => rows.flatMap(a => {
    const provider = fixedName || districtLabel(a.DISTRICT);
    return districtFindings(typeDecides ? servicesOfType(a.TYPE, services) : services, provider, `inside Yellowstone County district: ${provider}`);
  })
});

export const YELLOWSTONE_UTILITIES = {
  state: 'MT', county: 'Yellowstone',
  sources: [
    MSDI_WATER_SOURCE,
    MSDI_SEWER_SOURCE,
    districtSource('yellowstone-water-sewer-districts', 'Yellowstone County water/sewer districts', YELLOWSTONE_WATER_SEWER_DISTRICTS, ['water', 'sewer'], { typeDecides: true }),
    districtSource('lockwood-water-service-area', 'Lockwood water service area', LOCKWOOD_WATER_SERVICE_AREA, ['water'], { fixedName: 'Lockwood Water & Sewer District' }),
    districtSource('lockwood-sewer-district', 'Lockwood sewer district', LOCKWOOD_SEWER_DISTRICT, ['sewer']),
    districtSource('lockwood-water-sewer-district', 'Lockwood water/sewer district', LOCKWOOD_WATER_SEWER_DISTRICT, ['water', 'sewer'], { typeDecides: true }),
    {
      id: 'yellowstone-city-limits', name: 'Yellowstone County city limits (Billings, Laurel, Broadview)', agency: AGENCY,
      url: YELLOWSTONE_CITY_LIMITS, services: ['water', 'sewer'], kind: 'area', outFields: 'Name', cityLimits: true,
      read: rows => rows.filter(a => text(a.Name) && text(a.Name).toUpperCase() !== 'COUNTY')
        .flatMap(a => cityLimitsFindings(jurisdictionFromEntity(a.Name), ['water', 'sewer']))
    }
  ]
};
