// Public water and sewer sources for Stevens County, WA (src/services/public-utilities.js).
// Checked live (read-only) on 2026-11-09.
// - Water: WA DOH Drinking Water Service Areas (src/states/washington/public-water.js). The
//   Colville lot (0000500) returns COLVILLE WATER DEPARTMENT, Chewelah (0231200) CHEWELAH WATER
//   DEPT SOUTH, Nine Mile Falls (0763202) STEVENS CO PUD - SUNCREST.
// - Sewer: no reliable layer. The county's AdministrativeBoundaries PUD layers (26, 29) match
//   every point, so they are not used. Inside one of the six cities and towns (Chewelah,
//   Colville, Kettle Falls, Marcus, Northport, Springdale), both services are "likely" (none
//   publishes a utility map); everywhere else sewer is not_found.
// - City limits: the county "Cities" layer the zoning adapter uses
//     https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer/0
//   (field `name`), src/counties/stevens-cities.js STEVENS_CITIES.
import { WA_DOH_WATER_SOURCE } from '../states/washington/public-water.js';
import { STEVENS_CITIES, STEVENS_AGENCY, stevensCityInfo } from './stevens-cities.js';
import { cityLimitsFindings } from '../shared/utility-findings.js';

const stevensPlaceName = value => stevensCityInfo(value)?.name || '';

export const STEVENS_UTILITIES = {
  state: 'WA', county: 'Stevens',
  sources: [
    WA_DOH_WATER_SOURCE,
    {
      id: 'stevens-city-limits', name: 'Stevens County cities (city limits)', agency: STEVENS_AGENCY,
      url: STEVENS_CITIES, services: ['water', 'sewer'], kind: 'area', outFields: 'name',
      read: rows => rows.flatMap(a => cityLimitsFindings(stevensPlaceName(a.name), ['water', 'sewer']))
    }
  ]
};
