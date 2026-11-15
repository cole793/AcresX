// GET /api/county-coverage: the county coverage registry (src/config/county-coverage.js) in the
// shape the browser needs for the coverage badge and the grouped county dropdown
// (public/coverage-trust.js, public/state-selector.js). Read-only, no upstream calls.
//
// Badge per readiness level (COUNTY_CHECKLIST.md "Readiness levels"):
//   level 3   "Validated county"
//   level 2   "Partially validated"
//   level <=1 "Limited coverage — statewide data only, not validated"
// `supported` (level >= 2) puts a county in the dropdown's "Supported counties" group.
import { COUNTY_COVERAGE, COVERAGE_STATUS } from '../config/county-coverage.js';
import { json } from '../shared/http.js';

const CAPABILITY_LABELS = {
  parcel: 'parcel lines',
  wells: 'well records',
  soil: 'soils',
  terrain: 'terrain',
  flood: 'flood',
  wetlands: 'wetlands',
  utilities: 'power territory',
  assessment: 'assessor values',
  tax: 'property tax',
  zoning: 'zoning map',
  zoningRules: 'zoning rules'
};

const list = items => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const withStatus = (caps, status) => Object.keys(CAPABILITY_LABELS).filter(k => caps[k] === status).map(k => CAPABILITY_LABELS[k]);

export const SUPPORTED_LEVEL = 2;

export function describeCoverage(entry) {
  const level = Number(entry?.level) || 1;
  const caps = entry?.capabilities || {};
  const missing = withStatus(caps, COVERAGE_STATUS.NOT_CONFIGURED);
  const partial = withStatus(caps, COVERAGE_STATUS.PARTIAL);
  if (level >= 3) {
    const gaps = [partial.length ? `${list(partial)} partly covered` : '', missing.length ? `${list(missing)} not set up` : ''].filter(Boolean).join('; ');
    return {
      tier: 'validated', label: 'Validated county', limited: false,
      summary: `Results are checked against county records in daily validation runs${entry.lastValidated ? ` (last ${entry.lastValidated})` : ''}.${gaps ? ` ${gaps[0].toUpperCase()}${gaps.slice(1)}.` : ''}`
    };
  }
  if (level === 2) {
    const gaps = [partial.length ? `${list(partial)} partly covered` : '', missing.length ? `${list(missing)} not set up` : ''].filter(Boolean).join('; ');
    return {
      tier: 'partial', label: 'Partially validated', limited: false,
      summary: `County sources are set up and checked${entry.lastValidated ? ` (last ${entry.lastValidated})` : ''}, but the county is not fully validated yet.${gaps ? ` ${gaps[0].toUpperCase()}${gaps.slice(1)}.` : ''}`
    };
  }
  return {
    tier: 'limited', label: 'Limited coverage — statewide data only, not validated', limited: true,
    summary: `AcresX has not validated this county. ${missing.length ? `County ${list(missing)} sources are not set up; ` : ''}the other layers come from statewide or national data. Any zoning shown was found automatically. Verify every finding with the county.`
  };
}

export function countyCoverageBody() {
  return {
    version: 1,
    supportedLevel: SUPPORTED_LEVEL,
    counties: COUNTY_COVERAGE.map(c => ({
      state: c.state,
      county: c.county,
      level: c.level,
      lastValidated: c.lastValidated,
      supported: c.level >= SUPPORTED_LEVEL,
      zoningValidated: c.capabilities.zoning === COVERAGE_STATUS.VALIDATED,
      coverage: describeCoverage(c)
    }))
  };
}

export function handleCountyCoverage() {
  return json(countyCoverageBody(), 200, 'public, max-age=300, s-maxage=3600');
}
