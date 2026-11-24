// Every rules and cache version a score depends on (index_runs.rules_json, docs/explore-index.md
// section 4). rulesKey() is the part that decides whether a stored parcel is current: the git SHA
// is recorded but left out, so a commit that changes no rule does not rescore the county.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { WELL_TERRAIN_RULES_VERSION, WELL_TERRAIN_CACHE_PREFIX } from '../src/services/well-depth-terrain.js';
import { PUBLIC_UTILITIES_CACHE_PREFIX } from '../src/services/public-utilities.js';
import { TERRAIN_CACHE_PREFIX } from '../src/services/land-analysis.js';
import { SLOPE_RASTER_CACHE_PREFIX } from '../src/services/slope-raster.js';
import { SOIL_CACHE_PREFIX, SOIL_BACKUP_CACHE_PREFIX } from '../src/services/soils.js';
import { POWER_ANSWER_CACHE_PREFIX } from '../src/services/power-intelligence.js';
import { SPOKANE_CACHE_PREFIX } from '../src/counties/spokane.js';
import { SPOKANE_PARCEL_CACHE_PREFIX } from '../src/counties/spokane-parcels.js';
import { loadScoreCore, browserScriptVersions } from './browser-scripts.mjs';
import { INCLUDE_MIN_ACRES } from './config.mjs';

const fileHash = rel => createHash('sha256').update(readFileSync(new URL(`../${rel}`, import.meta.url))).digest('hex').slice(0, 12);
const version = prefix => String(prefix).match(/\/(v\d+)\/?$/)?.[1] || prefix;

export function gitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}

// The pipeline's own input rules: bump when the request builders or column mapping change in a way
// that changes stored inputs.
export const PIPELINE_INPUTS_VERSION = 1;

export function rulesFor(county = 'spokane') {
  const C = loadScoreCore();
  return {
    score_rules_version: C.SCORE_RULES_VERSION,
    pipeline_inputs_version: PIPELINE_INPUTS_VERSION,
    well_terrain_rules_version: WELL_TERRAIN_RULES_VERSION,
    include_min_acres: INCLUDE_MIN_ACRES,
    cache_versions: {
      well_terrain: version(WELL_TERRAIN_CACHE_PREFIX), public_utilities: version(PUBLIC_UTILITIES_CACHE_PREFIX),
      terrain: version(TERRAIN_CACHE_PREFIX), slope_raster: version(SLOPE_RASTER_CACHE_PREFIX),
      soil: version(SOIL_CACHE_PREFIX), soil_backup: version(SOIL_BACKUP_CACHE_PREFIX), power: version(POWER_ANSWER_CACHE_PREFIX),
      ...(county === 'spokane' ? { spokane_intelligence: version(SPOKANE_CACHE_PREFIX), spokane_parcels: version(SPOKANE_PARCEL_CACHE_PREFIX) } : {})
    },
    zoning_tables: county === 'spokane' ? { 'spokane-rules.js': fileHash('src/zoning/spokane-rules.js'), 'spokane-city-rules.js': fileHash('src/zoning/spokane-city-rules.js') } : {},
    browser_scripts: browserScriptVersions()
  };
}

export const rulesKey = rules => createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0, 16);

// The version of the stored inputs (parcel_inputs.inputs_version): every rule except the score's
// own. A parcel whose inputs are current but whose score_version is older is rescored from the
// stored inputs without the network (a "rescore"); any other change fetches its layers again.
export function inputsKey(rules) {
  const { score_rules_version, browser_scripts = {}, ...rest } = rules;
  const { 'score-core.js': _core, ...scripts } = browser_scripts;
  return rulesKey({ ...rest, browser_scripts: scripts });
}
