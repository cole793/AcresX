const WA_COUNTIES = ['Adams','Asotin','Benton','Chelan','Clallam','Clark','Columbia','Cowlitz','Douglas','Ferry','Franklin','Garfield','Grant','Grays Harbor','Island','Jefferson','King','Kitsap','Kittitas','Klickitat','Lewis','Lincoln','Mason','Okanogan','Pacific','Pend Oreille','Pierce','San Juan','Skagit','Skamania','Snohomish','Spokane','Stevens','Thurston','Wahkiakum','Walla Walla','Whatcom','Whitman','Yakima'];
const MT_COUNTIES = ['Beaverhead','Big Horn','Blaine','Broadwater','Carbon','Carter','Cascade','Chouteau','Custer','Daniels','Dawson','Deer Lodge','Fallon','Fergus','Flathead','Gallatin','Garfield','Glacier','Golden Valley','Granite','Hill','Jefferson','Judith Basin','Lake','Lewis and Clark','Liberty','Lincoln','Madison','McCone','Meagher','Mineral','Missoula','Musselshell','Park','Petroleum','Phillips','Pondera','Powder River','Powell','Prairie','Ravalli','Richland','Roosevelt','Rosebud','Sanders','Sheridan','Silver Bow','Stillwater','Sweet Grass','Teton','Toole','Treasure','Valley','Wheatland','Wibaux','Yellowstone'];
const ID_COUNTIES = ['Ada','Adams','Bannock','Bear Lake','Benewah','Bingham','Blaine','Boise','Bonner','Bonneville','Boundary','Butte','Camas','Canyon','Caribou','Cassia','Clark','Clearwater','Custer','Elmore','Franklin','Fremont','Gem','Gooding','Idaho','Jefferson','Jerome','Kootenai','Latah','Lemhi','Lewis','Lincoln','Madison','Minidoka','Nez Perce','Oneida','Owyhee','Payette','Power','Shoshone','Teton','Twin Falls','Valley','Washington'];

export const COVERAGE_STATUS = {
  VALIDATED: 'validated',
  AVAILABLE_UNVALIDATED: 'available_unvalidated',
  PARTIAL: 'partial',
  NOT_CONFIGURED: 'not_configured'
};

const statewideBase = {
  parcel: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  wells: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  soil: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  terrain: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  flood: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  wetlands: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  utilities: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  assessment: COVERAGE_STATUS.NOT_CONFIGURED,
  tax: COVERAGE_STATUS.NOT_CONFIGURED,
  zoning: COVERAGE_STATUS.NOT_CONFIGURED,
  zoningRules: COVERAGE_STATUS.NOT_CONFIGURED
};

// Levels follow COUNTY_CHECKLIST.md "Readiness levels"; checklistScore is that checklist's audit
// score (out of 100) on checklistScoreDate.
//
// Every capability below comes from the live validation runs of 2026-11-03 (started 23:25Z, after
// PR #30's terrain fix deployed; Spokane and Stevens ran on the WA validation tool from PR #36),
// 12 parcels per county, never from older hand-set values:
//   validated      ok on at least 10 of 12 parcels and no mismatch
//   partial        answered for some parcels, had a mismatch, or answered without usable data
//   not_configured unavailable on every parcel because nothing is set up for it
// utilities = the utility-territory and power layers; terrain = the terrain and slope-grid layers.
// tax: no run returned a tax amount for any parcel, so no county claims tax coverage.
const overrides = {
  'WA:Spokane': {
    level: 2,
    priority: 1,
    lastValidated: '2026-11-03',
    checklistScore: 79,
    checklistScoreDate: '2026-11-03',
    notes: 'Validated with the WA validation tool (PR #36) on 2026-11-03. That run had 2 soil errors (USDA soil service timeouts); zoning rules are missing for 3 of 12 parcels (City of Spokane R1, Spokane Valley R-3, Cheney R-1).',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'validated',assessment:'validated',tax:'not_configured',zoning:'validated',zoningRules:'partial'}
  },
  'MT:Yellowstone': {
    level: 2,
    priority: 1,
    lastValidated: '2026-11-03',
    checklistScore: 80,
    checklistScoreDate: '2026-11-03',
    notes: 'Validation run 2026-11-03T23:25Z had 1 terrain error and 1 power timeout; zoning rules are missing for 4 of 12 parcels (all unzoned county land).',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'validated',assessment:'validated',tax:'not_configured',zoning:'validated',zoningRules:'partial'}
  },
  'ID:Kootenai': {
    level: 2,
    priority: 1,
    lastValidated: '2026-11-03',
    checklistScore: 87,
    checklistScoreDate: '2026-11-03',
    notes: 'First clean validation run 2026-11-03T23:25Z (after the terrain fix); level 3 needs a second consecutive clean run plus owner sign-off. Zoning rules are missing for 3 of 12 parcels (Coeur d\'Alene R-12 twice, county Restricted Residential).',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'validated',assessment:'validated',tax:'not_configured',zoning:'validated',zoningRules:'partial'}
  },
  'MT:Gallatin': {
    level: 2,
    priority: 2,
    lastValidated: '2026-11-03',
    checklistScore: 75,
    checklistScoreDate: '2026-11-03',
    notes: 'Validation run 2026-11-03T23:25Z had 1 terrain error; zoning answered for 10 of 12 parcels. No zoning rules table for Gallatin.',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'validated',assessment:'validated',tax:'not_configured',zoning:'validated',zoningRules:'not_configured'}
  },
  'WA:Stevens': {
    level: 1,
    lastValidated: '2026-11-03',
    checklistScore: 49,
    checklistScoreDate: '2026-11-03',
    notes: 'Validated with the WA validation tool (PR #36) on 2026-11-03. That run had 2 soil errors (USDA soil service timeouts) and a zoning mismatch on parcel 2371220 (expected 10, got no zone). No assessor adapter. FEMA has no digital flood map here: all 12 parcels answered "no mapped FEMA zone".',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'partial',wetlands:'validated',utilities:'validated',assessment:'not_configured',tax:'not_configured',zoning:'partial',zoningRules:'partial'}
  }
};

const priority2 = new Set([
  'WA:Stevens','WA:Pend Oreille','WA:Whitman','WA:Kittitas','WA:Chelan','WA:Okanogan','WA:Grant','WA:Benton','WA:Yakima',
  'MT:Flathead','MT:Ravalli','MT:Missoula','MT:Lewis and Clark','MT:Lake','MT:Carbon',
  'ID:Bonner','ID:Boundary','ID:Latah','ID:Ada','ID:Canyon','ID:Valley','ID:Teton','ID:Bonneville'
]);

function makeCounty(state, county) {
  const key = `${state}:${county}`;
  const override = overrides[key] || {};
  return {
    state,
    county,
    key,
    level: override.level || 1,
    priority: override.priority || (priority2.has(key) ? 2 : 3),
    lastValidated: override.lastValidated || null,
    checklistScore: override.checklistScore ?? null,
    checklistScoreDate: override.checklistScoreDate || null,
    notes: override.notes || '',
    capabilities: {...statewideBase, ...(override.capabilities || {})}
  };
}

export const COUNTY_COVERAGE = [
  ...WA_COUNTIES.map(county => makeCounty('WA', county)),
  ...MT_COUNTIES.map(county => makeCounty('MT', county)),
  ...ID_COUNTIES.map(county => makeCounty('ID', county))
];

export function getCountyCoverageRegistry() {
  const summary = COUNTY_COVERAGE.reduce((acc, county) => {
    acc.total += 1;
    acc.byState[county.state] = (acc.byState[county.state] || 0) + 1;
    acc.byLevel[county.level] = (acc.byLevel[county.level] || 0) + 1;
    return acc;
  }, {total:0, byState:{}, byLevel:{}});
  return {
    version: 1,
    generatedFrom: 'AcresX county coverage registry',
    levels: {
      1: 'Statewide/base screening only; county-specific assessor/zoning intelligence not yet fully configured.',
      2: 'County parcel/assessment/zoning partly configured; local zoning-code Development Potential may be incomplete.',
      3: 'Validated county experience with parcel screening, assessor/zoning intelligence and standardized Development Potential.'
    },
    statusDefinitions: {
      validated: 'Returned usable data on at least 10 of 12 parcels in a live validation run, with no mismatch against hand-checked values.',
      available_unvalidated: 'Source/adapter exists but county-specific validation is still required.',
      partial: 'Some data is returned but coverage or completeness is limited.',
      not_configured: 'No dedicated source/adapter is currently configured.'
    },
    summary,
    counties: COUNTY_COVERAGE
  };
}
