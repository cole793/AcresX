// Public water and sewer sources for Gallatin County, MT (src/services/public-utilities.js).
// Every layer below was checked live (`?f=json`, distinct values and test-parcel queries,
// read-only) on 2026-11-09. Only the named fields are requested.
// - Montana MSDI water and sewer districts (src/states/montana/water-sewer-districts.js):
//   districts outside cities (Four Corners, Big Sky, Gallatin Gateway, ...).
// - City of Bozeman water mains:
//     https://gisweb.bozeman.net/arcgis/rest/services/COB_Utilities/Water_Utility/MapServer/6
//   Fields LIFE ('Active' | 'Abandoned'), Main_Category ('Distribution', 'Backbone',
//   'Transmission', null). Active mains other than transmission count.
// - City of Bozeman sewer gravity mains:
//     https://gisweb.bozeman.net/arcgis/rest/services/COB_Utilities/Wastewater_Utility/MapServer/8
//   SUBTYPE 1 'Collector' only (9 'Interceptor' and the storm/overflow subtypes take no service
//   connections). Bozeman test lots: 06079812230210000 sewer 3.3 m / water 12.0 m,
//   06079801358210000 sewer 12.6 m / water 8.5 m.
// - "Established Water/Sewer District Service or Planning Area" (Ardurra/T-O Engineers for the
//   Gallatin Development Authority, org k6rZTDGNZ7Srk5IB, last edit 2024-06-17):
//     https://services5.arcgis.com/k6rZTDGNZ7Srk5IB/arcgis/rest/services/Established_Water_Sewer_District_Service_or_Planning_Area/FeatureServer/0
//   Fields NAME, TYPE. A third-party planning layer ("planning, not proof of service"), so it
//   gives "likely" at most. TYPE 'SEWER DISTRICT' / 'Sewer District  Planning Area' -> sewer only;
//   every other TYPE names water and sewer.
// - City limits: Gallatin_Incorporated_Cities_and_Towns/FeatureServer/267 (NAME, TYPE), the layer
//   the zoning adapter uses (src/counties/gallatin.js GALLATIN_CITY_LIMITS). Inside Belgrade,
//   Three Forks, Manhattan or West Yellowstone (no public utility map) both services are
//   "likely"; Bozeman is decided by its mains.
import { MSDI_WATER_SOURCE, MSDI_SEWER_SOURCE } from '../states/montana/water-sewer-districts.js';
import { GALLATIN_CITY_LIMITS } from './gallatin.js';
import { cityLimitsFindings, text, titleCase } from '../shared/utility-findings.js';

const BOZEMAN = 'https://gisweb.bozeman.net/arcgis/rest/services/COB_Utilities';
export const BOZEMAN_WATER_MAINS = `${BOZEMAN}/Water_Utility/MapServer/6`;
export const BOZEMAN_SEWER_MAINS = `${BOZEMAN}/Wastewater_Utility/MapServer/8`;
export const GALLATIN_WATER_SEWER_PLANNING = 'https://services5.arcgis.com/k6rZTDGNZ7Srk5IB/arcgis/rest/services/Established_Water_Sewer_District_Service_or_Planning_Area/FeatureServer/0';

const MAPPED = { BOZEMAN: ['water', 'sewer'] };
const PLACE_TYPE = { BOZEMAN: 'City', BELGRADE: 'City', 'THREE FORKS': 'City', MANHATTAN: 'Town', 'WEST YELLOWSTONE': 'Town' };

export function gallatinPlace(attrs) {
  const key = text(attrs?.NAME).toUpperCase();
  if (!key) return null;
  const type = PLACE_TYPE[key] || (/town/i.test(text(attrs?.TYPE)) ? 'Town' : 'City');
  return { key, name: `${type} of ${titleCase(key)}` };
}

export const GALLATIN_UTILITIES = {
  state: 'MT', county: 'Gallatin',
  sources: [
    MSDI_WATER_SOURCE,
    MSDI_SEWER_SOURCE,
    {
      id: 'bozeman-water-mains', name: 'City of Bozeman water mains', agency: 'City of Bozeman GIS',
      url: BOZEMAN_WATER_MAINS, services: ['water'], kind: 'mains', outFields: 'Main_Category',
      where: "LIFE='Active' AND (Main_Category IS NULL OR Main_Category <> 'Transmission')",
      provider: 'City of Bozeman', mainLabel: 'City of Bozeman water main'
    },
    {
      id: 'bozeman-sewer-mains', name: 'City of Bozeman sewer mains', agency: 'City of Bozeman GIS',
      url: BOZEMAN_SEWER_MAINS, services: ['sewer'], kind: 'mains', outFields: 'SUBTYPE', where: 'SUBTYPE=1',
      provider: 'City of Bozeman', mainLabel: 'City of Bozeman sewer main'
    },
    {
      id: 'gallatin-water-sewer-planning', name: 'Gallatin water/sewer district service or planning areas (GDA, planning only)', agency: 'Gallatin Development Authority (Ardurra/T-O Engineers)',
      url: GALLATIN_WATER_SEWER_PLANNING, services: ['water', 'sewer'], kind: 'area', outFields: 'NAME,TYPE',
      read: rows => rows.flatMap(a => {
        const name = text(a.NAME);
        if (!name) return [];
        const services = /^sewer district/i.test(text(a.TYPE)) ? ['sewer'] : ['water', 'sewer'];
        return services.map(service => ({
          service, status: 'likely', provider: name,
          basis: `inside a ${service} district service or planning area (${text(a.TYPE) || 'planning area'}): ${name}; a planning area is not proof of service`
        }));
      })
    },
    {
      id: 'gallatin-city-limits', name: 'Gallatin County incorporated cities and towns', agency: 'Gallatin County GIS',
      url: GALLATIN_CITY_LIMITS, services: ['water', 'sewer'], kind: 'area', outFields: 'NAME,TYPE',
      read: rows => rows.flatMap(a => {
        const place = gallatinPlace(a);
        return place ? cityLimitsFindings(place.name, ['water', 'sewer'].filter(s => !(MAPPED[place.key] || []).includes(s))) : [];
      })
    }
  ]
};
