(() => {
  const form = document.getElementById('searchForm');
  if (!form || document.getElementById('acresxLoadingModal')) return;

  const style = document.createElement('style');
  style.id = 'acresxLoadingModalStyles';
  style.textContent = `
    #acresxLoadingModal{position:fixed;inset:0;z-index:99990;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(14,30,22,.64);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}
    #acresxLoadingModal.show{display:flex;animation:axFade .16s ease-out}
    .ax-load-card{width:min(620px,100%);background:#fff;border:1px solid rgba(27,79,52,.12);border-radius:22px;padding:34px 38px 30px;box-shadow:0 28px 80px rgba(9,29,18,.28);text-align:center}
    .ax-load-logo{display:block;width:176px;max-width:48%;height:auto;margin:0 auto 18px;object-fit:contain}
    .ax-load-title{margin:0;font:800 27px/1.15 Manrope,Arial,sans-serif;color:#17231c}
    .ax-load-copy{margin:9px auto 24px;max-width:470px;color:#617067;font:500 13px/1.55 Manrope,Arial,sans-serif;min-height:40px}
    .ax-progress-track{height:10px;background:#e8eee9;border-radius:999px;overflow:hidden;margin:0 4px 26px;position:relative}
    .ax-progress-fill{height:100%;width:14%;border-radius:999px;background:linear-gradient(90deg,#1d8150,#2aa364);transition:width .65s cubic-bezier(.2,.8,.2,1);position:relative;overflow:hidden}
    .ax-progress-fill:after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 0 35%,rgba(255,255,255,.38) 48%,transparent 61%);transform:translateX(-100%);animation:axShimmer 1.4s linear infinite}
    .ax-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:24px}
    .ax-step{position:relative;display:flex;flex-direction:column;align-items:center;gap:7px;color:#8b9690;font:700 10px/1.25 Manrope,Arial,sans-serif}
    .ax-step-dot{width:31px;height:31px;border-radius:50%;display:grid;place-items:center;border:2px solid #dce5df;background:#fff;color:#a4afa8;font-size:12px;transition:.25s}
    .ax-step.active{color:#1d8150}.ax-step.active .ax-step-dot{border-color:#1d8150;background:#edf7f1;color:#1d8150;box-shadow:0 0 0 4px rgba(29,129,80,.08)}
    .ax-step.done{color:#315c45}.ax-step.done .ax-step-dot{border-color:#1d8150;background:#1d8150;color:#fff}
    .ax-load-note{display:flex;align-items:center;gap:12px;text-align:left;background:#eef6f1;border:1px solid #deebe3;border-radius:13px;padding:13px 15px;color:#45564c;font:600 11px/1.45 Manrope,Arial,sans-serif}
    .ax-load-note img{width:27px;height:27px;object-fit:contain;flex:0 0 auto}
    .ax-load-note strong{display:block;color:#1c5538;font-size:11px;margin-bottom:1px}
    .ax-load-error{display:none;margin-top:16px;padding:11px 13px;border-radius:10px;background:#fff2f0;color:#9a342e;font:700 11px/1.4 Manrope,Arial,sans-serif}
    .ax-load-error.show{display:block}
    @keyframes axFade{from{opacity:0}to{opacity:1}}@keyframes axShimmer{to{transform:translateX(100%)}}
    @media(max-width:620px){.ax-load-card{padding:28px 20px 24px;border-radius:18px}.ax-load-title{font-size:23px}.ax-steps{gap:3px}.ax-step{font-size:8.5px}.ax-step-dot{width:27px;height:27px}.ax-load-logo{width:150px}}
    @media(prefers-reduced-motion:reduce){#acresxLoadingModal.show,.ax-progress-fill:after{animation:none}.ax-progress-fill{transition:none}}
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.id = 'acresxLoadingModal';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-live','polite');
  modal.innerHTML = `
    <div class="ax-load-card">
      <img class="ax-load-logo" src="/assets/acresx-logo.png" alt="AcresX">
      <h2 class="ax-load-title">Analyzing Property</h2>
      <div class="ax-load-copy" id="axLoadingCopy">Finding the parcel and preparing your property analysis…</div>
      <div class="ax-progress-track" aria-hidden="true"><div class="ax-progress-fill" id="axProgressFill"></div></div>
      <div class="ax-steps">
        <div class="ax-step active" data-step="0"><div class="ax-step-dot">1</div><span>Finding Parcel</span></div>
        <div class="ax-step" data-step="1"><div class="ax-step-dot">2</div><span>Gathering Data</span></div>
        <div class="ax-step" data-step="2"><div class="ax-step-dot">3</div><span>Analyzing</span></div>
        <div class="ax-step" data-step="3"><div class="ax-step-dot">✓</div><span>Finalizing</span></div>
      </div>
      <div class="ax-load-note"><img src="/assets/favicon.png" alt=""><div><strong>Building your property snapshot</strong>Some public data sources can take 20–60 seconds to respond. You can stay on this screen while AcresX finishes the analysis.</div></div>
      <div class="ax-load-error" id="axLoadingError"></div>
    </div>`;
  document.body.appendChild(modal);

  const copy = document.getElementById('axLoadingCopy');
  const fill = document.getElementById('axProgressFill');
  const errorBox = document.getElementById('axLoadingError');
  const steps = [...modal.querySelectorAll('.ax-step')];
  const status = document.getElementById('status');
  let active = false;
  let fallbackTimers = [];
  let autoCloseTimer = null;

  const messages = [
    'Finding the parcel and preparing your property analysis…',
    'Checking wells, utilities, soils, hazards, zoning and permits…',
    'Comparing property conditions and development feasibility…',
    'Compiling the dashboard and final screening results…'
  ];
  const widths = ['16%','43%','72%','92%'];

  function setStep(index, customMessage) {
    index = Math.max(0, Math.min(3,index));
    steps.forEach((el,i)=>{
      el.classList.toggle('done', i < index);
      el.classList.toggle('active', i === index);
    });
    fill.style.width = widths[index];
    copy.textContent = customMessage || messages[index];
  }

  function clearTimers(){ fallbackTimers.forEach(clearTimeout); fallbackTimers=[]; clearTimeout(autoCloseTimer); }
  function show(){
    clearTimers(); active=true; errorBox.classList.remove('show'); errorBox.textContent=''; setStep(0); modal.classList.add('show'); document.body.style.overflow='hidden';
    fallbackTimers.push(setTimeout(()=>active&&setStep(1),1800));
    fallbackTimers.push(setTimeout(()=>active&&setStep(2),6500));
    fallbackTimers.push(setTimeout(()=>active&&setStep(3),14000));
    autoCloseTimer=setTimeout(()=>{ if(active){ copy.textContent='Still working — a data source is taking longer than usual…'; fill.style.width='96%'; } },30000);
  }
  function hide(){ if(!active)return; active=false; clearTimers(); fill.style.width='100%'; steps.forEach(s=>{s.classList.remove('active');s.classList.add('done')}); copy.textContent='Analysis complete. Opening property dashboard…'; setTimeout(()=>{modal.classList.remove('show');document.body.style.overflow='';},350); }
  function fail(message){ if(!active)return; clearTimers(); fill.style.width='100%'; fill.style.background='#b84a43'; copy.textContent='We couldn’t complete this property analysis.'; errorBox.textContent=message || 'Please check the parcel number and try again.'; errorBox.classList.add('show'); setTimeout(()=>{active=false;modal.classList.remove('show');document.body.style.overflow='';fill.style.background='';},3200); }

  function interpretStatus(raw){
    if(!active)return;
    const t=String(raw||'').trim(); if(!t)return;
    const l=t.toLowerCase();
    if(/parcel found|checking wells|utilities|listing context/.test(l)) setStep(1,t);
    if(/analyz|soil|flood|wetland|zoning|permit|power|slope|elevation/.test(l)) setStep(2,t);
    if(/compil|final|building dashboard/.test(l)) setStep(3,t);
    if(/analysis complete|complete[:.]|dashboard ready|screening complete/.test(l)) hide();
    if(/not found|unable|failed|error|invalid|multiple .* matches/.test(l)) fail(t);
  }

  // Run before the dashboard's existing submit handler so preventDefault() there does not suppress the loader.
  form.addEventListener('submit', ()=>{
    const parcel=document.getElementById('parcel');
    const state=document.getElementById('state');
    if(!parcel?.value?.trim() || (state && !state.value)) return;
    show();
  }, true);

  if(status){
    new MutationObserver(()=>interpretStatus(status.textContent)).observe(status,{subtree:true,childList:true,characterData:true,attributes:true});
  }

  // Backstop: dashboard becoming visibly populated means the analysis finished even if status wording changes later.
  const dashboard=document.getElementById('dashboard');
  if(dashboard){
    new MutationObserver(()=>{
      if(!active)return;
      const visible=getComputedStyle(dashboard).display!=='none' && dashboard.offsetHeight>0;
      const hasParcel=(document.getElementById('parcelFact')?.textContent||'').trim();
      if(visible && hasParcel && hasParcel!=='—') hide();
    }).observe(dashboard,{subtree:true,childList:true,characterData:true,attributes:true});
  }
})();
