const FEMA_URLS = [
  'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query',
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query'
];
const NWI_URLS = [
  'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query'
];

const countyProfiles = {
  Spokane: {
    planningAgency: 'Spokane County Building & Planning',
    healthAgency: 'Spokane Regional Health District',
    planningUrl: 'https://www.spokanecounty.org/194/Building-Planning',
    zoningMapUrl: 'https://cp.spokanecounty.org/scout/scoutdashboard/',
    permitUrl: 'https://www.spokanecounty.org/194/Building-Planning',
    septicUrl: 'https://srhd.org/programs-and-services/environmental-health/onsite-sewage',
    roadAgency: 'Spokane County Public Works',
    catalogQuery: 'Spokane County zoning'
  }
};

const POWER_PATTERNS = [
  { re: /power\s+(?:is\s+)?(?:available|at|along|near|to)\s+(?:the\s+)?(?:road|property|lot|site)/i, label: 'Power nearby' },
  { re: /(?:electricity|electrical service|electric service)\s+(?:is\s+)?available/i, label: 'Electric service available' },
  { re: /power\s+(?:is\s+)?(?:on[- ]?site|on\s+(?:the\s+)?property|installed|connected)/i, label: 'Power onsite' },
  { re: /(?:meter|transformer)\s+(?:is\s+)?(?:installed|on[- ]?site|on\s+(?:the\s+)?property|nearby|at\s+(?:the\s+)?road)/i, label: 'Electrical equipment mentioned' },
  { re: /off[- ]?grid|no\s+(?:power|electricity)|power\s+not\s+available/i, label: 'Power limitation' },
  { re: /buyer\s+to\s+verify\s+(?:all\s+)?utilities|utilities\s+unknown/i, label: 'Utilities unverified' }
];

function json(body, status = 200, cache = 'public, max-age=300, s-maxage=86400') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache } });
}

function roundCoords(value) {
  if (Array.isArray(value)) return value.map(roundCoords);
  return typeof value === 'number' ? Number(value.toFixed(6)) : value;
}

function geoJsonToEsriPolygon(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) throw new Error('A parcel Polygon or MultiPolygon is required.');
  return {
    rings: roundCoords(geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()),
    spatialReference: { wkid: 4326 }
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function queryArcGIS(urls, geometry, outFields = '*') {
  const endpointList = Array.isArray(urls) ? urls : [urls];
  const form = new URLSearchParams({
    f: 'json', where: '1=1', geometry: JSON.stringify(geoJsonToEsriPolygon(geometry)),
    geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields, returnGeometry: 'false', resultRecordCount: '2000'
  });
  const errors = [];
  for (const url of endpointList) {
    try {
      const r = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'AcresX/0.5.2' },
        body: form.toString(),
        cf: { cacheTtl: 86400, cacheEverything: true }
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error.message || 'ArcGIS query failed');
      return data.features || [];
    } catch (error) {
      errors.push(`${new URL(url).hostname}: ${error?.name === 'AbortError' ? 'timeout' : error?.message || 'failed'}`);
    }
  }
  throw new Error(errors.join(' | ') || 'All GIS services failed');
}

function getField(attributes, suffix) {
  const key = Object.keys(attributes || {}).find(k => k === suffix || k.endsWith(`.${suffix}`));
  return key ? attributes[key] : undefined;
}

async function hazards(request) {
  const { kind, geometry } = await request.json();
  if (kind === 'flood') {
    const rows = (await queryArcGIS(FEMA_URLS, geometry, 'FLD_ZONE,ZONE_SUBTY,SFHA_TF')).map(f => f.attributes || {});
    const zones = [...new Set(rows.map(r => getField(r, 'FLD_ZONE')).filter(Boolean))];
    const high = rows.some(r => String(getField(r, 'SFHA_TF') || '').toUpperCase() === 'T' || /^(A|V)/.test(String(getField(r, 'FLD_ZONE') || '').toUpperCase()));
    return json({ available: true, intersects: rows.length > 0, high, zones });
  }
  if (kind === 'wetlands') {
    const rows = (await queryArcGIS(NWI_URLS, geometry, 'ATTRIBUTE,WETLAND_TYPE,ACRES')).map(f => f.attributes || {});
    const types = [...new Set(rows.map(r => getField(r, 'WETLAND_TYPE') || getField(r, 'ATTRIBUTE')).filter(Boolean))];
    return json({ available: true, intersects: rows.length > 0, count: rows.length, types });
  }
  return json({ error: 'Unknown hazard type.' }, 400);
}

function fallbackProfile(county) {
  const official = `https://www.google.com/search?q=${encodeURIComponent(`${county} County Washington official`)}`;
  return {
    planningAgency: `${county} County planning or community development`, healthAgency: `${county} County environmental health`,
    planningUrl: official,
    zoningMapUrl: `https://www.google.com/search?q=${encodeURIComponent(`${county} County Washington official zoning GIS`)}`,
    permitUrl: `https://www.google.com/search?q=${encodeURIComponent(`${county} County Washington official building permits`)}`,
    septicUrl: `https://www.google.com/search?q=${encodeURIComponent(`${county} County Washington official septic permit`)}`,
    roadAgency: `${county} County public works or roads department`, catalogQuery: `${county} County Washington zoning`
  };
}

function zoningValue(attrs) {
  const preferred = ['ZONING', 'ZONE', 'ZONE_CODE', 'ZONING_CODE', 'ZONINGCLASS', 'ZONING_CLASS', 'DESIGNATION', 'LANDUSE', 'LAND_USE'];
  for (const wanted of preferred) {
    const key = Object.keys(attrs || {}).find(k => k.toUpperCase().replace(/[^A-Z0-9_]/g, '') === wanted);
    if (key && attrs[key] != null && String(attrs[key]).trim()) return { code: String(attrs[key]).trim(), field: key };
  }
  const key = Object.keys(attrs || {}).find(k => /zon(e|ing)|designation/i.test(k) && attrs[k] != null && String(attrs[k]).trim());
  return key ? { code: String(attrs[key]).trim(), field: key } : null;
}

async function queryZoningCatalog(county, lat, lon, profile) {
  const queries = [
    `${county} County Washington zoning`,
    `${county} County WA zoning`,
    `${county} County land use zoning`
  ];
  const seen = new Set();
  const candidates = [];
  for (const term of queries) {
    const search = new URL('https://www.arcgis.com/sharing/rest/search');
    search.searchParams.set('f', 'json');
    search.searchParams.set('num', '50');
    search.searchParams.set('q', `${term} AND (type:"Feature Service" OR type:"Map Service")`);
    try {
      const sr = await fetchWithTimeout(search, { cf: { cacheTtl: 86400, cacheEverything: true } });
      if (!sr.ok) continue;
      const catalog = await sr.json();
      for (const item of catalog.results || []) {
        if (!item.url || seen.has(item.url)) continue;
        const haystack = `${item.title || ''} ${(item.tags || []).join(' ')} ${item.snippet || ''}`;
        if (!/zon(e|ing)|land.?use|development.?code|planning/i.test(haystack)) continue;
        seen.add(item.url); candidates.push(item);
      }
    } catch (_) {}
  }

  for (const item of candidates.slice(0, 20)) {
    if (!/^https:\/\//i.test(item.url || '')) continue;
    try {
      const metaResp = await fetchWithTimeout(`${item.url}?f=json`, { cf: { cacheTtl: 86400, cacheEverything: true } });
      if (!metaResp.ok) continue;
      const meta = await metaResp.json();
      let layers = [];
      if (Array.isArray(meta.layers) && meta.layers.length) {
        layers = meta.layers.filter(l => /zon(e|ing)|land.?use|designation|district/i.test(l.name || ''));
        if (!layers.length && meta.layers.length <= 8) layers = meta.layers;
      } else if (/\/(FeatureServer|MapServer)\/\d+$/i.test(item.url)) {
        layers = [{ id: null, name: item.title || 'Zoning' }];
      }
      for (const layer of layers.slice(0, 8)) {
        const base = layer.id == null ? item.url : `${item.url}/${layer.id}`;
        const q = new URL(`${base}/query`);
        q.searchParams.set('f', 'json'); q.searchParams.set('where', '1=1'); q.searchParams.set('geometry', `${lon},${lat}`);
        q.searchParams.set('geometryType', 'esriGeometryPoint'); q.searchParams.set('inSR', '4326');
        q.searchParams.set('spatialRel', 'esriSpatialRelIntersects'); q.searchParams.set('outFields', '*');
        q.searchParams.set('returnGeometry', 'false'); q.searchParams.set('resultRecordCount', '1');
        const qr = await fetchWithTimeout(q, { cf: { cacheTtl: 86400, cacheEverything: true } });
        if (!qr.ok) continue;
        const data = await qr.json();
        const attrs = data.features?.[0]?.attributes;
        const val = zoningValue(attrs);
        if (val) return { ...val, label: layer.name || item.title, sourceTitle: item.title, sourceUrl: base, itemId: item.id };
      }
    } catch (_) {}
  }
  return null;
}

function permitList(profile) {
  return [
    { name: 'Land-use / zoning verification', agency: profile.planningAgency, status: 'Verify', reason: 'Confirm allowed use, setbacks, minimum lot size and overlays before design.', url: profile.zoningMapUrl },
    { name: 'Building permit', agency: profile.planningAgency, status: 'Likely', reason: 'Normally required for a new residence, shop or other permitted structure.', url: profile.permitUrl },
    { name: 'On-site septic approval', agency: profile.healthAgency, status: 'Likely', reason: 'Needed when the parcel is not served by public sewer. Site and soil evaluation may be required.', url: profile.septicUrl },
    { name: 'Well notice / water review', agency: 'Washington Department of Ecology and local health authority', status: 'Possible', reason: 'Well construction, water availability and drinking-water requirements vary by project and location.', url: 'https://ecology.wa.gov/Water-Shorelines/Water-supply/Wells' },
    { name: 'Driveway / road approach permit', agency: profile.roadAgency, status: 'Possible', reason: 'Often required for a new or modified connection to a county or state road.', url: profile.planningUrl },
    { name: 'Critical-areas review', agency: profile.planningAgency, status: 'Possible', reason: 'Floodplain, wetlands, shorelines, steep slopes or habitat areas can trigger additional review.', url: profile.planningUrl }
  ];
}

async function zoningPermits(request) {
  const body = await request.json();
  const county = String(body.county || '').trim();
  if (!county) return json({ error: 'County is required' }, 400);
  const profile = countyProfiles[county] || fallbackProfile(county);
  let hit = null;
  if (Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lon))) hit = await queryZoningCatalog(county, Number(body.lat), Number(body.lon), profile);
  return json({
    available: true, county, parcelId: body.parcelId || '', address: body.address || '', jurisdiction: `${county} County`,
    zoning: hit ? {
      status: 'gis_match', code: hit.code, label: hit.label || 'Mapped zoning',
      note: `Mapped zoning value returned from ${hit.sourceTitle}. Verify permitted uses and dimensional standards with the county.`,
      url: profile.zoningMapUrl, sourceUrl: hit.sourceUrl, sourceField: hit.field
    } : {
      status: 'verification_required', code: null, label: 'County zoning lookup',
      note: 'No reliable automated zoning value was returned. Open the county zoning source and confirm the parcel designation.', url: profile.zoningMapUrl
    }, agencies: profile, permits: permitList(profile)
  }, 200, 'public, max-age=3600, s-maxage=86400');
}

function clean(v = '') { return String(v).replace(/\s+/g, ' ').trim(); }
function classify(text) { for (const p of POWER_PATTERNS) { const m = text.match(p.re); if (m) { const i = Math.max(0, m.index - 110), j = Math.min(text.length, m.index + m[0].length + 150); return { classification: p.label, evidence: clean(text.slice(i, j)) }; } } return null; }

async function listingEvidence(request, env) {
  if (!env.GOOGLE_SEARCH_API_KEY || !env.GOOGLE_SEARCH_ENGINE_ID) return json({ status: 'unavailable', error: 'Cloudflare search credentials are not configured.', matches: [] }, 503, 'no-store');
  const body = await request.json(); const parcelId = clean(body.parcelId), address = clean(body.address), county = clean(body.county);
  if (!parcelId && !address) return json({ error: 'Parcel identifier or address required' }, 400);
  const identity = [parcelId ? `"${parcelId}"` : '', address ? `"${address}"` : '', county ? `${county} Washington` : ''].filter(Boolean).join(' OR ');
  const terms = '("power at road" OR "power available" OR "power on property" OR "electricity available" OR "meter installed" OR "transformer nearby" OR "off grid" OR utilities)';
  const u = new URL('https://www.googleapis.com/customsearch/v1'); u.searchParams.set('key', env.GOOGLE_SEARCH_API_KEY); u.searchParams.set('cx', env.GOOGLE_SEARCH_ENGINE_ID); u.searchParams.set('q', `${identity} ${terms}`); u.searchParams.set('num', '10');
  const r = await fetch(u); const data = await r.json(); if (!r.ok) throw new Error(data.error?.message || `Search API returned ${r.status}`);
  const matches = [];
  for (const item of data.items || []) { const combined = clean(`${item.title || ''}. ${item.snippet || ''}`), hit = classify(combined); if (!hit) continue; matches.push({ title: clean(item.title), url: item.link, source: new URL(item.link).hostname.replace(/^www\./, ''), snippet: clean(item.snippet), classification: hit.classification, evidence: hit.evidence, confidence: 'Moderate' }); }
  const best = matches[0]; return json(matches.length ? { status: 'found', summary: best.classification, confidence: best.confidence, matches: matches.slice(0, 5) } : { status: 'none', summary: 'No public power statement found', confidence: 'Low', matches: [] });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/api/hazards') return await hazards(request);
      if (request.method === 'POST' && url.pathname === '/api/zoning-permits') return await zoningPermits(request);
      if (request.method === 'POST' && url.pathname === '/api/listing-evidence') return await listingEvidence(request, env);
      if (url.pathname.startsWith('/api/')) return json({ error: 'API route not found' }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error?.message || 'Request failed' }, 502, 'no-store');
    }
  }
};
