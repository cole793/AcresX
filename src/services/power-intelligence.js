import { getAvistaPowerIntelligence, isAvistaProvider, serviceTerritoryBasis } from '../utilities/avista.js';
import { getInlandPowerIntelligence, isInlandPowerProvider } from '../utilities/inland-power.js';
import { getOsmPowerProximity } from '../utilities/osm-power.js';
import { nearestAvistaLine } from '../utilities/avista-distribution.js';
import { nearestTransmissionLine } from '../utilities/hifld-transmission.js';
import { publishedLineSource, nearestPublishedLine } from '../utilities/published-lines.js';
import { FALLBACK_KINDS, fallbackHint, hintGeometry } from '../shared/fallback.js';
import { json } from '../shared/http.js';
import { openValueCache, readCachedJson, writeCachedJson } from '../shared/edge-cache.js';

// Time box for the whole route. The browser gives this follow-up POWER_TIMEOUT_MS from the moment
// the request is sent (public/ui-polish.js) and the validator 30 s (scripts/validate-county.mjs
// DEFAULT_TIMEOUT_MS). Profile (2026-11-10): the only slow source was Overpass, asked one endpoint
// after the other at 18 s each; the provider adapters are static. The sources run in parallel,
// each under this deadline, and a source that has not answered by then is reported as "distance
// not verified" instead of holding the answer.
//
// 2026-11-20 (production, 6 test parcels, 12 calls): every call took 9.05-9.09 s, because Overpass
// never answered Cloudflare (12/12 timeouts or 521s) and the route waited the full 9 s for it,
// while HIFLD and Avista's map had answered long before. The browser then asked Overpass itself
// (the osm-power fallback) under the same 15 s clock, which ran out 6 s later and threw the
// server's answer away ("The user aborted a request."). Now Overpass gets a short cap
// (OVERPASS_SERVER_CAP_MS: an edge-cache hit or a fast answer still counts; the browser fallback
// covers the rest), the other sources keep their own 4 s limits, and the whole route is boxed at
// POWER_BUDGET_MS.
export const POWER_BUDGET_MS = 6000;
export const OVERPASS_SERVER_CAP_MS = 3000;
const SOURCE_TIMEOUT_MS = 4000;

// Whole answers are cached (edge cache, versioned prefix; bump the version on any change to the
// answer's rules) so a repeat search is instant. Only answers whose utility map and transmission
// sources answered are stored: 7 days when OpenStreetMap answered too, 1 day when it did not (the
// answer then carries the browser fallback hint, and a later lookup may get OSM on the server).
export const POWER_ANSWER_CACHE_PREFIX = 'https://acresx.internal/cache/power-intelligence/v1/';
export const POWER_ANSWER_TTL_SECONDS = 7 * 86400;
export const POWER_ANSWER_PARTIAL_TTL_SECONDS = 86400;

const WHOLESALE_POWER = /\b(?:bonneville|western area|southwestern|southeastern) power administration\b|^(?:bpa|wapa)\b/i;

// Resolves to the source's answer, or to onTimeout() once `ms` pass. Never rejects.
function withDeadline(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(onTimeout()), Math.max(0, ms)); });
  return Promise.race([Promise.resolve(promise).catch(() => onTimeout()), timeout]).finally(() => clearTimeout(timer));
}

function timedOutProximity(budgetMs) {
  return {
    available: false,
    adapter: 'osm-power-v1',
    status: 'timed_out',
    confidence: 'low',
    browserFallback: true,
    error: `OpenStreetMap power data did not answer within ${Math.round(budgetMs / 1000)} s.`,
    note: 'Distance not verified: OpenStreetMap power data did not answer in time. This does not mean power is unavailable.'
  };
}

// OpenStreetMap maps very few local distribution lines in our counties (ohsome API, OSM as of
// 2026-07: Spokane 98 km of power lines, Stevens 8.5, Kootenai 11.5, Yellowstone 17.7, Gallatin
// 4.8, Bozeman 0, against about 10,000 km of roads each). An OSM "nearest line" can therefore
// badly overstate the distance to power. OSM distances are "mapped lines only":
// - the nearest OSM distribution feature (a minor_line, a distribution-voltage line or cable, a
//   pole or a transformer) within OSM_COST_MAX_FT may feed the cost model, labelled as mapped only;
// - anything farther, and any line whose type is unknown or transmission, never does: the
//   distribution distance stays null (the cost model keeps its "not mapped" range) and the card
//   reads "Distance not confirmed" instead of concluding the parcel is far from power.
// A utility's own map (Avista, src/utilities/avista-distribution.js; Flathead Electric,
// src/utilities/published-lines.js) takes precedence over OSM. Copied in public/browser-fallback.js.
export const OSM_COST_MAX_FT = 1000;
export const OSM_ATTRIBUTION = { text: '\u00a9 OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' };
export const OSM_MAPPED_ONLY_NOTE = 'OSM maps few local lines here; the actual nearest line may be much closer. The utility confirms the route.';
const OSM_FEATURE_NAMES = { pole: 'power pole', transformer: 'transformer', minor_line: 'distribution line', cable: 'distribution cable', line: 'distribution line' };

function osmDistribution(proximity, fallbackNote) {
  const mapped = proximity.available && Number.isFinite(proximity.estimatedDistanceFt);
  if (!mapped) {
    return {
      status: 'no_verified_distance',
      estimatedDistanceFt: null,
      confidence: proximity.confidence || 'low',
      infrastructure: proximity.infrastructure || 'unknown',
      note: proximity.note || fallbackNote
    };
  }
  const ft = proximity.estimatedDistanceFt;
  const featureType = proximity.nearest?.type || 'line';
  const feature = OSM_FEATURE_NAMES[featureType] || 'power feature';
  const osm = { lineType: 'distribution', source: 'OpenStreetMap', sourceLabel: 'OSM', sourceUrl: 'https://www.openstreetmap.org', featureType, mappedOnly: true, attribution: OSM_ATTRIBUTION };
  if (ft <= OSM_COST_MAX_FT) {
    return {
      status: 'osm_mapped_proximity',
      estimatedDistanceFt: ft,
      confidence: proximity.confidence || 'low',
      infrastructure: proximity.infrastructure || 'unknown',
      ...osm,
      usableForCost: true,
      note: `Nearest ${feature} mapped in OpenStreetMap about ${ft.toLocaleString('en-US')} ft from the parcel (mapped lines only). ${OSM_MAPPED_ONLY_NOTE}`
    };
  }
  return {
    status: 'osm_distance_not_confirmed',
    estimatedDistanceFt: null,
    mappedDistanceFt: ft,
    confidence: 'low',
    infrastructure: proximity.infrastructure || 'unknown',
    ...osm,
    usableForCost: false,
    note: `Distance not confirmed. The nearest ${feature} mapped in OpenStreetMap is about ${ft.toLocaleString('en-US')} ft away, but ${OSM_MAPPED_ONLY_NOTE.charAt(0).toLowerCase()}${OSM_MAPPED_ONLY_NOTE.slice(1)} This distance is not used in the cost estimate.`
  };
}

// A utility's own published line map (src/utilities/published-lines.js) first, else OpenStreetMap.
function publishedOrOsmDistribution(published, proximity, fallbackNote) {
  if (published?.available && Number.isFinite(published.distanceFt)) {
    const ft = published.distanceFt;
    return {
      status: 'utility_published_proximity',
      estimatedDistanceFt: ft,
      confidence: ft <= 1320 ? 'moderate' : 'low',
      infrastructure: published.infrastructure || 'utility_distribution_line',
      lineType: 'distribution',
      source: published.source,
      sourceLabel: published.sourceLabel || `${published.utility} map`,
      sourceUrl: published.sourceUrl,
      usableForCost: true,
      note: `${published.utility}'s published grid map shows a distribution line about ${ft.toLocaleString('en-US')} ft from the parcel. It is not a service point; ${published.utility} confirms the route, capacity and cost.`
    };
  }
  return osmDistribution(proximity, fallbackNote);
}

// The one line the power card names (additive field `nearestLine`): the nearest DISTRIBUTION line
// when one is mapped, else the nearest other mapped line (OSM power=line without a voltage, or a
// transmission line from OSM or HIFLD). `usableForCost` is true only for the distance the cost
// model uses (distribution.estimatedDistanceFt); an OSM line is `mappedOnly` and carries the OSM
// attribution. A mapped line is never a service connection; the utility confirms the route.
export function chooseNearestLine(distribution, proximity, transmission) {
  const osmFields = { source: 'OpenStreetMap', sourceLabel: 'OSM', sourceUrl: 'https://www.openstreetmap.org', mappedOnly: true, attribution: OSM_ATTRIBUTION };
  if (Number.isFinite(distribution?.estimatedDistanceFt)) {
    const utility = distribution.status === 'utility_published_proximity';
    return {
      distanceFt: distribution.estimatedDistanceFt,
      lineType: 'distribution',
      infrastructure: distribution.infrastructure || 'unknown',
      ...(utility
        ? { source: distribution.source || 'Utility-published line map', sourceLabel: distribution.sourceLabel || 'utility map', sourceUrl: distribution.sourceUrl || '' }
        : { ...osmFields, featureType: distribution.featureType || 'line' }),
      usableForCost: true,
      confidence: distribution.confidence || 'low',
      note: utility
        ? 'Straight-line distance to the nearest mapped distribution line, not a service connection. The utility confirms the route, capacity and cost.'
        : `Straight-line distance to the nearest line mapped in OpenStreetMap, not a service connection. ${OSM_MAPPED_ONLY_NOTE}`
    };
  }
  // An OSM distribution feature too far away to be trusted (osmDistribution): still the line named.
  if (proximity?.available && Number.isFinite(proximity.estimatedDistanceFt)) {
    return {
      distanceFt: proximity.estimatedDistanceFt,
      lineType: 'distribution',
      infrastructure: proximity.infrastructure || 'unknown',
      ...osmFields,
      featureType: proximity.nearest?.type || 'line',
      usableForCost: false,
      confidence: 'low',
      note: `Nearest line mapped in OpenStreetMap; distance not confirmed. ${OSM_MAPPED_ONLY_NOTE}`
    };
  }
  const candidates = [];
  const other = proximity?.available ? proximity.nearestOtherLine : null;
  if (other && Number.isFinite(other.distanceFt)) {
    candidates.push({ distanceFt: other.distanceFt, lineType: other.lineType === 'transmission' ? 'transmission' : 'unknown', infrastructure: other.infrastructureClass || 'unknown', ...osmFields, voltage: other.voltage || '' });
  }
  if (transmission?.available && Number.isFinite(transmission.distanceFt)) {
    candidates.push({ distanceFt: transmission.distanceFt, lineType: 'transmission', infrastructure: 'transmission_line', source: transmission.source, sourceLabel: 'HIFLD', sourceUrl: transmission.sourceUrl, voltage: transmission.voltageKv ? `${transmission.voltageKv} kV` : '' });
  }
  if (!candidates.length) return null;
  const best = candidates.sort((a, b) => a.distanceFt - b.distanceFt)[0];
  return {
    ...best,
    usableForCost: false,
    confidence: 'low',
    note: best.lineType === 'transmission'
      ? 'Nearest mapped line is a high-voltage transmission line, which does not serve homes directly; no distribution line was mapped nearby. Local lines are often not mapped, so this does not mean the parcel is far from power. The utility confirms the route and cost.'
      : 'Nearest mapped power line; its voltage is not mapped, so it may be a distribution or a transmission line. The utility confirms the route and cost.'
  };
}

// The per-adapter distribution rules (copied in public/browser-fallback.js powerDistribution).
// No provider: the proximity's own status, with the same OSM distance guard.
function unknownProviderDistribution(proximity) {
  const d = osmDistribution(proximity, 'Electric utility territory was not identified for this parcel.');
  if (d.status === 'osm_distance_not_confirmed') return d;
  if (d.status === 'osm_mapped_proximity') return { ...d, status: proximity.status || 'unknown' };
  return { status: proximity.status || 'unknown', estimatedDistanceFt: null, confidence: proximity.confidence || 'low', infrastructure: proximity.infrastructure || 'unknown', note: proximity.note || 'Electric utility territory was not identified for this parcel.' };
}
// Avista's own line map first; OpenStreetMap only when Avista's map gave no distance, and only a
// distance short enough to use. A far OSM line keeps Avista's own answer (the card still names it).
function avistaDistribution(current, proximity) {
  if (current?.status === 'utility_published_proximity') return { ...current, lineType: 'distribution', sourceLabel: 'Avista map', usableForCost: true };
  if (Number.isFinite(current?.estimatedDistanceFt)) return current;
  const osm = osmDistribution(proximity, '');
  return osm.status === 'osm_mapped_proximity' ? osm : current;
}
function inlandDistribution(proximity) {
  const osm = osmDistribution(proximity, 'Distance not verified.');
  return osm.status === 'no_verified_distance'
    ? { ...osm, note: 'Publicly mapped infrastructure proximity is not a verified Inland Power service connection or extension route.' }
    : { ...osm, note: `${osm.note} Publicly mapped infrastructure proximity is not a verified Inland Power service connection or extension route.` };
}

function transmissionSummary(t) {
  if (!t) return null;
  if (!t.available) return { available: false, status: t.status || 'source_unavailable', lineType: 'transmission' };
  return {
    available: true,
    lineType: 'transmission',
    distanceFt: Number.isFinite(t.distanceFt) ? t.distanceFt : null,
    searchedFt: t.searchedFt,
    voltageKv: t.voltageKv ?? null,
    source: t.source,
    sourceUrl: t.sourceUrl,
    usableForResidentialExtensionCost: false,
    note: Number.isFinite(t.distanceFt)
      ? 'Transmission lines (69 kV and up) do not serve homes directly. Shown for context only; not used in the power cost range.'
      : `No mapped transmission line within ${Math.round((t.searchedFt || 0) / 5280)} miles.`
  };
}

// Adds the nearest-line fields, and the browser fallback hint when OpenStreetMap failed in a way
// the user's browser might get past (src/shared/fallback.js) and no utility map gave a distance.
function addLineFields(result, { proximity, transmission, body }) {
  result.transmissionLine = transmissionSummary(transmission);
  result.nearestLine = chooseNearestLine(result.distribution, proximity, transmission);
  const utilityDistance = result.distribution?.status === 'utility_published_proximity' && Number.isFinite(result.distribution?.estimatedDistanceFt);
  if (proximity?.browserFallback === true && !utilityDistance) {
    const lat = Number(body.lat), lon = Number(body.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const geometry = hintGeometry(body.geometry);
      result.fallback = fallbackHint(FALLBACK_KINDS.osmPower, { lat, lon, ...(geometry ? { geometry } : {}) });
    }
  }
  return result;
}

// The primary provider is providers[0] (the browser and /api/utility-territory put it first).
// Other retail names are "also listed": unless the caller says the ranking resolved them
// (providerRanking.resolved === true), the territory is not confirmed, so an unresolved overlap
// never scores as a confirmed territory (public/score-cost.js powerScore).
function applyOverlap(result, alsoListed, ranking) {
  result.alsoListed = alsoListed;
  if (ranking && typeof ranking === 'object') {
    result.providerRanking = { basis: String(ranking.basis || ''), resolved: ranking.resolved === true, note: String(ranking.note || '') };
  }
  if (alsoListed.length && ranking?.resolved !== true) {
    result.territory = {
      ...(result.territory || {}),
      confirmed: false,
      confidence: 'low',
      basis: ranking?.note || `Mapped service territories overlap here: ${alsoListed.join(', ')} also ${alsoListed.length === 1 ? 'has' : 'have'} territory at this parcel. Confirm the serving utility with each.`
    };
  }
  return result;
}

const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';
// A source that did not answer (a parcel outside Avista's layer is an answer, not a failure).
const failed = source => Boolean(source) && source.available === false && ['timed_out', 'source_unavailable'].includes(source.status);

// The answer for one request body, from the sources, and `timing` (diagnostics, sent as a
// Server-Timing header, not in the body): milliseconds each source took, and the route's total.
async function buildAnswer(body, { budgetMs, overpassCapMs, ctx }) {
  const listed = Array.isArray(body.providers) ? body.providers : [body.provider].filter(Boolean);
  // Wholesale federal marketers (BPA, WAPA) are never the serving utility; the validator sends
  // the raw list, where BPA could come first.
  const providers = [...new Set(listed.map(name => String(name ?? '').trim()).filter(name => name && !WHOLESALE_POWER.test(name)))];
  const provider = providers[0] || '';
  const alsoListed = providers.slice(1);
  const ranking = body.providerRanking || null;

  const started = Date.now();
  const controller = new AbortController();
  const osmMs = Math.min(budgetMs, overpassCapMs);
  const point = { lat: body.lat, lon: body.lon };
  const geometry = body.geometry || null;
  const sourceMs = {};
  const timed = (name, promise) => promise.then(value => { if (value) sourceMs[name] = Date.now() - started; return value; });
  const sourceTimeoutMs = Math.min(SOURCE_TIMEOUT_MS, budgetMs);
  const notInTime = () => ({ available: false, status: 'timed_out' });

  // Sources, in parallel. Overpass (OpenStreetMap) only gets osmMs: it has not answered Cloudflare
  // since 2026-11 (the browser fallback asks it instead), so it never holds the answer.
  const proximityTask = timed('osm', withDeadline(
    getOsmPowerProximity({ provider, ...point, geometry, deadline: started + osmMs, signal: controller.signal, ctx }),
    osmMs + 250, () => timedOutProximity(osmMs)));
  const avistaLineTask = isAvistaProvider(provider)
    ? timed('avistaLine', withDeadline(nearestAvistaLine({ ...point, geometry, timeoutMs: sourceTimeoutMs, signal: controller.signal }), budgetMs, notInTime))
    : Promise.resolve(null);
  const publishedSource = publishedLineSource(provider);
  const publishedTask = publishedSource
    ? timed('published', withDeadline(nearestPublishedLine(publishedSource, { ...point, geometry, timeoutMs: sourceTimeoutMs, signal: controller.signal }), budgetMs, notInTime))
    : Promise.resolve(null);
  const transmissionTask = timed('transmission', withDeadline(nearestTransmissionLine({ ...point, geometry, timeoutMs: sourceTimeoutMs, signal: controller.signal }), budgetMs, notInTime));
  const [proximity, avistaLine, published, transmission] = await Promise.all([proximityTask, avistaLineTask, publishedTask, transmissionTask]);
  controller.abort();
  const lines = { proximity, transmission, body };
  const timing = { totalMs: Date.now() - started, overpassCapMs: osmMs, sources: sourceMs };
  // Cacheable: every source other than OpenStreetMap answered.
  const complete = !failed(avistaLine) && !failed(published) && !failed(transmission);
  const finish = result => ({ result, timing, complete, osmAnswered: Boolean(proximity?.available) });

  if (!provider) {
    return finish(addLineFields({
      available: Boolean(proximity.available),
      status: 'provider_unknown',
      provider: '',
      proximity,
      distribution: unknownProviderDistribution(proximity),
      verification: {
        required: true,
        recommendation: 'Confirm the serving electric utility and parcel-level service availability before purchase.'
      }
    }, lines));
  }

  if (isAvistaProvider(provider)) {
    const result = await getAvistaPowerIntelligence({
      provider,
      lat: body.lat,
      lon: body.lon,
      parcelId: body.parcelId,
      address: body.address,
      publishedLine: avistaLine,
      state: body.state
    });

    result.proximity = proximity;
    result.distribution = avistaDistribution(result.distribution, proximity);
    return finish(applyOverlap(addLineFields(result, lines), alsoListed, ranking));
  }

  if (isInlandPowerProvider(provider)) {
    const result = getInlandPowerIntelligence({
      provider,
      parcelId: body.parcelId,
      address: body.address
    });
    result.proximity = proximity;
    result.distribution = inlandDistribution(proximity);
    return finish(applyOverlap(addLineFields(result, lines), alsoListed, ranking));
  }

  return finish(applyOverlap(addLineFields({
    available: true,
    adapter: 'generic-v2-osm',
    provider,
    territory: {
      confirmed: true,
      confidence: 'moderate',
      basis: serviceTerritoryBasis(body.state)
    },
    proximity,
    distribution: publishedOrOsmDistribution(published, proximity, `A dedicated ${provider} utility infrastructure adapter has not been built yet.`),
    costEstimate: {
      available: false,
      status: 'screening_only',
      note: 'OSM proximity can improve screening, but utility extension pricing is withheld until the service point and required infrastructure are verified.'
    },
    verification: {
      required: true,
      recommendation: `Contact ${provider} for parcel-level service availability, transformer capacity, and extension pricing.`
    }
  }, lines), alsoListed, ranking));
}

// What the answer depends on (the cache key; numbers rounded by src/shared/edge-cache.js).
function answerKey(body) {
  return {
    state: String(body.state || ''), parcelId: String(body.parcelId || ''), address: String(body.address || ''),
    provider: String(body.provider || ''), providers: Array.isArray(body.providers) ? body.providers.map(String) : [],
    providerRanking: body.providerRanking && typeof body.providerRanking === 'object'
      ? { basis: String(body.providerRanking.basis || ''), resolved: body.providerRanking.resolved === true, note: String(body.providerRanking.note || '') }
      : null,
    lat: Number(body.lat), lon: Number(body.lon), geometry: body.geometry || null
  };
}

export async function handlePowerIntelligence(request, { budgetMs = POWER_BUDGET_MS, overpassCapMs = OVERPASS_SERVER_CAP_MS, ctx } = {}) {
  const body = await request.json();
  const slot = await openValueCache(POWER_ANSWER_CACHE_PREFIX, answerKey(body || {}));
  const hit = await readCachedJson(slot);
  if (hit && typeof hit === 'object' && hit.answer) {
    return withServerTiming(json({ ...hit.answer, answerCache: { hit: true, storedAt: String(hit.storedAt || '') } }, 200, CACHE_CONTROL), { cache: 'hit' });
  }
  const { result, timing, complete, osmAnswered } = await buildAnswer(body || {}, { budgetMs, overpassCapMs, ctx });
  if (complete) {
    await writeCachedJson(slot, { answer: result, storedAt: new Date().toISOString() }, osmAnswered ? POWER_ANSWER_TTL_SECONDS : POWER_ANSWER_PARTIAL_TTL_SECONDS, ctx);
  }
  return withServerTiming(json(result, 200, CACHE_CONTROL), timing);
}

// Server-Timing: "osm;dur=2501, transmission;dur=640, total;dur=2510" (or "cache;desc=hit").
export function withServerTiming(response, timing) {
  try {
    const parts = timing?.cache
      ? [`cache;desc=${timing.cache}`]
      : [...Object.entries(timing?.sources || {}).map(([name, ms]) => `${name};dur=${Math.round(ms)}`), `total;dur=${Math.round(timing?.totalMs || 0)}`];
    response.headers.set('Server-Timing', parts.join(', '));
  } catch { /* headers may be immutable; diagnostics only */ }
  return response;
}
