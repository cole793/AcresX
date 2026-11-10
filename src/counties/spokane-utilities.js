// Public water and sewer sources for Spokane County, WA (src/services/public-utilities.js).
// Every layer below was checked live (`?f=json`, distinct values and test-parcel queries,
// read-only) on 2026-11-09. Only the named fields are requested.
//
// Water
// - WA DOH Drinking Water Service Areas (src/states/washington/public-water.js).
// - Spokane County "Water Districts":
//     https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/DistrictLookup/MapServer/6
//   Fields NAME, SUBNAME, SYSTEMTYPE ('Public' | 'Private' | null). The City of Spokane lot
//   (35204.2729) returns NAME 'City of Spokane' (SYSTEMTYPE null); the Spokane Valley lot
//   (35234.0602) 'Spokane County Water District #3' / 'System #1' (Public); Chattaroy (47071.9003)
//   'Whitworth Water District #2'. 'Private' systems are not counted.
// - City of Spokane water mains (City of Spokane ArcGIS Online org 3PDwyTturHqnGCu0):
//     https://services.arcgis.com/3PDwyTturHqnGCu0/arcgis/rest/services/Water_Main/FeatureServer/2
//   Fields OwnedBy ('Water' | 'Private'), SrvcStatus ('InService'), MainType ('DISTRIBUTION',
//   'TRANSMISSION', 'HYDRANT', 'CASING'). Only city-owned, in-service distribution mains count
//   (hydrant leads and casings are not service mains; transmission mains are not tapped for homes).
// - City of Cheney water lines ("Cheney, WA Map for Work Orders - Assets System"):
//     https://services.arcgis.com/yP5WvH3YqutU0LDh/arcgis/rest/services/Cheney_WA_All_Utilities_2026/FeatureServer/52
//   Field Type ('Meter Main', 'Hydrant Main', 'Stub', 'Hydrant', ' '); hydrant lines are left out.
//   (DOH lists only Eastern Washington University's system at some Cheney points, so the city's
//   own lines decide there.)
// Sewer
// - City of Spokane gravity sewer mains:
//     https://services.arcgis.com/3PDwyTturHqnGCu0/arcgis/rest/services/Sewer_Gravity_Main/FeatureServer/1
//   Fields OwnedBy ('CITY'), SrvcStatus ('ACTV'), UnitType. Storm units (STRUNK, STRFAC, CBL) are
//   left out.
// - City of Cheney sewer mains: .../Cheney_WA_All_Utilities_2026/FeatureServer/36 (field Layer).
// - Spokane County sewer gravity mains (Spokane County org ozNll27nt9ZtPWOn, "SewerViewer"):
//     https://services1.arcgis.com/ozNll27nt9ZtPWOn/arcgis/rest/services/SewerViewer_WFL1/FeatureServer/13
//   Fields LIFECYCLESTATUS ('ACTIVE'), NAME. The whole service was last edited 2021-10-12, so it
//   is supplementary: a main counts as "likely" at most and the answer carries asOf 2021-10-12.
//   Its project polygons (layer 27, SEWERED/SEWERDIST) are not used; layer 21 holds owner names
//   and is never queried. Spokane County Utilities serves most unincorporated and Spokane Valley
//   sewer; this is the only public map of it.
// City limits
// - SCOUT PermittingLookup/MapServer/0 (NAME, MUNITYP), the jurisdiction layer the zoning adapter
//   uses (src/counties/spokane-cities.js SPOKANE_JURISDICTIONS). Inside a city or town other than
//   Spokane and Cheney (which publish their own maps above) both services are "likely".
import { WA_DOH_WATER_SOURCE } from '../states/washington/public-water.js';
import { SPOKANE_JURISDICTIONS, spokaneCityInfo } from './spokane-cities.js';
import { cityLimitsFindings, districtFindings, text } from '../shared/utility-findings.js';

const CITY_OF_SPOKANE = 'https://services.arcgis.com/3PDwyTturHqnGCu0/arcgis/rest/services';
const CHENEY_UTILITIES = 'https://services.arcgis.com/yP5WvH3YqutU0LDh/arcgis/rest/services/Cheney_WA_All_Utilities_2026/FeatureServer';
export const SPOKANE_WATER_DISTRICTS = 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/DistrictLookup/MapServer/6';
export const SPOKANE_CITY_WATER_MAINS = `${CITY_OF_SPOKANE}/Water_Main/FeatureServer/2`;
export const SPOKANE_CITY_SEWER_MAINS = `${CITY_OF_SPOKANE}/Sewer_Gravity_Main/FeatureServer/1`;
export const CHENEY_SEWER_MAINS = `${CHENEY_UTILITIES}/36`;
export const CHENEY_WATER_LINES = `${CHENEY_UTILITIES}/52`;
export const SPOKANE_COUNTY_SEWER_MAINS = 'https://services1.arcgis.com/ozNll27nt9ZtPWOn/arcgis/rest/services/SewerViewer_WFL1/FeatureServer/13';
export const SPOKANE_COUNTY_SEWER_AS_OF = '2021-10-12';

// Cities whose own utility maps decide each service (no "likely" from city limits alone).
const MAPPED = { SPOKANE: ['water', 'sewer'], CHENEY: ['water', 'sewer'] };

export const SPOKANE_UTILITIES = {
  state: 'WA', county: 'Spokane',
  sources: [
    WA_DOH_WATER_SOURCE,
    {
      id: 'spokane-water-districts', name: 'Spokane County Water Districts', agency: 'Spokane County GIS',
      url: SPOKANE_WATER_DISTRICTS, services: ['water'], kind: 'area', outFields: 'NAME,SUBNAME,SYSTEMTYPE',
      read: rows => rows.filter(a => text(a.SYSTEMTYPE).toUpperCase() !== 'PRIVATE').flatMap(a => {
        const name = [text(a.NAME), text(a.SUBNAME)].filter(Boolean).join(' ');
        return districtFindings(['water'], name, `inside Spokane County water district: ${name}`);
      })
    },
    {
      id: 'spokane-jurisdiction', name: 'Spokane County jurisdictions (city limits)', agency: 'Spokane County GIS',
      url: SPOKANE_JURISDICTIONS, services: ['water', 'sewer'], kind: 'area', outFields: 'NAME,MUNITYP',
      read: rows => rows.flatMap(a => {
        const city = spokaneCityInfo(a.NAME, a.MUNITYP);
        if (!city || city.federal) return [];
        const mapped = MAPPED[city.key] || [];
        return cityLimitsFindings(city.name, ['water', 'sewer'].filter(s => !mapped.includes(s)));
      })
    },
    {
      id: 'spokane-city-water-mains', name: 'City of Spokane water mains', agency: 'City of Spokane GIS',
      url: SPOKANE_CITY_WATER_MAINS, services: ['water'], kind: 'mains', outFields: 'MainType',
      where: "OwnedBy='Water' AND SrvcStatus='InService' AND MainType='DISTRIBUTION'",
      provider: 'City of Spokane', mainLabel: 'City of Spokane water main'
    },
    {
      id: 'spokane-city-sewer-mains', name: 'City of Spokane sewer mains', agency: 'City of Spokane GIS',
      url: SPOKANE_CITY_SEWER_MAINS, services: ['sewer'], kind: 'mains', outFields: 'UnitType',
      where: "SrvcStatus='ACTV' AND (UnitType IS NULL OR UnitType NOT IN ('STRUNK','STRFAC','CBL'))",
      provider: 'City of Spokane', mainLabel: 'City of Spokane sewer main'
    },
    {
      id: 'cheney-water-lines', name: 'City of Cheney water lines', agency: 'City of Cheney GIS',
      url: CHENEY_WATER_LINES, services: ['water'], kind: 'mains', outFields: 'Type',
      where: "Type IS NULL OR Type NOT IN ('Hydrant','Hydrant Main')",
      provider: 'City of Cheney', mainLabel: 'City of Cheney water line'
    },
    {
      id: 'cheney-sewer-mains', name: 'City of Cheney sewer mains', agency: 'City of Cheney GIS',
      url: CHENEY_SEWER_MAINS, services: ['sewer'], kind: 'mains', outFields: 'Layer',
      provider: 'City of Cheney', mainLabel: 'City of Cheney sewer main'
    },
    {
      id: 'spokane-county-sewer-mains', name: `Spokane County sewer mains (${SPOKANE_COUNTY_SEWER_AS_OF} map)`, agency: 'Spokane County GIS',
      url: SPOKANE_COUNTY_SEWER_MAINS, services: ['sewer'], kind: 'mains', outFields: 'NAME',
      where: "LIFECYCLESTATUS='ACTIVE'", maxStatus: 'likely', asOf: SPOKANE_COUNTY_SEWER_AS_OF,
      provider: 'Spokane County Utilities', mainLabel: 'Spokane County sewer main'
    }
  ]
};
