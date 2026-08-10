import { fetchWithTimeout } from '../shared/http.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

function toRadians(value) {
  return value * Math.PI / 180;
}

function distanceFeet(a, b) {
  const earthRadiusFt = 20902231;
  const p1 = toRadians(a.lat);
  const p2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusFt * Math.asin(Math.min(1, Math.sqrt(h)));
}

function geometryPoints(geometry) {
  const points = [];
  const walk = value => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push({ lon: Number(value[0]), lat: Number(value[1]) });
      return;
    }
    value.forEach(walk);
  };
  walk(geometry?.coordinates);
  return points.filter(p => Number.isFinite(p.lon) && Number.isFinite(p.lat));
}

function minDistanceToParcel(point, geometry, center) {
  const boundaryPoints = geometryPoints(geometry);
  const candidates = boundaryPoints.length ? boundaryPoints : [center];
  return Math.min(...candidates.map(p => distanceFeet(point, p)));
}

function featureType(element) {
  const tags = element.tags || {};
  if (tags.power === 'pole') return 'pole';
  if (tags.power === 'minor_line') return 'minor_line';
  if (tags.power === 'cable') return 'cable';
  if (tags.power === 'transformer') return 'transformer';
  return tags.power || 'power_feature';
}

function infrastructureClass(element) {
  const tags = element.tags || {};
  if (tags.power === 'pole' || tags.power === 'minor_line') return 'overhead_distribution';
  if (tags.power === 'cable' && String(tags.location || '').toLowerCase().includes('underground')) return 'underground_distribution';
  if (tags.power === 'cable') return 'distribution_cable';
  if (tags.power === 'transformer') return 'transformer';
  return 'unknown';
}

function elementPoints(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) return [{ lat: element.lat, lon: element.lon }];
  if (Array.isArray(element.geometry)) {
    return element.geometry
      .map(p => ({ lat: Number(p.lat), lon: Number(p.lon) }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }
  if (element.center && Number.isFinite(element.center.lat) && Number.isFinite(element.center.lon)) {
    return [{ lat: element.center.lat, lon: element.center.lon }];
  }
  return [];
}

async function overpassQuery(query) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`,
        cf: { cacheTtl: 86400, cacheEverything: true }
      }, 18000);
      if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('OpenStreetMap power query failed.');
}

function confidenceFor({ nearest, poles, lines, transformers, providerKnown }) {
  let score = providerKnown ? 10 : 0;
  if (nearest && nearest.distanceFt <= 300) score += 40;
  else if (nearest && nearest.distanceFt <= 800) score += 30;
  else if (nearest && nearest.distanceFt <= 1500) score += 20;
  else if (nearest) score += 10;
  if (poles >= 2) score += 20;
  else if (poles === 1) score += 10;
  if (lines >= 1) score += 20;
  if (transformers >= 1) score += 10;

  const confidence = score >= 70 ? 'high' : score >= 40 ? 'moderate' : 'low';
  return { score: Math.min(score, 100), confidence };
}

export async function getOsmPowerProximity({ lat, lon, geometry, provider }) {
  const center = { lat: Number(lat), lon: Number(lon) };
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon)) {
    return { available: false, status: 'invalid_location', confidence: 'low' };
  }

  const radiusM = 5000;
  const query = `[out:json][timeout:15];(node["power"="pole"](around:${radiusM},${center.lat},${center.lon});node["power"="transformer"](around:${radiusM},${center.lat},${center.lon});way["power"="minor_line"](around:${radiusM},${center.lat},${center.lon});way["power"="cable"](around:${radiusM},${center.lat},${center.lon}););out tags geom center;`;

  try {
    const data = await overpassQuery(query);
    const features = (data.elements || []).map(element => {
      const points = elementPoints(element);
      if (!points.length) return null;
      const distanceFt = Math.min(...points.map(point => minDistanceToParcel(point, geometry, center)));
      return {
        osmType: element.type,
        osmId: element.id,
        type: featureType(element),
        infrastructureClass: infrastructureClass(element),
        distanceFt,
        operator: element.tags?.operator || '',
        voltage: element.tags?.voltage || '',
        location: element.tags?.location || '',
        source: 'OpenStreetMap'
      };
    }).filter(Boolean).sort((a, b) => a.distanceFt - b.distanceFt);

    const distributionFeatures = features.filter(f => ['pole','minor_line','cable','transformer'].includes(f.type));
    const nearest = distributionFeatures[0] || null;
    const poles = distributionFeatures.filter(f => f.type === 'pole').length;
    const lines = distributionFeatures.filter(f => f.type === 'minor_line' || f.type === 'cable').length;
    const transformers = distributionFeatures.filter(f => f.type === 'transformer').length;
    const confidence = confidenceFor({ nearest, poles, lines, transformers, providerKnown: Boolean(provider) });

    let status = 'no_mapped_distribution_found';
    let infrastructure = 'unknown';
    if (nearest) {
      status = 'mapped_distribution_found';
      infrastructure = nearest.infrastructureClass;
    }

    return {
      available: true,
      adapter: 'osm-power-v1',
      status,
      provider: provider || '',
      searchRadiusFt: Math.round(radiusM * 3.28084),
      nearest,
      estimatedDistanceFt: nearest ? Math.round(nearest.distanceFt) : null,
      infrastructure,
      confidence: confidence.confidence,
      confidenceScore: confidence.score,
      evidence: {
        mappedPoles: poles,
        mappedDistributionLines: lines,
        mappedTransformers: transformers,
        mappedFeatures: distributionFeatures.length
      },
      nearby: distributionFeatures.slice(0, 8),
      source: 'OpenStreetMap / Overpass API',
      sourceUrl: 'https://www.openstreetmap.org',
      note: nearest
        ? 'Distance is measured to nearby OpenStreetMap-mapped power infrastructure. OSM coverage is incomplete and is not utility-verified.'
        : 'No nearby distribution infrastructure was mapped in OpenStreetMap within the search radius. This does not mean power is unavailable.'
    };
  } catch (error) {
    return {
      available: false,
      adapter: 'osm-power-v1',
      status: 'source_unavailable',
      confidence: 'low',
      error: error?.message || 'OpenStreetMap power proximity unavailable.'
    };
  }
}
