import { json } from '../shared/http.js';

const DEFAULT_FIELDS = [
  'ListingKey','ListingId','StandardStatus','ListPrice','OriginalListPrice','ClosePrice',
  'ListingContractDate','DaysOnMarket','CloseDate','ModificationTimestamp','PropertyType','PropertySubType',
  'ParcelNumber','LotSizeAcres','StreetNumber','StreetDirPrefix','StreetName','StreetSuffix','UnitNumber',
  'City','StateOrProvince','PostalCode','Latitude','Longitude','PublicRemarks',
  'ListAgentFullName','ListOfficeName','InternetAddressDisplayYN','InternetEntireListingDisplayYN'
];
const DIAGNOSTIC_FIELDS = [
  'ListingKey','ListingId','ParcelNumber','StandardStatus','ModificationTimestamp',
  'StreetNumber','StreetDirPrefix','StreetName','StreetSuffix','UnitNumber','City','StateOrProvince','PostalCode'
];

function clean(v){ return String(v ?? '').trim(); }
function normParcel(v){ return clean(v).toUpperCase().replace(/[^A-Z0-9]/g,''); }
function escapeOData(v){ return clean(v).replace(/'/g,"''"); }
function baseUrl(env){ return clean(env?.RESO_BASE_URL).replace(/\/$/,''); }
function provider(env){ return clean(env?.RESO_PROVIDER).toLowerCase(); }
function isBridge(env){ return provider(env)==='bridge' || /bridgedataoutput\.com/i.test(baseUrl(env)); }
function hasStaticToken(env){ return Boolean(clean(env?.RESO_TOKEN)); }
function hasClientCredentials(env){ return Boolean(clean(env?.RESO_TOKEN_URL)&&clean(env?.RESO_CLIENT_ID)&&clean(env?.RESO_CLIENT_SECRET)); }
function configured(env){ return Boolean(baseUrl(env) && (hasStaticToken(env)||hasClientCredentials(env))); }
function addressOf(r={}){ return [r.StreetNumber,r.StreetDirPrefix,r.StreetName,r.StreetSuffix,r.UnitNumber].filter(Boolean).join(' ').replace(/\s+/g,' ').trim(); }
function normalize(r={}){
  return {
    source:'RESO Web API',listingKey:r.ListingKey||null,listingId:r.ListingId||null,status:r.StandardStatus||null,
    listPrice:r.ListPrice??null,originalListPrice:r.OriginalListPrice??null,closePrice:r.ClosePrice??null,
    listingDate:r.ListingContractDate||null,daysOnMarket:r.DaysOnMarket??null,closeDate:r.CloseDate||null,
    modified:r.ModificationTimestamp||null,propertyType:r.PropertyType||null,propertySubType:r.PropertySubType||null,
    parcelNumber:r.ParcelNumber||null,lotSizeAcres:r.LotSizeAcres??null,address:addressOf(r),city:r.City||null,
    state:r.StateOrProvince||null,postalCode:r.PostalCode||null,latitude:r.Latitude??null,longitude:r.Longitude??null,
    publicRemarks:r.PublicRemarks||null,listAgent:r.ListAgentFullName||null,listOffice:r.ListOfficeName||null,
    display:{address:r.InternetAddressDisplayYN!==false,entireListing:r.InternetEntireListingDisplayYN!==false},raw:r
  };
}

async function accessToken(env){
  if(hasStaticToken(env)){const token=clean(env.RESO_TOKEN);return token.toLowerCase().startsWith('bearer ')?token.slice(7).trim():token;}
  const form=new URLSearchParams({grant_type:'client_credentials',client_id:clean(env.RESO_CLIENT_ID),client_secret:clean(env.RESO_CLIENT_SECRET)});
  if(clean(env.RESO_SCOPE))form.set('scope',clean(env.RESO_SCOPE));
  const response=await fetch(clean(env.RESO_TOKEN_URL),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:form.toString()});
  if(!response.ok){const text=await response.text();throw new Error(`RESO OAuth returned ${response.status}: ${text.slice(0,180)}`);}
  const payload=await response.json();if(!payload?.access_token)throw new Error('RESO OAuth response did not include access_token.');return payload.access_token;
}

async function providerFetch(env,path,accept='application/json'){
  const token=await accessToken(env);
  const url=new URL(`${baseUrl(env)}/${String(path).replace(/^\//,'')}`);
  const headers={'Accept':accept,'OData-Version':'4.0'};
  if(isBridge(env)) url.searchParams.set('access_token',token);
  else headers.Authorization=`Bearer ${token}`;
  const response=await fetch(url.toString(),{headers});
  if(!response.ok){const text=await response.text();throw new Error(`RESO provider returned ${response.status}: ${text.slice(0,180)}`);}
  return response;
}
async function query(env,path){return (await providerFetch(env,path)).json();}
async function metadata(env){return (await providerFetch(env,'$metadata','application/xml')).text();}
function chooseMatches(records,parcelId){const target=normParcel(parcelId);return records.map(normalize).sort((a,b)=>{const ap=normParcel(a.parcelNumber)===target?1:0,bp=normParcel(b.parcelNumber)===target?1:0;if(ap!==bp)return bp-ap;const active=s=>/^(active|activeundercontract|pending)$/i.test(clean(s));if(active(a.status)!==active(b.status))return active(b.status)?1:-1;return new Date(b.modified||b.listingDate||0)-new Date(a.modified||a.listingDate||0);});}
async function diagnostic(env){
  const params=new URLSearchParams({'$select':DIAGNOSTIC_FIELDS.join(','),'$top':'5'});
  const payload=await query(env,`Property?${params.toString()}`);
  const records=Array.isArray(payload?.value)?payload.value:[];
  return {
    available:true,configured:true,diagnostic:true,provider:clean(env.RESO_PROVIDER)||'RESO Web API',
    dataset:baseUrl(env).split('/').pop()||null,authMode:isBridge(env)?'bridge_server_token':'bearer',
    recordCount:records.length,fields:DIAGNOSTIC_FIELDS,
    records:records.map(r=>({
      listingKey:r.ListingKey??null,listingId:r.ListingId??null,parcelNumber:r.ParcelNumber??null,
      status:r.StandardStatus??null,modified:r.ModificationTimestamp??null,address:addressOf(r),
      city:r.City??null,state:r.StateOrProvince??null,postalCode:r.PostalCode??null
    })),
    note:'Safe diagnostic sample from the configured RESO Property resource. Authentication credentials are never returned.'
  };
}

export async function handleResoListings(request,env){
  if(!configured(env))return json({available:false,configured:false,status:'not_configured',label:'RESO adapter is installed. Configure a service root plus either a server token or OAuth client credentials.',required:['RESO_BASE_URL','RESO_TOKEN or RESO_TOKEN_URL + RESO_CLIENT_ID + RESO_CLIENT_SECRET'],optional:['RESO_SCOPE','RESO_PROVIDER','RESO_PROPERTY_FIELDS']},200,'no-store');
  const body=await request.json();const parcelId=clean(body.parcelId),listingKey=clean(body.listingKey),listingId=clean(body.listingId);
  try{
    if(body.metadata===true){const xml=await metadata(env);return new Response(xml,{status:200,headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'}});}
    if(body.diagnostic===true)return json(await diagnostic(env),200,'no-store');
    if(!parcelId&&!listingKey&&!listingId)return json({available:false,error:'parcelId, listingKey, or listingId is required.'},400,'no-store');
    const fields=clean(env.RESO_PROPERTY_FIELDS)||DEFAULT_FIELDS.join(',');
    const filter=listingKey?`ListingKey eq '${escapeOData(listingKey)}'`:listingId?`ListingId eq '${escapeOData(listingId)}'`:`ParcelNumber eq '${escapeOData(parcelId)}'`;
    const params=new URLSearchParams({'$filter':filter,'$select':fields,'$orderby':'ModificationTimestamp desc','$top':'25'});
    const payload=await query(env,`Property?${params.toString()}`),records=Array.isArray(payload?.value)?payload.value:[],matches=chooseMatches(records,parcelId);
    return json({available:true,configured:true,provider:clean(env.RESO_PROVIDER)||'RESO Web API',dataset:baseUrl(env).split('/').pop()||null,authMode:isBridge(env)?'bridge_server_token':'bearer',query:{parcelId:parcelId||null,listingKey:listingKey||null,listingId:listingId||null},matchCount:matches.length,best:matches[0]||null,listings:matches,methodology:'Queries the RESO Property resource using ParcelNumber as the primary AcresX join key. ListingKey and ListingId are also supported for diagnostics and direct lookup.',caution:'Listing display and downstream use remain subject to the MLS/data-provider license and display rules.'},200,'private, max-age=60');
  }catch(error){return json({available:false,configured:true,status:'provider_error',provider:clean(env.RESO_PROVIDER)||'RESO Web API',error:error?.message||'RESO query failed.'},502,'no-store');}
}
