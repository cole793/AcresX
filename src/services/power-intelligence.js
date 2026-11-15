import { getAvistaPowerIntelligence, isAvistaProvider, serviceTerritoryBasis } from '../utilities/avista.js';
import { getInlandPowerIntelligence, isInlandPowerProvider } from '../utilities/inland-power.js';
import { getOsmPowerProximity } from '../utilities/osm-power.js';
import { nearestAvistaLine } from '../utilities/avista-distribution.js';
import { nearestTransmissionLine } from '../utilities/hifld-transmission.js';
import { publishedLineSource, nearestPublishedLine } from '../utilities/published-lines.js';
import { FALLBACK_KINDS, fallbackHint, hintGeometry } from '../shared/fallback.js';
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
    browserFallback: true,
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
    ...(mapped ? { lineType: 'distribution', source: 'OpenStreetMap', sourceLabel: 'OSM' } : {}),
    note: mapped ? proximity.note : (proximity.note || fallbackNote)
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
      note: `${published.utility}'s published grid map shows a distribution line about ${ft.toLocaleString('en-US')} ft from the parcel. It is not a service point; ${published.utility} confirms the route, capacity and cost.`
    };
  }
  return osmDistribution(proximity, fallbackNote);
}

// The one line the power card names (additive field `nearestLine`): the nearest DISTRIBUTION line
// when one is mapped (that is the only distance the cost model uses), else the nearest other
// mapped line (OSM power=line without a voltage, or a transmission line from OSM or HIFLD).
// A mapped line is never a service connection; the utility confirms the route.
export function chooseNearestLine(distribution, proximity, transmission) {
  if (Number.isFinite(distribution?.estimatedDistanceFt)) {
    const utility = distribution.status === 'utility_published_proximity';
    return {
      distanceFt: distribution.estimatedDistanceFt,
      lineType: 'distribution',
      infrastructure: distribution.infrastructure || 'unknown',
      source: distribution.source || (utility ? 'Utility-published line map' : 'OpenStreetMap'),
      sourceLabel: distribution.sourceLabel || (utility ? 'utility map' : 'OSM'),
      sourceUrl: distribution.sourceUrl || (utility ? '' : 'https://www.openstreetmap.org'),
      confidence: distribution.confidence || 'low',
      note: 'Straight-line distance to the nearest mapped distribution line, not a service connection. The utility confirms the route, capacity and cost.'
    };
  }
  const candidates = [];
  const other = proximity?.available ? proximity.nearestOtherLine : null;
  if (other && Number.isFinite(other.distanceFt)) {
    candidates.push({ distanceFt: other.distanceFt, lineType: other.lineType === 'transmission' ? 'transmission' : 'unknown', infrastructure: other.infrastructureClass || 'unknown', source: 'OpenStreetMap', sourceLabel: 'OSM', sourceUrl: 'https://www.openstreetmap.org', voltage: other.voltage || '' });
  }
  if (transmission?.available && Number.isFinite(transmission.distanceFt)) {
    candidates.push({ distanceFt: transmission.distanceFt, lineType: 'transmission', infrastructure: 'transmission_line', source: transmission.source, sourceLabel: 'HIFLD', sourceUrl: transmission.sourceUrl, voltage: transmission.voltageKv ? `${transmission.voltageKv} kV` : '' });
  }
  if (!candidates.length) return null;
  const best = candidates.sort((a, b) => a.distanceFt - b.distanceFt)[0];
  return {
    ...best,
    confidence: 'low',
    note: best.lineType === 'transmission'
      ? 'Nearest mapped line is a high-voltage transmission line, which does not serve homes directly; no distribution line was mapped nearby. The utility confirms the route and cost.'
      : 'Nearest mapped power line; its voltage is not mapped, so it may be a distribution or a transmission line. The utility confirms the route and cost.'
  };
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
  const publishedSource = publishedLineSource(provider);
  const publishedTask = publishedSource
    ? withDeadline(nearestPublishedLine(publishedSource, { ...point, geometry: body.geometry || null, timeoutMs: Math.min(4000, budgetMs), signal: controller.signal }),
      budgetMs, () => ({ available: false, status: 'timed_out' }))
    : Promise.resolve(null);
  const transmissionTask = withDeadline(nearestTransmissionLine({ ...point, geometry: body.geometry || null, timeoutMs: Math.min(4000, budgetMs), signal: controller.signal }),
    budgetMs, () => ({ available: false, status: 'timed_out' }));
  const [proximity, avistaLine, published, transmission] = await Promise.all([proximityTask, avistaLineTask, publishedTask, transmissionTask]);
  controller.abort();
  const lines = { proximity, transmission, body };

  if (!provider) {
    return json(addLineFields({
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
    }, lines), 200, 'public, max-age=3600, s-maxage=86400');
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
        lineType: 'distribution',
        source: 'OpenStreetMap',
        sourceLabel: 'OSM',
        note: proximity.note
      };
    } else if (result.distribution?.status === 'utility_published_proximity') {
      result.distribution.lineType = 'distribution';
      result.distribution.sourceLabel = 'Avista map';
    }
    return json(applyOverlap(addLineFields(result, lines), alsoListed, ranking), 200, 'public, max-age=3600, s-maxage=86400');
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
    return json(applyOverlap(addLineFields(result, lines), alsoListed, ranking), 200, 'public, max-age=3600, s-maxage=86400');
  }

  return json(applyOverlap(addLineFields({
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
  }, lines), alsoListed, ranking), 200, 'public, max-age=3600, s-maxage=86400');
}
