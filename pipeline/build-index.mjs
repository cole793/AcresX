#!/usr/bin/env node
// Parcel search index ("Explore"), Phase 1 step 2 part A: the batch scoring job, Spokane County
// only, writing a local SQLite file with the D1 schema (migrations-index/0001_parcel_index.sql).
// Design: docs/explore-index.md. Writing to D1 and the scheduled workflow come later.
//
//   node pipeline/build-index.mjs --county spokane --limit 200 --db ./tmp/index.sqlite
//
// Options:
//   --county spokane        the only county so far
//   --db FILE               SQLite file (created with the schema if missing); default tmp/index.sqlite
//   --limit N               stop after N included parcels have been handled (scored or skipped)
//   --ids A,B,...           only these parcel ids (still through the inclusion rule)
//   --concurrency N         parcels in flight (default 4)
//   --shard I/N             only parcels whose id hash mod N is I
//   --mode full|incremental|rescore|pull_only   rescore: stored inputs through the current score
//                           core only; pull_only: the parcel list and the rule, nothing scored
//   --force                 rescore every parcel, even when current
//   --max-minutes M         stop cleanly (no new parcels) after M minutes
//   --no-cache              no in-memory Cache API (every handler fetches; production reuses answers)
//   --summary FILE          write the run's measurements as JSON
//   --verbose               print the handlers' per-request log lines and warnings
//
// Live runs from a cloud session need NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
// (handoff/testing.md). Never run from tests: tests call runIndex() with a stubbed fetch.
//
// Steps: (1) page the assessor layer (attributes only, no owner fields), (2) download the city
// limits and PAD-US Fee polygons once, (3) code exclusions, then outlines by id for the parcels
// that can still be included, the local city / public land overlays and the rule, (4) per
// included parcel: skip when current, rescore from stored inputs when only the score rules
// changed, else the in-process report layers and score-core.js, (5) write rows that changed,
// (6) record the run in index_runs.
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installRuntime, requestScope, newCounter, quietHandlerLogs } from './runtime.mjs';
import { makeApi } from './assemble.mjs';
import { openIndexDb } from './db.mjs';
import { rulesFor, rulesKey, inputsKey, gitSha } from './rules.mjs';
import { preExclusion, needsOutline, smallWithoutOutline, decide } from './inclusion.mjs';
import { parcelSamples } from './overlay.mjs';
import { scoreParcel, failedParcel, sourceHash, headlineAcres } from './score-parcel.mjs';
import { scoreOf, scoreColumns, rehydrateInputs } from './columns.mjs';
import { loadScoreCore } from './browser-scripts.mjs';
import { INCLUDE_MIN_ACRES, DEFAULT_CONCURRENCY, MAX_AGE_DAYS } from './config.mjs';
import * as spokane from './counties/spokane.mjs';

export const COUNTIES = Object.freeze({ spokane });
const OUTLINE_BATCH = 100;

const idHash = id => createHash('sha1').update(String(id)).digest();
const shardOf = (id, n) => idHash(id).readUInt32BE(0) % n;
const quantile = (values, q) => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null; const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

export function parseArgs(argv) {
  const out = { county: 'spokane', db: 'tmp/index.sqlite', limit: Infinity, concurrency: DEFAULT_CONCURRENCY, mode: 'full', cache: true, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--county') out.county = String(next()).toLowerCase();
    else if (a === '--db') out.db = next();
    else if (a === '--limit') out.limit = Number(next());
    else if (a === '--ids') out.ids = String(next()).split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--concurrency') out.concurrency = Math.max(1, Number(next()) || DEFAULT_CONCURRENCY);
    else if (a === '--shard') { const [s, n] = String(next()).split('/').map(Number); out.shard = { index: s, count: n }; }
    else if (a === '--mode') out.mode = next();
    else if (a === '--force') out.force = true;
    else if (a === '--max-minutes') out.maxMinutes = Number(next());
    else if (a === '--no-cache') out.cache = false;
    else if (a === '--summary') out.summary = next();
    else if (a === '--verbose') out.verbose = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!COUNTIES[out.county]) throw new Error(`County ${out.county} is not supported yet (Spokane only).`);
  if (!['full', 'incremental', 'rescore', 'pull_only'].includes(out.mode)) throw new Error(`Unknown mode ${out.mode}`);
  return out;
}

// What to do with an included parcel that is already stored: 'skip' (current), 'rescore' (inputs
// current, score rules newer) or 'score'.
export function plan(existing, inputsRow, { sourceHash: hash, inputsVersion, scoreVersion, now, force, maxAgeDays = MAX_AGE_DAYS }) {
  if (!existing || force) return { action: 'score', why: existing ? 'forced' : 'new' };
  if (existing.index_status !== 'active') return { action: 'score', why: 'reactivated' };
  if (existing.source_hash !== hash) return { action: 'score', why: 'source_changed' };
  if (!inputsRow || inputsRow.inputs_version !== inputsVersion) return { action: 'score', why: 'rules_version' };
  if (existing.layers_missing) return { action: 'score', why: 'layer_retry' };
  const age = (Date.parse(now) - Date.parse(existing.scored_at || 0)) / 86400000;
  if (!(age <= maxAgeDays)) return { action: 'score', why: 'age' };
  if (existing.score_version !== scoreVersion) return { action: 'rescore', why: 'score_version' };
  return { action: 'skip', why: 'current' };
}

// The run. options: parseArgs() output plus { db (an open index db), log, fetchImpl, now }.
export async function runIndex(options) {
  const county = COUNTIES[options.county];
  const log = options.log || (line => console.error(line));
  const runtime = installRuntime({ fetchImpl: options.fetchImpl || globalThis.fetch, cache: options.cache !== false });
  const db = options.db && typeof options.db === 'object' ? options.db : openIndexDb(options.db);
  const ownsDb = !(options.db && typeof options.db === 'object');
  const clock = options.now || (() => new Date().toISOString());
  const started = clock();
  const rules = rulesFor(options.county);
  const inputsVersion = inputsKey(rules);
  const C = loadScoreCore();
  const scoreVersion = String(C.SCORE_RULES_VERSION);
  const shardLabel = options.shard ? `${options.shard.index}/${options.shard.count}` : null;
  const runId = `${started.replace(/\.\d+Z$/, 'Z')}-${options.county}${shardLabel ? `-${options.shard.index}of${options.shard.count}` : ''}`;
  db.startRun({ runId, county: options.county, shard: shardLabel, mode: options.mode, startedAt: started, gitSha: options.gitSha || gitSha(), scoreVersion, rulesJson: JSON.stringify({ ...rules, rules_key: rulesKey(rules), inputs_version: inputsVersion }), minAcres: INCLUDE_MIN_ACRES });

  const includedIds = new Set();
  const stats = { pulled: 0, included: 0, scored: 0, rescored: 0, skipped: 0, partial: 0, failed: 0, removed: 0, excluded: {}, layerFailures: {}, layerStatus: {}, plans: {}, perParcel: [], inputsMismatch: 0, includedByReason: {} };
  const deadline = options.maxMinutes ? Date.now() + options.maxMinutes * 60000 : Infinity;
  let stopReason = null;
  const onSignal = () => { stopReason = 'signal'; log('Stopping after the parcels in flight…'); };
  process.once('SIGINT', onSignal);
  // options.api: tests answer the in-process calls from recorded fixtures.
  const api = options.api || makeApi();
  const t0 = Date.now();
  let status = 'succeeded', notes = [], pullIncomplete = false, cityLimitsOk = false;
  try {
    // (1) Attributes.
    let rows;
    if (options.ids?.length) rows = (await county.pullAttributesById?.(options.ids)) ?? (await county.pullAttributes()).filter(r => options.ids.includes(r.pid));
    else rows = await county.pullAttributes({ onPage: ({ offset }) => { if (offset % 20000 === 0) log(`assessor rows from ${offset}`); } });
    stats.pulled = rows.length;
    log(`${rows.length} assessor rows (${Math.round((Date.now() - t0) / 1000)} s)`);
    // (2) Overlays, once. A failed city-limits layer keeps parcels with in_city NULL.
    let cityLimits = null, publicLand = null;
    try { cityLimits = await county.fetchCityLimits(); } catch (error) { notes.push(`city limits unavailable: ${error.message}`); log(`city limits unavailable: ${error.message}`); }
    try { publicLand = await county.fetchPublicLand(cityLimits?.countyBbox || county.COUNTY_BBOX); } catch (error) { notes.push(`PAD-US Fee unavailable: ${error.message}`); log(`PAD-US Fee unavailable: ${error.message}`); }
    const now = clock();
    cityLimitsOk = Boolean(cityLimits);
    const cityLayer = cityLimits ? { status: 'ok', source: county.LABELS.cityLimits } : { status: 'unavailable', source: county.LABELS.cityLimits, error: 'city-limits layer failed; acreage test only' };

    // (3) Rule, in id-hash order (a --limit sample spreads over the county; shards split by it).
    let order = rows.filter(r => !options.shard || shardOf(r.pid, options.shard.count) === options.shard.index);
    order.sort((a, b) => Buffer.compare(idHash(a.pid), idHash(b.pid)));
    const candidates = [];
    for (const r of order) {
      const pre = preExclusion({ id: r.pid, codeReason: county.codeExclusion(r) });
      if (pre) { bump(stats.excluded, pre.excluded); continue; }
      if (!needsOutline({ acres: r.acreage, improved: r.improved })) { bump(stats.excluded, smallWithoutOutline(r)); continue; }
      candidates.push(r);
    }
    log(`${candidates.length} candidates need an outline`);

    async function* included() {
      let next = null;
      const fetchBatch = i => county.fetchOutlines(candidates.slice(i, i + OUTLINE_BATCH).map(r => r.pid));
      for (let i = 0; i < candidates.length; i += OUTLINE_BATCH) {
        let outlines;
        try { outlines = await (next || fetchBatch(i)); } catch (error) { outlines = null; next = null; notes.push(`outlines unavailable for ${Math.min(OUTLINE_BATCH, candidates.length - i)} parcels: ${error.message}`); }
        next = i + OUTLINE_BATCH < candidates.length ? fetchBatch(i + OUTLINE_BATCH) : null;
        next?.catch(() => {});
        // A failed outline batch: those parcels are not decided this run (stored rows stay as
        // they are, and nothing is marked removed).
        if (!outlines) { pullIncomplete = true; bump(stats.excluded, 'outline_unavailable', Math.min(OUTLINE_BATCH, candidates.length - i)); continue; }
        if (i && i % 5000 === 0) log(`rule applied to ${i} of ${candidates.length} candidates (${Math.round((Date.now() - t0) / 1000)} s)`);
        for (const r of candidates.slice(i, i + OUTLINE_BATCH)) {
          const bulk = outlines.get(r.pid);
          const parcel = bulk ? parcelSamples(bulk.geometry) : null;
          const { acres } = bulk ? await headlineAcres(bulk) : { acres: r.acreage };
          const city = parcel && cityLimits ? county.cityOf(parcel, cityLimits) : null;
          const pub = parcel && publicLand ? county.publicLandOf(parcel, publicLand) : null;
          const d = decide({ id: r.pid, codeReason: null, hasGeometry: Boolean(parcel), acres, inCity: city ? city.inCity : null, improved: r.improved, publicLand: pub, publicHint: county.publicHint(r) });
          if (!d.included) { bump(stats.excluded, d.reason); continue; }
          yield { pid: r.pid, row: r, bulk, reason: d.reason, inCity: city ? city.inCity : null, cityName: city?.cityName ?? null, acres, sourceHash: sourceHash({ pid: r.pid, row: r, geometry: bulk.geometry }), cityLayer };
        }
      }
    }

    // (4-5) Score with a small worker pool.
    const iterator = included();
    let handed = 0;
    const take = async () => {
      if (stopReason || handed >= options.limit) return null;
      if (Date.now() > deadline) { stopReason = 'time_budget'; return null; }
      const n = await iterator.next();
      if (n.done) return null;
      handed++;
      return n.value;
    };
    const worker = async () => {
      for (let cand = await take(); cand; cand = await take()) {
        stats.included++;
        includedIds.add(cand.pid);
        const existing = db.getParcel(options.county, cand.pid);
        const inputsRow = existing ? db.getInputs(options.county, cand.pid) : null;
        const p = options.mode === 'rescore' ? (inputsRow ? { action: 'rescore', why: 'mode' } : { action: 'skip', why: 'no stored inputs' })
          : plan(existing, inputsRow, { sourceHash: cand.sourceHash, inputsVersion, scoreVersion, now, force: options.force });
        bump(stats.plans, `${p.action}:${p.why}`);
        if (options.mode === 'pull_only') { bump(stats.includedByReason, cand.reason); continue; }
        bump(stats.includedByReason, cand.reason);
        if (p.action === 'skip') { stats.skipped++; continue; }
        if (p.action === 'rescore') {
          const { last, sections } = rehydrateInputs(JSON.parse(inputsRow.inputs_json));
          db.updateScore(options.county, cand.pid, scoreColumns(scoreOf(last, sections)), clock(), runId);
          stats.rescored++;
          continue;
        }
        const counter = newCounter();
        const tStart = Date.now();
        let out;
        try {
          out = await requestScope.run(counter, () => scoreParcel(cand, { api, where: county.WHERE, county: options.county, state: county.STATE, labels: county.LABELS, now: clock(), runId, inputsVersion, assembleOptions: options.assembleOptions }));
        } catch (error) {
          stats.failed++;
          log(`${cand.pid}: pipeline error ${error?.stack || error}`);
          out = await failedParcel(cand, error, { county: options.county, state: county.STATE, labels: county.LABELS, now: clock(), runId });
        }
        const ms = Date.now() - tStart;
        db.writeParcel({ row: out.row, layers: out.layers, shape: out.shape, inputs: out.inputs, inputsVersion, now: clock(), runId });
        stats.scored++;
        if (out.row.layers_missing) stats.partial++;
        if (out.inputsMatch === false) stats.inputsMismatch++;
        for (const [layer, l] of Object.entries(out.layers)) {
          bump(stats.layerStatus, `${layer}:${l.status}`);
          if (l.status === 'unavailable' || l.status === 'timeout') bump(stats.layerFailures, layer);
        }
        stats.perParcel.push({ pid: cand.pid, ms, requests: counter.requests, rateLimited: counter.rateLimited, byHost: counter.byHost, reason: cand.reason, score: out.row.score, rating: out.row.score_rating, missing: out.row.layers_missing, attempts: out.attempts });
        log(`${cand.pid} ${cand.reason} ${out.row.acres?.toFixed?.(2)} ac -> ${out.row.score == null ? 'not scored' : out.row.score.toFixed(1)} ${out.row.score_rating} (${ms} ms, ${counter.requests} requests${out.row.layers_missing ? `, missing ${out.row.layers_missing}` : ''})`);
      }
    };
    await Promise.all(Array.from({ length: options.concurrency }, worker));
    if (stopReason) { status = 'stopped'; notes.push(`stopped: ${stopReason}`); }
    else if (Number.isFinite(options.limit) || options.ids?.length || options.shard) { status = 'partial'; notes.push(Number.isFinite(options.limit) ? `limit ${options.limit}` : options.ids?.length ? 'id list' : `shard ${shardLabel}`); }
    if (stats.failed) notes.push(`${stats.failed} parcels hit a pipeline error`);

    // Removal marking: only a complete, unsharded full pull, and never after a short pull.
    if (status === 'succeeded' && ['full', 'pull_only'].includes(options.mode) && !pullIncomplete && cityLimitsOk) {
      const previous = db.lastRun(options.county);
      if (previous?.pulled_count && stats.pulled < 0.9 * previous.pulled_count) notes.push(`pull ${stats.pulled} < 90% of previous ${previous.pulled_count}: nothing marked removed`);
      else {
        const gone = db.activeIds(options.county).filter(id => !includedIds.has(id));
        stats.removed = gone.length;
        if (gone.length) db.markRemoved(options.county, gone, clock());
      }
    }
  } catch (error) {
    status = 'failed';
    notes.push(String(error?.message || error).slice(0, 300));
    log(`run failed: ${error?.stack || error}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    const finished = clock();
    db.finishRun({ runId, status, finishedAt: finished, pulled: stats.pulled, included: stats.included, scored: stats.scored + stats.rescored, partial: stats.partial, removed: stats.removed, excluded: stats.excluded, layerFailures: stats.layerFailures, notes: notes.join('; ') || null });
    if (status !== 'failed') db.setMeta(`county:${options.county}`, { runId, status, finishedAt: finished, included: stats.included, scored: stats.scored }, finished);
    stats.wallMs = Date.now() - t0;
    stats.totalRequests = runtime.counter.requests + stats.perParcel.reduce((s, p) => s + p.requests, 0);
    stats.bulkRequests = runtime.counter.requests;
    stats.cache = runtime.cache ? { hits: runtime.cache.hits, misses: runtime.cache.misses } : null;
    stats.writes = { ...db.writes };
    runtime.restore();
    if (ownsDb) db.close();
  }
  return { runId, status, notes, stats, summary: summarize(stats) };
}

export function summarize(stats) {
  const ms = stats.perParcel.map(p => p.ms), req = stats.perParcel.map(p => p.requests);
  const n = stats.perParcel.length;
  const rate = Object.fromEntries(Object.entries(stats.layerFailures).map(([k, v]) => [k, `${v}/${n}`]));
  return {
    parcels: n, wallSeconds: Math.round((stats.wallMs || 0) / 1000),
    perParcelMs: { median: quantile(ms, 0.5), p90: quantile(ms, 0.9), max: n ? Math.max(...ms) : null, mean: n ? Math.round(ms.reduce((a, b) => a + b, 0) / n) : null },
    requestsPerParcel: { median: quantile(req, 0.5), p90: quantile(req, 0.9), max: n ? Math.max(...req) : null, mean: n ? Math.round(req.reduce((a, b) => a + b, 0) / n * 10) / 10 : null },
    throughputPerHour: n && stats.wallMs ? Math.round(n / (stats.wallMs / 3600000)) : null,
    layerFailureRates: rate, included: stats.includedByReason, excluded: stats.excluded, plans: stats.plans
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const quiet = quietHandlerLogs({ verbose: options.verbose });
  let result;
  try { result = await runIndex(options); } finally { quiet.restore(); }
  result.upstream = { hosts: quiet.hosts, handlerWarnings: quiet.warnings };
  if (options.summary) { mkdirSync(dirname(options.summary), { recursive: true }); writeFileSync(options.summary, JSON.stringify(result, null, 2)); }
  console.log(JSON.stringify({ runId: result.runId, status: result.status, notes: result.notes, ...result.summary, writes: result.stats.writes, cache: result.stats.cache, bulkRequests: result.stats.bulkRequests, inputsMismatch: result.stats.inputsMismatch }, null, 2));
  if (result.status === 'failed') process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
