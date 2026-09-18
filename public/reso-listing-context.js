(() => {
  let seq = 0;
  const text = v => String(v ?? '').trim();
  const money = v => Number.isFinite(Number(v)) ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(v)) : '—';
  const esc = v => text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function getLast(){ try{ if(typeof last!=='undefined'&&last?.parcel)return last; }catch(_){} return window.__acresxLast || window.last || null; }
  function parcelId(d){ return text(d?.parcelId || d?.parcel?.parcelId || d?.parcel?.properties?.PID_NUM || d?.parcel?.properties?.PARCELID || d?.parcel?.properties?.ParcelNumber || document.getElementById('parcelFact')?.textContent); }
  function address(d){ return text(d?.address || d?.parcel?.address || d?.parcel?.properties?.site_address || d?.parcel?.properties?.SITE_ADDRESS || d?.parcel?.properties?.SitusAddress || document.querySelector('.parcel-address')?.textContent); }
  function point(d){
    const p=d?.parcel||d; const lat=Number(p?.lat ?? p?.latitude ?? p?.center?.lat ?? p?.centroid?.lat); const lon=Number(p?.lon ?? p?.lng ?? p?.longitude ?? p?.center?.lon ?? p?.center?.lng ?? p?.centroid?.lon ?? p?.centroid?.lng);
    if(Number.isFinite(lat)&&Number.isFinite(lon)) return {lat,lon};
    const g=p?.geometry; if(g?.type==='Point'&&Array.isArray(g.coordinates)) return {lat:Number(g.coordinates[1]),lon:Number(g.coordinates[0])};
    return {};
  }
  function listingCard(){ return document.querySelector('.snapshot-card[data-detail="listing"]'); }
  function parts(card){
    if(!card)return {}; const value=card.querySelector('.snapshot-value'); const spans=[...card.querySelectorAll(':scope > span:not(.snapshot-icon):not(.traffic-dot):not(.chevron)')];
    return {value,status:spans[0]||null};
  }
  function paint(result){
    const card=listingCard(); if(!card)return; const p=parts(card), best=result?.best;
    card.dataset.resoState=best?'matched':'unmatched';
    if(best){
      if(p.value)p.value.textContent=best.status || 'Listing found';
      if(p.status)p.status.textContent=`${money(best.listPrice)}${best.daysOnMarket!=null?` · ${best.daysOnMarket} DOM`:''}`;
      card.title=`RESO listing match · ${result.matchConfidence||'verified'} confidence`;
    } else {
      if(p.value)p.value.textContent='No Listing Match';
      if(p.status)p.status.textContent=result?.configured===false?'Listing source not configured':'No matching listing found in the connected listing dataset';
      card.title='This does not mean the property is not listed; no sufficiently strong match was found in the connected dataset.';
    }
  }
  function detailHtml(result){
    const best=result?.best; if(!best)return `<div class="notice"><strong>No Listing Match</strong><br>No matching listing found in the connected listing dataset. This does not mean the property is not listed; AcresX did not find a sufficiently strong match in the currently connected RESO dataset.</div>`;
    const evidence=(result.matchEvidence||[]).map(x=>x.replaceAll('_',' ')).join(', ')||'RESO record';
    return `<div class="result-item"><div class="result-top"><h4>${esc(best.address||'Listing Context')}</h4><span class="badge">${esc(best.status||'RESO')}</span></div><div class="data-grid"><div class="datum"><span>List Price</span><strong>${money(best.listPrice)}</strong></div><div class="datum"><span>Days on Market</span><strong>${best.daysOnMarket??'—'}</strong></div><div class="datum"><span>MLS / Listing ID</span><strong>${esc(best.listingId||'—')}</strong></div><div class="datum"><span>Parcel Number</span><strong>${esc(best.parcelNumber||'—')}</strong></div><div class="datum"><span>Match Confidence</span><strong>${esc(result.matchConfidence||'—')}</strong></div><div class="datum"><span>Match Evidence</span><strong>${esc(evidence)}</strong></div></div>${best.publicRemarks?`<div class="notice">${esc(best.publicRemarks)}</div>`:''}<div class="notice">Listing data is supplied through the connected RESO dataset and remains subject to provider/MLS display rules. Verify listing details with the authorized MLS source.</div></div>`;
  }

  function extractInfrastructureEvidence(remarks){
    const value=String(remarks||'').replace(/\\s+/g,' ').trim();
    const out={well:[],septic:[],power:[]};
    if(!value)return out;
    const add=(bucket,claim,m,extra={})=>{if(m)out[bucket].push({claim,source:'MLS PublicRemarks',confidence:'listing_reported',phrase:String(m[0]||'').trim(),...extra});};
    let m=value.match(/\\b(?:property\\s+(?:has|includes|features)\\s+)?(one|two|three|four|five|[1-5])\\s+(?:existing\\s+|private\\s+|drilled\\s+)?wells?\\b/i);
    if(m){const n={one:1,two:2,three:3,four:4,five:5};add('well','existing_well_reported',m,{count:n[m[1].toLowerCase()]||Number(m[1])||null});}
    else add('well','existing_well_reported',value.match(/\\b(?:existing|private|drilled|domestic)\\s+well\\b|\\bwell\\s+(?:is\\s+)?(?:installed|drilled|on\\s+(?:the\\s+)?property)\\b/i));
    add('well','shared_or_community_well_reported',value.match(/\\b(?:shared|community)\\s+well\\b/i));
    add('well','well_needed_reported',value.match(/\\b(?:buyer\\s+to\\s+drill|well\\s+(?:is\\s+)?needed|needs?\\s+(?:a\\s+)?well)\\b/i));
    add('septic','septic_installed_reported',value.match(/\\b(?:existing\\s+septic|septic\\s+(?:system\\s+)?(?:is\\s+)?(?:installed|in\\s+place)|installed\\s+septic)\\b/i));
    add('septic','perc_evidence_reported',value.match(/\\b(?:perc(?:olation)?\\s+test\\s+(?:is\\s+)?(?:approved|completed|done|passed)|approved\\s+perc|perc\\s+approved)\\b/i));
    add('septic','septic_needed_reported',value.match(/\\b(?:buyer\\s+to\\s+install\\s+septic|septic\\s+(?:is\\s+)?needed|needs?\\s+(?:a\\s+)?septic(?:\\s+system)?)\\b/i));
    m=value.match(/\\b(?:power|electric(?:ity)?)\\s+(?:is\\s+)?(?:connected|installed|hooked\\s+up|on\\s+(?:the\\s+)?property)|\\bmeter\\s+(?:is\\s+)?installed\\b/i);
    if(m)add('power','power_on_property_reported',m); else add('power','power_nearby_reported',value.match(/\\b(?:power|electric(?:ity)?)\\s+(?:is\\s+)?(?:at\\s+(?:the\\s+)?road|at\\s+(?:the\\s+)?property\\s+line|nearby|available\\s+nearby)\\b/i));
    const providers=[['Inland Power',/\\bInland\\s+Power(?:\\s*(?:&|and)\\s*Light)?\\b/i],['Avista Utilities',/\\bAvista(?:\\s+Utilities)?\\b/i],['Vera Water and Power',/\\bVera\\s+(?:Water\\s+(?:and|&)\\s+)?Power\\b/i]];
    for(const [provider,re] of providers){m=value.match(re);if(m){add('power','power_provider_reported',m,{provider});break;}}
    return out;
  }
  function bestRemarks(result){return result?.best?.publicRemarks||result?.best?.PublicRemarks||'';}
  function listingEvidenceNotice(items,label){
    if(!items?.length)return '';
    return '<div class="notice"><strong>LISTING REPORTED — '+label+'</strong><br>'+items.map(x=>esc(x.phrase||x.provider||x.claim)).join(' · ')+'<br>Seller/broker supplied; verify independently before relying on this claim.</div>';
  }
  function wireInfrastructureDetails(){
    if(typeof window.renderResults!=='function'||window.renderResults.__mlsInfrastructureWrapped)return;
    const base=window.renderResults;
    const wrapped=function(...args){const out=base.apply(this,args);try{const d=getLast(),tab=typeof activeTab!=='undefined'?activeTab:null,e=d?.mlsInfrastructureEvidence;if(e&&['wells','soil','power'].includes(tab)){const box=document.querySelector('#detailCard .results-scroll');const items=tab==='wells'?e.well:tab==='soil'?e.septic:e.power;if(box&&items?.length)box.insertAdjacentHTML('afterbegin',listingEvidenceNotice(items,tab==='wells'?'Well evidence':tab==='soil'?'Septic evidence':'Power evidence'));}}catch(_){}return out;};
    wrapped.__mlsInfrastructureWrapped=true;window.renderResults=wrapped;
  }
  function wireDetails(){
    if(typeof window.renderResults!=='function'||window.renderResults.__resoWrapped)return;
    const base=window.renderResults;
    const wrapped=function(...args){ const out=base.apply(this,args); try{ const d=getLast(); if(typeof activeTab!=='undefined'&&activeTab==='listing'&&d?.resoListings){ const box=document.querySelector('#detailCard .results-scroll'); if(box)box.innerHTML=detailHtml(d.resoListings); } }catch(_){} return out; };
    wrapped.__resoWrapped=true; window.renderResults=wrapped;
  }
  async function lookup(){
    const d=getLast(); if(!d)return; const id=parcelId(d); const addr=address(d); const pt=point(d); if(!id&&!addr&&!Number.isFinite(pt.lat))return;
    const mine=++seq;
    try{
      const response=await fetch('/api/reso-listings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parcelId:id||undefined,address:addr||undefined,lat:pt.lat,lon:pt.lon})});
      const result=await response.json(); if(mine!==seq)return;
      d.resoListings=result; d.listingContext=result;
      // Supplemental infrastructure evidence is derived only after a RESO match succeeds.
      // It never participates in listing lookup/matching and is labeled as listing-reported.
      const remarks=bestRemarks(result);
      d.mlsInfrastructureEvidence=extractInfrastructureEvidence(remarks);
      window.__acresxLast=d;
      paint(result);
      if(typeof activeTab!=='undefined'&&activeTab==='listing'&&document.getElementById('detailCard')?.classList.contains('show')){ const box=document.querySelector('#detailCard .results-scroll'); if(box)box.innerHTML=detailHtml(result); }
    }catch(error){ if(mine!==seq)return; const result={available:false,status:'lookup_error',error:error?.message}; d.resoListings=result; d.listingContext=result; paint(result); }
  }
  function schedule(){ setTimeout(lookup,250); setTimeout(lookup,1100); }
  wireDetails();\n  wireInfrastructureDetails();
  if(typeof window.renderSummary==='function'){
    const base=window.renderSummary;
    window.renderSummary=function(...args){ const out=base.apply(this,args); schedule(); return out; };
  }
  const dashboard=document.querySelector('.dashboard');
  if(dashboard)new MutationObserver(()=>{ if(dashboard.classList.contains('show'))schedule(); }).observe(dashboard,{attributes:true,attributeFilter:['class']});
  document.addEventListener('click',e=>{ if(e.target.closest('.snapshot-card[data-detail="listing"] .snapshot-details-btn'))setTimeout(()=>{ const d=getLast(); if(d?.resoListings){const box=document.querySelector('#detailCard .results-scroll');if(box)box.innerHTML=detailHtml(d.resoListings);}},0); },true);
})();
