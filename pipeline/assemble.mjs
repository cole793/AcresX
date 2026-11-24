// One parcel, end to end, in process: the Worker's own handlers (src/index.js worker.fetch, the
// way test/worker.test.js calls it) with the page's request bodies (pipeline/report-inputs.mjs),
// in the page's order:
//   1. every progressive-loading.js section at once, each with its own time limit;
//   2. follow-ups as their inputs settle: zoning rules after zoning, power intelligence after the
//      utility list (only with a provider), buildable area after flood + wetlands + zoning + land
//      (and the zoning rules, so the setback goes with it as it usually does on the page), cost
//      context (road access) right away;
//   3. layers that failed are asked again after a backoff (the report's Retry button), and the
//      follow-ups that depend on them are re-run.
// Returns { last, sections, followups, attempts }: `last` is the page's object, sections the
// progressive-loading.js state per section ('done' | 'failed' | 'timeout').
import worker from '../src/index.js';
import {
  SECTIONS, SECTION_FINDERS, FOLLOWUP_MS, BUILDABLE_WAITS_FOR,
  zoningRulesIdentity, findZoningRules, powerIdentity, findPowerIntelligence,
  buildableBody, findBuildableArea, costContextBody, findCostContext, findParcelSpokane
} from './report-inputs.mjs';
import { LAYER_RETRIES, LAYER_RETRY_BACKOFF_MS } from './config.mjs';
import { TERRAIN_FAILED } from './columns.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ORIGIN = 'https://acresx.index';
const ENV = {};

// One in-process call: POST path with a JSON body -> { ok, status, data } (data null when the
// answer is not JSON, as the page's response.json() would throw).
export function makeApi({ handler = worker, env = ENV, onCall } = {}) {
  const ctx = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); }, passThroughOnException() {} };
  return async function api(path, body) {
    const started = Date.now();
    const request = new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let response, data = null;
    try {
      response = await handler.fetch(request, env, ctx);
      try { data = await response.json(); } catch { data = null; }
    } catch (error) {
      onCall?.({ path, ms: Date.now() - started, status: 0, error: error?.message });
      throw error;
    }
    onCall?.({ path, ms: Date.now() - started, status: response.status });
    return { ok: response.ok, status: response.status, data };
  };
}

// Promise.race with the page's time limit: { status, value }.
async function limited(run, ms, fallback) {
  let timer;
  const TIMEOUT = Symbol('timeout');
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(TIMEOUT), ms); });
  try {
    const result = await Promise.race([run().then(value => ({ ok: true, value }), error => ({ ok: false, error })), timeout]);
    if (result === TIMEOUT) return { status: 'timeout', value: fallback('timeout') };
    if (result.ok) return { status: 'done', value: result.value };
    return { status: 'failed', value: fallback('error', result.error), error: result.error?.message };
  } finally { clearTimeout(timer); }
}

// Whether a section's answer is a failure worth asking again (not a real "nothing there").
export function sectionFailed(name, value, status) {
  if (status === 'timeout' || status === 'failed') return true;
  switch (name) {
    case 'wells': return Boolean(value?.lookupFailed) || (value?.terrain && value.terrain.available === false && TERRAIN_FAILED.includes(value.terrain.status));
    case 'utility': return Boolean(value?.lookupFailed);
    case 'flood': case 'wetlands': case 'publicUtilities': return !value?.available;
    case 'zoningPermits': return ['unavailable', 'error'].includes(value?.zoning?.status);
    case 'land': return !value?.soil?.available || !value?.terrain?.available;
    default: return false;
  }
}
export function followupFailed(name, value) {
  switch (name) {
    case 'zoningDevelopmentPotential': return Boolean(value && value.available === false && value.error);
    case 'powerIntelligence': return Boolean(value && value.available === false && value.error);
    case 'buildableArea': return value?.status === 'unavailable';
    case 'costContext': return value?.roadAccess?.status === 'source_unavailable';
    default: return false;
  }
}

// parcel: the Feature /api/parcel-search answers (or the bulk outline in the same shape).
// where: the page's state and county selects ({ state: 'WA', county: 'Spokane' }).
export async function assembleParcel(parcel, { api, where, retries = LAYER_RETRIES, backoffMs = LAYER_RETRY_BACKOFF_MS, sectionMs = {} } = {}) {
  const last = { parcel, wells: [], utility: [], evidence: null, flood: null, wetlands: null, zoningPermits: null, land: null, publicUtilities: null };
  const sections = {}, followups = {}, attempts = {};
  const ms = name => sectionMs[name] ?? SECTIONS[name].ms;

  const runSection = async name => {
    attempts[name] = (attempts[name] || 0) + 1;
    const out = await limited(() => SECTION_FINDERS[name](parcel, api, where), ms(name), SECTIONS[name].fallback);
    last[name] = out.value;
    sections[name] = out.status;
    return out;
  };
  const runFollowup = async (name, run, fallback) => {
    attempts[name] = (attempts[name] || 0) + 1;
    const out = await limited(run, sectionMs[name] ?? FOLLOWUP_MS[name], fallback);
    followups[name] = out.status;
    return out.value;
  };
  const zoningRules = async () => {
    const identity = zoningRulesIdentity(last);
    if (!identity) { delete last.zoningDevelopmentPotential; followups.zoningDevelopmentPotential = 'not_sent'; return; }
    last.zoningDevelopmentPotential = await runFollowup('zoningDevelopmentPotential', () => findZoningRules(identity, api), () => ({ available: false, error: 'Timed out' }));
  };
  const power = async () => {
    const identity = powerIdentity(last, where);
    if (!identity || !identity.providers.length) { delete last.powerIntelligence; followups.powerIntelligence = 'not_sent'; return; }
    last.powerIntelligence = await runFollowup('powerIntelligence', () => findPowerIntelligence(identity, api), () => ({ available: false, error: 'Power intelligence timed out' }));
  };
  const buildable = async () => {
    last.buildableArea = await runFollowup('buildableArea', () => findBuildableArea(buildableBody(last, where), api),
      () => ({ status: 'unavailable', removed: [], layers: [], notes: ['Buildable area could not be measured (timed out).'], geometry: null }));
  };
  const costContext = async () => {
    const body = costContextBody(last, where);
    if (!body) { followups.costContext = 'not_sent'; return; }
    last.costContext = await runFollowup('costContext', () => findCostContext(body, api), () => {
      const down = { available: false, status: 'source_unavailable', error: 'Cost context timed out' };
      return { roadAccess: down, watershed: { ...down } };
    });
  };

  // 1-2. Sections at once; follow-ups chained on what they wait for.
  const started = Object.fromEntries(Object.keys(SECTIONS).map(name => [name, runSection(name)]));
  const zoningDone = started.zoningPermits.then(zoningRules);
  const powerDone = started.utility.then(power);
  const buildableDone = Promise.all([...BUILDABLE_WAITS_FOR.map(n => started[n]), zoningDone]).then(buildable);
  const costDone = costContext();
  await Promise.all([...Object.values(started), zoningDone, powerDone, buildableDone, costDone]);

  // 3. Retries.
  for (let round = 0; round < retries; round++) {
    const failed = Object.keys(SECTIONS).filter(name => sectionFailed(name, last[name], sections[name]));
    const failedFollowups = ['zoningDevelopmentPotential', 'powerIntelligence', 'buildableArea', 'costContext'].filter(n => followupFailed(n, last[n]));
    if (!failed.length && !failedFollowups.length) break;
    await sleep(backoffMs[Math.min(round, backoffMs.length - 1)] ?? 0);
    await Promise.all(failed.map(runSection));
    const again = new Set(failedFollowups);
    if (failed.includes('zoningPermits')) again.add('zoningDevelopmentPotential');
    if (failed.includes('utility')) again.add('powerIntelligence');
    if (failed.some(n => BUILDABLE_WAITS_FOR.includes(n)) || again.has('zoningDevelopmentPotential')) again.add('buildableArea');
    if (again.has('zoningDevelopmentPotential')) await zoningRules();
    await Promise.all([
      again.has('powerIntelligence') ? power() : null,
      again.has('costContext') ? costContext() : null
    ]);
    if (again.has('buildableArea')) await buildable();
  }
  return { last, sections, followups, attempts };
}

// The parcel as the report finds it (/api/parcel-search, in process). null + error on a miss.
export async function findParcel(parcelId, api) {
  try { return await findParcelSpokane(parcelId, api); } catch (error) { return { parcel: null, error: error?.message || String(error) }; }
}
