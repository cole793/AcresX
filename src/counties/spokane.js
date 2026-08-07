import { fetchWithTimeout } from '../shared/http.js';

const SPOKANE_GIS = {
  zoningBase: 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer',
  permittingBase: 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/PermittingLookup/MapServer',
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

  const response = await fetchWithTimeout(q, { cf: { cacheTtl: 86400, cacheEverything: true } }, 20000);
  if (!response.ok) throw new Error(`Spokane County GIS returned ${response.status}`);

  const data = await response.json();
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

export async function getSpokaneCountyIntelligence(body, profile) {
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Valid parcel coordinates are required for Spokane County intelligence.');

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
    zoning: zoningCode ? {
      status: 'gis_match',
      code: zoningCode,
      name: zoningName,
      label: 'Official mapped zoning',
      note: 'Mapped directly from Spokane County SCOUT zoning. Verify allowed uses, density, setbacks and overlays with Spokane County or the applicable city.',
      url: SPOKANE_GIS.scoutUrl,
      sourceUrl: `${SPOKANE_GIS.zoningBase}/3`,
      sourceField: 'ZONECLASS',
      zoneFileNumber: attrValue(zAttrs, ['ZFILENUM']),
      developmentAgreement: attrValue(zAttrs, ['DevFileNum']),
      developmentAgreementUrl: attrValue(zAttrs, ['DevURL'])
    } : {
      status: 'no_match',
      code: null,
      name: '',
      label: 'No mapped zoning result',
      note: zoningR.status === 'rejected'
        ? `Spokane zoning service error: ${zoningR.reason?.message || 'unavailable'}`
        : 'The official Spokane zoning layer returned no intersecting designation for the parcel center.',
      url: SPOKANE_GIS.scoutUrl
    },
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
      attributes: jAttrs,
      sourceUrl: `${SPOKANE_GIS.permittingBase}/0`
    },
    permitHistory,
    permitHistoryStatus: permitsR.status === 'fulfilled' ? (permitHistory.length ? 'found' : 'none') : 'unavailable',
    permitHistoryError: permitsR.status === 'rejected' ? permitsR.reason?.message || 'Permit service unavailable' : '',
    agencies: profile,
    permits: permitList(profile)
  };
}
