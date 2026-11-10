// Public water and sewer sources for Kootenai County, ID (src/services/public-utilities.js).
// Every layer below was checked live (`?f=json`, distinct values and test-parcel queries,
// read-only) on 2026-11-09. Only the named fields are requested.
//
// City of Coeur d'Alene (gis.cdaid.org)
// - Water districts: .../Water_Distribution_System/MapServer/11, field Water_Dist. C72150030040
//   and C72150040140 return 'CDA Water'; the rural 0L8210010030 returns nothing.
// - Water mains: .../Water_Distribution_System/MapServer/9. Category (null, 'HYDMAIN', 'FIRELINE',
//   'PRIVATELINE') and Status (null, 'Active', 'On', 'Off', 'Pending', 'Abandoned'): hydrant
//   leads, fire lines, private lines and abandoned/off/pending mains are left out.
// - Sewer pipes: https://gis.cdaid.org/server/rest/services/CityUtilities/Public_Wastewater/MapServer/3,
//   field Forcemain ('Yes' | 'No' | 'N' | ' ' | null): force mains are left out (a lot cannot
//   connect to one by gravity). C72150030040's nearest pipe is 6.9 m from its outline.
// City of Post Falls (gis.postfalls.gov)
// - Water purveyors: https://gis.postfalls.gov/server/rest/services/Water/Purveyor/MapServer/9,
//   fields Name ('Post Falls Water', 'Ross Point Water District', 'East Greenacres Irrigation
//   District', 'North Kootenai Water District', 'Valley Water Assoc', 'Future Post Falls Water
//   District') and Status ('Existing' | 'Future'); only Status 'Existing' is queried. The layer
//   also has Contact, Phone, Email and AgencyUrl: NEVER requested.
//   (UtilityInfrastructure/PostFallsServiceArea/MapServer/1 is "Existing Water Service Area",
//   the same city water area without a name, so it is not queried.)
// - Sewer gravity mains: https://gis.postfalls.gov/server/rest/services/SanitarySewer/Gravity_Mains_Viewing/MapServer/0.
// Kootenai County
// - Tax districts: https://map.kcgov.us/arcgis/rest/services/ASSR_Dynamic_Layers_gisapp2022/MapServer/25,
//   fields CITY, WATER, SEWER. WATER/SEWER name a special district only (e.g. WATER 'North
//   Kootenai', 'Ross Point'; SEWER 'Hayden Lake', 'Twin Lakes', 'Bayview'); blank is ' '. CITY is
//   the same tax-code-area city value as the city-limits layer the zoning adapter reads
//   (Data_Layers/MapServer/18, src/counties/kootenai-cities.js), so this one query answers city
//   limits too. Inside a city other than Coeur d'Alene and Post Falls (Hayden, Rathdrum, Spirit
//   Lake, ...: no public utility layer, and none for HARSB) both services are "likely";
//   Coeur d'Alene is decided by its maps, Post Falls by its purveyor and sewer layers.
import { cityInfo } from './kootenai-cities.js';
import { cityLimitsFindings, districtFindings, text } from '../shared/utility-findings.js';

const CDA = 'https://gis.cdaid.org/server/rest/services';
export const CDA_WATER_DISTRICTS = `${CDA}/Water_Distribution_System/MapServer/11`;
export const CDA_WATER_MAINS = `${CDA}/Water_Distribution_System/MapServer/9`;
export const CDA_SEWER_PIPES = `${CDA}/CityUtilities/Public_Wastewater/MapServer/3`;
export const POST_FALLS_WATER_PURVEYORS = 'https://gis.postfalls.gov/server/rest/services/Water/Purveyor/MapServer/9';
export const POST_FALLS_SEWER_MAINS = 'https://gis.postfalls.gov/server/rest/services/SanitarySewer/Gravity_Mains_Viewing/MapServer/0';
export const KC_TAX_DISTRICTS = 'https://map.kcgov.us/arcgis/rest/services/ASSR_Dynamic_Layers_gisapp2022/MapServer/25';

const MAPPED = { 'COEUR D ALENE': ['water', 'sewer'], 'POST FALLS': ['water', 'sewer'] };
const CDA_AGENCY = "City of Coeur d'Alene GIS";

const districtName = (value, kind) => {
  const name = text(value);
  if (!name) return '';
  return new RegExp(`\\b${kind}\\b|district|assoc`, 'i').test(name) ? name : `${name} ${kind} district`;
};

export const KOOTENAI_UTILITIES = {
  state: 'ID', county: 'Kootenai',
  sources: [
    {
      id: 'cda-water-districts', name: "City of Coeur d'Alene water districts", agency: CDA_AGENCY,
      url: CDA_WATER_DISTRICTS, services: ['water'], kind: 'area', outFields: 'Water_Dist',
      read: rows => rows.flatMap(a => districtFindings(['water'], a.Water_Dist, `inside water district: ${text(a.Water_Dist)}`))
    },
    {
      id: 'cda-water-mains', name: "City of Coeur d'Alene water mains", agency: CDA_AGENCY,
      url: CDA_WATER_MAINS, services: ['water'], kind: 'mains', outFields: 'Category',
      where: "(Category IS NULL OR Category NOT IN ('HYDMAIN','FIRELINE','PRIVATELINE')) AND (Status IS NULL OR Status NOT IN ('Abandoned','Off','Pending'))",
      provider: "City of Coeur d'Alene (CDA Water)", mainLabel: "City of Coeur d'Alene water main"
    },
    {
      id: 'cda-sewer-pipes', name: "City of Coeur d'Alene sewer mains", agency: CDA_AGENCY,
      url: CDA_SEWER_PIPES, services: ['sewer'], kind: 'mains', outFields: 'PIPE_SIZE',
      where: "Forcemain IS NULL OR Forcemain <> 'Yes'",
      provider: "City of Coeur d'Alene", mainLabel: "City of Coeur d'Alene sewer main"
    },
    {
      id: 'post-falls-water-purveyors', name: 'City of Post Falls water purveyors', agency: 'City of Post Falls GIS',
      url: POST_FALLS_WATER_PURVEYORS, services: ['water'], kind: 'area', outFields: 'Name,Status', where: "Status='Existing'",
      read: rows => rows.filter(a => !/^future/i.test(text(a.Name))).flatMap(a => districtFindings(['water'], a.Name, `inside water purveyor area: ${text(a.Name)}`))
    },
    {
      id: 'post-falls-sewer-mains', name: 'City of Post Falls sewer mains', agency: 'City of Post Falls GIS',
      url: POST_FALLS_SEWER_MAINS, services: ['sewer'], kind: 'mains', outFields: 'Diameter',
      provider: 'City of Post Falls', mainLabel: 'City of Post Falls sewer main'
    },
    {
      id: 'kootenai-tax-districts', name: 'Kootenai County tax districts (city, water, sewer)', agency: 'Kootenai County GIS',
      url: KC_TAX_DISTRICTS, services: ['water', 'sewer'], kind: 'area', outFields: 'CITY,WATER,SEWER',
      read: rows => rows.flatMap(a => {
        const out = [
          ...districtFindings(['water'], districtName(a.WATER, 'water'), `inside Kootenai County tax district for water: ${districtName(a.WATER, 'water')}`),
          ...districtFindings(['sewer'], districtName(a.SEWER, 'sewer'), `inside Kootenai County tax district for sewer: ${districtName(a.SEWER, 'sewer')}`)
        ];
        const city = text(a.CITY) ? cityInfo(a.CITY) : null;
        if (city) out.push(...cityLimitsFindings(city.name, ['water', 'sewer'].filter(s => !(MAPPED[city.key] || []).includes(s))));
        return out;
      })
    }
  ]
};
