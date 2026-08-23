import { fetchWithTimeout } from '../shared/http.js';

const KC_PARCELS = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0';
const KC_ZONING = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/21';
const KC_PLANNING = 'https://www.kcgov.us/230/Planning';
const KC_CODE_RESIDENTIAL = 'https://codelibrary.amlegal.com/codes/kootenaicountyid/latest/kootenaicounty_id/0-0-0-3664';

function sql(value) { return String(value || '').replaceAll("'", "''"); }
function requestedParcelId(body) {
  return body.parcelId || body.parcelID || body.apn || body.pin || body.taxParcelId || body?.parcel?.properties?.ORIG_PARCEL_ID || body?.parcel?.properties?.PARCEL_ID_NR || body?.parcel?.properties?.PIN || '';
}
async function arcQuery(base, params) {
  const url=new URL(`${base}/query`); url.searchParams.set('f','json');
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const response=await fetchWithTimeout(url,{cf:{cacheTtl:900,cacheEverything:true}},20000);
  if(!response.ok) throw new Error(`Kootenai County GIS returned ${response.status}`);
  const data=await response.json(); if(data.error) throw new Error(data.error.message||'Kootenai County GIS query failed');
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
  let sx=0,sy=0,n=0; for(const p of rings[0]) if(Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])) { sx+=p[0]; sy+=p[1]; n++; }
  return n ? [sx/n,sy/n] : null;
}

function buildingUsesForZone(zoneRaw) {
  const z=String(zoneRaw||'').toUpperCase().replace(/^COUNTY[-\s]*/,'').trim();
  const aliases={
    'AG':'A','AGRICULTURE':'A','AGRICULTURAL':'A','A':'A','RU':'R','RURAL':'R','R':'R','AS':'AS','AG-SUBURBAN':'AS','AG SUBURBAN':'AS','AGRICULTURAL-SUBURBAN':'AS','RR':'RR','RURAL RESIDENTIAL':'RR','RURAL-RESIDENTIAL':'RR','HDR':'HDR','HIGH DENSITY RESIDENTIAL':'HDR','HIGH-DENSITY RESIDENTIAL':'HDR','C':'C','COMMERCIAL':'C','M':'M','MINING':'M','LI':'LI','LIGHT INDUSTRIAL':'LI','I':'I','INDUSTRIAL':'I'
  };
  const zone=aliases[z]||z;
  const matrix={
    A:{single:'P',duplex:'P',multi:'',manufactured:'P',adu:'A',accessory:'P',storage:'P'},R:{single:'P',duplex:'P',multi:'',manufactured:'P',adu:'A',accessory:'P',storage:'P'},AS:{single:'P',duplex:'P',multi:'S',manufactured:'S',adu:'A',accessory:'P',storage:'P'},RR:{single:'P',duplex:'P',multi:'',manufactured:'S',adu:'A',accessory:'P',storage:'P'},HDR:{single:'P',duplex:'P',multi:'P',manufactured:'P',adu:'A',accessory:'P',storage:'C'},C:{single:'P',duplex:'P',multi:'P',manufactured:'',adu:'',accessory:'P',storage:''},M:{single:'',duplex:'',multi:'',manufactured:'',adu:'',accessory:'',storage:''},LI:{single:'',duplex:'',multi:'',manufactured:'',adu:'',accessory:'',storage:''},I:{single:'',duplex:'',multi:'',manufactured:'',adu:'',accessory:'',storage:''}
  };
  const m=matrix[zone];
  if(!m) return {title:'Allowed Buildings / Dwelling Types',zone:zoneRaw,sourceUrl:KC_CODE_RESIDENTIAL,status:'not_mapped',uses:[],note:'This zoning designation has not yet been mapped to the Kootenai County residential-use table. Verify with Community Development.'};
  const label={P:'Permitted',A:'Administrative permit',S:'Special notice permit',C:'Conditional use permit',X:'Prohibited','':'Not permitted / not listed'};
  const uses=[
    {use:'Site-built single-family dwelling',code:m.single,status:label[m.single]},
    {use:'Manufactured home (Class B)',code:m.manufactured,status:label[m.manufactured],note:zone==='HDR'?'Class A or B manufactured home requires at least 6,000 sq ft and public-road frontage.':'Subject to manufactured-home and zone-specific standards.'},
    {use:'Two-family dwelling / duplex',code:m.duplex,status:label[m.duplex],note:zone==='RR'?'Minimum parcel size 9,900 sq ft.':undefined},
    {use:'Multi-family dwelling',code:m.multi,status:label[m.multi],note:zone==='HDR'?'Minimum 12,000 sq ft, public-road frontage, and 3,000 sq ft of land per dwelling unit.':undefined},
    {use:'Accessory living unit / ADU',code:m.adu,status:label[m.adu],note:m.adu?'Accessory use after establishment of a primary use; separate standards apply.':undefined},
    {use:'Accessory building / shop',code:m.accessory,status:label[m.accessory],note:m.accessory?'Generally accessory to an established primary use; special conditions can apply.':undefined},
    {use:'Personal storage building',code:m.storage,status:label[m.storage],note:['A','R','AS','RR'].includes(zone)?'One may be allowed before a primary use; special notice permit required if parcel is under 2 acres; maximum 2,000 sq ft under that condition.':undefined}
  ];
  return {title:'Allowed Buildings / Dwelling Types',zone:zoneRaw,sourceUrl:KC_CODE_RESIDENTIAL,status:'mapped_from_county_code',legend:{P:'Permitted',A:'Administrative permit',S:'Special notice permit',C:'Conditional use permit',X:'Prohibited'},uses,disclaimer:'Planning summary from Kootenai County Code Table 2-1101. Parcel size, frontage, overlays, nonconforming status, septic, access, fire/building code and use-specific standards can affect approval.'};
}
function allowedUsesSummary(allowedBuildings) {
  if (!allowedBuildings?.uses?.length) return allowedBuildings?.note || '';
  return 'Allowed buildings / dwelling types: ' + allowedBuildings.uses.map(item => `${item.use} — ${item.status}`).join(' • ');
}

export async function getKootenaiCountyIntelligence(body) {
  const parcelId=requestedParcelId(body); let parcelFeatures=[];
  try { parcelFeatures=await queryParcel(parcelId); } catch(e) { console.warn('Kootenai ownership parcel lookup failed',e); }
  let lon=Number(body.lon), lat=Number(body.lat);
  if((!Number.isFinite(lon)||!Number.isFinite(lat)) && parcelFeatures.length) { const c=centerFromGeometry(parcelFeatures[0].geometry); if(c) [lon,lat]=c; }
  let zoningFeatures=[]; if(Number.isFinite(lon)&&Number.isFinite(lat)) zoningFeatures=await queryZoningByPoint(lon,lat);
  const parcelAttrs=parcelFeatures[0]?.attributes||{}, zoningAttrs=zoningFeatures[0]?.attributes||{};
  const zone=String(zoningAttrs.LABEL||zoningAttrs.ZONE_NAME||parcelAttrs.ZONING||'').trim();
  if(!zone) return {available:false,county:'Kootenai',state:'ID',countyStatus:'kootenai-data-layers-v3',jurisdiction:'Kootenai County',permitJurisdiction:{name:'Kootenai County'},zoning:{status:'no_mapped_result',label:'No mapped zoning result found',note:'The current Kootenai County Data_Layers zoning service returned no polygon at this parcel location.',sourceUrl:KC_ZONING,url:KC_PLANNING},permits:[],permitHistory:[],permitHistoryStatus:'unavailable',source:{agency:'Kootenai County GIS',service:'NewServices/Data_Layers',layerId:21,parcelMatched:Boolean(parcelFeatures.length)}};
  const allowedBuildings=buildingUsesForZone(zone);
  const useSummary=allowedUsesSummary(allowedBuildings);
  return {available:true,county:'Kootenai',state:'ID',countyStatus:'kootenai-data-layers-v3',jurisdiction:'Kootenai County',permitJurisdiction:{name:'Kootenai County'},zoning:{status:'gis_match',code:zone,name:zone,label:zone,note:`Mapped zoning designation from Kootenai County KCEarth/Data_Layers. ${useSummary}`,sourceUrl:KC_ZONING,url:KC_PLANNING},allowedBuildings,permittedUses:allowedBuildings,comprehensivePlan:{},urbanGrowthArea:{intersects:false},overlays:[],permits:[],permitHistory:[],permitHistoryStatus:'unavailable',source:{agency:'Kootenai County GIS',service:'NewServices/Data_Layers',layerId:21,matchMethod:'parcel location',attributes:zoningAttrs,parcelAttributes:parcelAttrs}};
}
