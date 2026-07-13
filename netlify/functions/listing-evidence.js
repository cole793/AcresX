const POWER_PATTERNS = [
  { re: /power\s+(?:is\s+)?(?:available|at|along|near|to)\s+(?:the\s+)?(?:road|property|lot|site)/i, label: 'Power nearby' },
  { re: /(?:electricity|electrical service|electric service)\s+(?:is\s+)?available/i, label: 'Electric service available' },
  { re: /power\s+(?:is\s+)?(?:on[- ]?site|on\s+(?:the\s+)?property|installed|connected)/i, label: 'Power onsite' },
  { re: /(?:meter|transformer)\s+(?:is\s+)?(?:installed|on[- ]?site|on\s+(?:the\s+)?property|nearby|at\s+(?:the\s+)?road)/i, label: 'Electrical equipment mentioned' },
  { re: /off[- ]?grid|no\s+(?:power|electricity)|power\s+not\s+available/i, label: 'Power limitation' },
  { re: /buyer\s+to\s+verify\s+(?:all\s+)?utilities|utilities\s+unknown/i, label: 'Utilities unverified' }
];
const allowedHosts = /(^|\.)(landwatch|landsearch|landandfarm|landsofamerica|realtor|redfin|homes|trulia|zillow|compass|coldwellbanker|century21|kw|windermere|johnlscott|realty|properties)\./i;
function clean(v=''){return String(v).replace(/\s+/g,' ').trim()}
function classify(text){for(const p of POWER_PATTERNS){const m=text.match(p.re);if(m){const i=Math.max(0,m.index-110), j=Math.min(text.length,m.index+m[0].length+150);return {classification:p.label,evidence:clean(text.slice(i,j))}}}return null}
exports.handler=async(event)=>{
  if(event.httpMethod!=='POST')return {statusCode:405,body:JSON.stringify({error:'Method not allowed'})};
  const key=process.env.GOOGLE_SEARCH_API_KEY, cx=process.env.GOOGLE_SEARCH_ENGINE_ID;
  if(!key||!cx)return {statusCode:503,body:JSON.stringify({status:'unavailable',error:'Netlify search credentials are not configured.',matches:[]})};
  let body={};try{body=JSON.parse(event.body||'{}')}catch{return {statusCode:400,body:JSON.stringify({error:'Invalid request'})}}
  const parcelId=clean(body.parcelId), address=clean(body.address), county=clean(body.county);
  if(!parcelId&&!address)return {statusCode:400,body:JSON.stringify({error:'Parcel identifier or address required'})};
  const identity=[parcelId?`"${parcelId}"`:'',address?`"${address}"`:'',county?`${county} Washington`:'' ].filter(Boolean).join(' OR ');
  const terms='("power at road" OR "power available" OR "power on property" OR "electricity available" OR "meter installed" OR "transformer nearby" OR "off grid" OR utilities)';
  const url=new URL('https://www.googleapis.com/customsearch/v1');url.searchParams.set('key',key);url.searchParams.set('cx',cx);url.searchParams.set('q',`${identity} ${terms}`);url.searchParams.set('num','10');
  try{
    const response=await fetch(url);const data=await response.json();if(!response.ok)throw new Error(data.error?.message||`Search API returned ${response.status}`);
    const matches=[];
    for(const item of data.items||[]){
      let host='';try{host=new URL(item.link).hostname}catch{}
      const combined=clean(`${item.title||''}. ${item.snippet||''}`), hit=classify(combined);if(!hit)continue;
      const parcelMatch=parcelId&&combined.replace(/[^A-Z0-9]/gi,'').toUpperCase().includes(parcelId.replace(/[^A-Z0-9]/g,'').toUpperCase());
      const addressTokens=address.toLowerCase().split(/\W+/).filter(x=>x.length>3), addressScore=addressTokens.length?addressTokens.filter(t=>combined.toLowerCase().includes(t)).length/addressTokens.length:0;
      const confidence=parcelMatch||addressScore>=.65?'High':addressScore>=.35?'Moderate':'Low';
      if(confidence==='Low'&&!allowedHosts.test(host))continue;
      matches.push({title:clean(item.title),url:item.link,source:host.replace(/^www\./,''),snippet:clean(item.snippet),classification:hit.classification,evidence:hit.evidence,confidence});
    }
    matches.sort((a,b)=>({High:3,Moderate:2,Low:1}[b.confidence]-({High:3,Moderate:2,Low:1}[a.confidence])));
    const best=matches[0];return {statusCode:200,headers:{'Content-Type':'application/json'},body:JSON.stringify(matches.length?{status:'found',summary:best.classification,confidence:best.confidence,matches:matches.slice(0,5)}:{status:'none',summary:'No public power statement found',confidence:'Low',matches:[]})};
  }catch(err){return {statusCode:502,body:JSON.stringify({status:'unavailable',error:err.message,matches:[]})}}
};
