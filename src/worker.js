import { getZoningProfile } from './zoning-counties.js';
const FEMA_URL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const NWI_URL = 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query';

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

async function fetchWithTimeout(input, init = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function geoJsonToEsriPolygon(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) throw new Error('A parcel Polygon or MultiPolygon is required.');
  return { rings: geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat(), spatialReference: { wkid: 4326 } };
}

async function queryArcGIS(url, geometry, outFields = '*') {
  const params = new URLSearchParams({
    f: 'json', where: '1=1', geometry: JSON.stringify(geoJsonToEsriPolygon(geometry)), geometryType: 'esriGeometryPolygon',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: 'false', resultRecordCount: '100'
  });
  const r = await fetch(`${url}?${params}`, { headers: { 'User-Agent': 'AcresX/0.5.1' }, cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!r.ok) throw new Error(`Upstream service returned ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || 'ArcGIS query failed');
  return data.features || [];
}

function getField(attributes, suffix) {
  const key = Object.keys(attributes || {}).find(k => k === suffix || k.endsWith(`.${suffix}`));
  return key ? attributes[key] : undefined;
}

async function hazards(request) {
  const { kind, geometry } = await request.json();
  if (kind === 'flood') {
    const rows = (await queryArcGIS(FEMA_URL, geometry, 'FLD_ZONE,ZONE_SUBTY,SFHA_TF')).map(f => f.attributes || {});
    const zones = [...new Set(rows.map(r => getField(r, 'FLD_ZONE')).filter(Boolean))];
    const high = rows.some(r => String(getField(r, 'SFHA_TF') || '').toUpperCase() === 'T' || /^(A|V)/.test(String(getField(r, 'FLD_ZONE') || '').toUpperCase()));
    return json({ available: true, intersects: rows.length > 0, high, zones });
  }
  if (kind === 'wetlands') {
    const rows = (await queryArcGIS(NWI_URL, geometry)).map(f => f.attributes || {});
    const types = [...new Set(rows.map(r => getField(r, 'WETLAND_TYPE') || getField(r, 'ATTRIBUTE')).filter(Boolean))];
    return json({ available: true, intersects: rows.length > 0, count: rows.length, types });
  }
  return json({ error: 'Unknown hazard type.' }, 400);
}

function normalizedField(attrs, candidates) {
  const keys = Object.keys(attrs || {});
  for (const candidate of candidates || []) {
    const wanted = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const key = keys.find(k => k.toUpperCase().replace(/[^A-Z0-9]/g, '') === wanted);
    if (key && attrs[key] != null && String(attrs[key]).trim()) return { value: String(attrs[key]).trim(), field: key };
  }
  return null;
}

function zoningValue(attrs, profile) {
  const code = normalizedField(attrs, profile.codeFields);
  const name = normalizedField(attrs, profile.nameFields);
  if (code || name) return { code: code?.value || name?.value, name: name?.value || '', field: code?.field || name?.field };
  const key = Object.keys(attrs || {}).find(k => /zon(e|ing)|designation|land.?use/i.test(k) && attrs[k] != null && String(attrs[k]).trim());
  return key ? { code: String(attrs[key]).trim(), name: '', field: key } : null;
}

function scoreCatalogItem(item, profile) {
  const text = `${item.title || ''} ${(item.tags || []).join(' ')} ${item.description || ''}`.toLowerCase();
  let score = 0;
  if (/zon(e|ing)/.test(text)) score += 10;
  if (/current|official|generalized/.test(text)) score += 3;
  if (/spokane county|county/.test(text)) score += 2;
  if (profile.preferredOwners?.some(owner => String(item.owner || '').toLowerCase().includes(owner.toLowerCase()))) score += 8;
  if (/city of spokane/.test(text) && profile.county === 'Spokane') score -= 4;
  return score;
}

async function queryPointLayer(serviceUrl, layerId, lat, lon, profile, sourceTitle) {
  const q = new URL(`${serviceUrl}/${layerId}/query`);
  q.searchParams.set('f', 'json'); q.searchParams.set('where', '1=1'); q.searchParams.set('geometry', `${lon},${lat}`);
  q.searchParams.set('geometryType', 'esriGeometryPoint'); q.searchParams.set('inSR', '4326');
  q.searchParams.set('spatialRel', 'esriSpatialRelIntersects'); q.searchParams.set('outFields', '*'); q.searchParams.set('returnGeometry', 'false');
  const qr = await fetchWithTimeout(q, { cf: { cacheTtl: 86400, cacheEverything: true } }, 15000);
  if (!qr.ok) return null;
  const data = await qr.json();
  if (data.error) return null;
  for (const feature of data.features || []) {
    const value = zoningValue(feature.attributes, profile);
    if (value) return { ...value, sourceTitle, sourceUrl: serviceUrl, layerId };
  }
  return null;
}

async function inspectService(serviceUrl, lat, lon, profile, sourceTitle) {
  const metaResp = await fetchWithTimeout(`${serviceUrl}?f=json`, { cf: { cacheTtl: 86400, cacheEverything: true } }, 15000);
  if (!metaResp.ok) return null;
  const meta = await metaResp.json();
  const layers = [...(meta.layers || []), ...(meta.tables || [])]
    .filter(layer => profile.layerNamePattern.test(layer.name || ''))
    .slice(0, 12);
  for (const layer of layers) {
    const hit = await queryPointLayer(serviceUrl, layer.id, lat, lon, profile, sourceTitle || layer.name);
    if (hit) return { ...hit, label: layer.name || sourceTitle };
  }
  return null;
}

async function queryZoningCatalog(county, lat, lon, profile) {
  for (const candidate of profile.serviceCandidates || []) {
    try {
      const hit = await inspectService(candidate.url, lat, lon, profile, candidate.title || `${county} County zoning`);
      if (hit) return hit;
    } catch (_) {}
  }

  const seen = new Set();
  const catalogItems = [];
  for (const queryText of profile.catalogQueries || []) {
    const search = new URL('https://www.arcgis.com/sharing/rest/search');
    search.searchParams.set('f', 'json'); search.searchParams.set('num', '50');
    search.searchParams.set('q', `(${queryText}) AND (type:"Feature Service" OR type:"Map Service")`);
    try {
      const sr = await fetchWithTimeout(search, { cf: { cacheTtl: 86400, cacheEverything: true } }, 15000);
      if (!sr.ok) continue;
      const catalog = await sr.json();
      for (const item of catalog.results || []) {
        if (!item.url || !/^https:\/\//i.test(item.url) || seen.has(item.url)) continue;
        seen.add(item.url); catalogItems.push(item);
      }
    } catch (_) {}
  }

  catalogItems.sort((a,b) => scoreCatalogItem(b, profile) - scoreCatalogItem(a, profile));
  for (const item of catalogItems.slice(0, 20)) {
    try {
      const hit = await inspectService(item.url, lat, lon, profile, item.title);
      if (hit) return { ...hit, itemId: item.id, owner: item.owner };
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
  const profile = getZoningProfile(county);
  let hit = null;
  if (Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lon))) hit = await queryZoningCatalog(county, Number(body.lat), Number(body.lon), profile);
  return json({
    available: true, county, parcelId: body.parcelId || '', address: body.address || '', jurisdiction: profile.jurisdiction || `${county} County`, countyStatus: profile.status,
    zoning: hit ? {
      status: 'gis_match', code: hit.code, name: hit.name || '', label: hit.label || 'Mapped zoning',
      note: `Mapped zoning returned from ${hit.sourceTitle}. Verify permitted uses and dimensional standards with the county.`,
      url: profile.zoningMapUrl, sourceUrl: hit.sourceUrl, sourceField: hit.field
    } : {
      status: profile.status === 'configured' ? 'no_match' : 'not_configured',
      code: null,
      name: '',
      label: profile.status === 'configured' ? 'No mapped result' : 'Source not configured',
      note: profile.status === 'configured'
        ? `${county} County is configured, but no intersecting zoning value was returned. Open the official zoning source and confirm the parcel designation.`
        : `${county} County uses the shared zoning adapter, but its authoritative GIS source has not been configured yet.`,
      url: profile.zoningMapUrl
    }, agencies: profile, permits: permitList(profile)
  }, 200, 'public, max-age=3600, s-maxage=86400');
}

function clean(v = '') { return String(v).replace(/\s+/g, ' ').trim(); }
const LISTING_PATTERNS = [
  { category: 'Power', re: /power\s+(?:is\s+)?(?:available|at|along|near|to)\s+(?:the\s+)?(?:road|property|lot|site)/i, label: 'Power nearby' },
  { category: 'Power', re: /(?:electricity|electrical service|electric service)\s+(?:is\s+)?available/i, label: 'Electric service available' },
  { category: 'Power', re: /power\s+(?:is\s+)?(?:on[- ]?site|on\s+(?:the\s+)?property|installed|connected)/i, label: 'Power onsite' },
  { category: 'Power', re: /(?:meter|transformer)\s+(?:is\s+)?(?:installed|on[- ]?site|on\s+(?:the\s+)?property|nearby|at\s+(?:the\s+)?road)/i, label: 'Electrical equipment mentioned' },
  { category: 'Power', re: /off[- ]?grid|no\s+(?:power|electricity)|power\s+not\s+available/i, label: 'Power limitation' },
  { category: 'Water', re: /(?:private|shared|community)?\s*well\s+(?:is\s+)?(?:installed|drilled|on[- ]?site|on\s+(?:the\s+)?property|produces?|tested)/i, label: 'Well mentioned' },
  { category: 'Water', re: /(?:water\s+rights?|irrigation\s+rights?|public\s+water|community\s+water)/i, label: 'Water service or rights mentioned' },
  { category: 'Septic', re: /septic\s+(?:is\s+)?(?:installed|approved|permitted|designed|on[- ]?site)|perc(?:olation)?\s+test/i, label: 'Septic or perc information' },
  { category: 'Access', re: /(?:paved|gravel|private|county[- ]maintained)\s+(?:road|access)|legal\s+access|easement|driveway\s+(?:is\s+)?(?:installed|cut\s+in)/i, label: 'Access information' },
  { category: 'Site', re: /(?:building|home)\s+site\s+(?:is\s+)?(?:cleared|prepared|graded|level)|level\s+building\s+site|site\s+prep/i, label: 'Building-site work mentioned' },
  { category: 'Improvements', re: /(?:shop|barn|garage|outbuilding|fence|gate)\s+(?:is\s+)?(?:included|installed|built|on\s+(?:the\s+)?property)/i, label: 'Existing improvement mentioned' },
  { category: 'Restrictions', re: /(?:cc&rs?|covenants?|hoa|no\s+manufactured\s+homes?|buyer\s+to\s+verify\s+(?:all\s+)?utilities|utilities\s+unknown)/i, label: 'Restriction or verification language' }
];
function extractClaims(text, source = {}) {
  const claims = [];
  for (const p of LISTING_PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    const i = Math.max(0, m.index - 120), j = Math.min(text.length, m.index + m[0].length + 180);
    claims.push({ category: p.category, classification: p.label, evidence: clean(text.slice(i, j)), ...source });
  }
  return claims;
}
function htmlToText(html) {
  return clean(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'"));
}
function safeListingUrl(raw) {
  if (!raw) return null;
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Listing URL must use http or https.');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) throw new Error('Private-network listing URLs are not allowed.');
  return u;
}
async function fetchListingContext(rawUrl) {
  const u = safeListingUrl(rawUrl);
  if (!u) return null;
  const r = await fetchWithTimeout(u, { headers: { 'User-Agent': 'AcresX/0.6 Listing Context' }, redirect: 'follow' }, 15000);
  if (!r.ok) throw new Error(`Listing page returned ${r.status}`);
  const type = r.headers.get('content-type') || '';
  if (!type.includes('text/html') && !type.includes('text/plain')) throw new Error('Listing URL did not return a readable webpage.');
  const html = (await r.text()).slice(0, 750000);
  const title = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,''])[1]);
  const description = clean((html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i) || [,''])[1]);
  const text = `${description} ${htmlToText(html)}`.slice(0, 120000);
  const source = { title: title || u.hostname, url: u.href, source: u.hostname.replace(/^www\./, ''), confidence: 'Listing supplied' };
  return { source, claims: extractClaims(text, source) };
}

async function listingEvidence(request, env) {
  const body = await request.json();
  const parcelId = clean(body.parcelId), address = clean(body.address), county = clean(body.county), listingUrl = clean(body.listingUrl);
  if (!parcelId && !address && !listingUrl) return json({ error: 'Parcel identifier, address, or listing URL required' }, 400);
  const allClaims = [];
  let supplied = null, suppliedError = '';
  if (listingUrl) {
    try { supplied = await fetchListingContext(listingUrl); allClaims.push(...(supplied?.claims || [])); }
    catch (e) { suppliedError = e.message || 'Listing page could not be read.'; }
  }
  const matches = [];
  if (env.GOOGLE_SEARCH_API_KEY && env.GOOGLE_SEARCH_ENGINE_ID && (parcelId || address)) {
    const identity = [parcelId ? `"${parcelId}"` : '', address ? `"${address}"` : '', county ? `${county} Washington` : ''].filter(Boolean).join(' OR ');
    const terms = '(power OR electricity OR well OR septic OR access OR easement OR "building site" OR utilities)';
    const u = new URL('https://www.googleapis.com/customsearch/v1');
    u.searchParams.set('key', env.GOOGLE_SEARCH_API_KEY); u.searchParams.set('cx', env.GOOGLE_SEARCH_ENGINE_ID); u.searchParams.set('q', `${identity} ${terms}`); u.searchParams.set('num', '10');
    const r = await fetchWithTimeout(u, {}, 15000); const data = await r.json();
    if (r.ok) for (const item of data.items || []) {
      const source = { title: clean(item.title), url: item.link, source: new URL(item.link).hostname.replace(/^www\./, ''), snippet: clean(item.snippet), confidence: 'Moderate' };
      const claims = extractClaims(clean(`${item.title || ''}. ${item.snippet || ''}`), source);
      allClaims.push(...claims); matches.push(...claims);
    }
  }
  const unique = []; const seen = new Set();
  for (const c of allClaims) { const k = `${c.category}|${c.classification}|${c.url || ''}`; if (!seen.has(k)) { seen.add(k); unique.push(c); } }
  const powerClaims = unique.filter(c => c.category === 'Power');
  const status = unique.length ? 'found' : (listingUrl && supplied ? 'none' : (!env.GOOGLE_SEARCH_API_KEY && !listingUrl ? 'unavailable' : 'none'));
  return json({
    status,
    summary: powerClaims[0]?.classification || (unique.length ? `${unique.length} listing claim${unique.length === 1 ? '' : 's'} found` : 'No listing context found'),
    confidence: supplied ? 'Listing supplied' : (unique.length ? 'Moderate' : 'Low'),
    matches: powerClaims.slice(0, 5), claims: unique.slice(0, 20), listing: supplied?.source || null,
    suppliedError, searchConfigured: Boolean(env.GOOGLE_SEARCH_API_KEY && env.GOOGLE_SEARCH_ENGINE_ID)
  }, 200, 'no-store');
}

function geometryBounds(geometry) {
  const coords=[]; const walk=v=>Array.isArray(v?.[0])?v.forEach(walk):coords.push(v); walk(geometry.coordinates);
  const xs=coords.map(p=>Number(p[0])).filter(Number.isFinite), ys=coords.map(p=>Number(p[1])).filter(Number.isFinite);
  if(!xs.length||!ys.length) throw new Error('Parcel geometry is invalid.');
  return {minLon:Math.min(...xs),maxLon:Math.max(...xs),minLat:Math.min(...ys),maxLat:Math.max(...ys)};
}
function distanceFeet(a,b){const R=20902231,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dp=(b.lat-a.lat)*Math.PI/180,dl=(b.lon-a.lon)*Math.PI/180,h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
async function elevationAt(lon,lat){const u=new URL('https://epqs.nationalmap.gov/v1/json');u.searchParams.set('x',lon);u.searchParams.set('y',lat);u.searchParams.set('wkid','4326');u.searchParams.set('units','Feet');u.searchParams.set('includeDate','false');const r=await fetchWithTimeout(u,{cf:{cacheTtl:2592000,cacheEverything:true}},15000);if(!r.ok)throw new Error(`USGS elevation service returned ${r.status}`);const j=await r.json(),z=Number(j.value??j.USGS_Elevation_Point_Query_Service?.Elevation_Query?.Elevation);if(!Number.isFinite(z)||z<-10000)throw new Error('USGS elevation was unavailable.');return z;}
async function soilAt(lon,lat){const point=`POINT(${lon} ${lat})`,query=`SELECT TOP 1 mu.mukey, mu.muname, c.compname, c.comppct_r, c.drainagecl, c.hydgrp, c.slope_r FROM mapunit mu INNER JOIN component c ON c.mukey=mu.mukey WHERE mu.mukey = SDA_Get_Mukey_from_intersection_with_WktWgs84('${point}') ORDER BY c.comppct_r DESC`;const r=await fetchWithTimeout('https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,format:'JSON+COLUMNNAME'}),cf:{cacheTtl:2592000,cacheEverything:true}},20000);if(!r.ok)throw new Error(`USDA soil service returned ${r.status}`);const j=await r.json(),t=j.Table;if(!Array.isArray(t)||t.length<2)throw new Error('No USDA soil map unit was returned.');const row=Object.fromEntries(t[0].map((c,i)=>[c,t[1][i]])),drainage=String(row.drainagecl||'').toLowerCase(),hyd=String(row.hydgrp||'').toUpperCase(),slope=Number(row.slope_r);let feasibility='moderate';if(/very poorly|poorly/.test(drainage)||hyd.includes('D')||(Number.isFinite(slope)&&slope>15))feasibility='limited';else if(/well drained|somewhat excessively|excessively/.test(drainage)&&!hyd.includes('D')&&(!Number.isFinite(slope)||slope<=8))feasibility='favorable';return {available:true,mapUnit:row.muname||'',component:row.compname||'',componentPct:Number(row.comppct_r)||null,drainage:row.drainagecl||'',hydrologicGroup:row.hydgrp||'',soilSlopePct:Number.isFinite(slope)?slope:null,feasibility};}
async function landAnalysis(request){const {geometry}=await request.json();if(!geometry)return json({error:'Parcel geometry is required.'},400,'no-store');const b=geometryBounds(geometry),center={lon:(b.minLon+b.maxLon)/2,lat:(b.minLat+b.maxLat)/2},points=[center,{lon:b.minLon,lat:b.minLat},{lon:b.minLon,lat:b.maxLat},{lon:b.maxLon,lat:b.minLat},{lon:b.maxLon,lat:b.maxLat},{lon:center.lon,lat:b.minLat},{lon:center.lon,lat:b.maxLat},{lon:b.minLon,lat:center.lat},{lon:b.maxLon,lat:center.lat}];const [sr,er]=await Promise.allSettled([soilAt(center.lon,center.lat),Promise.all(points.map(async p=>({...p,elevation:await elevationAt(p.lon,p.lat)})))]);let terrain={available:false};if(er.status==='fulfilled'){const samples=er.value,elev=samples.map(x=>x.elevation),reliefFt=Math.max(...elev)-Math.min(...elev),c=samples[0],grades=samples.slice(1).map(p=>Math.abs(p.elevation-c.elevation)/Math.max(distanceFeet(c,p),1)*100);terrain={available:true,gradePct:grades.reduce((a,b)=>a+b,0)/grades.length,maxGradePct:Math.max(...grades),reliefFt,sampleCount:samples.length};}else terrain={available:false,error:er.reason?.message||'Elevation unavailable'};const soil=sr.status==='fulfilled'?sr.value:{available:false,error:sr.reason?.message||'Soil data unavailable'};return json({available:soil.available||terrain.available,soil,terrain},200,'public, max-age=3600, s-maxage=2592000');}

const ARCGIS_SERVICES = {
  parcel: 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0/query',
  wells: 'https://services.arcgis.com/6lCKYNJLvwTXqrmp/ArcGIS/rest/services/WR/FeatureServer/9/query',
  utility: 'https://gis.ecology.wa.gov/serverext/rest/services/CPR/CPR/MapServer/0/query'
};

async function arcgisProxy(request) {
  const body = await request.json();
  const endpoint = ARCGIS_SERVICES[body.service];
  if (!endpoint || !body.params || typeof body.params !== 'object') return json({ error: 'Invalid ArcGIS request.' }, 400, 'no-store');
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(body.params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetchWithTimeout(url, { cf: { cacheTtl: 3600, cacheEverything: true } }, 25000);
  const text = await response.text();
  if (!response.ok) return json({ error: `Government data service returned ${response.status}.` }, 502, 'no-store');
  try {
    const data = JSON.parse(text);
    if (data.error) return json({ error: data.error.message || 'Government GIS query failed.' }, 502, 'no-store');
    return json(data, 200, 'public, max-age=60, s-maxage=3600');
  } catch {
    return json({ error: 'Government data service returned an invalid response.' }, 502, 'no-store');
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/api/arcgis') return await arcgisProxy(request);
      if (request.method === 'POST' && url.pathname === '/api/hazards') return await hazards(request);
      if (request.method === 'POST' && url.pathname === '/api/land-analysis') return await landAnalysis(request);
      if (request.method === 'POST' && url.pathname === '/api/zoning-permits') return await zoningPermits(request);
      if (request.method === 'POST' && url.pathname === '/api/listing-evidence') return await listingEvidence(request, env);
      if (url.pathname.startsWith('/api/')) return json({ error: 'API route not found' }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error?.message || 'Request failed' }, 502, 'no-store');
    }
  }
};
