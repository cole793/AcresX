import { getAvistaPowerIntelligence, isAvistaProvider } from '../utilities/avista.js';
import { getOsmPowerProximity } from '../utilities/osm-power.js';
import { json } from '../shared/http.js';

export async function handlePowerIntelligence(request) {
  const body = await request.json();
  const providers = Array.isArray(body.providers) ? body.providers : [body.provider].filter(Boolean);
  const provider = String(providers[0] || '').trim();

  const proximity = await getOsmPowerProximity({
    provider,
    lat: body.lat,
    lon: body.lon,
    geometry: body.geometry || null
  });

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
      address: body.address
    });

    result.proximity = proximity;
    if (proximity.available && Number.isFinite(proximity.estimatedDistanceFt)) {
      result.distribution = {
        status: 'osm_mapped_proximity',
        estimatedDistanceFt: proximity.estimatedDistanceFt,
        confidence: proximity.confidence,
        infrastructure: proximity.infrastructure,
        note: proximity.note
      };
    }
    return json(result, 200, 'public, max-age=3600, s-maxage=86400');
  }

  return json({
    available: true,
    adapter: 'generic-v2-osm',
    provider,
    territory: {
      confirmed: true,
      confidence: 'moderate',
      basis: 'Washington electric utility service-territory screening'
    },
    proximity,
    distribution: {
      status: proximity.available && Number.isFinite(proximity.estimatedDistanceFt) ? 'osm_mapped_proximity' : 'no_verified_distance',
      estimatedDistanceFt: proximity.estimatedDistanceFt ?? null,
      confidence: proximity.confidence || 'low',
      infrastructure: proximity.infrastructure || 'unknown',
      note: proximity.note || `A dedicated ${provider} utility infrastructure adapter has not been built yet.`
    },
    costEstimate: {
      available: false,
      status: 'screening_only',
      note: 'OSM proximity can improve screening, but utility extension pricing is withheld until the service point and required infrastructure are verified.'
    },
    verification: {
      required: true,
      recommendation: `Contact ${provider} for parcel-level service availability, transformer capacity, and extension pricing.`
    }
  }, 200, 'public, max-age=3600, s-maxage=86400');
}
