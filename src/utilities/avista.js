const AVISTA_PUBLIC_MAP_URL = 'https://www.arcgis.com/home/item.html?id=955db80ba1124479a906c0a6edefe1cc';

export function isAvistaProvider(provider = '') {
  return /\bavista\b/i.test(String(provider));
}

// Distance to Avista's own published distribution line sections (avista-distribution.js
// nearestAvistaLine(), measured to the parcel edge). Screening only: a line section is not a
// service point and says nothing about capacity.
function publishedLineDistribution(line) {
  if (line?.available && Number.isFinite(line.nearestFt)) {
    return {
      status: 'utility_published_proximity',
      estimatedDistanceFt: line.nearestFt,
      confidence: line.nearestFt <= 1320 ? 'moderate' : 'low',
      infrastructure: 'utility_distribution_line',
      source: line.source,
      sourceUrl: line.sourceUrl,
      note: `Avista's published distribution map shows a line section about ${line.nearestFt.toLocaleString('en-US')} ft from the parcel. It is not a service point; Avista confirms the route, capacity and cost.`
    };
  }
  if (line?.available) {
    return {
      status: 'no_published_line_nearby',
      estimatedDistanceFt: null,
      confidence: 'low',
      source: line.source,
      sourceUrl: line.sourceUrl,
      note: `Avista's published distribution map shows no line within ${Number(line.searchedFt || 0).toLocaleString('en-US')} ft of the parcel. Distance not verified.`
    };
  }
  return {
    status: 'not_publicly_mapped',
    estimatedDistanceFt: null,
    confidence: 'low',
    note: "Distance not verified: Avista's published distribution map did not answer. AcresX will not invent a line-distance estimate."
  };
}

// The territory label names the parcel's state. Avista serves Washington and Idaho; with no
// state given the label stays state-neutral rather than assuming Washington.
const STATE_NAMES = { WA: 'Washington', ID: 'Idaho', MT: 'Montana' };
export function serviceTerritoryBasis(state) {
  const name = STATE_NAMES[String(state || '').trim().toUpperCase()];
  return name ? `${name} electric utility service-territory screening` : 'Electric utility service-territory screening';
}

export async function getAvistaPowerIntelligence({ provider, lat, lon, parcelId, address, publishedLine = null, state = '' } = {}) {
  const hasPoint = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));

  return {
    available: true,
    adapter: 'avista-v1',
    provider: provider || 'Avista Utilities',
    territory: {
      confirmed: true,
      confidence: 'high',
      basis: serviceTerritoryBasis(state)
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
    distribution: publishedLineDistribution(publishedLine),
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
