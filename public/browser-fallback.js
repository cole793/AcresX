// Browser fallback for government GIS layers that block or time out the Worker (owner decision
// 2026-10-29, "option A"). The Worker always asks first. When an eligible layer fails there with a
// network error, a timeout or a 403/429/5xx, its /api answer keeps its shape and adds
//   fallback: { mode: 'browser', kind, input }          (src/shared/fallback.js)
// This script wraps window.fetch for five /api routes (parcel search, zoning, wells, assessment,
// flood). When such an answer arrives it runs the
// known query for that kind from the user's browser and hands the page an answer in the Worker's
// shape, so the existing render path shows it. It then labels the section
// "Loaded directly from <agency>".
//
// Rules:
// - Only the hard-coded layer URLs below, on ALLOWED_HOSTS, are ever requested. Nothing in the
//   /api answer is used as a URL; `input` is checked (parcel number, point, polygon) and only
//   fills query parameters.
// - Same field lists as the Worker, and never owner or mailing fields. Answers are also stripped
//   with the Worker's personal-field pattern (src/shared/personal-fields.js PERSONAL_FIELD).
// - One attempt per request, 12 s each, no cookies, no redirects (a redirect fails the request). If any request this kind depends on fails,
//   the Worker's own (degraded) answer is kept.
// - The parsing below is a copy of the Worker's (src/counties/kootenai.js, kootenai-cities.js,
//   kootenai-assessor.js, src/shared/polygon-coverage.js, src/shared/arcgis.js spatialParams,
//   src/states/idaho/wells.js, src/services/flood.js). test/browser-fallback.test.js runs both on
//   the same recorded fixtures and checks the answers match. Change both together.
//
// Progressive loading (public/progressive-loading.js): a section's find* fetch passes its
// AbortSignal; the wrapped fetch holds the answer while the browser query runs, so the section
// stays "Checking…" and the score waits for it. Before the browser query starts it calls
// AcresXSections.extend(signal, EXTEND_MS), which gives that section one fresh time limit. A
// timed-out section's abort cancels the browser requests, and Retry goes through the same fetch,
// so it uses the fallback too. Parcel search has no time limit, so the search waits for it.
// AcresXFallback.run(kind, input, { signal }) returns a promise of the Worker-shaped answer and
// records the label; AcresXFallback.kinds lists the kinds.
// Loaded last by maybeInjectUiPolish() in src/index.js, after every renderer it labels.
(function (root) {
  'use strict';
  if (root.AcresXFallback) return;

  const ALLOWED_HOSTS = Object.freeze(['map.kcgov.us', 'gis.cdaid.org', 'gis.postfalls.gov', 'gis.idwr.idaho.gov', 'hazards.fema.gov']);
  const TIMEOUT_MS = 12000;
  // How much more time a progressive-loading section gets once its browser fallback starts.
  const EXTEND_MS = 30000;
  const baseFetch = typeof root.fetch === 'function' ? root.fetch.bind(root) : null;

  // ---- Requests (allowlisted hosts only)

  function assertAllowed(url) {
    let u;
    try { u = new URL(url); } catch { throw new Error('AcresX fallback: invalid URL'); }
    if (u.protocol !== 'https:' || u.port || u.username || u.password || !ALLOWED_HOSTS.includes(u.hostname)) {
      throw new Error(`AcresX fallback: host not allowed (${u.hostname})`);
    }
    return u;
  }

  // GET while the URL is at most maxGet characters, else a form POST (a CORS "simple" request:
  // no preflight). Errors read like the Worker's: "<agency> returned 503", ArcGIS {error} bodies
  // throw with arcgisError: true.
  async function request(base, params, { agency, maxGet = 3500, signal, arcgisMessage } = {}) {
    if (!baseFetch) throw new Error('fetch unavailable');
    const target = assertAllowed(base);
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) form.set(k, String(v));
    const query = form.toString();
    const get = `${target.origin}${target.pathname}?${query}`;
    const init = get.length <= maxGet
      ? { method: 'GET' }
      : { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: query };
    const url = init.method === 'GET' ? get : `${target.origin}${target.pathname}`;
    assertAllowed(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onCancel = () => controller.abort();
    if (signal) { if (signal.aborted) onCancel(); else signal.addEventListener('abort', onCancel, { once: true }); }
    let response, text;
    try {
      // redirect 'error': a redirect could lead off the allowlist, so it fails the request instead.
      response = await baseFetch(url, { ...init, credentials: 'omit', redirect: 'error', signal: controller.signal });
      text = await response.text();
    } catch (error) {
      throw new Error(controller.signal.aborted ? `${agency} timed out after ${TIMEOUT_MS / 1000}s` : (error?.message || 'network error'));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onCancel);
    }
    if (response.status < 200 || response.status > 299) throw new Error(`${agency} returned ${response.status}`);
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`${agency} returned invalid JSON`); }
    if (data && typeof data === 'object' && data.error) {
      const error = new Error(data.error.message || arcgisMessage || `${agency} query failed`);
      error.arcgisError = true;
      throw error;
    }
    return data;
  }

  async function arcgisFeatures(layer, params, opts) {
    const data = await request(`${layer}/query`, { f: 'json', ...params }, opts);
    return data?.features || [];
  }

  // ---- Input checks (the hint is data, never trusted as instructions)

  function parcelIdOf(input) {
    const id = String(input?.parcelId ?? '').trim();
    if (id.length > 64 || !/^[A-Za-z0-9 ._-]*$/.test(id)) throw new Error('AcresX fallback: bad parcel number');
    return id;
  }
  function pointOf(input, required) {
    const lat = Number(input?.lat), lon = Number(input?.lon);
    const ok = input?.lat != null && input?.lon != null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    if (!ok && required) throw new Error('AcresX fallback: bad point');
    return ok ? { lat, lon } : null;
  }
  function geometryOf(input, required) {
    const g = input?.geometry;
    const okRing = r => Array.isArray(r) && r.every(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    let rings = null;
    if (g?.type === 'Polygon' && Array.isArray(g.coordinates)) rings = g.coordinates;
    else if (g?.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.every(Array.isArray)) rings = g.coordinates.flat();
    const vertices = rings ? rings.reduce((n, r) => n + (Array.isArray(r) ? r.length : 0), 0) : 0;
    if (!rings || !rings.length || !rings.every(okRing) || vertices > 50000) {
      if (required) throw new Error('AcresX fallback: bad geometry');
      return null;
    }
    return { type: g.type, coordinates: g.coordinates };
  }

  // ---- Polygon coverage (copy of src/shared/polygon-coverage.js)

  function cleanRing(ring) {
    return Array.isArray(ring) ? ring.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
  }
  function ringsFromGeometry(geometry) {
    const g = geometry?.type === 'Feature' ? geometry.geometry : geometry;
    let rings = [];
    if (Array.isArray(g?.rings)) rings = g.rings;
    else if (g?.type === 'Polygon' && Array.isArray(g.coordinates)) rings = g.coordinates;
    else if (g?.type === 'MultiPolygon' && Array.isArray(g.coordinates)) rings = g.coordinates.flat();
    rings = rings.map(cleanRing).filter(r => r.length >= 3);
    return rings.length ? rings : null;
  }
  function pointInRings(x, y, rings) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }
  function samplePoints(rings, target = 200) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sx = 0, sy = 0, n = 0;
    for (const [x, y] of rings[0]) { sx += x; sy += y; n++; }
    for (const ring of rings) for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180) || 1;
    const w = (maxX - minX) * kx, h = maxY - minY;
    let points = [];
    if (w > 0 && h > 0) {
      let cells = target;
      for (let pass = 0; pass < 3; pass++) {
        const cell = Math.sqrt((w * h) / cells);
        const cols = Math.max(1, Math.min(80, Math.round(w / cell))), rows = Math.max(1, Math.min(80, Math.round(h / cell)));
        points = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const x = minX + (c + 0.5) * (maxX - minX) / cols, y = minY + (r + 0.5) * (maxY - minY) / rows;
          if (pointInRings(x, y, rings)) points.push([x, y]);
        }
        if (points.length >= target / 2) break;
        cells = Math.min(6400, cells * target / Math.max(points.length, target / 20));
      }
    }
    if (!points.length) points.push([sx / n, sy / n]);
    return points;
  }
  function coverageShares(samples, features, keyOf) {
    const list = Array.isArray(features) ? features : [];
    const placed = list.map(f => ({ f, rings: ringsFromGeometry(f?.geometry) })).filter(x => x.rings);
    if (!placed.length) return list.length ? [{ key: keyOf(list[0]?.attributes || {}), share: 1, attributes: list[0]?.attributes || {} }] : [];
    const counts = new Map();
    for (const [x, y] of samples) {
      const hit = placed.find(p => pointInRings(x, y, p.rings));
      const key = hit ? keyOf(hit.f.attributes || {}) : null;
      const entry = counts.get(key) || { key, count: 0, attributes: hit ? hit.f.attributes || {} : null };
      entry.count++;
      counts.set(key, entry);
    }
    return [...counts.values()].map(e => ({ key: e.key, share: e.count / samples.length, attributes: e.attributes })).sort((a, b) => b.share - a.share);
  }
  const pct = share => `${Math.round(share * 100)}%`;
  function coverageNote(top, others, uncovered, what) {
    if (!others.length && top.share >= 0.95) return '';
    const parts = [`Covers about ${pct(top.share)} of the parcel`];
    if (others.length) parts.push(`also partly ${others.map(s => `${s.key} (about ${pct(s.share)})`).join(', ')}`);
    if (uncovered >= 0.05) parts.push(`about ${pct(uncovered)} has no mapped ${what}`);
    return ` ${parts.join('; ')}.`;
  }
  // Copy of src/shared/arcgis.js spatialParams.
  function spatialParams({ rings, lon, lat }) {
    const geometry = rings
      ? { geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPolygon' }
      : { geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPoint' };
    const output = rings ? { returnGeometry: 'true', outSR: '4326', maxAllowableOffset: '0.00001', geometryPrecision: '6' } : { returnGeometry: 'false' };
    return { where: '1=1', ...geometry, inSR: '4326', spatialRel: 'esriSpatialRelIntersects', ...output };
  }

  // ---- 0. Kootenai parcel search (copy of src/counties/kootenai-parcels.js
  // findKootenaiCountyParcel and the /api/parcel-search answer around it). A miss or an ambiguous
  // match fails the fallback, so the Worker's own answer stays.

  const KC_PARCEL_LAYER = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0';
  const KC_PARCEL_SOURCE = 'Kootenai County GIS (Ownership_Display parcel layer)';
  const KC_PARCEL_SEARCH_FIELDS = 'PIN,PID,Acres,Loc_Addr,Loc_City'; // never Name (the owner)

  const normalizeId = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const trimmed = value => String(value ?? '').trim();
  const numberOrNull = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; };
  function closeRing(ring) {
    const pts = ring.map(p => [Number(p[0]), Number(p[1])]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length && (pts[0][0] !== pts.at(-1)[0] || pts[0][1] !== pts.at(-1)[1])) pts.push([...pts[0]]);
    return pts;
  }
  function signedArea(ring) {
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    return sum / 2;
  }
  function pointInRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function esriPolygonToGeoJSON(esriGeometry) {
    const rings = (Array.isArray(esriGeometry?.rings) ? esriGeometry.rings : []).map(closeRing).filter(r => r.length >= 4);
    const outers = [], holes = [];
    for (const ring of rings) {
      const a = signedArea(ring);
      if (a === 0) continue;
      if (a < 0) outers.push({ ring: [...ring].reverse(), area: -a, holes: [] });
      else holes.push(ring);
    }
    for (const hole of holes) {
      const probes = [hole[0], [(hole[0][0] + hole[1][0]) / 2, (hole[0][1] + hole[1][1]) / 2]];
      const owner = outers.filter(o => probes.some(p => pointInRing(p, o.ring))).sort((a, b) => a.area - b.area)[0];
      if (owner) owner.holes.push([...hole].reverse());
      else outers.push({ ring: hole, area: signedArea(hole), holes: [] });
    }
    const polygons = outers.map(o => [o.ring, ...o.holes]);
    if (!polygons.length) return null;
    return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
  }
  function mergeGeometries(geometries) {
    const polygons = [], seen = new Set();
    const add = polygon => { const key = JSON.stringify(polygon); if (!seen.has(key)) { seen.add(key); polygons.push(polygon); } };
    for (const g of geometries) {
      if (g?.type === 'Polygon') add(g.coordinates);
      else if (g?.type === 'MultiPolygon') g.coordinates.forEach(add);
    }
    if (!polygons.length) return null;
    return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
  }
  // Named fields only, like the Worker's mapKootenaiParcel.
  function mapKootenaiParcel(attrs = {}, geometry = null) {
    const pin = trimmed(attrs.PIN);
    return {
      type: 'Feature', geometry,
      properties: {
        PIN: pin, PID: trimmed(attrs.PID), COUNTY: 'Kootenai',
        ORIG_PARCEL_ID: pin, PARCEL_ID_NR: pin, COUNTY_NM: 'Kootenai',
        _countyDisplay: 'Kootenai', _stateCode: 'ID', _stateDisplay: 'Idaho',
        SITUS_ADDRESS: trimmed(attrs.Loc_Addr), SITUS_CITY_NM: trimmed(attrs.Loc_City), SITUS_ZIP_NR: '',
        DATA_LINK: '', ACRES: numberOrNull(attrs.Acres),
        _assessment: { categories: '' },
        _source: { name: KC_PARCEL_SOURCE, url: KC_PARCEL_LAYER }
      }
    };
  }

  async function kootenaiParcel(input, signal) {
    const raw = parcelIdOf(input), compact = normalizeId(raw);
    if (!compact) throw new Error('AcresX fallback: parcel number required');
    const id = String(raw.toUpperCase()).replaceAll("'", "''");
    const data = await request(`${KC_PARCEL_LAYER}/query`, { f: 'json', where: `PIN='${id}' OR PID='${id}'`, outFields: KC_PARCEL_SEARCH_FIELDS, returnGeometry: 'true', outSR: '4326', resultRecordCount: '20' }, {
      agency: 'Kootenai County parcel layer', signal, arcgisMessage: 'Kootenai County parcel layer: query failed'
    });
    const features = (Array.isArray(data?.features) ? data.features : []).filter(f => normalizeId(f.attributes?.PIN) === compact || normalizeId(f.attributes?.PID) === compact);
    const byPin = new Map();
    for (const f of features) { const key = normalizeId(f.attributes?.PIN); if (!byPin.has(key)) byPin.set(key, []); byPin.get(key).push(f); }
    if (byPin.size !== 1) throw new Error(byPin.size ? 'AcresX fallback: more than one parcel matches' : 'AcresX fallback: parcel not found');
    const rows = [...byPin.values()][0];
    const geometry = mergeGeometries(rows.map(f => esriPolygonToGeoJSON(f.geometry)));
    if (!geometry) throw new Error('AcresX fallback: parcel has no outline');
    return { available: true, state: 'ID', county: 'Kootenai', parcel: mapKootenaiParcel(rows[0].attributes, geometry) };
  }

  // ---- 1. Kootenai zoning, city limits and city zoning (copy of src/counties/kootenai.js and
  // kootenai-cities.js). Differences: a failing city-limits or city-zoning layer fails the
  // fallback (the Worker's degraded answer is kept), and there is no retry.

  const KC = 'https://map.kcgov.us/arcgis/rest/services/NewServices';
  const KC_PARCELS = `${KC}/Ownership_Display/MapServer/0`;
  const KC_ZONING = `${KC}/Data_Layers/MapServer/21`;
  const KC_CITY_LIMITS = `${KC}/Data_Layers/MapServer/18`;
  const KC_CITY_IMPACT = `${KC}/Data_Layers/MapServer/17`;
  const KC_PLANNING = 'https://www.kcgov.us/230/Planning';
  const KC_CODE_RESIDENTIAL = 'https://codelibrary.amlegal.com/codes/kootenaicountyid/latest/kootenaicounty_id/0-0-0-3664';
  const CDA_ZONING = 'https://gis.cdaid.org/server/rest/services/Share/Planning/MapServer/8';
  const POST_FALLS_ZONING = 'https://gis.postfalls.gov/server/rest/services/GIS2/LandUse/MapServer/5';
  // The parcel layer's Name field is the owner; it is never requested.
  const KC_PARCEL_FIELDS = 'PIN,PID,Acres,Legal,Loc_Addr,Loc_City,Ex_Value,Net_Val,Gross_Val,KTCA';
  const KC_PARCEL_FIELDS_MINIMAL = 'PIN,Acres,Loc_Addr,Loc_City';
  const KC_AGENCY = 'Kootenai County GIS';
  const ARCGIS_MAX_GET_URL = 1800; // src/shared/arcgis.js

  const sql = value => String(value || '').replaceAll("'", "''");
  const kq = (layer, params, signal, agency = KC_AGENCY) => arcgisFeatures(layer, params, { agency, maxGet: ARCGIS_MAX_GET_URL, signal });

  const CITIES = {
    'COEUR D ALENE': { name: "City of Coeur d'Alene", planningUrl: 'https://www.cdaid.org/planning',
      zoning: { url: CDA_ZONING, agency: "City of Coeur d'Alene GIS", service: 'Share/Planning', layerId: 8, outFields: 'ZONING,ZoningInfo,PUD,Notes,last_edited_date' } },
    'POST FALLS': { name: 'City of Post Falls', planningUrl: 'https://www.postfalls.gov/179/Planning',
      zoning: { url: POST_FALLS_ZONING, agency: 'City of Post Falls GIS', service: 'GIS2/LandUse', layerId: 5, outFields: 'ZONING,LAST_UPDATED' } },
    HAYDEN: { name: 'City of Hayden', planningUrl: 'https://www.haydenid.gov/departments/planning_/index.php' },
    'SPIRIT LAKE': { name: 'City of Spirit Lake', planningUrl: 'https://www.spiritlakeid.gov/planningandzoning' },
    RATHDRUM: { name: 'City of Rathdrum' },
    'DALTON GARDENS': { name: 'City of Dalton Gardens' },
    'HAYDEN LAKE': { name: 'City of Hayden Lake' },
    ATHOL: { name: 'City of Athol' },
    HARRISON: { name: 'City of Harrison' },
    WORLEY: { name: 'City of Worley' },
    FERNAN: { name: 'Fernan Lake Village' },
    'HAUSER LAKE': { name: 'City of Hauser' },
    HUETTER: { name: 'City of Huetter' },
    'STATE LINE': { name: 'City of State Line' },
    STATELINE: { name: 'City of State Line' }
  };
  const cityKey = value => String(value || '').replace(/[^A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  function cityInfo(cityValue) {
    const key = cityKey(cityValue);
    if (!key) return null;
    return { key, ...(CITIES[key] || { name: `City of ${String(cityValue).trim()}` }) };
  }
  async function findCityJurisdiction(where, samples, signal) {
    const features = await kq(KC_CITY_LIMITS, { ...spatialParams(where), outFields: 'CITY' }, signal);
    const shares = coverageShares(samples, features, a => cityKey(a.CITY));
    const merged = new Map();
    for (const s of shares) merged.set(s.key || '', (merged.get(s.key || '') || 0) + s.share);
    const ranked = [...merged.entries()].sort((a, b) => b[1] - a[1]);
    const [topKey, topShare] = ranked[0] || ['', 1];
    if (!topKey) return null;
    return { ...cityInfo(topKey), share: topShare, straddles: ranked.length > 1 };
  }
  async function findCityImpactArea(where, samples, signal) {
    const features = await kq(KC_CITY_IMPACT, { ...spatialParams(where), outFields: 'CITY,ORDINANCE' }, signal);
    const top = coverageShares(samples, features, a => cityKey(a.CITY)).find(s => s.key);
    if (!top) return null;
    const ordinance = String(top.attributes?.ORDINANCE || '').trim();
    return { city: cityInfo(top.key).name, ...(ordinance ? { ordinance } : {}) };
  }
  function cdaZonePdf(attrs, code) {
    const href = String(attrs?.ZoningInfo || '').match(/href=["']?([^"'\s>]+)/i)?.[1];
    if (!href) return null;
    let url;
    try { url = new URL(href); } catch { return null; }
    if (!/^https?:$/.test(url.protocol) || !/^(www\.)?cdaid\.org$/i.test(url.hostname) || url.port || url.username || url.password) return null;
    url.protocol = 'https:';
    let file;
    try { file = decodeURIComponent(url.pathname.split('/').pop() || ''); } catch { return null; }
    return file.replace(/\.pdf$/i, '').toUpperCase() === code.toUpperCase() ? url.href : null;
  }
  const NOT_MAPPED_NOTE = "City zoning rules aren't mapped in AcresX yet; see the city's zoning code.";
  const cityBase = city => ({ county: 'Kootenai', state: 'ID', countyStatus: 'kootenai-city-zoning-v1', jurisdiction: city.name, permitJurisdiction: { name: city.name } });
  const tail = source => ({ comprehensivePlan: {}, urbanGrowthArea: { intersects: false }, overlays: [], permits: [], permitHistory: [], permitHistoryStatus: 'unavailable', source });

  async function getCityZoning(city, where, samples, { parcelAttrs = {}, matchMethod, jurisdictionNote = '', signal } = {}) {
    const jurisdictionSource = { agency: KC_AGENCY, service: 'NewServices/Data_Layers', layerId: 18, city: city.key, share: Math.round(city.share * 1000) / 1000 };
    const planning = city.planningUrl ? { url: city.planningUrl, urlLabel: `Open ${city.name} planning ↗` } : {};
    if (!city.zoning) {
      const contact = city.planningUrl ? `See the ${city.name} planning page.` : `Contact ${city.name} for its zoning map and code.`;
      return {
        available: false, ...cityBase(city),
        zoning: { status: 'city_jurisdiction', label: `${city.name} zoning – see city`, note: `This parcel is inside ${city.name} limits, so city zoning applies, not Kootenai County zoning. ${city.name} zoning is not available digitally. ${contact}${jurisdictionNote}`, sourceUrl: KC_CITY_LIMITS, sourceLabel: 'Open city limits layer ↗', ...planning },
        ...tail({ agency: KC_AGENCY, service: 'NewServices/Data_Layers', layerId: 18, matchMethod, jurisdictionSource, parcelAttributes: parcelAttrs })
      };
    }
    const z = city.zoning;
    const source = { agency: z.agency, service: z.service, layerId: z.layerId, matchMethod, jurisdictionSource, parcelAttributes: parcelAttrs };
    const features = await kq(z.url, { ...spatialParams(where), outFields: z.outFields }, signal, z.agency); // a failure fails the fallback
    const covered = coverageShares(samples, features, a => String(a.ZONING || '').trim()).filter(s => s.key);
    const top = covered[0];
    if (!top) {
      return {
        available: false, ...cityBase(city),
        zoning: { status: 'no_mapped_result', label: `No mapped ${city.name} zoning result`, note: `This parcel is inside ${city.name} limits, but the city zoning map returned no zone here (it may be newly annexed). Check with the city.${jurisdictionNote}`, sourceUrl: z.url, ...planning },
        ...tail(source)
      };
    }
    const code = top.key;
    const attributes = Object.fromEntries(Object.entries(top.attributes || {}).filter(([k]) => k !== 'Shape'));
    const others = covered.slice(1).filter(s => s.share >= 0.05);
    const shareNote = samples.length > 1 ? coverageNote(top, others, 1 - covered.reduce((t, s) => t + s.share, 0), 'city zone') : '';
    const pdf = city.key === 'COEUR D ALENE' ? cdaZonePdf(top.attributes, code) : null;
    const url = pdf || city.planningUrl;
    const allowedBuildings = { title: 'Allowed Buildings / Dwelling Types', zone: code, sourceUrl: url, status: 'not_mapped', uses: [], note: NOT_MAPPED_NOTE };
    return {
      available: true, ...cityBase(city),
      zoning: {
        status: 'gis_match', code, name: code, label: code,
        note: `Mapped zoning designation from the ${city.name} zoning map. City zoning applies inside city limits.${shareNote}${jurisdictionNote}`,
        sourceUrl: z.url, url, urlLabel: pdf ? `Open ${code} zone summary (PDF) ↗` : `Open ${city.name} planning ↗`,
        ...(others.length ? { otherZones: others.map(s => ({ code: s.key, share: Math.round(s.share * 1000) / 1000 })) } : {})
      },
      allowedBuildings, permittedUses: allowedBuildings,
      ...tail({ ...source, attributes })
    };
  }

  function buildingUsesForZone(zoneRaw) {
    const z = String(zoneRaw || '').toUpperCase().replace(/^COUNTY[-\s]*/, '').trim();
    const aliases = {
      'AG': 'A', 'AGRICULTURE': 'A', 'AGRICULTURAL': 'A', 'A': 'A', 'RU': 'R', 'RURAL': 'R', 'R': 'R', 'AS': 'AS', 'AG-SUBURBAN': 'AS', 'AG SUBURBAN': 'AS', 'AGRICULTURAL-SUBURBAN': 'AS', 'RR': 'RR', 'RURAL RESIDENTIAL': 'RR', 'RURAL-RESIDENTIAL': 'RR', 'HDR': 'HDR', 'HIGH DENSITY RESIDENTIAL': 'HDR', 'HIGH-DENSITY RESIDENTIAL': 'HDR', 'C': 'C', 'COMMERCIAL': 'C', 'M': 'M', 'MINING': 'M', 'LI': 'LI', 'LIGHT INDUSTRIAL': 'LI', 'I': 'I', 'INDUSTRIAL': 'I'
    };
    const zone = aliases[z] || z;
    const matrix = {
      A: { single: 'P', duplex: 'P', multi: '', manufactured: 'P', adu: 'A', accessory: 'P', storage: 'P' }, R: { single: 'P', duplex: 'P', multi: '', manufactured: 'P', adu: 'A', accessory: 'P', storage: 'P' }, AS: { single: 'P', duplex: 'P', multi: 'S', manufactured: 'S', adu: 'A', accessory: 'P', storage: 'P' }, RR: { single: 'P', duplex: 'P', multi: '', manufactured: 'S', adu: 'A', accessory: 'P', storage: 'P' }, HDR: { single: 'P', duplex: 'P', multi: 'P', manufactured: 'P', adu: 'A', accessory: 'P', storage: 'C' }, C: { single: 'P', duplex: 'P', multi: 'P', manufactured: '', adu: '', accessory: 'P', storage: '' }, M: { single: '', duplex: '', multi: '', manufactured: '', adu: '', accessory: '', storage: '' }, LI: { single: '', duplex: '', multi: '', manufactured: '', adu: '', accessory: '', storage: '' }, I: { single: '', duplex: '', multi: '', manufactured: '', adu: '', accessory: '', storage: '' }
    };
    const m = matrix[zone];
    if (!m) return { title: 'Allowed Buildings / Dwelling Types', zone: zoneRaw, sourceUrl: KC_CODE_RESIDENTIAL, status: 'not_mapped', uses: [], note: 'This zoning designation has not yet been mapped to the Kootenai County residential-use table. Verify with Community Development.' };
    const label = { P: 'Permitted', A: 'Administrative permit', S: 'Special notice permit', C: 'Conditional use permit', X: 'Prohibited', '': 'Not permitted / not listed' };
    const uses = [
      { use: 'Site-built single-family dwelling', code: m.single, status: label[m.single] },
      { use: 'Manufactured home (Class B)', code: m.manufactured, status: label[m.manufactured], note: zone === 'HDR' ? 'Class A or B manufactured home requires at least 6,000 sq ft and public-road frontage.' : 'Subject to manufactured-home and zone-specific standards.' },
      { use: 'Two-family dwelling / duplex', code: m.duplex, status: label[m.duplex], note: zone === 'RR' ? 'Minimum parcel size 9,900 sq ft.' : undefined },
      { use: 'Multi-family dwelling', code: m.multi, status: label[m.multi], note: zone === 'HDR' ? 'Minimum 12,000 sq ft, public-road frontage, and 3,000 sq ft of land per dwelling unit.' : undefined },
      { use: 'Accessory living unit / ADU', code: m.adu, status: label[m.adu], note: m.adu ? 'Accessory use after establishment of a primary use; separate standards apply.' : undefined },
      { use: 'Accessory building / shop', code: m.accessory, status: label[m.accessory], note: m.accessory ? 'Generally accessory to an established primary use; special conditions can apply.' : undefined },
      { use: 'Personal storage building', code: m.storage, status: label[m.storage], note: ['A', 'R', 'AS', 'RR'].includes(zone) ? 'One may be allowed before a primary use; special notice permit required if parcel is under 2 acres; maximum 2,000 sq ft under that condition.' : undefined }
    ];
    return { title: 'Allowed Buildings / Dwelling Types', zone: zoneRaw, sourceUrl: KC_CODE_RESIDENTIAL, status: 'mapped_from_county_code', legend: { P: 'Permitted', A: 'Administrative permit', S: 'Special notice permit', C: 'Conditional use permit', X: 'Prohibited' }, uses, disclaimer: 'Planning summary from Kootenai County Code Table 2-1101. Parcel size, frontage, overlays, nonconforming status, septic, access, fire/building code and use-specific standards can affect approval.' };
  }

  async function queryKootenaiParcel(parcelId, signal) {
    const id = String(parcelId || '').trim().toUpperCase(); if (!id) return [];
    const params = { returnGeometry: 'true', outSR: '4326' };
    try {
      return await kq(KC_PARCELS, { ...params, where: `UPPER(PIN)='${sql(id)}' OR UPPER(PID)='${sql(id)}'`, outFields: KC_PARCEL_FIELDS }, signal);
    } catch (e) {
      if (!e?.arcgisError) throw e;
      return kq(KC_PARCELS, { ...params, where: `UPPER(PIN)='${sql(id)}'`, outFields: KC_PARCEL_FIELDS_MINIMAL }, signal);
    }
  }
  function centerFromGeometry(geometry) {
    const rings = geometry?.rings; if (!Array.isArray(rings) || !rings.length || !rings[0].length) return null;
    let sx = 0, sy = 0, n = 0; for (const p of rings[0]) if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) { sx += p[0]; sy += p[1]; n++; }
    return n ? [sx / n, sy / n] : null;
  }
  const round3 = n => Math.round(n * 1000) / 1000;

  function noZoneResult(parcelFeatures, matchMethod, impactNote, impact) {
    return { available: false, county: 'Kootenai', state: 'ID', countyStatus: 'kootenai-data-layers-v3', jurisdiction: 'Kootenai County', permitJurisdiction: { name: 'Kootenai County' }, zoning: { status: 'no_mapped_result', label: 'No mapped zoning result found', note: `The current Kootenai County Data_Layers zoning service returned no polygon ${matchMethod === 'parcel location' ? 'at this parcel location' : 'on this parcel'}.${impactNote}`, sourceUrl: KC_ZONING, url: KC_PLANNING, ...(impact ? { cityImpactArea: impact } : {}) }, permits: [], permitHistory: [], permitHistoryStatus: 'unavailable', source: { agency: KC_AGENCY, service: 'NewServices/Data_Layers', layerId: 21, parcelMatched: Boolean(parcelFeatures.length) } };
  }

  async function kootenaiZoning(input, signal) {
    const parcelId = parcelIdOf(input), point = pointOf(input, false), geometry = geometryOf(input, false);
    let parcelFeatures = [];
    try { parcelFeatures = await queryKootenaiParcel(parcelId, signal); } catch { /* as the Worker: carry on without it */ }
    let lon = point ? point.lon : NaN, lat = point ? point.lat : NaN;
    if ((!Number.isFinite(lon) || !Number.isFinite(lat)) && parcelFeatures.length) { const c = centerFromGeometry(parcelFeatures[0].geometry); if (c) [lon, lat] = c; }
    const parcelAttrs = parcelFeatures[0]?.attributes || {};
    const rings = ringsFromGeometry(parcelFeatures[0]?.geometry) || ringsFromGeometry(geometry);
    const hasPoint = Number.isFinite(lon) && Number.isFinite(lat);
    if (!rings && !hasPoint) return noZoneResult(parcelFeatures, 'parcel location', '');
    const where = { rings, lon, lat }, samples = rings ? samplePoints(rings) : [[lon, lat]];
    const matchMethod = rings ? 'parcel area (sampled)' : 'parcel location';

    const countyZoning = kq(KC_ZONING, { ...spatialParams(where), outFields: 'ZONE_NAME,LABEL,ACRES' }, signal).then(features => ({ features }), error => ({ error }));
    const impactArea = findCityImpactArea(where, samples, signal).catch(() => null);
    const city = await findCityJurisdiction(where, samples, signal); // a failure fails the fallback
    if (city) {
      const jurisdictionNote = city.straddles ? ` About ${pct(city.share)} of the parcel is inside ${city.name} limits; the rest may fall under another jurisdiction.` : '';
      return getCityZoning(city, where, samples, { parcelAttrs, matchMethod, jurisdictionNote, signal });
    }
    const { features: zoningFeatures, error } = await countyZoning; if (error) throw error;
    const covered = coverageShares(samples, zoningFeatures, a => String(a.LABEL || a.ZONE_NAME || '').trim()).filter(s => s.key);
    const impact = await impactArea;
    const impactNote = impact ? ` Inside the ${impact.city} area of city impact; Kootenai County zoning applies outside city limits.` : '';
    const top = covered[0];
    if (!top) return noZoneResult(parcelFeatures, matchMethod, impactNote, impact);
    const zone = top.key, zoningAttrs = Object.fromEntries(Object.entries(top.attributes || {}).filter(([k]) => k !== 'Shape'));
    const others = covered.slice(1).filter(s => s.share >= 0.05);
    const shareNote = samples.length > 1 ? coverageNote(top, others, 1 - covered.reduce((t, s) => t + s.share, 0), 'county zone') : '';
    const allowedBuildings = buildingUsesForZone(zone);
    return { available: true, county: 'Kootenai', state: 'ID', countyStatus: 'kootenai-data-layers-v3', jurisdiction: 'Kootenai County', permitJurisdiction: { name: 'Kootenai County' }, zoning: { status: 'gis_match', code: zone, name: zone, label: zone, note: `Mapped zoning designation from Kootenai County KCEarth/Data_Layers.${shareNote}${impactNote}`, sourceUrl: KC_ZONING, url: KC_PLANNING, ...(others.length ? { otherZones: others.map(s => ({ code: s.key, share: round3(s.share) })) } : {}), ...(impact ? { cityImpactArea: impact } : {}) }, allowedBuildings, permittedUses: allowedBuildings, comprehensivePlan: {}, urbanGrowthArea: { intersects: false }, overlays: [], permits: [], permitHistory: [], permitHistoryStatus: 'unavailable', source: { agency: KC_AGENCY, service: 'NewServices/Data_Layers', layerId: 21, matchMethod, attributes: zoningAttrs, parcelAttributes: parcelAttrs } };
  }

  // Copy of src/shared/personal-fields.js PERSONAL_FIELD: owner, taxpayer and mailing field names.
  const PERSONAL_FIELD = /^(owner|own_|ownr|taxpayer|careof|mail|public_std|recipient|attentionline|deliveryaddr|lastline|(first|last|middle)name_|legalpartytype)/i;
  const withoutPersonalFields = props => Object.fromEntries(Object.entries(props || {}).filter(([key]) => !PERSONAL_FIELD.test(key)));

  // ---- 2. IDWR wells (copy of src/states/idaho/wells.js)

  const IDAHO_WELLS = 'https://gis.idwr.idaho.gov/hosting/rest/services/Groundwater/Wells/FeatureServer/0';
  const IDAHO_WELL_FIELDS = 'WellID,PermitID,MetalTagNumber,ConstructionDate,WellUse,CountyName,WellAddress,ProductionRate,StaticWaterLevel,CasingDepth,TotalDepth,WellDocs,Latitude,Longitude';

  async function idahoWells(input, signal) {
    const { lat: y, lon: x } = pointOf(input, true);
    let features = [];
    for (const miles of [2, 5, 10, 20, 40]) {
      const data = await request(`${IDAHO_WELLS}/query`, {
        f: 'geojson', where: 'TotalDepth > 0', geometry: `${x},${y}`, geometryType: 'esriGeometryPoint', inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects', distance: String(miles), units: 'esriSRUnit_StatuteMile', outFields: IDAHO_WELL_FIELDS,
        returnGeometry: 'true', outSR: '4326', resultRecordCount: '200'
      }, { agency: 'Idaho well service', arcgisMessage: 'Idaho well search failed', signal });
      features = (data.features || []).filter(f => Number(f?.properties?.TotalDepth) > 0);
      if (features.length >= 5) break;
    }
    const wells = features.map(feature => {
      const p = withoutPersonalFields(feature.properties); // as the Worker: dropped even if a server sent them
      return {
        type: 'Feature',
        geometry: feature.geometry,
        properties: {
          ...p, ID: p.WellID, WellTagNr: p.MetalTagNumber || p.PermitID || p.WellID, ProjectName: p.WellUse || 'Idaho well record',
          CompletedDepth: p.TotalDepth, StaticWaterLvl: p.StaticWaterLevel, FlowRateGPM: p.ProductionRate, WorkCompletionDate: p.ConstructionDate,
          FileName: p.WellDocs, _source: 'Idaho Department of Water Resources'
        }
      };
    });
    return { available: true, state: 'ID', source: 'Idaho Department of Water Resources Well Database', wells };
  }

  // ---- 3. Kootenai assessor (copy of src/counties/kootenai-assessor.js and the Kootenai branch
  // of src/services/property-tax-test.js). At most 4 layers at once; a hit stops the rest.

  const KC_ASSESSOR = 'https://map.kcgov.us/arcgis/rest/services/Assessor_Layers/MapServer';
  const KC_ASSESSOR_LAYERS = [5, 6, 7, 8, 9, 10, 11];
  const KC_ASSESSOR_SOURCE = 'Kootenai County Assessor (Assessor_Layers)';
  // Never add Owner_*, *Name_Primary, Recipient_*, AttentionLine_*, DeliveryAddr_*, LastLine_*,
  // City/State/PostalCd/Country_Primary: the owner's name and mailing address.
  const KC_ASSESSOR_FIELDS = 'PIN,PID,AIN,EffStatus,ApprDist,property_class,Property_ClassDescr,AssessValue_Date,AssessValue_Land,AssessValue_Imp,AssessValue_Net,HO_Exemption,PclArea_Acres';

  const numOrNull = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; };
  const strOrNull = value => { const s = String(value ?? '').trim(); return s || null; };
  function assessmentDate(value) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? ''));
    return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, year: Number(m[1]) } : { date: null, year: null };
  }
  function classDescription(code, descr) {
    const d = strOrNull(descr); if (!d) return null;
    return code ? d.replace(new RegExp(`^\\s*${code.replace(/[^0-9A-Za-z]/g, '')}\\s*[-–:]\\s*`), '').trim() || null : d;
  }
  function mapKootenaiAssessorRecord(attrs = {}, layerId = null) {
    const land = numOrNull(attrs.AssessValue_Land), imp = numOrNull(attrs.AssessValue_Imp);
    const { date, year } = assessmentDate(attrs.AssessValue_Date);
    const code = strOrNull(attrs.property_class);
    return {
      pin: strOrNull(attrs.PIN), pid: strOrNull(attrs.PID), ain: strOrNull(attrs.AIN), status: strOrNull(attrs.EffStatus),
      appraisalDistrict: numOrNull(attrs.ApprDist), layerId,
      landValue: land, improvementValue: imp,
      totalValue: land != null || imp != null ? (land || 0) + (imp || 0) : null,
      homeownerExemption: numOrNull(attrs.HO_Exemption), netValue: numOrNull(attrs.AssessValue_Net),
      assessmentDate: date, taxYear: year,
      assessorAcres: numOrNull(attrs.PclArea_Acres),
      propertyClass: code, propertyClassDescription: classDescription(code, attrs.Property_ClassDescr)
    };
  }

  async function kootenaiAssessor(input, signal) {
    const parcelId = parcelIdOf(input);
    if (!parcelId) throw new Error('AcresX fallback: parcel number required');
    const id = sql(parcelId.toUpperCase());
    const where = `PIN='${id}' OR PID='${id}'`;
    const cancel = new AbortController();
    if (signal) { if (signal.aborted) cancel.abort(); else signal.addEventListener('abort', () => cancel.abort(), { once: true }); }
    const queue = [...KC_ASSESSOR_LAYERS];
    let hit = null, failed = false;
    const worker = async () => {
      while (queue.length && !hit) {
        const layerId = queue.shift();
        try {
          const features = await arcgisFeatures(`${KC_ASSESSOR}/${layerId}`, { where, outFields: KC_ASSESSOR_FIELDS, returnGeometry: 'false' }, { agency: `Kootenai County Assessor layer ${layerId}`, signal: cancel.signal });
          if (features.length && !hit) { hit = mapKootenaiAssessorRecord(features[0].attributes || {}, layerId); cancel.abort(); }
        } catch { if (!hit) failed = true; }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const base = { state: 'ID', county: 'Kootenai', parcelId, countySource: KC_ASSESSOR_SOURCE, countySourceUrl: KC_ASSESSOR };
    if (hit) return { available: true, ...base, countyRecords: [hit] };
    if (failed) throw new Error('Kootenai County Assessor unavailable'); // the PIN may be in a layer that failed
    return { available: false, ...base, countyRecords: [], note: 'No Kootenai County Assessor record matched this parcel number.' };
  }

  // ---- 4. FEMA NFHL flood (copy of src/services/flood.js, FEMA path only)

  const FEMA_NFHL_FLOOD_LAYER = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28';
  const FEMA_PROVIDER = 'FEMA NFHL';
  const NOT_MAPPED_ZONES = new Set(['AREA NOT INCLUDED', 'OPEN WATER']);
  const FLOOD_RANK = ['high', 'undetermined', 'moderate', 'not_mapped', 'minimal'];

  function field(attributes, name) {
    const wanted = name.toUpperCase();
    const key = Object.keys(attributes || {}).find(k => { const upper = k.toUpperCase(); return upper === wanted || upper.endsWith(`.${wanted}`); });
    return key === undefined ? undefined : attributes[key];
  }
  const zoneOf = row => String(field(row, 'FLD_ZONE') ?? '').trim().toUpperCase();
  function sfhaFlag(row) {
    const flag = field(row, 'SFHA_TF');
    if (flag === true || flag === false) return flag;
    const text = String(flag ?? '').trim();
    if (/^(T|TRUE|Y|YES|1)$/i.test(text)) return true;
    if (/^(F|FALSE|N|NO|0)$/i.test(text)) return false;
    return null;
  }
  function isSfha(row) {
    const zone = zoneOf(row);
    if (NOT_MAPPED_ZONES.has(zone)) return false;
    if (sfhaFlag(row) === true) return true;
    if (/^(A|V)/.test(zone)) return true;
    return /1%\s*annual|floodway/i.test(String(field(row, 'ESRI_SYMBOLOGY') || ''));
  }
  function rowCategory(row) {
    const zone = zoneOf(row);
    if (NOT_MAPPED_ZONES.has(zone)) return 'not_mapped';
    if (isSfha(row)) return 'high';
    if (zone === 'B') return 'moderate';
    if (zone === 'C') return 'minimal';
    if (zone === 'D') return 'undetermined';
    if (zone === 'X') {
      const subtype = String(field(row, 'ZONE_SUBTY') ?? '').trim();
      if (subtype) return /AREA OF MINIMAL FLOOD HAZARD/i.test(subtype) ? 'minimal' : 'moderate';
      return /0\.2\s*(%|PCT|PERCENT)/i.test(String(field(row, 'ESRI_SYMBOLOGY') ?? '')) ? 'moderate' : 'minimal';
    }
    return zone ? 'undetermined' : null;
  }
  function floodCategory(rows) {
    let worst = FLOOD_RANK.indexOf('not_mapped'), found = false;
    for (const row of rows) {
      const index = FLOOD_RANK.indexOf(rowCategory(row));
      if (index < 0) continue;
      if (!found || index < worst) worst = index;
      found = true;
    }
    return FLOOD_RANK[worst];
  }
  function zoneDetails(rows) {
    const seen = new Map();
    for (const row of rows) {
      const zone = String(field(row, 'FLD_ZONE') ?? '').trim();
      if (!zone) continue;
      const detail = { zone, subtype: String(field(row, 'ZONE_SUBTY') ?? '').trim() || null, sfha: sfhaFlag(row) };
      const key = JSON.stringify(detail);
      if (!seen.has(key)) seen.set(key, detail);
    }
    return [...seen.values()];
  }
  function summarizeFloodRows(rows) {
    const zones = [...new Set(rows.map(r => field(r, 'FLD_ZONE')).filter(Boolean).map(z => String(z).trim()).filter(Boolean))];
    return { available: true, intersects: rows.length > 0, high: rows.some(isSfha), zones, zoneDetails: zoneDetails(rows), category: floodCategory(rows) };
  }

  async function femaFlood(input, signal) {
    const geometry = geometryOf(input, true);
    const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
    const data = await request(`${FEMA_NFHL_FLOOD_LAYER}/query`, {
      f: 'json', where: '1=1', geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPolygon',
      inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF', returnGeometry: 'false', resultRecordCount: '100'
    }, { agency: FEMA_PROVIDER, signal });
    const rows = (data?.features || []).map(f => f?.attributes || {});
    return { ...summarizeFloodRows(rows), source: { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER } };
  }

  // ---- Kinds, the fetch hook and labels

  const KINDS = {
    'kootenai-parcel': { api: '/api/parcel-search', run: kootenaiParcel, agency: () => 'Kootenai County GIS', targets: ['overviewParcelId', 'parcelAddress'] },
    'kootenai-zoning': { api: '/api/zoning-permits', run: kootenaiZoning, agency: body => body?.source?.agency || KC_AGENCY, targets: ['zoningNote'] },
    'idaho-wells': { api: '/api/well-search', run: idahoWells, agency: () => 'Idaho Department of Water Resources', targets: ['wellNote'] },
    'kootenai-assessor': { api: '/api/property-assessment', run: kootenaiAssessor, agency: () => 'Kootenai County Assessor', targets: ['propertyAssessmentSource', 'overviewAssessorValue'] },
    'fema-flood': { api: '/api/hazards', run: femaFlood, agency: () => 'FEMA (National Flood Hazard Layer)', targets: ['overviewFlood'] }
  };

  let loaded = {};
  // Which search a run belongs to: bumped by reset() (a new search form submit), and
  // progressive loading's search id. A run that finishes after a newer search started still
  // returns its answer (the caller drops stale answers) but labels nothing.
  let generation = 0;
  const currentSearch = () => `${generation}:${root.AcresXSections?.searchId ?? ''}`;
  const labelText = agency => `Loaded directly from ${agency}. Verify with the responsible agency.`;

  function ensureStyles() {
    const doc = root.document;
    if (!doc?.head || doc.getElementById('acresxFallbackStyles')) return;
    const style = doc.createElement('style');
    style.id = 'acresxFallbackStyles';
    style.textContent = '.acresx-fallback-note{display:block;font-size:10px;line-height:1.3;color:var(--muted,#66736b);margin-top:2px;font-weight:400}';
    doc.head.appendChild(style);
  }

  function applyLabels() {
    const doc = root.document;
    if (!doc) return;
    ensureStyles();
    for (const [kind, agency] of Object.entries(loaded)) {
      const target = KINDS[kind].targets.map(id => doc.getElementById(id)).find(el => el && el.parentNode);
      if (!target) continue;
      // One label per kind: keep the one right after the target, remove any other (e.g. one left
      // after another target while the first was being re-rendered).
      const notes = [...(doc.querySelectorAll?.(`.acresx-fallback-note[data-kind="${kind}"]`) || [])];
      let note = notes.find(n => n.parentNode === target.parentNode && n.previousElementSibling === target) || null;
      for (const other of notes) if (other !== note) other.remove?.();
      if (!note) {
        note = doc.createElement('small');
        note.className = 'acresx-fallback-note';
        note.setAttribute?.('data-kind', kind);
        target.insertAdjacentElement('afterend', note);
      }
      note.textContent = labelText(agency);
    }
  }
  // Renderers run after the answer is handed back (property assessment renders later still).
  function scheduleLabels() { for (const ms of [0, 400, 1500]) setTimeout(applyLabels, ms); }

  function reset() {
    generation++;
    loaded = {};
    const notes = root.document?.querySelectorAll?.('.acresx-fallback-note') || [];
    for (const note of notes) note.remove?.();
  }

  // Runs the browser query for `kind`. Resolves the Worker-shaped answer; rejects for an unknown
  // kind, bad input, or a failed request.
  // options.signal (e.g. a progressive-loading section's) cancels the browser requests.
  async function run(kind, input, { signal } = {}) {
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new Error(`AcresX fallback: unknown kind ${kind}`);
    if (signal?.aborted) throw new Error('AcresX fallback: cancelled');
    const search = currentSearch();
    const body = await KINDS[kind].run(input || {}, signal);
    if (signal?.aborted) throw new Error('AcresX fallback: cancelled');
    if (search === currentSearch()) {
      loaded[kind] = KINDS[kind].agency(body);
      scheduleLabels();
    }
    return body;
  }

  // Given an /api answer: if it carries a browser hint for that route's kind, returns a new
  // Response with the browser's answer; otherwise (or if the browser query fails too) the
  // original response, untouched.
  // init.signal is the page request's signal. Before the browser query starts, the
  // progressive-loading section holding that signal gets its time limit extended once
  // (AcresXSections.extend), so it stays "Checking…" while the browser runs.
  async function recover(input, response, init) {
    try {
      const raw = typeof input === 'string' ? input : input?.url || String(input);
      const here = root.location?.href || 'https://acresx.invalid/';
      const url = new URL(raw, here);
      if (url.origin !== new URL(here).origin) return response;
      const kind = Object.keys(KINDS).find(k => KINDS[k].api === url.pathname);
      if (!kind || !/json/i.test(response?.headers?.get?.('Content-Type') || '')) return response;
      const data = await response.clone().json();
      const hint = data?.fallback;
      if (!hint || hint.mode !== 'browser' || hint.kind !== kind) return response;
      const signal = init?.signal || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
      try { root.AcresXSections?.extend?.(signal, EXTEND_MS); } catch { /* optional */ }
      const body = await run(kind, hint.input, { signal });
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    } catch (error) {
      try { console.warn('AcresX browser fallback did not load this layer', error?.message || error); } catch { /* ignore */ }
      return response;
    }
  }

  if (baseFetch) {
    root.fetch = async function (input, init) {
      const response = await baseFetch(input, init);
      return recover(input, response, init);
    };
  }

  // A new search clears the previous search's labels.
  root.document?.addEventListener?.('submit', event => { if (event?.target?.id === 'searchForm') reset(); }, true);
  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) { const result = base.apply(this, args); scheduleLabels(); return result; }; // eslint-disable-line no-global-assign
  }

  root.AcresXFallback = Object.freeze({
    run, recover, applyLabels, reset, labelText,
    kinds: Object.freeze(Object.keys(KINDS)), EXTEND_MS,
    ALLOWED_HOSTS,
    loaded: () => ({ ...loaded }),
    _request: request // tests: the allowlist check
  });
})(typeof window !== 'undefined' ? window : globalThis);
