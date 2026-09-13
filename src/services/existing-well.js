import { fetchWithTimeout, json } from '../shared/http.js';

const SPOKANE_ASSESSOR = 'https://gismo.spokanecounty.org/arcgis/rest/services/Assessor/SCOUTSimple/MapServer/0/query';
const ECOLOGY_WELLS = 'https://services.arcgis.com/6lCKYNJLvwTXqrmp/ArcGIS/rest/services/WR/FeatureServer/9/query';

function normParcel(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normName(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|CO|TRUST|TRUSTEE|ET AL|ESTATE)\b/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value) {
  return normName(value).split(' ').filter(token => token.length > 1);
}

function nameSimilarity(a, b) {
  const aa = nameTokens(a);
  const bb = nameTokens(b);
  if (!aa.length || !bb.length) return 0;
  const setA = new Set(aa);
  const setB = new Set(bb);
  const shared = [...setA].filter(token => setB.has(token)).length;
  const union = new Set([...aa, ...bb]).size;
  const jaccard = union ? shared / union : 0;
  const surnameBoost = aa[0] && bb.includes(aa[0]) ? 0.15 : 0;
  return Math.min(1, jaccard + surnameBoost);
}

function normAddress(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\b(STREET|ST)\b/g, 'ST')
    .replace(/\b(ROAD|RD)\b/g, 'RD')
    .replace(/\b(AVENUE|AVE)\b/g, 'AVE')
    .replace(/\b(DRIVE|DR)\b/g, 'DR')
    .replace(/\b(LANE|LN)\b/g, 'LN')
    .replace(/\b(HIGHWAY|HWY)\b/g, 'HWY')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point, geometry) {
  if (!geometry?.coordinates) return false;
  if (geometry.type === 'Polygon') return pointInRing(point, geometry.coordinates[0] || []);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(poly => pointInRing(point, poly[0] || []));
  return false;
}

function bounds(geometry) {
  const pts = [];
  const walk = value => Array.isArray(value?.[0]) ? value.forEach(walk) : pts.push(value);
  walk(geometry?.coordinates || []);
  const xs = pts.map(p => Number(p[0])).filter(Number.isFinite);
  const ys = pts.map(p => Number(p[1])).filter(Number.isFinite);
  if (!xs.length || !ys.length) throw new Error('Parcel geometry is required.');
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

async function queryAssessor(parcelId) {
  const raw = String(parcelId || '').trim().replaceAll("'", "''");
  const normalized = normParcel(parcelId);
  const url = new URL(SPOKANE_ASSESSOR);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', `PID_NUM='${raw}'`);
  url.searchParams.set('outFields', 'PID_NUM,owner_name,taxpayer_name,site_address,site_city,site_state,site_zip');
  url.searchParams.set('returnGeometry', 'false');
  let response = await fetchWithTimeout(url, { cf: { cacheTtl: 3600, cacheEverything: true } }, 15000);
  let data = await response.json();
  let features = data.features || [];

  if (!features.length && normalized) {
    const fallback = new URL(SPOKANE_ASSESSOR);
    fallback.searchParams.set('f', 'json');
    fallback.searchParams.set('where', `PID_NUM LIKE '%${normalized.replaceAll("'", "''")}%'`);
    fallback.searchParams.set('outFields', 'PID_NUM,owner_name,taxpayer_name,site_address,site_city,site_state,site_zip');
    fallback.searchParams.set('returnGeometry', 'false');
    response = await fetchWithTimeout(fallback, { cf: { cacheTtl: 3600, cacheEverything: true } }, 15000);
    data = await response.json();
    features = (data.features || []).filter(f => normParcel(f.attributes?.PID_NUM) === normalized);
  }

  const attrs = features[0]?.attributes || {};
  return {
    parcelId: attrs.PID_NUM || parcelId || '',
    ownerName: attrs.owner_name || attrs.taxpayer_name || '',
    taxpayerName: attrs.taxpayer_name || '',
    siteAddress: [attrs.site_address, attrs.site_city, attrs.site_state, attrs.site_zip].filter(Boolean).join(', ')
  };
}

async function queryNearbyWells(geometry) {
  const b = bounds(geometry);
  const latMid = (b.minY + b.maxY) / 2;
  const padLat = 0.004;
  const padLon = 0.004 / Math.max(0.35, Math.cos(latMid * Math.PI / 180));
  const envelope = {
    xmin: b.minX - padLon,
    ymin: b.minY - padLat,
    xmax: b.maxX + padLon,
    ymax: b.maxY + padLat,
    spatialReference: { wkid: 4326 }
  };
  const url = new URL(ECOLOGY_WELLS);
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('where', "WellProjectType <> 'Decommission'");
  url.searchParams.set('geometry', JSON.stringify(envelope));
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outFields', 'ID,WellTagNr,ProjectName,OwnerName,WellAddress,ParcelNumber,CompletedDepth,WorkCompletionDate,WellProjectType,WellSubType,DrillerLicenseNumber,FlowRateGPM');
  url.searchParams.set('resultRecordCount', '500');
  const response = await fetchWithTimeout(url, { cf: { cacheTtl: 3600, cacheEverything: true } }, 20000);
  if (!response.ok) throw new Error(`Washington Ecology well service returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Washington Ecology well lookup failed');
  return data.features || [];
}

function scoreWell(well, assessor, parcelId, geometry) {
  const p = well.properties || {};
  const coords = well.geometry?.coordinates || [];
  const insideParcel = Number.isFinite(Number(coords[0])) && Number.isFinite(Number(coords[1]))
    ? pointInGeometry([Number(coords[0]), Number(coords[1])], geometry)
    : false;
  const parcelMatch = Boolean(p.ParcelNumber && normParcel(p.ParcelNumber) === normParcel(parcelId));
  const ownerScore = nameSimilarity(assessor.ownerName, p.OwnerName);
  const ownerMatch = ownerScore >= 0.55;
  const partialOwnerMatch = ownerScore >= 0.34;
  const site = normAddress(assessor.siteAddress);
  const wellAddress = normAddress(p.WellAddress);
  const addressMatch = Boolean(site && wellAddress && (site.includes(wellAddress) || wellAddress.includes(site)));

  let score = 0;
  if (parcelMatch) score += 70;
  if (insideParcel) score += 55;
  if (ownerMatch) score += 35;
  else if (partialOwnerMatch) score += 18;
  if (addressMatch) score += 20;
  score = Math.min(score, 100);

  return {
    id: p.ID || null,
    wellTag: p.WellTagNr || '',
    projectName: p.ProjectName || '',
    ownerName: p.OwnerName || '',
    wellAddress: p.WellAddress || '',
    parcelNumber: p.ParcelNumber || '',
    completedDepth: p.CompletedDepth || null,
    completionDate: p.WorkCompletionDate || null,
    wellType: p.WellSubType || p.WellProjectType || '',
    drillerLicenseNumber: p.DrillerLicenseNumber || '',
    flowRateGPM: p.FlowRateGPM ?? null,
    latitude: Number(coords[1]) || null,
    longitude: Number(coords[0]) || null,
    evidence: { parcelMatch, insideParcel, ownerMatch, partialOwnerMatch, addressMatch, ownerSimilarity: Math.round(ownerScore * 100) },
    score
  };
}

function classification(score) {
  if (score >= 85) return { status: 'strong_match', label: 'Likely existing well', confidence: 'High' };
  if (score >= 60) return { status: 'likely_match', label: 'Possible existing well', confidence: 'Moderate' };
  if (score >= 35) return { status: 'possible_match', label: 'Possible well association', confidence: 'Low' };
  return { status: 'no_match', label: 'No existing well match found', confidence: 'Low' };
}

export async function handleExistingWell(request) {
  const body = await request.json();
  const state = String(body.state || 'WA').toUpperCase();
  const county = String(body.county || '').replace(/\s+County$/i, '').trim();
  if (state !== 'WA' || !/^spokane$/i.test(county)) {
    return json({ available: false, status: 'not_supported', label: 'Existing-well matching is not configured for this county yet.' }, 200, 'no-store');
  }
  if (!body.parcelId || !body.geometry) return json({ error: 'parcelId and geometry are required.' }, 400, 'no-store');

  const [assessor, wells] = await Promise.all([
    queryAssessor(body.parcelId),
    queryNearbyWells(body.geometry)
  ]);

  const candidates = wells
    .map(well => scoreWell(well, assessor, body.parcelId, body.geometry))
    .sort((a, b) => b.score - a.score);
  const best = candidates[0] || null;
  const result = classification(best?.score || 0);

  return json({
    available: true,
    county: 'Spokane',
    state: 'WA',
    parcelId: assessor.parcelId || body.parcelId,
    currentOwner: assessor.ownerName || '',
    siteAddress: assessor.siteAddress || body.address || '',
    ...result,
    score: best?.score || 0,
    match: best && best.score >= 35 ? best : null,
    candidateCount: candidates.length,
    methodology: 'Matches Washington Ecology well records to the current Spokane County assessor parcel using parcel number, mapped location, owner name, and site address.',
    caution: 'Well records are historical and mapped locations can be approximate. A match is screening evidence, not proof that a well is currently usable or legally serving the parcel.',
    sources: {
      assessor: 'Spokane County Assessor SCOUT',
      wells: 'Washington Department of Ecology Well Reports'
    }
  }, 200, 'public, max-age=900, s-maxage=3600');
}
