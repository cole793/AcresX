import { getAvistaPowerIntelligence, isAvistaProvider } from '../utilities/avista.js';
import { json } from '../shared/http.js';

export async function handlePowerIntelligence(request) {
  const body = await request.json();
  const providers = Array.isArray(body.providers) ? body.providers : [body.provider].filter(Boolean);
  const provider = String(providers[0] || '').trim();

  if (!provider) {
    return json({
      available: false,
      status: 'provider_unknown',
      note: 'Electric utility territory was not identified for this parcel.'
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
    return json(result, 200, 'public, max-age=3600, s-maxage=86400');
  }

  return json({
    available: true,
    adapter: 'generic-v1',
    provider,
    territory: {
      confirmed: true,
      confidence: 'moderate',
      basis: 'Washington electric utility service-territory screening'
    },
    distribution: {
      status: 'adapter_not_built',
      estimatedDistanceFt: null,
      confidence: 'low',
      note: `A dedicated ${provider} infrastructure adapter has not been built yet.`
    },
    costEstimate: {
      available: false,
      status: 'pending_provider_adapter',
      note: 'Power-extension cost is withheld until AcresX has a credible distribution-distance source.'
    },
    verification: {
      required: true,
      recommendation: `Contact ${provider} for parcel-level service availability and extension pricing.`
    }
  }, 200, 'public, max-age=3600, s-maxage=86400');
}
