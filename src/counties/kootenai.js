import { fetchWithTimeout } from '../shared/http.js';

const KC_ZONING = 'https://services9.arcgis.com/G9tkBzRKbAqaotWr/ArcGIS/rest/services/Zoning_County/FeatureServer/9';
const KC_PLANNING = 'https://www.kcgov.us/230/Planning';

function normalizeKey(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function valueFrom(attrs, candidates) {
  const entries = Object.entries(attrs || {});
  for (const candidate of candidates) {
    const wanted = normalizeKey(candidate);
    const match = entries.find(([key]) => normalizeKey(key) === wanted);
    if (match && match[1] != null && String(match[1]).trim()) return String(match[1]).trim();
  }
  return '';
}
function usefulZoneValue(attrs) {
  const preferred = valueFrom(attrs, ['ZONE_NAME','ZONENAME','ZONING','ZONE','ZONE_CODE','ZONECODE','DISTRICT','DISTRICT_NAME','CLASS','CLASSIFICATION','DESCRIPTION','DESC','LANDUSE','LAND_USE']);
  if (preferred && preferred.length > 1) return preferred;
  const ignored = /OBJECTID|GLOBALID|SHAPE|AREA|LENGTH|CREATED|EDITED|STATUS|ACTIVE|FLAG|LABEL/i;
  const values = Object.entries(attrs || {}).filter(([key,value]) => !ignored.test(key) && value != null).map(([,value]) => String(value).trim()).filter(value => value.length > 1 && value.length < 120);
  return values.find(value => /^(COUNTY[-\s])|\b(AG|AGRICULT|RURAL|COMMERCIAL|INDUSTRIAL|RESIDENTIAL|SUBURBAN)\b/i.test(value)) || values[0] || '';
}

// ArcGIS hosted feature services are more reliable when geometry is sent as a
// JSON point with an explicit WKID. The service itself is Web Mercator (3857),
// while AcresX parcel centroids are WGS84 lon/lat (4326); inSR tells ArcGIS to
// project the input before applying the spatial intersection.
async function queryPoint(lon, lat) {
  const url = new URL(`${KC_ZONING}/query`);
  url.searchParams.set('f','json');
  url.searchParams.set('where','1=1');
  url.searchParams.set('geometry', JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
  url.searchParams.set('geometryType','esriGeometryPoint');
  url.searchParams.set('inSR','4326');
  url.searchParams.set('spatialRel','esriSpatialRelIntersects');
  url.searchParams.set('outFields','*');
  url.searchParams.set('returnGeometry','false');
  url.searchParams.set('resultRecordCount','10');
  const response = await fetchWithTimeout(url,{cf:{cacheTtl:300,cacheEverything:true}},20000);
  if(!response.ok) throw new Error(`Kootenai County zoning service returned ${response.status}`);
  const data=await response.json();
  if(data.error) throw new Error(data.error.message||'Kootenai County zoning query failed');
  return data.features||[];
}

export async function getKootenaiCountyIntelligence(body) {
  const lat=Number(body.lat), lon=Number(body.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) throw new Error('Kootenai zoning requires parcel coordinates.');
  const features=await queryPoint(lon,lat);
  if(!features.length) return {available:false,county:'Kootenai',state:'ID',countyStatus:'kootenai-v3',jurisdiction:'Kootenai County',permitJurisdiction:{name:'Kootenai County'},zoning:{status:'no_mapped_result',label:'No mapped zoning result found',note:'Kootenai County’s current zoning layer returned no polygon at the parcel center. Verify with Community Development.',sourceUrl:KC_ZONING,url:KC_PLANNING},permits:[],permitHistory:[],permitHistoryStatus:'unavailable'};
  const attrs=features[0].attributes||{};
  const zone=usefulZoneValue(attrs);
  return {available:Boolean(zone),county:'Kootenai',state:'ID',countyStatus:'kootenai-v3',jurisdiction:'Kootenai County',permitJurisdiction:{name:'Kootenai County'},zoning:{status:zone?'gis_match':'unavailable',code:zone,name:zone,label:zone||'Mapped zoning result unavailable',note:zone?'Mapped zoning designation from Kootenai County’s current official public zoning layer using the parcel center.':'The zoning polygon intersected the parcel, but AcresX could not identify a meaningful zoning field.',sourceUrl:KC_ZONING,url:KC_PLANNING},comprehensivePlan:{},urbanGrowthArea:{intersects:false},overlays:[],permits:[],permitHistory:[],permitHistoryStatus:'unavailable',source:{agency:'Kootenai County GIS',service:'Zoning_County',layerId:9,matchMethod:'parcel center / WGS84 point projected by ArcGIS',attributes:attrs}};
}
