import { fetchWithTimeout } from '../shared/http.js';

// Current Kootenai County KCEarth/Data_Layers services. The older
// KC_Dynamic_Layers_KE_Unfil endpoint has been intermittent from Cloudflare.
const KC_PARCELS = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0';
const KC_ZONING = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/21';
const KC_PLANNING = 'https://www.kcgov.us/230/Planning';

function sql(value) { return String(value || '').replaceAll("'", "''"); }
function requestedParcelId(body) {
  return body.parcelId || body.parcelID || body.apn || body.pin || body.taxParcelId || body?.parcel?.properties?.ORIG_PARCEL_ID || body?.parcel?.properties?.PARCEL_ID_NR || body?.parcel?.properties?.PIN || '';
}
async function arcQuery(base, params) {
  const url=new URL(`${base}/query`);
  url.searchParams.set('f','json');
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const response=await fetchWithTimeout(url,{cf:{cacheTtl:900,cacheEverything:true}},20000);
  if(!response.ok) throw new Error(`Kootenai County GIS returned ${response.status}`);
  const data=await response.json();
  if(data.error) throw new Error(data.error.message||'Kootenai County GIS query failed');
  return data.features||[];
}
async function queryParcel(parcelId) {
  const id=String(parcelId||'').trim().toUpperCase(); if(!id) return [];
  return arcQuery(KC_PARCELS,{where:`UPPER(PIN)='${sql(id)}' OR UPPER(PID)='${sql(id)}'`,outFields:'PIN,PID,Acres,Legal,Loc_Addr,Loc_City,Ex_Value,Net_Val,Gross_Val,TCA,ZONING',returnGeometry:'true',outSR:'4326'});
}
async function queryZoningByPoint(lon,lat) {
  return arcQuery(KC_ZONING,{where:'1=1',geometry:JSON.stringify({x:lon,y:lat,spatialReference:{wkid:4326}}),geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'ZONE_NAME,LABEL,ACRES',returnGeometry:'false'});
}
function centerFromGeometry(geometry) {
  const rings=geometry?.rings; if(!Array.isArray(rings)||!rings.length||!rings[0].length) return null;
  let sx=0,sy=0,n=0; for(const p of rings[0]) { if(Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])) { sx+=p[0]; sy+=p[1]; n++; } }
  return n ? [sx/n,sy/n] : null;
}
export async function getKootenaiCountyIntelligence(body) {
  const parcelId=requestedParcelId(body);
  let parcelFeatures=[];
  try { parcelFeatures=await queryParcel(parcelId); } catch(e) { console.warn('Kootenai ownership parcel lookup failed',e); }

  let lon=Number(body.lon), lat=Number(body.lat);
  if((!Number.isFinite(lon)||!Number.isFinite(lat)) && parcelFeatures.length) {
    const c=centerFromGeometry(parcelFeatures[0].geometry); if(c) [lon,lat]=c;
  }
  let zoningFeatures=[];
  if(Number.isFinite(lon)&&Number.isFinite(lat)) zoningFeatures=await queryZoningByPoint(lon,lat);

  const parcelAttrs=parcelFeatures[0]?.attributes||{};
  const zoningAttrs=zoningFeatures[0]?.attributes||{};
  const zone=String(zoningAttrs.LABEL||zoningAttrs.ZONE_NAME||parcelAttrs.ZONING||'').trim();
  if(!zone) return {available:false,county:'Kootenai',state:'ID',countyStatus:'kootenai-data-layers-v1',jurisdiction:'Kootenai County',permitJurisdiction:{name:'Kootenai County'},zoning:{status:'no_mapped_result',label:'No mapped zoning result found',note:'The current Kootenai County Data_Layers zoning service returned no polygon at this parcel location.',sourceUrl:KC_ZONING,url:KC_PLANNING},permits:[],permitHistory:[],permitHistoryStatus:'unavailable',source:{agency:'Kootenai County GIS',service:'NewServices/Data_Layers',layerId:21,parcelMatched:Boolean(parcelFeatures.length)}};

  return {available:true,county:'Kootenai',state:'ID',countyStatus:'kootenai-data-layers-v1',jurisdiction:'Kootenai County',permitJurisdiction:{name:'Kootenai County'},zoning:{status:'gis_match',code:zone,name:zone,label:zone,note:'Mapped zoning designation from Kootenai County KCEarth/Data_Layers.',sourceUrl:KC_ZONING,url:KC_PLANNING},comprehensivePlan:{},urbanGrowthArea:{intersects:false},overlays:[],permits:[],permitHistory:[],permitHistoryStatus:'unavailable',source:{agency:'Kootenai County GIS',service:'NewServices/Data_Layers',layerId:21,matchMethod:'parcel location',attributes:zoningAttrs,parcelAttributes:parcelAttrs}};
}
