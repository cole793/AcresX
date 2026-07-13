const FEMA_URL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const NWI_URL = 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query';

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300, s-maxage=86400',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

function geoJsonToEsriPolygon(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error('A parcel Polygon or MultiPolygon is required.');
  }
  const rings = geometry.type === 'Polygon'
    ? geometry.coordinates
    : geometry.coordinates.flat();
  return { rings, spatialReference: { wkid: 4326 } };
}

async function queryArcGIS(url, geometry, outFields) {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: JSON.stringify(geoJsonToEsriPolygon(geometry)),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'false',
    resultRecordCount: '100',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(`${url}?${params.toString()}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AcresX/0.4.3' },
    });
    if (!r.ok) throw new Error(`Upstream service returned ${r.status}`);
    const data = await r.json();
    if (data.error) throw new Error(data.error.message || 'ArcGIS query failed');
    return data.features || [];
  } finally {
    clearTimeout(timeout);
  }
}

function getField(attributes, suffix) {
  const key = Object.keys(attributes || {}).find(k => k === suffix || k.endsWith(`.${suffix}`));
  return key ? attributes[key] : undefined;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, { ok: true });
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
  try {
    const { kind, geometry } = JSON.parse(event.body || '{}');
    if (kind === 'flood') {
      const features = await queryArcGIS(FEMA_URL, geometry, 'FLD_ZONE,ZONE_SUBTY,SFHA_TF');
      const rows = features.map(f => f.attributes || {});
      const zones = [...new Set(rows.map(r => getField(r, 'FLD_ZONE')).filter(Boolean))];
      const high = rows.some(r => {
        const sfha = String(getField(r, 'SFHA_TF') || '').toUpperCase();
        const zone = String(getField(r, 'FLD_ZONE') || '').toUpperCase();
        return sfha === 'T' || /^(A|V)/.test(zone);
      });
      return response(200, { available: true, intersects: rows.length > 0, high, zones });
    }
    if (kind === 'wetlands') {
      const features = await queryArcGIS(NWI_URL, geometry, '*');
      const rows = features.map(f => f.attributes || {});
      const types = [...new Set(rows.map(r => getField(r, 'WETLAND_TYPE') || getField(r, 'ATTRIBUTE')).filter(Boolean))];
      return response(200, { available: true, intersects: rows.length > 0, count: rows.length, types });
    }
    return response(400, { error: 'Unknown hazard type.' });
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Hazard service timed out' : error.message;
    return response(502, { error: message });
  }
};
