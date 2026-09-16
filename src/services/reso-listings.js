import { json } from '../shared/http.js';

const DEFAULT_FIELDS = [
  'ListingKey','ListingId','StandardStatus','ListPrice','OriginalListPrice','ClosePrice',
  'ListingContractDate','DaysOnMarket','CloseDate','ModificationTimestamp','PropertyType','PropertySubType',
  'ParcelNumber','LotSizeAcres','StreetNumber','StreetDirPrefix','StreetName','StreetSuffix','UnitNumber',
  'City','StateOrProvince','PostalCode','Latitude','Longitude','PublicRemarks',
  'ListAgentFullName','ListOfficeName','InternetAddressDisplayYN','InternetEntireListingDisplayYN'
];

function clean(v){ return String(v ?? '').trim(); }
function normParcel(v){ return clean(v).toUpperCase().replace(/[^A-Z0-9]/g,''); }
function escapeOData(v){ return clean(v).replace(/'/g,"''"); }
function configured(env){ return Boolean(clean(env?.RESO_BASE_URL) && clean(env?.RESO_TOKEN)); }
function baseUrl(env){ return clean(env.RESO_BASE_URL).replace(/\/$/,''); }
function authHeaders(env){
  const token=clean(env.RESO_TOKEN);
  return { 'Accept':'application/json', 'Authorization': token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}` };
}
function addressOf(r={}){ return [r.StreetNumber,r.StreetDirPrefix,r.StreetName,r.StreetSuffix,r.UnitNumber].filter(Boolean).join(' ').replace(/\s+/g,' ').trim(); }
function normalize(r={}){
  return {
    source:'RESO Web API', listingKey:r.ListingKey||null, listingId:r.ListingId||null,
    status:r.StandardStatus||null, listPrice:r.ListPrice??null, originalListPrice:r.OriginalListPrice??null,
    closePrice:r.ClosePrice??null, listingDate:r.ListingContractDate||null, daysOnMarket:r.DaysOnMarket??null,
    closeDate:r.CloseDate||null, modified:r.ModificationTimestamp||null, propertyType:r.PropertyType||null,
    propertySubType:r.PropertySubType||null, parcelNumber:r.ParcelNumber||null, lotSizeAcres:r.LotSizeAcres??null,
    address:addressOf(r), city:r.City||null, state:r.StateOrProvince||null, postalCode:r.PostalCode||null,
    latitude:r.Latitude??null, longitude:r.Longitude??null, publicRemarks:r.PublicRemarks||null,
    listAgent:r.ListAgentFullName||null, listOffice:r.ListOfficeName||null,
    display:{address:r.InternetAddressDisplayYN!==false,entireListing:r.InternetEntireListingDisplayYN!==false}, raw:r
  };
}
async function query(env, path){
  const response=await fetch(`${baseUrl(env)}/${path}`,{headers:authHeaders(env)});
  if(!response.ok){ const text=await response.text(); throw new Error(`RESO provider returned ${response.status}: ${text.slice(0,180)}`); }
  return response.json();
}
async function metadata(env){
  const response=await fetch(`${baseUrl(env)}/$metadata`,{headers:authHeaders(env)});
  if(!response.ok) throw new Error(`RESO metadata returned ${response.status}`);
  return response.text();
}
function chooseMatches(records, parcelId){
  const target=normParcel(parcelId);
  return records.map(normalize).sort((a,b)=>{
    const ap=normParcel(a.parcelNumber)===target?1:0,bp=normParcel(b.parcelNumber)===target?1:0;
    if(ap!==bp)return bp-ap;
    const active=s=>/^(active|activeundercontract|pending)$/i.test(clean(s));
    if(active(a.status)!==active(b.status))return active(b.status)?1:-1;
    return new Date(b.modified||b.listingDate||0)-new Date(a.modified||a.listingDate||0);
  });
}

export async function handleResoListings(request, env){
  if(!configured(env)) return json({available:false,configured:false,status:'not_configured',label:'RESO listing source is ready but credentials are not configured.'},200,'no-store');
  const body=await request.json();
  const parcelId=clean(body.parcelId), listingKey=clean(body.listingKey);
  if(!parcelId&&!listingKey) return json({available:false,error:'parcelId or listingKey is required.'},400,'no-store');
  try{
    if(body.metadata===true){ const xml=await metadata(env); return new Response(xml,{status:200,headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'}}); }
    const fields=clean(env.RESO_PROPERTY_FIELDS)||DEFAULT_FIELDS.join(',');
    let filter='';
    if(listingKey) filter=`ListingKey eq '${escapeOData(listingKey)}'`;
    else filter=`ParcelNumber eq '${escapeOData(parcelId)}'`;
    const params=new URLSearchParams({'$filter':filter,'$select':fields,'$orderby':'ModificationTimestamp desc','$top':'25'});
    const payload=await query(env,`Property?${params.toString()}`);
    const records=Array.isArray(payload?.value)?payload.value:[];
    const matches=chooseMatches(records,parcelId);
    return json({available:true,configured:true,provider:clean(env.RESO_PROVIDER)||'RESO Web API',query:{parcelId:parcelId||null,listingKey:listingKey||null},matchCount:matches.length,best:matches[0]||null,listings:matches,methodology:'Queries the provider Property resource using standard RESO fields. ParcelNumber is the primary AcresX join key; provider metadata may require a field-map override.',caution:'Listing display and downstream use remain subject to the MLS/data-provider license and display rules.'},200,'private, max-age=60');
  }catch(error){
    return json({available:false,configured:true,status:'provider_error',error:error?.message||'RESO query failed.'},502,'no-store');
  }
}
