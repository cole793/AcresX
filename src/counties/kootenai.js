import { arcgisQuery, spatialParams } from '../shared/arcgis.js';
import { ringsFromGeometry, samplePoints, coverageShares, coverageNote, pct } from '../shared/polygon-coverage.js';
import { findCityJurisdiction, findCityImpactArea, getCityZoning } from './kootenai-cities.js';

const KC_PARCELS = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0';
const KC_ZONING = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/21';
const KC_PLANNING = 'https://www.kcgov.us/230/Planning';
const KC_CODE_RESIDENTIAL = 'https://codelibrary.amlegal.com/codes/kootenaicountyid/latest/kootenaicounty_id/0-0-0-3664';

function sql(value) { return String(value || '').replaceAll("'", "''"); }
function requestedParcelId(body) {
  return body.parcelId || body.parcelID || body.apn || body.pin || body.taxParcelId || body?.parcel?.properties?.ORIG_PARCEL_ID || body?.parcel?.properties?.PARCEL_ID_NR || body?.parcel?.properties?.PIN || '';
}
// Through the shared client (src/shared/arcgis.js -> upstream.js): 12 s + one retry at 8 s.
const arcQuery = (base, params, label) => arcgisQuery(base, params, { agency: 'Kootenai County GIS', label });
// The Ownership_Display parcel layer has no ZONING field (zoning comes from Data_Layers/21), and
// ArcGIS fails the whole query when outFields or where names a field the layer lacks. Every field
// below is in the layer's field list (checked live 2026-10-27; it has KTCA/STCA, not TCA). An
// ArcGIS error still gets one retry with PIN,Acres,Loc_Addr,Loc_City in case the layer changes.
const KC_PARCEL_FIELDS='PIN,PID,Acres,Legal,Loc_Addr,Loc_City,Ex_Value,Net_Val,Gross_Val,KTCA';
const KC_PARCEL_FIELDS_MINIMAL='PIN,Acres,Loc_Addr,Loc_City';
async function queryParcel(parcelId) {
  const id=String(parcelId||'').trim().toUpperCase(); if(!id) return [];
  const params={returnGeometry:'true',outSR:'4326'};
  try {
    return await arcQuery(KC_PARCELS,{...params,where:`UPPER(PIN)='${sql(id)}' OR UPPER(PID)='${sql(id)}'`,outFields:KC_PARCEL_FIELDS},'kootenai-ownership-parcel');
  } catch(e) {
    if(!e?.arcgisError) throw e;
    console.warn(`Kootenai ownership parcel query failed (${e.message}); retrying with minimal fields ${KC_PARCEL_FIELDS_MINIMAL}`);
    return arcQuery(KC_PARCELS,{...params,where:`UPPER(PIN)='${sql(id)}'`,outFields:KC_PARCEL_FIELDS_MINIMAL},'kootenai-ownership-parcel-minimal');
  }
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

const round3 = n => Math.round(n * 1000) / 1000;

export async function getKootenaiCountyIntelligence(body) {
  const parcelId=requestedParcelId(body); let parcelFeatures=[];
  try { parcelFeatures=await queryParcel(parcelId); } catch(e) { console.warn('Kootenai ownership parcel lookup failed',e); }
  let lon=Number(body.lon), lat=Number(body.lat);
  if((!Number.isFinite(lon)||!Number.isFinite(lat)) && parcelFeatures.length) { const c=centerFromGeometry(parcelFeatures[0].geometry); if(c) [lon,lat]=c; }
  const parcelAttrs=parcelFeatures[0]?.attributes||{};
  // The parcel outline (county layer first, then the one the browser sent) lets every layer below
  // be read by how much of the parcel it covers instead of at one center point, which can land in
  // a gap of the zoning map or on the wrong side of a city boundary.
  const rings=ringsFromGeometry(parcelFeatures[0]?.geometry)||ringsFromGeometry(body.geometry);
  const hasPoint=Number.isFinite(lon)&&Number.isFinite(lat);
  if(!rings&&!hasPoint) return noZoneResult(parcelFeatures,'parcel location','');
  const where={rings,lon,lat}, samples=rings?samplePoints(rings):[[lon,lat]];
  const matchMethod=rings?'parcel area (sampled)':'parcel location';

  // Who zones it. If the city-limits layer fails, carry on with county zoning (the old behaviour).
  const countyZoning=arcQuery(KC_ZONING,{...spatialParams(where),outFields:'ZONE_NAME,LABEL,ACRES'},'kootenai-zoning').then(features=>({features}),error=>({error}));
  const impactArea=findCityImpactArea(where,samples).catch(e=>{ console.warn('Kootenai city impact area lookup failed',e); return null; });
  let city=null, cityLimitsUnavailable=false;
  try { city=await findCityJurisdiction(where,samples); } catch(e) { cityLimitsUnavailable=true; console.warn('Kootenai city limits lookup failed; using county zoning',e); }
  if(city) {
    const jurisdictionNote=city.straddles?` About ${pct(city.share)} of the parcel is inside ${city.name} limits; the rest may fall under another jurisdiction.`:'';
    return getCityZoning(city,where,samples,{parcelAttrs,matchMethod,jurisdictionNote});
  }

  const {features:zoningFeatures,error}=await countyZoning; if(error) throw error;
  const covered=coverageShares(samples,zoningFeatures,a=>String(a.LABEL||a.ZONE_NAME||'').trim()).filter(s=>s.key);
  const impact=await impactArea;
  const impactNote=impact?` Inside the ${impact.city} area of city impact; Kootenai County zoning applies outside city limits.`:'';
  const top=covered[0];
  if(!top) return noZoneResult(parcelFeatures,matchMethod,impactNote,impact,cityLimitsUnavailable);
  const zone=top.key, zoningAttrs=Object.fromEntries(Object.entries(top.attributes||{}).filter(([k])=>k!=='Shape'));
  const others=covered.slice(1).filter(s=>s.share>=0.05);
  const shareNote=samples.length>1?coverageNote(top,others,1-covered.reduce((t,s)=>t+s.share,0),'county zone'):'';
  const allowedBuildings=buildingUsesForZone(zone);
  return {available:true,county:'Kootenai',state:'ID',countyStatus:'kootenai-data-layers-v3',jurisdiction:'Kootenai County',permitJurisdiction:{name:'Kootenai County'},zoning:{status:'gis_match',code:zone,name:zone,label:zone,note:`Mapped zoning designation from Kootenai County KCEarth/Data_Layers.${shareNote}${impactNote}`,sourceUrl:KC_ZONING,url:KC_PLANNING,...(others.length?{otherZones:others.map(s=>({code:s.key,share:round3(s.share)}))}:{}),...(impact?{cityImpactArea:impact}:{})},allowedBuildings,permittedUses:allowedBuildings,comprehensivePlan:{},urbanGrowthArea:{intersects:false},overlays:[],permits:[],permitHistory:[],permitHistoryStatus:'unavailable',source:{agency:'Kootenai County GIS',service:'NewServices/Data_Layers',layerId:21,matchMethod,attributes:zoningAttrs,parcelAttributes:parcelAttrs}};
}

function noZoneResult(parcelFeatures,matchMethod,impactNote,impact,cityLimitsUnavailable=false) {
  // Without the city-limits answer, an empty county result may just mean the parcel is in a city.
  const label=cityLimitsUnavailable?'No county zoning found here; the parcel may be inside a city — city limits lookup unavailable':'No mapped zoning result found';
  const cityNote=cityLimitsUnavailable?' The county city-limits layer did not answer, so the parcel may be inside a city, where city zoning applies; check with the city or Kootenai County.':'';
  return {available:false,county:'Kootenai',state:'ID',countyStatus:'kootenai-data-layers-v3',jurisdiction:'Kootenai County',permitJurisdiction:{name:'Kootenai County'},zoning:{status:'no_mapped_result',label,note:`The current Kootenai County Data_Layers zoning service returned no polygon ${matchMethod==='parcel location'?'at this parcel location':'on this parcel'}.${cityNote}${impactNote}`,sourceUrl:KC_ZONING,url:KC_PLANNING,...(impact?{cityImpactArea:impact}:{})},permits:[],permitHistory:[],permitHistoryStatus:'unavailable',source:{agency:'Kootenai County GIS',service:'NewServices/Data_Layers',layerId:21,parcelMatched:Boolean(parcelFeatures.length)}};
}
