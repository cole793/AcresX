// The browser's own classic scripts, loaded in Node with node:vm (docs/explore-index.md section 8:
// "No copy of the rules lives in scripts/"). Each runs in a bare context with only what it reads.
//   public/score-core.js   -> AcresXScoreCore (the buildability score, R1)
//   public/well-terrain.js -> AcresXWellTerrain.homesite (the /api/well-depth-terrain point)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const PUBLIC = new URL('../public/', import.meta.url);
export const readPublic = name => readFileSync(new URL(name, PUBLIC), 'utf8');
export const sha256 = text => createHash('sha256').update(text).digest('hex');

let core = null;
export function loadScoreCore() {
  if (core) return core;
  const context = vm.createContext({});
  vm.runInContext(readPublic('score-core.js'), context, { filename: 'public/score-core.js' });
  core = context.AcresXScoreCore;
  if (!core?.calculate) throw new Error('public/score-core.js did not define AcresXScoreCore');
  return core;
}

let wellTerrain = null;
// well-terrain.js wraps window.findWells; a stub findWells is enough for it to define the helper.
export function loadWellTerrain() {
  if (wellTerrain) return wellTerrain;
  const context = vm.createContext({ findWells: async () => [], Date, Math, Number, Promise, setTimeout, clearTimeout });
  vm.runInContext(readPublic('well-terrain.js'), context, { filename: 'public/well-terrain.js' });
  wellTerrain = context.AcresXWellTerrain;
  if (typeof wellTerrain?.homesite !== 'function') throw new Error('public/well-terrain.js did not define AcresXWellTerrain.homesite');
  return wellTerrain;
}

let acreage = null;
// public/acreage.js describe(parcel): the acres the report headlines (assessor, else mapped with
// turf.area). turf: the same @turf/turf 7 the page loads (pinned in package.json).
export async function loadAcreage() {
  if (acreage) return acreage;
  const turf = await import('@turf/turf');
  const context = vm.createContext({ turf: { area: turf.area }, Number, Math });
  vm.runInContext(readPublic('acreage.js'), context, { filename: 'public/acreage.js' });
  acreage = context.AcresXAcreage;
  if (typeof acreage?.describe !== 'function') throw new Error('public/acreage.js did not define AcresXAcreage.describe');
  return acreage;
}

// The browser files the scores depend on, hashed for index_runs.rules_json.
export function browserScriptVersions() {
  return Object.fromEntries(['score-core.js', 'well-terrain.js', 'acreage.js'].map(f => [f, sha256(readPublic(f)).slice(0, 12)]));
}
