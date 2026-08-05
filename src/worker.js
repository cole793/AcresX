import { getZoningProfile } from './zoning-counties.js';
const FEMA_URL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const NWI_URL = 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query';

const LISTING_CLAIM_PATTERNS = [
  { category: 'Power', label: 'Power onsite', re: /(?:power|electric(?:ity|al service)?)\s+(?:is\s+)?(?:on[- ]?site|on (?:the )?property|installed|connected)/i },
  { category: 'Power', label: 'Power nearby', re: /(?:power|electric(?:ity|al service)?)\s+(?:is\s+)?(?:available|at|along|near|to)\s+(?:the\s+)?(?:road|property|lot|site)/i },
  { category: 'Power', label: 'Electrical equipment mentioned', re: /(?:meter|transformer)\s+(?:is\s+)?(?:installed|on[- ]?site|on (?:the )?property|nearby|at (?:the )?road)/i },
  { category: 'Power', label: 'Power limitation', re: /off[- ]?grid|no\s+(?:power|electricity)|power\s+not\s+available/i },
  { category: 'Water', label: 'Well installed', re: /(?:private\s+)?well\s+(?:is\s+)?(?:installed|drilled|on[- ]?site|on (?:the )?property|in place)/i },
  { category: 'Water', label: 'Shared well', re: /shared\s+well|community\s+well/i },
  { category: 'Water', label: 'Well needed', re: /(?:buyer|new owner)\s+(?:to|must)\s+(?:install|drill)\s+(?:a\s+)?well|well\s+(?:needed|required)/i },
  { category: 'Septic', label: 'Septic installed', re: /septic\s+(?:system\s+)?(?:is\s+)?(?:installed|in place|approved and installed)/i },
  { category: 'Septic', label: 'Septic approved', re: /(?:septic|onsite sewage)\s+(?:design|permit|approval)\s+(?:is\s+)?(?:approved|completed|available)|approved\s+septic/i },
  { category: 'Septic', label: 'Perc test mentioned', re: /perc(?:olation)?\s+test(?:ed|ing)?|soil\s+test(?:ed|ing)?\s+for\s+septic/i },
  { category: 'Septic', label: 'Septic needed', re: /(?:buyer|new owner)\s+(?:to|must)\s+install\s+(?:a\s+)?septic|septic\s+(?:needed|required)/i },
  { category: 'Access', label: 'Road access mentioned', re: /(?:legal|recorded|year[- ]round|paved|gravel)\s+(?:road\s+)?access|access\s+(?:from|off|via)/i },
  { category: 'Access', label: 'Driveway installed', re: /driveway\s+(?:is\s+)?(?:installed|in place|cut in|completed)/i },
  { category: 'Site work', label: 'Building pad prepared', re: /(?:building|home|house)\s+(?:pad|site)\s+(?:is\s+)?(?:prepared|excavated|graded|ready)|graded\s+building\s+(?:pad|site)/i },
  { category: 'Survey', label: 'Survey mentioned', re: /(?:recent|recorded|boundary)\s+survey|surveyed\s+(?:property|parcel|lot)|corners\s+(?:are\s+)?marked/i },
  { category: 'Restrictions', label: 'CC&Rs or HOA mentioned', re: /\b(?:cc&?rs?|covenants?|hoa|homeowners association)\b/i },
  { category: 'Restrictions', label: 'Manufactured homes mentioned', re: /manufactured\s+homes?\s+(?:are\s+)?(?:allowed|permitted|not allowed|prohibited)/i },
  { category: 'Financing', label: 'Owner financing mentioned', re: /owner\s+(?:will\s+)?financ(?:e|ing)|seller\s+financ(?:e|ing)/i },
  { category: 'Improvements', label: 'Existing structure mentioned', re: /(?:shop|barn|garage|cabin|outbuilding)\s+(?:is\s+)?(?:on (?:the )?property|included|already built|in place)/i },
  { category: 'Utilities', label: 'Utilities unverified', re: /buyer\s+to\s+verify\s+(?:all\s+)?utilities|utilities\s+(?:are\s+)?unknown/i }
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



const SPOKANE_GIS = {
  zoningBase: 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer',
  permittingBase: 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/PermittingLookup/MapServer',
  permitsLayer: 'https://gismo.spokanecounty.org/arcgis/rest/services/BPPublic/BPPublic/MapServer/5',
  scoutUrl: 'https://cp.spokanecounty.org/scout/propertyinformation/'
};

function attrValue(attrs, candidates) {
  const hit = normalizedField(attrs, candidates);
  return hit?.value || '';
}

async function queryOfficialLayer(layerUrl, { lat, lon, geometry, outFields = '*', where = '1=1', limit = 100 } = {}) {
  const q = new URL(`${layerUrl.replace(/\/$/, '')}/query`);
  q.searchParams.set('f', 'json');
  q.searchParams.set('where', where);
  if (geometry) {
    q.searchParams.set('geometry', JSON.stringify(geoJsonToEsriPolygon(geometry)));
    q.searchParams.set('geometryType', 'esriGeometryPolygon');
  } else {
    q.searchParams.set('geometry', `${lon},${lat}`);
    q.searchParams.set('geometryType', 'esriGeometryPoint');
  }
  q.searchParams.set('inSR', '4326');
  q.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  q.searchParams.set('outFields', outFields);
  q.searchParams.set('returnGeometry', 'false');
  q.searchParams.set('resultRecordCount', String(limit));
  const r = await fetchWithTimeout(q, { cf: { cacheTtl: 86400, cacheEverything: true } }, 20000);
  if (!r.ok) throw new Error(`Spokane County GIS returned ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || 'Spokane County GIS query failed');
  return data.features || [];
}

function permitRecord(attrs = {}) {
  const number = attrValue(attrs, ['PERMITNUM','PERMIT_NO','PERMITNUMBER','PERMIT_NUMBER','RECORDNO','RECORD_NO','CASE_NO','CASENO','APPLICATIONNO']);
  const type = attrValue(attrs, ['PERMITTYPE','PERMIT_TYPE','RECORDTYPE','RECORD_TYPE','WORKTYPE','WORK_TYPE','TYPE','DESCRIPTION']);
  const status = attrValue(attrs, ['STATUS','PERMITSTATUS','PERMIT_STATUS','RECORDSTATUS','RECORD_STATUS']);
  const address = attrValue(attrs, ['ADDRESS','SITEADDRESS','SITE_ADDRESS','SITUSADDRESS','SITUS_ADDRESS','LOCATION']);
  const issuedRaw = attrValue(attrs, ['ISSUEDDATE','ISSUED_DATE','ISSUED','DATEISSUED','DATE_ISSUED']);
  const appliedRaw = attrValue(attrs, ['APPLIEDDATE','APPLIED_DATE','APPLICATIONDATE','APPLICATION_DATE','FILEDATE','FILE_DATE']);
  const description = attrValue(attrs, ['WORKDESCRIPTION','WORK_DESCRIPTION','PROJECTDESCRIPTION','PROJECT_DESCRIPTION','DESCRIPTION','COMMENTS']);
  const url = attrValue(attrs, ['URL','LINK','PERMITURL','PERMIT_URL']);
  const dateValue = v => {
    if (!v) return '';
    const n = Number(v); const d = Number.isFinite(n) ? new Date(n) : new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0,10);
  };
  return { number, type: type || 'Permit record', status: status || 'Recorded', address, issuedDate: dateValue(issuedRaw), appliedDate: dateValue(appliedRaw), description, url };
}

async function spokaneCountyIntelligence(body, profile) {
  const lat = Number(body.lat), lon = Number(body.lon);
  const geometry = body.geometry || null;
  const [zoningR, compR, ugaR, jurisdictionR, permitsR] = await Promise.allSettled([
    queryOfficialLayer(`${SPOKANE_GIS.zoningBase}/3`, { lat, lon, outFields: 'ZONECLASS,ZONEDESC,ZFILENUM,COMMENTS,URL,DevFileNum,DevURL' }),
    queryOfficialLayer(`${SPOKANE_GIS.zoningBase}/4`, { lat, lon, outFields: 'LANDUSECODE,LANDUSEDESC,COMMENTS,DevFileNum,DevURL' }),
    queryOfficialLayer(`${SPOKANE_GIS.zoningBase}/2`, { lat, lon, outFields: 'NAME,TYPE' }),
    queryOfficialLayer(`${SPOKANE_GIS.permittingBase}/0`, { lat, lon, outFields: '*' }),
    queryOfficialLayer(SPOKANE_GIS.permitsLayer, { lat, lon, geometry, outFields: '*', limit: 100 })
  ]);

  const zAttrs = zoningR.status === 'fulfilled' ? zoningR.value[0]?.attributes || {} : {};
  const cAttrs = compR.status === 'fulfilled' ? compR.value[0]?.attributes || {} : {};
  const uAttrs = ugaR.status === 'fulfilled' ? ugaR.value[0]?.attributes || {} : {};
  const jAttrs = jurisdictionR.status === 'fulfilled' ? jurisdictionR.value[0]?.attributes || {} : {};
  const zoningCode = attrValue(zAttrs, ['ZONECLASS']);
  const zoningName = attrValue(zAttrs, ['ZONEDESC']);
  const jurisdictionName = attrValue(jAttrs, ['JURISDICTION','JURIS_NAME','NAME','AGENCY','SERVICEPROVIDER','SERVICE_PROVIDER','DESCRIPTION']) || profile.jurisdiction || 'Spokane County';
  const permitHistory = permitsR.status === 'fulfilled'
    ? permitsR.value.map(f => permitRecord(f.attributes || {})).filter((x, i, arr) => (x.number || x.type || x.description) && arr.findIndex(y => `${y.number}|${y.type}|${y.address}` === `${x.number}|${x.type}|${x.address}`) === i).slice(0,50)
    : [];

  return {
    available: true,
    county: 'Spokane',
    parcelId: body.parcelId || '',
    address: body.address || '',
    jurisdiction: jurisdictionName,
    countyStatus: 'official_adapter',
    source: 'Spokane County SCOUT / Building & Planning GIS',
    sourceUrl: SPOKANE_GIS.scoutUrl,
    zoning: zoningCode ? {
      status: 'gis_match', code: zoningCode, name: zoningName, label: 'Official mapped zoning',
      note: 'Mapped directly from Spokane County SCOUT zoning. Verify allowed uses, density, setbacks and overlays with Spokane County or the applicable city.',
      url: SPOKANE_GIS.scoutUrl, sourceUrl: `${SPOKANE_GIS.zoningBase}/3`, sourceField: 'ZONECLASS',
      zoneFileNumber: attrValue(zAttrs, ['ZFILENUM']), developmentAgreement: attrValue(zAttrs, ['DevFileNum']), developmentAgreementUrl: attrValue(zAttrs, ['DevURL'])
    } : {
      status: 'no_match', code: null, name: '', label: 'No mapped zoning result',
      note: zoningR.status === 'rejected' ? `Spokane zoning service error: ${zoningR.reason?.message || 'unavailable'}` : 'The official Spokane zoning layer returned no intersecting designation for the parcel center.',
      url: SPOKANE_GIS.scoutUrl
    },
    comprehensivePlan: {
      available: Boolean(attrValue(cAttrs, ['LANDUSECODE','LANDUSEDESC'])),
      code: attrValue(cAttrs, ['LANDUSECODE']), name: attrValue(cAttrs, ['LANDUSEDESC']),
      developmentAgreement: attrValue(cAttrs, ['DevFileNum']), developmentAgreementUrl: attrValue(cAttrs, ['DevURL']),
      sourceUrl: `${SPOKANE_GIS.zoningBase}/4`
    },
    urbanGrowthArea: {
      intersects: Boolean(Object.keys(uAttrs).length), name: attrValue(uAttrs, ['NAME']), type: attrValue(uAttrs, ['TYPE']), sourceUrl: `${SPOKANE_GIS.zoningBase}/2`
    },
    permitJurisdiction: { name: jurisdictionName, attributes: jAttrs, sourceUrl: `${SPOKANE_GIS.permittingBase}/0` },
    permitHistory,
    permitHistoryStatus: permitsR.status === 'fulfilled' ? (permitHistory.length ? 'found' : 'none') : 'unavailable',
    permitHistoryError: permitsR.status === 'rejected' ? permitsR.reason?.message || 'Permit service unavailable' : '',
    agencies: profile,
    permits: permitList(profile)
  };
}

async function zoningPermits(request) {
  const body = await request.json();
  const county = String(body.county || '').replace(/\s+County$/i, '').trim();
  if (!county) return json({ error: 'County is required' }, 400);
  const profile = getZoningProfile(county);
  const hasPoint = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lon));
  if (/^spokane$/i.test(county) && hasPoint) {
    try {
      const result = await spokaneCountyIntelligence(body, profile);
      return json(result, 200, 'public, max-age=3600, s-maxage=86400');
    } catch (error) {
      // Fall through to the shared discovery adapter so a temporary county outage does not blank the panel.
      console.warn('Spokane official adapter failed', error);
    }
  }
  let hit = null;
  if (hasPoint) hit = await queryZoningCatalog(county, Number(body.lat), Number(body.lon), profile);
  return json({
    available: true, county, parcelId: body.parcelId || '', address: body.address || '', jurisdiction: profile.jurisdiction || `${county} County`, countyStatus: profile.status,
    zoning: hit ? {
      status: 'gis_match', code: hit.code, name: hit.name || '', label: hit.label || 'Mapped zoning',
      note: `Mapped zoning returned from ${hit.sourceTitle}. Verify permitted uses and dimensional standards with the county.`,
      url: profile.zoningMapUrl, sourceUrl: hit.sourceUrl, sourceField: hit.field
    } : {
      status: profile.status === 'configured' ? 'no_match' : 'not_configured', code: null, name: '',
      label: profile.status === 'configured' ? 'No mapped result' : 'Source not configured',
      note: profile.status === 'configured' ? `${county} County is configured, but no intersecting zoning value was returned.` : `${county} County has not received a dedicated official adapter yet.`,
      url: profile.zoningMapUrl
    }, agencies: profile, permits: permitList(profile), permitHistory: [], permitHistoryStatus: 'not_configured'
  }, 200, 'public, max-age=3600, s-maxage=86400');
}

function clean(v = '') { return String(v).replace(/\s+/g, ' ').trim(); }
function normalizeIdentity(v = '') { return clean(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function addressParts(address = '') {
  const parts = clean(address).split(',').map(clean).filter(Boolean);
  const street = parts[0] || '';
  const number = (street.match(/^\s*(\d+[A-Z]?)/i) || [])[1] || '';
  const streetWords = street.replace(/^\s*\d+[A-Z]?\s*/i, '').replace(/\b(?:N|S|E|W|NE|NW|SE|SW|ROAD|RD|STREET|ST|AVENUE|AVE|LANE|LN|DRIVE|DR|COURT|CT|HIGHWAY|HWY|ROUTE|RT)\b/gi, ' ').split(/\s+/).filter(w => w.length > 2);
  const zip = (address.match(/\b\d{5}(?:-\d{4})?\b/) || [])[0] || '';
  return { number, streetWords, zip };
}
function extractClaims(text) {
  const claims = [];
  for (const pattern of LISTING_CLAIM_PATTERNS) {
    const match = text.match(pattern.re);
    if (!match) continue;
    const i = Math.max(0, match.index - 120), j = Math.min(text.length, match.index + match[0].length + 180);
    claims.push({ category: pattern.category, label: pattern.label, evidence: clean(text.slice(i, j)) });
  }
  return claims;
}
function scoreListingMatch(item, { parcelId, address, county }) {
  const text = clean(`${item.title || ''} ${item.snippet || ''} ${item.displayLink || ''}`);
  const normalized = normalizeIdentity(text);
  const parcelNorm = normalizeIdentity(parcelId);
  const { number, streetWords, zip } = addressParts(address);
  let score = 0;
  const signals = [];
  if (parcelNorm && parcelNorm.length >= 6 && normalized.includes(parcelNorm)) { score += 55; signals.push('Parcel number match'); }
  if (number && new RegExp(`\\b${number.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(text)) { score += 18; signals.push('Street number match'); }
  const wordHits = streetWords.filter(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(text)).length;
  if (streetWords.length && wordHits === streetWords.length) { score += 24; signals.push('Street name match'); }
  else if (wordHits >= Math.max(1, Math.ceil(streetWords.length / 2))) { score += 12; signals.push('Partial street match'); }
  if (zip && text.includes(zip)) { score += 12; signals.push('ZIP match'); }
  if (county && new RegExp(`\\b${county.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(text)) { score += 6; signals.push('County match'); }
  const label = score >= 65 ? 'Strong match' : score >= 42 ? 'Probable match' : score >= 25 ? 'Possible match' : 'Weak match';
  return { score: Math.min(score, 100), label, signals };
}
async function googleSearch(env, query) {
  if (!env.GOOGLE_SEARCH_API_KEY || !env.GOOGLE_SEARCH_ENGINE_ID) return null;
  const u = new URL('https://www.googleapis.com/customsearch/v1');
  u.searchParams.set('key', env.GOOGLE_SEARCH_API_KEY); u.searchParams.set('cx', env.GOOGLE_SEARCH_ENGINE_ID);
  u.searchParams.set('q', query); u.searchParams.set('num', '10');
  const r = await fetchWithTimeout(u, {}, 20000); const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || `Google search returned ${r.status}`);
  return data.items || [];
}
async function serperSearch(env, query) {
  if (!env.SERPER_API_KEY) return null;
  const r = await fetchWithTimeout('https://google.serper.dev/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': env.SERPER_API_KEY }, body: JSON.stringify({ q: query, num: 10 }) }, 20000);
  const data = await r.json(); if (!r.ok) throw new Error(data.message || `Serper search returned ${r.status}`);
  return (data.organic || []).map(x => ({ title: x.title, link: x.link, snippet: x.snippet, displayLink: x.displayLink || '' }));
}
async function listingEvidence(request, env) {
  const body = await request.json();
  const parcelId = clean(body.parcelId), address = clean(body.address), county = clean(body.county);
  if (!parcelId && !address) return json({ error: 'Parcel identifier or address required' }, 400);
  if (!address) return json({ status: 'none', summary: 'No situs address available', confidence: 'Low', matchQuality: 'No reliable match', claims: [], matches: [] });
  const identity = [`"${address}"`, parcelId ? `"${parcelId}"` : '', county ? `${county} Washington` : ''].filter(Boolean).join(' ');
  const query = `${identity} (land OR acreage OR parcel OR property OR listing OR "for sale")`;
  let items = await serperSearch(env, query);
  let provider = 'Serper';
  if (!items) { items = await googleSearch(env, query); provider = 'Google Custom Search'; }
  if (!items) return json({ status: 'unavailable', error: 'Set SERPER_API_KEY or GOOGLE_SEARCH_API_KEY plus GOOGLE_SEARCH_ENGINE_ID in Cloudflare.', claims: [], matches: [] }, 503, 'no-store');
  const candidates = [];
  for (const item of items) {
    if (!item.link) continue;
    let source = '';
    try { source = new URL(item.link).hostname.replace(/^www\./, ''); } catch { continue; }
    const combined = clean(`${item.title || ''}. ${item.snippet || ''}`);
    const match = scoreListingMatch(item, { parcelId, address, county });
    if (match.score < 25) continue;
    const claims = extractClaims(combined);
    candidates.push({ title: clean(item.title), url: item.link, source, snippet: clean(item.snippet), matchScore: match.score, matchQuality: match.label, matchSignals: match.signals, claims });
  }
  candidates.sort((a, b) => b.matchScore - a.matchScore || b.claims.length - a.claims.length);
  const reliable = candidates.filter(x => x.matchScore >= 42).slice(0, 5);
  const claimMap = new Map();
  for (const source of reliable) for (const claim of source.claims) {
    const key = `${claim.category}|${claim.label}`;
    if (!claimMap.has(key)) claimMap.set(key, { ...claim, sourceTitle: source.title, source: source.source, url: source.url, matchQuality: source.matchQuality, matchScore: source.matchScore });
  }
  const claims = [...claimMap.values()];
  if (!reliable.length) return json({ status: 'none', summary: 'No reliable listing found', confidence: 'Low', matchQuality: candidates[0]?.matchQuality || 'No reliable match', provider, searchedAddress: address, claims: [], matches: candidates.slice(0, 3) });
  const top = reliable[0];
  return json({ status: 'found', summary: claims.length ? `${claims.length} listing claim${claims.length === 1 ? '' : 's'} identified` : 'Matching listing found', confidence: top.matchScore >= 65 ? 'High' : 'Moderate', matchQuality: top.matchQuality, matchScore: top.matchScore, provider, searchedAddress: address, claims, matches: reliable });
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
