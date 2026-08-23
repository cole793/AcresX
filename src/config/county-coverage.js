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

const overrides = {
  'WA:Spokane': {
    level: 3,
    priority: 1,
    lastValidated: '2026-08-23',
    notes: 'Reference implementation for Washington and canonical Development Potential UI.',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'validated',assessment:'validated',tax:'partial',zoning:'validated',zoningRules:'validated'}
  },
  'MT:Yellowstone': {
    level: 3,
    priority: 1,
    lastValidated: '2026-08-23',
    notes: 'Reference implementation for Montana.',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'available_unvalidated',assessment:'validated',tax:'partial',zoning:'validated',zoningRules:'validated'}
  },
  'ID:Kootenai': {
    level: 3,
    priority: 1,
    lastValidated: '2026-08-23',
    notes: 'Reference implementation for Idaho; county PIN, KCEarth zoning and local-code Development Potential validated.',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'available_unvalidated',assessment:'partial',tax:'not_configured',zoning:'validated',zoningRules:'validated'}
  },
  'MT:Gallatin': {
    level: 2,
    priority: 2,
    lastValidated: '2026-08-23',
    notes: 'Parcel and assessment tested; zoning behavior requires broader validation and local-code mapping.',
    capabilities: {parcel:'validated',wells:'available_unvalidated',soil:'available_unvalidated',terrain:'available_unvalidated',flood:'available_unvalidated',wetlands:'available_unvalidated',utilities:'available_unvalidated',assessment:'validated',tax:'partial',zoning:'partial',zoningRules:'not_configured'}
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
      validated: 'Tested successfully against a real parcel.',
      available_unvalidated: 'Source/adapter exists but county-specific validation is still required.',
      partial: 'Some data is returned but coverage or completeness is limited.',
      not_configured: 'No dedicated source/adapter is currently configured.'
    },
    summary,
    counties: COUNTY_COVERAGE
  };
}
