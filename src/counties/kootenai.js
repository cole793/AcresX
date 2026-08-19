import { fetchWithTimeout } from '../shared/http.js';

const KC_ZONING = 'https://services9.arcgis.com/G9tkBzRKbAqaotWr/ArcGIS/rest/services/Zoning_County/FeatureServer/9';
const KC_PLANNING = 'https://www.kcgov.us/230/Planning';

function normalizeKey(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function sql(value) { return String(value || '').replaceAll("'", "''"); }
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
  const preferred = valueFrom(attrs, ['MAJORITYZONED','MULTIZONING','ZONE_NAME','ZONENAME','ZONING','ZONE','ZONE_CODE','ZONECODE','DISTRICT','DISTRICT_NAME','CLASS','CLASSIFICATION','DESCRIPTION','DESC','LANDUSE','LAND_USE']);
  if (preferred && preferred.length > 1) return preferred;
  const ignored = /OBJECTID|GLOBALID|SHAPE|AREA|LENGTH|CREATED|EDITED|STATUS|ACTIVE|FLAG|LABEL|PARCELID|TAXPARCELID/i;
  const values = Object.entries(attrs || {}).filter(([key,value]) => !ignored.test(key) && value != null).map(([,value]) => String(value).trim()).filter(value => value.length > 1 && value.length < 120);
  return values.find(value => /^(COUNTY[-\s])|\b(AG|AGRICULT|RURAL|COMMERCIAL|INDUSTRIAL|RESIDENTIAL|SUBURBAN|UPLAND)\b/i.test(value)) || values[0] || '';
}
async function queryUrl(params) {
  const url = new URL(`${KC_ZONING}/query`);
  url.searchParams.set('f','json');
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,String(value));
  url.searchParams.set('outFields','*'); url.searchParams.set('returnGeometry','false'); url.searchParams.set('resultRecordCount','10');
  const response = await fetchWithTimeout(url,{cf:{cacheTtl:1800,cacheEverything:true}},20000);
  if(!response.ok) throw new Error(`Kootenai County zoning service returned ${response.status}`);
  const data=await response.json(); if(data.error) throw new Error(data.error.message||'Kootenai County zoning query failed');
  return data.features||[];
}
async function queryParcelId(parcelId) {
  const id=String(parcelId||'').trim().toUpperCase(); if(!id) return [];
  return queryUrl({where:`UPPER(TAXPARCELID)='${sql(id)}' OR UPPER(PARCELID)='${sql(id)}'`});
}
async function queryPoint(lon, lat) {
  return queryUrl({where:'1=1',geometry:JSON.stringify({x:lon,y:lat,spatialReference:{wkid:4326}}),geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects'});
}
function requestedParcelId(body) {
  return body.parcelId || body.parcelID || body.apn || body.pin || body.taxParcelId || body?.parcel?.properties?.ORIG_PARCEL_ID || body?.parcel?.properties?.PARCEL_ID_NR || body?.parcel?.properties?.PIN || '';
}
export async function getKootenaiCountyIntelligence(body) {
  const lat=Number(body.lat), lon=Number(body.lon); const parcelId=requestedParcelId(body);
  let features=[]; let matchMethod='';
  if(parcelId) { features=await queryParcelId(parcelId); if(features.length) matchMethod='parcel ID'; }
  if(!features.length && Number.isFinite(lat) && Number.isFinite(lon)) { features=await queryPoint(lon,lat); if(features.length) matchMethod='parcel center'; }
  if(!features.length) return {available:false,county:'Kootenai',state:'ID',countyStatus:'kootenai-v3',jurisdiction:'Kootenai County',permitJurisdiction:{name:'Kootenai County'},zoning:{status:'no_mapped_result',label:'No mapped zoning result found',note:'Kootenai County zoning returned no match by parcel ID or parcel center. Verify with Community Development.',sourceUrl:KC_ZONING,url:KC_PLANNING},permits:[],permitHistory:[],permitHistoryStatus:'unavailable'};
  const attrs=features[0].attributes||{}; const zone=usefulZoneValue(attrs);
  return {available:Boolean(zone),county:'Kootenai',state:'ID',countyStatus:'kootenai-v3',jurisdiction:'Kootenai County',permitJurisdiction:{name:'Kootenai County'},zoning:{status:zone?'gis_match':'unavailable',code:zone,name:zone,label:zone||'Mapped zoning result unavailable',note:zone?`Mapped zoning designation from Kootenai County’s official zoning layer using ${matchMethod}.`:'The zoning record matched the parcel, but AcresX could not identify a meaningful zoning field.',sourceUrl:KC_ZONING,url:KC_PLANNING},comprehensivePlan:{},urbanGrowthArea:{intersects:false},overlays:[],permits:[],permitHistory:[],permitHistoryStatus:'unavailable',source:{agency:'Kootenai County GIS',service:'Zoning_County',layerId:9,matchMethod,attributes:attrs}};
}
