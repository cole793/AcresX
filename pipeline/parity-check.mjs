#!/usr/bin/env node
// Parity check for the parcel index (docs/explore-index.md section 7, step 2): takes N parcels
// from the index and compares each stored score and its main inputs with a fresh in-process run
// of the same handlers plus public/score-core.js. Also checks that the stored trimmed inputs
// (parcel_inputs) re-score to the stored score without the network.
//
//   node pipeline/parity-check.mjs --db tmp/index.sqlite --n 10
//   node pipeline/parity-check.mjs --db tmp/index.sqlite --ids 23123.9051,47174.9017
//
// Each parcel also gets its live-report deep link (?state=WA&county=spokane&parcel=…&report=1)
// for a by-eye comparison with the deployed site's #scoreMetric, factor chips, buildable acres and
// zoning. Upstream answers change over time (well records, FEMA maps), so a difference between a
// stored row and a fresh run is reported with the inputs that moved, not assumed to be a bug.
import { pathToFileURL } from 'node:url';
import { installRuntime, requestScope, newCounter, quietHandlerLogs } from './runtime.mjs';
import { makeApi, assembleParcel, findParcel } from './assemble.mjs';
import { scoreOf, layerColumns, rehydrateInputs } from './columns.mjs';
import { openIndexDb } from './db.mjs';
import * as spokane from './counties/spokane.mjs';
import { DEFAULT_BASE_URL } from '../scripts/validate-county.mjs';

const COUNTIES = { spokane };
// The deployed site (the same base URL the county validation uses).
export const SITE = DEFAULT_BASE_URL;
export const COMPARED = Object.freeze(['zoning_code', 'zoning_status', 'flood_high', 'flood_share_pct', 'wetlands_category', 'slope_mean_pct', 'buildable_acres', 'septic_grade', 'well_depth_ft', 'public_water', 'public_sewer', 'power_provider', 'power_territory_confirmed']);
// Numbers within these differences count as the same.
const TOLERANCE = { flood_share_pct: 0.5, slope_mean_pct: 0.2, buildable_acres: 0.05, well_depth_ft: 0.5 };

export function deepLink(state, county, parcelId, site = SITE) {
  return `${site}/?state=${encodeURIComponent(state)}&county=${encodeURIComponent(county)}&parcel=${encodeURIComponent(parcelId)}&report=1`;
}

const same = (key, a, b) => {
  if (a == null || b == null) return a == b;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= (TOLERANCE[key] ?? 1e-9);
  return String(a) === String(b);
};
const round1 = v => (v == null ? null : Math.round(v * 10) / 10);

// stored: the parcels row; fresh: { score, rating, measured, columns }. Returns the differences.
export function compareRow(stored, fresh) {
  const diffs = [];
  if (round1(stored.score) !== round1(fresh.score)) diffs.push({ field: 'score', stored: round1(stored.score), fresh: round1(fresh.score) });
  if (stored.score_rating !== fresh.rating) diffs.push({ field: 'score_rating', stored: stored.score_rating, fresh: fresh.rating });
  if (stored.score_factors_measured !== fresh.measured) diffs.push({ field: 'score_factors_measured', stored: stored.score_factors_measured, fresh: fresh.measured });
  for (const key of COMPARED) if (!same(key, stored[key], fresh.columns[key])) diffs.push({ field: key, stored: stored[key], fresh: fresh.columns[key] });
  return diffs;
}

// Differences that an upstream answer changing between the two runs accounts for.
export function explain(diffs, wellTerrain = {}) {
  const out = [];
  const fields = new Set(diffs.map(d => d.field));
  if (fields.has('well_depth_ft') && wellTerrain.stored !== wellTerrain.fresh) out.push(`well terrain estimate ${wellTerrain.stored || 'none'} -> ${wellTerrain.fresh || 'none'}`);
  return out;
}

export async function parityCheck({ db, county = 'spokane', ids, n = 10, log = line => console.error(line), fetchImpl, cache = true } = {}) {
  const C = COUNTIES[county];
  const runtime = installRuntime({ fetchImpl: fetchImpl || globalThis.fetch, cache });
  const api = makeApi();
  const picked = ids?.length ? ids : db.sample(county, n);
  const results = [];
  try {
    for (const id of picked) {
      const stored = db.getParcel(county, id);
      if (!stored) { results.push({ id, error: 'not in the index' }); continue; }
      const inputsRow = db.getInputs(county, id);
      let storedInputsScore = null, storedTerrain = null;
      if (inputsRow) { const inputs = JSON.parse(inputsRow.inputs_json); const { last, sections } = rehydrateInputs(inputs); storedInputsScore = scoreOf(last, sections).score; storedTerrain = inputs.wells?.terrain?.status ?? null; }
      const counter = newCounter();
      const t = Date.now();
      const fresh = await requestScope.run(counter, async () => {
        const found = await findParcel(id, api);
        if (!found.parcel) return { error: found.error || 'parcel not found' };
        const { last, sections } = await assembleParcel(found.parcel, { api, where: C.WHERE });
        const r = scoreOf(last, sections);
        return { score: r.score, rating: r.rating, measured: r.completeness.measured, columns: layerColumns(last), missing: r.completeness.missing.map(m => m.label), terrain: last.wells?.terrain?.status ?? null };
      });
      const entry = { id, link: deepLink(C.STATE, county, id), ms: Date.now() - t, requests: counter.requests, storedScore: stored.score, freshScore: fresh.score ?? null, storedInputsScore, inputsConsistent: storedInputsScore == null ? null : round1(storedInputsScore) === round1(stored.score) };
      if (fresh.error) entry.error = fresh.error;
      else {
        entry.diffs = compareRow(stored, fresh); entry.freshMissing = fresh.missing; entry.storedMissing = stored.layers_missing;
        // The usual reason a well depth moves between two runs: the terrain-aware estimate
        // answered in one and not the other (the page then shows the nearest-wells median).
        entry.wellTerrain = { stored: storedTerrain, fresh: fresh.terrain };
        entry.explained = explain(entry.diffs, entry.wellTerrain);
      }
      entry.match = !entry.error && entry.diffs.length === 0;
      results.push(entry);
      log(`${id} stored ${round1(stored.score)} ${stored.score_rating} | fresh ${round1(fresh.score)} ${fresh.rating || ''} ${entry.match ? 'MATCH' : `DIFF ${JSON.stringify(entry.diffs || entry.error)}${entry.explained?.length ? ` (${entry.explained.join('; ')})` : ''}`}  ${entry.link}`);
    }
  } finally { runtime.restore(); }
  const checked = results.filter(r => !r.error);
  return {
    checked: checked.length, matched: checked.filter(r => r.match).length,
    scoreMatched: checked.filter(r => round1(r.storedScore) === round1(r.freshScore)).length,
    inputsConsistent: results.filter(r => r.inputsConsistent === true).length,
    results
  };
}

function parseArgs(argv) {
  const out = { county: 'spokane', db: 'tmp/index.sqlite', n: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--db') out.db = next();
    else if (a === '--n') out.n = Number(next());
    else if (a === '--ids') out.ids = String(next()).split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--county') out.county = String(next()).toLowerCase();
    else if (a === '--no-cache') out.cache = false;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!COUNTIES[out.county]) throw new Error(`County ${out.county} is not supported yet (Spokane only).`);
  return out;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = openIndexDb(options.db);
  const quiet = quietHandlerLogs();
  let report;
  try { report = await parityCheck({ ...options, db }); } finally { quiet.restore(); db.close(); }
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
