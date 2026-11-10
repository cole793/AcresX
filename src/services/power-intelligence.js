import { getAvistaPowerIntelligence, isAvistaProvider, serviceTerritoryBasis } from '../utilities/avista.js';
import { getInlandPowerIntelligence, isInlandPowerProvider } from '../utilities/inland-power.js';
import { getOsmPowerProximity } from '../utilities/osm-power.js';
import { nearestAvistaLine } from '../utilities/avista-distribution.js';
import { json } from '../shared/http.js';

// Time box for the whole route. The browser gives this follow-up 15 s
// (public/progressive-loading.js FOLLOWUP_TIMEOUT_MS) and the validator 30 s
// (scripts/validate-county.mjs DEFAULT_TIMEOUT_MS). Profile (2026-11-10): the only slow source was
// Overpass, asked one endpoint after the other at 18 s each (36 s worst case); the provider
// adapters are static. Now the sources run in parallel, each under this deadline, and a source
// that has not answered by then is reported as "distance not verified" instead of holding the
// answer. 9 s leaves room under the browser's 15 s for the request itself.
export const POWER_BUDGET_MS = 9000;

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
    error: `OpenStreetMap power data did not answer within ${Math.round(budgetMs / 1000)} s.`,
    note: 'Distance not verified: OpenStreetMap power data did not answer in time. This does not mean power is unavailable.'
  };
}

function osmDistribution(proximity, fallbackNote) {
  const mapped = proximity.available && Number.isFinite(proximity.estimatedDistanceFt);
  return {
    status: mapped ? 'osm_mapped_proximity' : 'no_verified_distance',
    estimatedDistanceFt: mapped ? proximity.estimatedDistanceFt : null,
    confidence: proximity.confidence || 'low',
    infrastructure: proximity.infrastructure || 'unknown',
    note: mapped ? proximity.note : (proximity.note || fallbackNote)
  };
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

export async function handlePowerIntelligence(request, { budgetMs = POWER_BUDGET_MS } = {}) {
  const body = await request.json();
  const listed = Array.isArray(body.providers) ? body.providers : [body.provider].filter(Boolean);
  // Wholesale federal marketers (BPA, WAPA) are never the serving utility; the validator sends
  // the raw list, where BPA could come first.
  const providers = [...new Set(listed.map(name => String(name ?? '').trim()).filter(name => name && !WHOLESALE_POWER.test(name)))];
  const provider = providers[0] || '';
  const alsoListed = providers.slice(1);
  const ranking = body.providerRanking || null;

  const started = Date.now();
  const controller = new AbortController();
  const deadline = started + budgetMs;
  const point = { lat: body.lat, lon: body.lon };

  // Sources, in parallel, each under the same deadline.
  const proximityTask = withDeadline(
    getOsmPowerProximity({ provider, ...point, geometry: body.geometry || null, deadline, signal: controller.signal }),
    budgetMs, () => timedOutProximity(budgetMs));
  const avistaLineTask = isAvistaProvider(provider)
    ? withDeadline(nearestAvistaLine({ ...point, geometry: body.geometry || null, timeoutMs: Math.min(4000, budgetMs), signal: controller.signal }),
      budgetMs, () => ({ available: false, status: 'timed_out' }))
    : Promise.resolve(null);
  const [proximity, avistaLine] = await Promise.all([proximityTask, avistaLineTask]);
  controller.abort();

  if (!provider) {
    return json({
      available: Boolean(proximity.available),
      status: 'provider_unknown',
      provider: '',
      proximity,
      distribution: {
        status: proximity.status || 'unknown',
        estimatedDistanceFt: proximity.estimatedDistanceFt ?? null,
        confidence: proximity.confidence || 'low',
        infrastructure: proximity.infrastructure || 'unknown',
        note: proximity.note || 'Electric utility territory was not identified for this parcel.'
      },
      verification: {
        required: true,
        recommendation: 'Confirm the serving electric utility and parcel-level service availability before purchase.'
      }
    }, 200, 'public, max-age=3600, s-maxage=86400');
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
    // Avista's own line map first; OpenStreetMap only when Avista's map gave no distance.
    if (!Number.isFinite(result.distribution?.estimatedDistanceFt) && proximity.available && Number.isFinite(proximity.estimatedDistanceFt)) {
      result.distribution = {
        status: 'osm_mapped_proximity',
        estimatedDistanceFt: proximity.estimatedDistanceFt,
        confidence: proximity.confidence,
        infrastructure: proximity.infrastructure,
        note: proximity.note
      };
    }
    return json(applyOverlap(result, alsoListed, ranking), 200, 'public, max-age=3600, s-maxage=86400');
  }

  if (isInlandPowerProvider(provider)) {
    const result = getInlandPowerIntelligence({
      provider,
      parcelId: body.parcelId,
      address: body.address
    });
    result.proximity = proximity;
    result.distribution = {
      ...osmDistribution(proximity, 'Distance not verified.'),
      note: 'Publicly mapped infrastructure proximity is not a verified Inland Power service connection or extension route.'
    };
    return json(applyOverlap(result, alsoListed, ranking), 200, 'public, max-age=3600, s-maxage=86400');
  }

  return json(applyOverlap({
    available: true,
    adapter: 'generic-v2-osm',
    provider,
    territory: {
      confirmed: true,
      confidence: 'moderate',
      basis: serviceTerritoryBasis(body.state)
    },
    proximity,
    distribution: osmDistribution(proximity, `A dedicated ${provider} utility infrastructure adapter has not been built yet.`),
    costEstimate: {
      available: false,
      status: 'screening_only',
      note: 'OSM proximity can improve screening, but utility extension pricing is withheld until the service point and required infrastructure are verified.'
    },
    verification: {
      required: true,
      recommendation: `Contact ${provider} for parcel-level service availability, transformer capacity, and extension pricing.`
    }
  }, alsoListed, ranking), 200, 'public, max-age=3600, s-maxage=86400');
}
