import legacyWorker from './worker.js';
import { getZoningProfile } from './zoning-counties.js';
import { getSpokaneCountyIntelligence } from './counties/spokane.js';
import { getYellowstoneCountyIntelligence } from './counties/yellowstone.js';
import { getGallatinCountyIntelligence } from './counties/gallatin.js';
import { getKootenaiCountyIntelligence } from './counties/kootenai.js';
import { findYellowstoneParcel, findMontanaParcel } from './states/montana/parcels.js';
import { findMontanaWells } from './states/montana/wells.js';
import { findIdahoParcel } from './states/idaho/parcels.js';
import { findIdahoWells } from './states/idaho/wells.js';
import { handleLandAnalysis } from './services/land-analysis.js';
import { handleSlopeGrid } from './services/slope-grid.js';
import { handleWetlands } from './services/wetlands.js';
import { handlePowerIntelligence } from './services/power-intelligence.js';
import { handleUtilityTerritory } from './services/utility-territory.js';
import { handleZoningRules } from './services/zoning-rules.js';
import { handlePropertyTaxTest } from './services/property-tax-test.js';
import { json } from './shared/http.js';

async function handleParcelSearch(request) {
  const body = await request.json(); const state = String(body.state || '').toUpperCase().trim(); const county = String(body.county || '').replace(/\s+County$/i, '').trim(); const parcelId = String(body.parcelId || '').trim();
  if (state === 'MT') { const parcel = /^yellowstone$/i.test(county) ? await findYellowstoneParcel(parcelId) : await findMontanaParcel(parcelId, county); return json({ available: true, state: 'MT', county: county || parcel.properties?._countyDisplay || '', parcel }, 200, 'public, max-age=300, s-maxage=3600'); }
  if (state === 'ID') { const parcel = await findIdahoParcel(parcelId, county); return json({ available: true, state: 'ID', county: county || parcel.properties?._countyDisplay || '', parcel }, 200, 'public, max-age=300, s-maxage=3600'); }
  return json({ available: false, error: 'This state/county parcel adapter is not supported by the new router yet.' }, 400, 'no-store');
}
async function handleWellSearch(request) {
  const body = await request.json(); const state = String(body.state || '').toUpperCase().trim();
  if (state === 'MT') return json(await findMontanaWells({ lat: body.lat, lon: body.lon }), 200, 'public, max-age=3600, s-maxage=86400');
  if (state === 'ID') return json(await findIdahoWells({ lat: body.lat, lon: body.lon }), 200, 'public, max-age=3600, s-maxage=86400');
  return json({ available: false, error: 'New well-search router currently supports Montana and Idaho.' }, 400, 'no-store');
}
async function handleZoningPermits(request) {
  const body = await request.clone().json(); const county = String(body.county || '').replace(/\s+County$/i, '').trim(); const hasPoint = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lon)); if (!hasPoint) return null;
  if (/^spokane$/i.test(county)) { const profile = getZoningProfile(county); return json(await getSpokaneCountyIntelligence(body, profile), 200, 'public, max-age=3600, s-maxage=86400'); }
  if (/^yellowstone$/i.test(county)) return json(await getYellowstoneCountyIntelligence(body), 200, 'public, max-age=3600, s-maxage=86400');
  if (/^gallatin$/i.test(county)) return json(await getGallatinCountyIntelligence(body), 200, 'no-store');
  if (/^kootenai$/i.test(county)) return json(await getKootenaiCountyIntelligence(body), 200, 'no-store');
  return null;
}
async function runPropertyTaxBrowserTest(request) { const tests = [{ state: 'WA', county: 'Spokane', parcelId: '47174.9017' }, { state: 'MT', county: 'Yellowstone', parcelId: '03092727411010000' }]; const results = []; for(const test of tests){const r=new Request(request.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(test)});results.push(await(await handlePropertyTaxTest(r)).json());} return json({test:'AcresX property tax / assessment sources',results},200,'no-store'); }
async function maybeInjectUiPolish(request,response) { if(request.method!=='GET')return response; const url=new URL(request.url); if(url.pathname!=='/'&&url.pathname!=='/index.html')return response; const contentType=response.headers.get('Content-Type')||''; if(!contentType.includes('text/html'))return response; const html=await response.text(); const scripts=[]; for(const s of ['ui-polish','parcel-preview','score-cost','zoning-potential','snapshot-accordion','state-selector','slope-map','screening-refinements','branding-polish','library-polish','loading-modal','property-assessment','compact-overview','parcel-summary-insights','map-polish']) if(!html.includes(`/${s}.js`))scripts.push(`<script src="/${s}.js"></script>`); if(!scripts.length)return new Response(html,response); const polished=html.replace('</body>',`${scripts.join('\n')}\n</body>`); const headers=new Headers(response.headers); headers.delete('Content-Length'); return new Response(polished,{status:response.status,statusText:response.statusText,headers}); }
export default { async fetch(request,env,ctx) { const url=new URL(request.url); try {
  if(url.pathname==='/api/property-tax-test'&&request.method==='GET')return await runPropertyTaxBrowserTest(request);
  if(url.pathname==='/api/property-tax-test'&&request.method==='POST')return await handlePropertyTaxTest(request);
  if(url.pathname==='/api/property-assessment'&&request.method==='POST')return await handlePropertyTaxTest(request);
  if(request.method==='POST'&&url.pathname==='/api/parcel-search')return await handleParcelSearch(request);
  if(request.method==='POST'&&url.pathname==='/api/well-search')return await handleWellSearch(request);
  if(request.method==='POST'&&url.pathname==='/api/utility-territory')return await handleUtilityTerritory(request);
  if(request.method==='POST'&&url.pathname==='/api/land-analysis')return await handleLandAnalysis(request);
  if(request.method==='POST'&&url.pathname==='/api/slope-grid')return await handleSlopeGrid(request);
  if(request.method==='POST'&&url.pathname==='/api/hazards'){const clone=request.clone();try{const body=await clone.json();if(body?.kind==='wetlands')return await handleWetlands(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)}));}catch(_){}}
  if(request.method==='POST'&&url.pathname==='/api/power-intelligence')return await handlePowerIntelligence(request);
  if(request.method==='POST'&&url.pathname==='/api/zoning-rules')return await handleZoningRules(request);
  if(request.method==='POST'&&url.pathname==='/api/zoning-permits'){
    const clone=request.clone(); let county='';
    try { const body=await clone.json(); county=String(body?.county||'').replace(/\s+County$/i,'').trim(); } catch (_) {}
    if(/^(gallatin|kootenai)$/i.test(county)) {
      try { const response=await handleZoningPermits(request); if(response)return response; }
      catch(error){ const isKootenai=/^kootenai$/i.test(county); return json({available:false,county:isKootenai?'Kootenai':'Gallatin',state:isKootenai?'ID':'MT',countyStatus:`${county.toLowerCase()}-error`,jurisdiction:`${isKootenai?'Kootenai':'Gallatin'} County`,permitJurisdiction:{name:`${isKootenai?'Kootenai':'Gallatin'} County`},zoning:{status:'unavailable',label:`${isKootenai?'Kootenai':'Gallatin'} zoning lookup unavailable`,note:error?.message||'County GIS lookup failed.'},permits:[],error:error?.message||'County GIS lookup failed.'},502,'no-store'); }
    }
    try{const response=await handleZoningPermits(request);if(response)return response;}catch(error){console.warn('Modular county zoning adapter failed; using legacy fallback.',error);}
  }
  const response=await legacyWorker.fetch(request,env,ctx); return await maybeInjectUiPolish(request,response);
} catch(error){return json({error:error?.message||'Request failed'},502,'no-store');} } };
