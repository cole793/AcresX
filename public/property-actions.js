(() => {
  const STORAGE_KEY = 'acresx.savedProperties.v1';
  const $ = id => document.getElementById(id);
  const text = id => ($(id)?.textContent || '').trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function currentState() {
    const parcel = window.last?.parcel || (typeof last !== 'undefined' ? last?.parcel : null);
    if (!parcel) return null;
    const p = parcel.properties || {};
    const stateEl = $('state');
    const countyEl = $('county');
    const parcelId = p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || text('parcelFact') || $('parcel')?.value || '';
    const address = text('parcelTitle') || [p.SITUS_ADDRESS,p.SITUS_CITY_NM,p.SITUS_ZIP_NR].filter(Boolean).join(', ') || 'Selected property';
    return {
      key: `${stateEl?.value || 'WA'}:${countyEl?.value || p._countyDisplay || p.COUNTY_NM || ''}:${parcelId}`,
      state: stateEl?.value || 'WA', county: countyEl?.value || p._countyDisplay || p.COUNTY_NM || '', parcelId,
      address, acreage: text('acreageValue') || text('parcelAcreage') || '', score: text('scoreMetric') || '', savedAt: new Date().toISOString()
    };
  }

  function loadSaved() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
  function storeSaved(items) { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
  function toast(message) {
    let el = document.getElementById('propertyActionToast');
    if (!el) { el = document.createElement('div'); el.id='propertyActionToast'; document.body.appendChild(el); }
    el.textContent = message; el.classList.add('show'); clearTimeout(el._timer); el._timer=setTimeout(()=>el.classList.remove('show'),2200);
  }

  function saveCurrent() {
    const item = currentState(); if (!item) return toast('Analyze a property first.');
    const items = loadSaved(); const index = items.findIndex(x => x.key === item.key);
    if (index >= 0) items[index] = {...items[index], ...item}; else items.unshift(item);
    storeSaved(items.slice(0,100)); toast(index >= 0 ? 'Saved property updated.' : 'Property saved.');
  }

  function metric(label, value) { if (!value || value === '—') return ''; return `<div class="report-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function section(title, body) { return `<section class="report-section"><h2>${esc(title)}</h2>${body}</section>`; }

  function generateReport() {
    const item = currentState(); if (!item) return toast('Analyze a property first.');
    const parcel = window.last?.parcel || (typeof last !== 'undefined' ? last?.parcel : null);
    const p = parcel?.properties || {};
    const address = text('parcelTitle') || item.address;
    const subtitle = text('parcelAddress');
    const reportSections = [
      section('Property Overview', `<div class="report-grid">${metric('Address',address)}${metric('County',text('countyFact') || item.county)}${metric('Parcel ID',text('parcelFact') || item.parcelId)}${metric('Acreage',item.acreage)}${metric('Buildability Score',item.score)}</div>`),
      section('Development Screening', `<div class="report-grid">${metric('Well Feasibility',text('waterGrade'))}${metric('Well Depth',text('wellMetric'))}${metric('Septic Feasibility',text('soilGrade'))}${metric('Soil',text('soilMetric'))}${metric('Power',text('utilityMetric'))}${metric('Site-Work',text('slopeGrade'))}${metric('Average Grade',text('slopeMetric'))}</div>`),
      section('Land & Hazard Screening', `<div class="report-grid">${metric('Flood Screening',text('floodGrade') || text('floodStatus'))}${metric('Wetland Screening',text('wetlandGrade') || text('wetlandStatus'))}${metric('Zoning',text('zoningMetric'))}</div>`),
      section('Development Notes', `<p>${esc(text('scoreNote') || 'Preliminary public-record screening.')}</p><p><strong>Likely permits:</strong> Building, septic, well, access and critical-area approvals may apply depending on the project and jurisdiction.</p>`)
    ].join('');

    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to generate the report.');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>AcresX Property Report — ${esc(item.parcelId)}</title><style>
      *{box-sizing:border-box}body{margin:0;background:#f3f6f2;color:#18251e;font-family:Arial,sans-serif}.report{max-width:900px;margin:28px auto;background:white;padding:46px;border-radius:18px}.head{display:flex;justify-content:space-between;gap:30px;border-bottom:3px solid #185b3a;padding-bottom:25px;margin-bottom:28px}.brand{font-size:28px;font-weight:900;color:#185b3a}.kicker{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#4a7e63}.head h1{font-size:30px;margin:6px 0}.muted{color:#65736b;font-size:13px}.score{font-size:38px;font-weight:900;color:#185b3a;text-align:right}.score small{display:block;font-size:11px;color:#65736b;text-transform:uppercase}.report-section{margin:28px 0}.report-section h2{font-size:17px;border-bottom:1px solid #dce5df;padding-bottom:9px}.report-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 30px}.report-metric{padding:12px 0;border-bottom:1px solid #edf1ee}.report-metric span{display:block;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#738078}.report-metric strong{display:block;margin-top:5px;font-size:15px}.disclaimer{margin-top:35px;padding:16px;background:#f3f6f2;border-radius:10px;font-size:11px;line-height:1.5;color:#65736b}.actions{max-width:900px;margin:20px auto;display:flex;justify-content:flex-end}.actions button{border:0;border-radius:9px;background:#185b3a;color:white;padding:12px 18px;font-weight:800;cursor:pointer}@media print{body{background:white}.actions{display:none}.report{margin:0;max-width:none;padding:28px;border-radius:0}@page{margin:.45in}}@media(max-width:650px){.report{margin:0;padding:24px;border-radius:0}.report-grid{grid-template-columns:1fr}.head{display:block}.score{text-align:left;margin-top:20px}}
    </style></head><body><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div><main class="report"><div class="head"><div><div class="brand">AcresX</div><div class="kicker">Property Development Screening Report</div><h1>${esc(address)}</h1><div class="muted">${esc(subtitle)} · ${esc(item.county)} County · Parcel ${esc(item.parcelId)}</div></div><div class="score">${esc(item.score || '—')}<small>Buildability score</small></div></div>${reportSections}<div class="disclaimer"><strong>Preliminary screening only.</strong> AcresX compiles public-record and mapped data to support early land research. Results are not a survey, wetland delineation, septic design, title report, utility availability confirmation, zoning determination, engineering analysis, or guarantee of development approval. Verify findings with the applicable county, agencies, utilities, licensed professionals, and recorded CCRs/HOA documents before purchase or development.</div><div class="muted" style="margin-top:14px">Generated ${esc(new Date().toLocaleString())}</div></main></body></html>`);
    w.document.close();
  }

  function init() {
    const topActions = document.querySelector('.top-actions'); if (!topActions) return;
    const buttons = topActions.querySelectorAll('button'); const saveBtn=buttons[0], reportBtn=buttons[1];
    if (saveBtn) { saveBtn.disabled=false; saveBtn.id='savePropertyBtn'; saveBtn.addEventListener('click',saveCurrent); }
    if (reportBtn) { reportBtn.disabled=false; reportBtn.id='generateReportBtn'; reportBtn.addEventListener('click',generateReport); }
    const style=document.createElement('style'); style.textContent=`#propertyActionToast{position:fixed;right:24px;bottom:24px;background:#174f34;color:white;padding:12px 16px;border-radius:10px;font-weight:800;box-shadow:0 10px 30px #0003;opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s;z-index:99999}#propertyActionToast.show{opacity:1;transform:none}`; document.head.appendChild(style);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
