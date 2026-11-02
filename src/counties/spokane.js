import { cachedJson, upstreamJson } from '../shared/upstream.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { ringsFromGeometry, samplePoints, coverageNote } from '../shared/polygon-coverage.js';
import { layerShares, queryJurisdictionShares, decideJurisdiction, queryCityZoningShares, cityZoning, jurisdictionNote, SPOKANE_JURISDICTIONS } from './spokane-cities.js';

// The layer answers for one parcel (jurisdiction, county or city zoning, comp plan, UGA, permits)
// are cached for a day (Cache API), only when every layer asked answered; the response is rebuilt
// from them each time, so profile/text changes apply at once. Zoning and jurisdiction are stored
// as coverage shares over the parcel (no outlines). Owner and mailing fields are removed
// (src/shared/personal-fields.js) before an answer is stored or used, so neither a cache hit nor
// a fresh answer carries them. Bump the version in the prefix whenever what is stored changes, so
// no entry in the old shape survives. v3: jurisdiction first, whole-parcel shares, city zoning.
export const SPOKANE_CACHE_PREFIX = 'https://acresx.internal/cache/spokane-intelligence/v3/';
const CACHE_TTL_SECONDS = 24 * 60 * 60;

// The jurisdiction layer (SCOUT/PermittingLookup/MapServer/0) and the city zoning layers are in
// spokane-cities.js.
const SPOKANE_GIS = {
  zoningBase: 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer',
  permitsLayer: 'https://gismo.spokanecounty.org/arcgis/rest/services/BPPublic/BPPublic/MapServer/5',
  scoutUrl: 'https://cp.spokanecounty.org/scout/propertyinformation/'
};

function normalizedField(attrs, candidates) {
  const keys = Object.keys(attrs || {});
  for (const candidate of candidates || []) {
    const wanted = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const key = keys.find(k => k.toUpperCase().replace(/[^A-Z0-9]/g, '') === wanted);
    if (key && attrs[key] != null && String(attrs[key]).trim()) {
      return { value: String(attrs[key]).trim(), field: key };
    }
  }
  return null;
}

function attrValue(attrs, candidates) {
  return normalizedField(attrs, candidates)?.value || '';
}

function geoJsonToEsriPolygon(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error('A parcel Polygon or MultiPolygon is required.');
  }

  return {
    rings: geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat(),
    spatialReference: { wkid: 4326 }
  };
}

async function queryOfficialLayer(layerUrl, { lat, lon, geometry, outFields = '*', where = '1=1', limit = 100, label = 'spokane-gis' } = {}) {
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

  // Was one 20 s attempt; now 12 s + one retry at 8 s (body included). A long polygon query
  // goes as a form POST.
  const data = await upstreamJson(q, { timeoutMs: 12000, retryTimeoutMs: 8000, arcgis: true, label, agency: 'Spokane County GIS' });
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

  const dateValue = value => {
    if (!value) return '';
    const numeric = Number(value);
    const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
  };

  return {
    number,
    type: type || 'Permit record',
    status: status || 'Recorded',
    address,
    issuedDate: dateValue(issuedRaw),
    appliedDate: dateValue(appliedRaw),
    description,
    url
  };
}

// Likely approvals. Inside a city (or the air base) its own departments handle zoning, building,
// road-approach and critical-areas review, linked to the city page in spokane-cities.js ('' when
// no page was verified; the UI then shows no link). The health-district and state items are the
// same everywhere. Unincorporated land (and an unknown jurisdiction) keeps the county agencies.
function permitList(profile, city = null) {
  const local = !city
    ? { planning: profile.planningAgency, building: profile.planningAgency, road: profile.roadAgency, roads: 'a county or state road', zoningUrl: profile.zoningMapUrl, permitUrl: profile.permitUrl, planningUrl: profile.planningUrl }
    : city.federal
      ? { planning: city.name, building: city.name, road: city.name, roads: 'a base or state road', zoningUrl: '', permitUrl: '', planningUrl: '' }
      : { planning: `${city.name} planning / community development`, building: `${city.name} building / permit department`, road: `${city.name} public works / streets`, roads: 'a city or state road', zoningUrl: city.planningUrl || '', permitUrl: city.planningUrl || '', planningUrl: city.planningUrl || '' };
  return [
    { name: 'Land-use / zoning verification', agency: local.planning, status: 'Verify', reason: 'Confirm allowed use, setbacks, minimum lot size and overlays before design.', url: local.zoningUrl },
    { name: 'Building permit', agency: local.building, status: 'Likely', reason: 'Normally required for a new residence, shop or other permitted structure.', url: local.permitUrl },
    { name: 'On-site septic approval', agency: profile.healthAgency, status: 'Likely', reason: 'Needed when the parcel is not served by public sewer. Site and soil evaluation may be required.', url: profile.septicUrl },
    { name: 'Well notice / water review', agency: 'Washington Department of Ecology and local health authority', status: 'Possible', reason: 'Well construction, water availability and drinking-water requirements vary by project and location.', url: 'https://ecology.wa.gov/Water-Shorelines/Water-supply/Wells' },
    { name: 'Driveway / road approach permit', agency: local.road, status: 'Possible', reason: `Often required for a new or modified connection to ${local.roads}.`, url: local.planningUrl },
    { name: 'Critical-areas review', agency: local.planning, status: 'Possible', reason: 'Floodplain, wetlands, shorelines, steep slopes or habitat areas can trigger additional review.', url: local.planningUrl }
  ];
}

const COUNTY_ZONING_FIELDS = 'ZONECLASS,ZONEDESC,ZFILENUM,COMMENTS,URL,DevFileNum,DevURL';
const settle = promise => promise.then(value => ({ status: 'fulfilled', value: withoutPersonalFields(value) }), reason => ({ status: 'rejected', reason }));

// Unincorporated parcels: Spokane County SCOUT zoning, read across the parcel outline. The zone
// covering most of the parcel is reported; others covering 5% or more are listed in otherZones.
function countyZoning(zoningR, samples, decision, matchMethod) {
  const jurisdiction = jurisdictionNote(decision);
  const noMatch = note => ({ status: 'no_match', code: null, name: '', label: 'No mapped zoning result', note, url: SPOKANE_GIS.scoutUrl });
  if (zoningR.status !== 'fulfilled') return noMatch(`Spokane zoning service error: ${zoningR.reason?.message || 'unavailable'}`);
  const covered = (zoningR.value || []).filter(s => s.key);
  const top = covered[0];
  if (!top) return noMatch(`The official Spokane County zoning layer returned no zoning ${matchMethod === 'parcel location' ? 'at the parcel location' : 'on this parcel'}.${jurisdiction}`);
  const zAttrs = top.attributes || {};
  const others = covered.slice(1).filter(s => s.share >= 0.05);
  const shareNote = samples.length > 1 ? coverageNote(top, others, 1 - covered.reduce((t, s) => t + s.share, 0), 'county zone') : '';
  return {
    status: 'gis_match',
    code: top.key,
    name: attrValue(zAttrs, ['ZONEDESC']),
    label: 'Official mapped zoning',
    note: `Mapped directly from Spokane County SCOUT zoning. Verify allowed uses, density, setbacks and overlays with Spokane County or the applicable city.${shareNote}${jurisdiction}`,
    url: SPOKANE_GIS.scoutUrl,
    sourceUrl: `${SPOKANE_GIS.zoningBase}/3`,
    sourceField: 'ZONECLASS',
    zoneFileNumber: attrValue(zAttrs, ['ZFILENUM']),
    developmentAgreement: attrValue(zAttrs, ['DevFileNum']),
    developmentAgreementUrl: attrValue(zAttrs, ['DevURL']),
    ...(others.length ? { otherZones: others.map(s => ({ code: s.key, share: s.share })) } : {})
  };
}

// Without the jurisdiction answer AcresX cannot tell city from county land, so only zoning
// degrades: no county zone is shown (it could be the wrong jurisdiction's), everything else stays.
function jurisdictionUnavailable(reason) {
  const message = reason?.message || 'unavailable';
  return {
    status: 'unavailable', code: null, name: '',
    label: 'Zoning lookup unavailable – jurisdiction unknown',
    note: `The Spokane County jurisdiction layer did not answer (${message}), so AcresX cannot tell whether city or Spokane County zoning applies to this parcel. Check with Spokane County Building & Planning or the city.`,
    url: SPOKANE_GIS.scoutUrl, sourceUrl: SPOKANE_JURISDICTIONS, error: message
  };
}

export async function getSpokaneCountyIntelligence(body, profile) {
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Valid parcel coordinates are required for Spokane County intelligence.');

  const geometry = body.geometry || null;
  // Jurisdiction and zoning are read across the parcel outline (sampled), not at its center,
  // which can fall in a gap of the zoning map or on the wrong side of a city boundary.
  const rings = ringsFromGeometry(geometry);
  const where = { rings, lon, lat };
  const samples = rings ? samplePoints(rings) : [[lon, lat]];
  const matchMethod = rings ? 'parcel area (sampled)' : 'parcel location';

  const queryLayers = async () => {
    // County zoning is asked alongside the jurisdiction so an unincorporated parcel needs one
    // round trip; it is used only when the parcel is not inside a city.
    const [jurisdiction, countyZoningR, comp, uga, permits] = await Promise.all([
      settle(queryJurisdictionShares(where, samples)),
      settle(layerShares(`${SPOKANE_GIS.zoningBase}/3`, where, samples, { outFields: COUNTY_ZONING_FIELDS, keyOf: a => attrValue(a, ['ZONECLASS']), agency: 'Spokane County GIS', label: 'spokane-zoning' })),
      settle(queryOfficialLayer(`${SPOKANE_GIS.zoningBase}/4`, { lat, lon, outFields: 'LANDUSECODE,LANDUSEDESC,COMMENTS,DevFileNum,DevURL', label: 'spokane-comp-plan' })),
      settle(queryOfficialLayer(`${SPOKANE_GIS.zoningBase}/2`, { lat, lon, outFields: 'NAME,TYPE', label: 'spokane-uga' })),
      settle(queryOfficialLayer(SPOKANE_GIS.permitsLayer, { lat, lon, geometry, outFields: '*', limit: 100, label: 'spokane-permits' }))
    ]);
    const city = jurisdiction.status === 'fulfilled' ? decideJurisdiction(jurisdiction.value).city : null;
    const cityZoningR = city?.zoning ? await settle(queryCityZoningShares(city, where, samples)) : null;
    return { jurisdiction, countyZoning: countyZoningR, cityZoning: cityZoningR, comp, uga, permits };
  };
  const layers = await cachedJson(
    SPOKANE_CACHE_PREFIX, { lat, lon, geometry }, CACHE_TTL_SECONDS, queryLayers,
    { isValid: answer => Object.values(answer).every(r => r === null || r.status === 'fulfilled') }
  );
  const { jurisdiction: jurisdictionR, countyZoning: zoningR, cityZoning: cityZoningR, comp: compR, uga: ugaR, permits: permitsR } = layers;

  const decision = jurisdictionR.status === 'fulfilled' ? decideJurisdiction(jurisdictionR.value) : null;
  const city = decision?.city || null;
  const cAttrs = compR.status === 'fulfilled' ? compR.value[0]?.attributes || {} : {};
  const uAttrs = ugaR.status === 'fulfilled' ? ugaR.value[0]?.attributes || {} : {};

  const jurisdictionName = !decision ? 'Jurisdiction unknown' : city ? city.name : profile.jurisdiction || 'Spokane County';
  const zoning = !decision ? jurisdictionUnavailable(jurisdictionR.reason)
    : city ? cityZoning(city, cityZoningR, samples, decision)
      : countyZoning(zoningR, samples, decision, matchMethod);

  const permitHistory = permitsR.status === 'fulfilled'
    ? permitsR.value
        .map(feature => permitRecord(feature.attributes || {}))
        .filter((record, index, records) =>
          (record.number || record.type || record.description) &&
          records.findIndex(other => `${other.number}|${other.type}|${other.address}` === `${record.number}|${record.type}|${record.address}`) === index
        )
        .slice(0, 50)
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
    zoning,
    comprehensivePlan: {
      available: Boolean(attrValue(cAttrs, ['LANDUSECODE','LANDUSEDESC'])),
      code: attrValue(cAttrs, ['LANDUSECODE']),
      name: attrValue(cAttrs, ['LANDUSEDESC']),
      developmentAgreement: attrValue(cAttrs, ['DevFileNum']),
      developmentAgreementUrl: attrValue(cAttrs, ['DevURL']),
      sourceUrl: `${SPOKANE_GIS.zoningBase}/4`
    },
    urbanGrowthArea: {
      intersects: Boolean(Object.keys(uAttrs).length),
      name: attrValue(uAttrs, ['NAME']),
      type: attrValue(uAttrs, ['TYPE']),
      sourceUrl: `${SPOKANE_GIS.zoningBase}/2`
    },
    permitJurisdiction: {
      name: jurisdictionName,
      attributes: decision?.attributes || {},
      sourceUrl: SPOKANE_JURISDICTIONS
    },
    // How jurisdiction and zoning were read (additive): sampled across the parcel outline or at
    // one point, and how much of the parcel the deciding jurisdiction covers.
    zoningMatch: {
      method: matchMethod,
      ...(decision ? { jurisdictionShare: decision.share, otherJurisdictions: decision.others } : { jurisdictionError: jurisdictionR.reason?.message || 'unavailable' })
    },
    permitHistory,
    permitHistoryStatus: permitsR.status === 'fulfilled' ? (permitHistory.length ? 'found' : 'none') : 'unavailable',
    permitHistoryError: permitsR.status === 'rejected' ? permitsR.reason?.message || 'Permit service unavailable' : '',
    agencies: profile,
    permits: permitList(profile, city)
  };
}
