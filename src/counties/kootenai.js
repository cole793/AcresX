import { fetchWithTimeout } from '../shared/http.js';

// Kootenai County's live KCEarth parcel layer already carries the county ZONING
// attribute. Using the same parcel record avoids cross-service geometry/ID mismatches.
const KC_PARCELS = 'https://map.kcgov.us/arcgis/rest/services/KC_Dynamic_Layers_KE_Unfil/MapServer/11';
const KC_PLANNING = 'https://www.kcgov.us/230/Planning';

function sql(value) { return String(value || '').replaceAll("'", "''"); }
function requestedParcelId(body) {
  return body.parcelId || body.parcelID || body.apn || body.pin || body.taxParcelId || body?.parcel?.properties?.ORIG_PARCEL_ID || body?.parcel?.properties?.PARCEL_ID_NR || body?.parcel?.properties?.PIN || '';
}

async function queryParcel(parcelId) {
  const id=String(parcelId||'').trim().toUpperCase();
  if(!id) return [];
  const url=new URL(`${KC_PARCELS}/query`);
  url.searchParams.set('f','json');
  url.searchParams.set('where',`UPPER(PIN)='${sql(id)}' OR UPPER(PID)='${sql(id)}'`);
  url.searchParams.set('outFields','PIN,PID,ZONING,Acres,Legal,Loc_Addr,Loc_City,Ex_Value,Net_Val,Gross_Val,TCA');
  url.searchParams.set('returnGeometry','false');
  const response=await fetchWithTimeout(url,{cf:{cacheTtl:1800,cacheEverything:true}},20000);
  if(!response.ok) throw new Error(`Kootenai County parcel service returned ${response.status}`);
  const data=await response.json();
  if(data.error) throw new Error(data.error.message||'Kootenai County parcel query failed');
  return data.features||[];
}

export async function getKootenaiCountyIntelligence(body) {
  const parcelId=requestedParcelId(body);
  const features=await queryParcel(parcelId);
  if(!features.length) return {available:false,county:'Kootenai',state:'ID',countyStatus:'kootenai-kcearth',jurisdiction:'Kootenai County',permitJurisdiction:{name:'Kootenai County'},zoning:{status:'no_mapped_result',label:'No mapped zoning result found',note:'Kootenai County KCEarth parcel data returned no match for this PIN. Verify with Community Development.',sourceUrl:KC_PARCELS,url:KC_PLANNING},permits:[],permitHistory:[],permitHistoryStatus:'unavailable'};

  const attrs=features[0].attributes||{};
  const zone=String(attrs.ZONING||'').trim();
  return {
    available:Boolean(zone), county:'Kootenai', state:'ID', countyStatus:'kootenai-kcearth', jurisdiction:'Kootenai County', permitJurisdiction:{name:'Kootenai County'},
    zoning:{status:zone?'gis_match':'unavailable',code:zone,name:zone,label:zone||'Mapped zoning result unavailable',note:zone?'Zoning designation from the matching Kootenai County KCEarth parcel record.':'The county parcel matched, but its ZONING field was blank.',sourceUrl:KC_PARCELS,url:KC_PLANNING},
    comprehensivePlan:{},urbanGrowthArea:{intersects:false},overlays:[],permits:[],permitHistory:[],permitHistoryStatus:'unavailable',
    source:{agency:'Kootenai County GIS',service:'KC_Dynamic_Layers_KE_Unfil',layerId:11,matchMethod:'PIN',attributes:attrs}
  };
}
