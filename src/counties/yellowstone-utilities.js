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
// - Nothing is reachable for the City of Billings or Laurel water and sewer systems, so inside
//   their limits (Zoning/MapServer/7 "Zoning Jurisdictions", field ZoningJurisdictions_Entity
//   'BILLINGS' | 'LAUREL', the layer the zoning adapter uses) both services are "likely".
import { MSDI_WATER_SOURCE, MSDI_SEWER_SOURCE } from '../states/montana/water-sewer-districts.js';
import { jurisdictionFromEntity } from './yellowstone.js';
import { cityLimitsFindings, districtFindings, text, titleCase } from '../shared/utility-findings.js';

const DISTRICTS = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Water_Sewer_Irrigation_Districts/MapServer';
export const YELLOWSTONE_WATER_SEWER_DISTRICTS = `${DISTRICTS}/27`;
export const LOCKWOOD_WATER_SERVICE_AREA = `${DISTRICTS}/18`;
export const LOCKWOOD_SEWER_DISTRICT = `${DISTRICTS}/19`;
export const LOCKWOOD_WATER_SEWER_DISTRICT = `${DISTRICTS}/20`;
export const YELLOWSTONE_JURISDICTIONS = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer/7';
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
      id: 'yellowstone-city-limits', name: 'Yellowstone County zoning jurisdictions (Billings, Laurel)', agency: AGENCY,
      url: YELLOWSTONE_JURISDICTIONS, services: ['water', 'sewer'], kind: 'area', outFields: 'ZoningJurisdictions_Entity',
      read: rows => rows.flatMap(a => cityLimitsFindings(jurisdictionFromEntity(a.ZoningJurisdictions_Entity), ['water', 'sewer']))
    }
  ]
};
