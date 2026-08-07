const AVISTA_PUBLIC_MAP_URL = 'https://www.arcgis.com/home/item.html?id=955db80ba1124479a906c0a6edefe1cc';

export function isAvistaProvider(provider = '') {
  return /\bavista\b/i.test(String(provider));
}

export async function getAvistaPowerIntelligence({ provider, lat, lon, parcelId, address } = {}) {
  const hasPoint = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));

  return {
    available: true,
    adapter: 'avista-v1',
    provider: provider || 'Avista Utilities',
    territory: {
      confirmed: true,
      confidence: 'high',
      basis: 'Washington electric utility service-territory screening'
    },
    publicInfrastructure: {
      available: true,
      mapUrl: AVISTA_PUBLIC_MAP_URL,
      source: 'Avista Geospatial Maps',
      scope: 'system planning / transmission and other public planning layers',
      locationAccuracy: 'approximate',
      note: 'Avista publishes public geospatial planning maps, but these should not be treated as a parcel-level residential service-point map.'
    },
    transmission: {
      status: 'public_map_available',
      distanceFt: null,
      usableForResidentialExtensionCost: false,
      note: 'Transmission infrastructure is not a residential service connection and is intentionally excluded from the development-cost estimate.'
    },
    distribution: {
      status: 'not_publicly_mapped',
      estimatedDistanceFt: null,
      confidence: 'low',
      note: 'A reliable public pole, transformer, or primary-distribution layer has not been identified yet. AcresX will not invent a line-distance estimate.'
    },
    costEstimate: {
      available: false,
      low: null,
      high: null,
      status: 'pending_distribution_distance',
      note: 'Power-extension cost will be calculated after a credible distribution-distance estimate or utility-provided service point is available.'
    },
    verification: {
      required: true,
      recommendation: 'Contact Avista with the parcel number and site address for service availability, required facilities, and an official extension estimate.'
    },
    parcel: {
      parcelId: parcelId || '',
      address: address || '',
      pointAvailable: hasPoint
    }
  };
}
