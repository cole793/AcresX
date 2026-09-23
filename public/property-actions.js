(() => {
  const SAVED_KEY = 'acresx.savedProperties.v2';
  const REPORTS_KEY = 'acresx.reports.v1';
  const $ = id => document.getElementById(id);
  const text = id => ($(id)?.textContent || '').trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function read(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
  function write(key, items) { localStorage.setItem(key, JSON.stringify(items)); }
  function stateName(code) { return code === 'MT' ? 'Montana' : code === 'WA' ? 'Washington' : code || ''; }

  function currentState() {
    const parcel = window.last?.parcel || (typeof last !== 'undefined' ? last?.parcel : null);
    if (!parcel) return null;
    const p = parcel.properties || {};
    const stateEl = $('state');
    const countyEl = $('county');
    const parcelId = p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || text('parcelFact') || $('parcel')?.value || '';
    const title = text('parcelTitle');
    const address = title && title !== '—' ? title : [p.SITUS_ADDRESS,p.SITUS_CITY_NM,p.SITUS_ZIP_NR].filter(Boolean).join(', ');
    return {
      key: `${stateEl?.value || 'WA'}:${countyEl?.value || p._countyDisplay || p.COUNTY_NM || ''}:${parcelId}`,
      state: stateEl?.value || 'WA',
      county: countyEl?.value || p._countyDisplay || p.COUNTY_NM || '',
      parcelId,
      address: address || 'No situs address',
      acreage: text('acreageValue') || text('parcelAcreage') || '',
      score: text('scoreMetric') || '',
      // Save a parcel location for the optional Saved Properties map.
      // Existing saved entries without coordinates remain available in List view.
      location: (() => {
        try {
          const center = turf.centroid(parcel).geometry.coordinates;
          return center.length === 2 && center.every(Number.isFinite)
            ? { lat: center[1], lng: center[0] } : null;
        } catch { return null; }
      })(),
      savedAt: new Date().toISOString()
    };
  }

  function toast(message) {
    let el = $('propertyActionToast');
    if (!el) { el = document.createElement('div'); el.id='propertyActionToast'; document.body.appendChild(el); }
    el.textContent = message; el.classList.add('show'); clearTimeout(el._timer); el._timer=setTimeout(()=>el.classList.remove('show'),2200);
  }

  function askName({title, description, action, placeholder='e.g. Smith Parcel, Lot 3, Client 1042'}) {
    return new Promise(resolve => {
      let modal = $('propertyNameModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id='propertyNameModal';
        modal.innerHTML = `<div class="name-dialog" role="dialog" aria-modal="true"><div class="name-kicker">AcresX</div><h2 id="nameDialogTitle"></h2><p id="nameDialogDescription"></p><label for="propertyReferenceName">Property name or reference ID</label><input id="propertyReferenceName" maxlength="80" autocomplete="off"><div class="name-actions"><button type="button" class="ghost" id="cancelPropertyName">Cancel</button><button type="button" class="primary" id="confirmPropertyName"></button></div></div>`;
        document.body.appendChild(modal);
      }
      const input=$('propertyReferenceName'), confirm=$('confirmPropertyName');
      $('nameDialogTitle').textContent=title;
      $('nameDialogDescription').textContent=description;
      confirm.textContent=action;
      input.value=''; input.placeholder=placeholder;
      modal.classList.add('show');
      setTimeout(()=>input.focus(),50);
      const close = value => { modal.classList.remove('show'); resolve(value); };
      const accept = () => { const value=input.value.trim(); if(!value){input.focus(); input.classList.add('invalid'); setTimeout(()=>input.classList.remove('invalid'),700); return;} close(value); };
      $('cancelPropertyName').onclick=()=>close(null);
      confirm.onclick=accept;
      input.onkeydown=e=>{if(e.key==='Enter')accept();if(e.key==='Escape')close(null)};
      modal.onclick=e=>{if(e.target===modal)close(null)};
    });
  }

  async function saveCurrent() {
    const item = currentState(); if (!item) return toast('Analyze a property first.');
    const name = await askName({title:'Save property',description:'Give this property a name or reference so it is easy to recognize later.',action:'Save property'});
    if (!name) return;
    const items = read(SAVED_KEY); const index = items.findIndex(x => x.key === item.key);
    const saved = {...item, name, savedAt:new Date().toISOString()};
    if (index >= 0) items[index] = {...items[index], ...saved}; else items.unshift(saved);
    write(SAVED_KEY, items.slice(0,100)); toast(index >= 0 ? 'Saved property updated.' : 'Property saved.');
    refreshLibraryIfOpen();
  }

  function metric(label, value) { if (!value || value === '—') return ''; return `<div class="report-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function section(title, body) { return `<section class="report-section"><h2>${esc(title)}</h2>${body}</section>`; }

  async function generateReport() {
    const item = currentState(); if (!item) return toast('Analyze a property first.');
    const name = await askName({title:'Generate report',description:'Add a client name, property nickname, or internal reference ID for this report.',action:'Generate report'});
    if (!name) return;
    const address = text('parcelTitle') && text('parcelTitle') !== '—' ? text('parcelTitle') : item.address;
    const subtitle = text('parcelAddress');
    const reportSections = [
      section('Property Overview', `<div class="report-grid">${metric('Property Reference',name)}${metric('Address',address)}${metric('County',text('countyFact') || item.county)}${metric('Parcel ID',text('parcelFact') || item.parcelId)}${metric('Acreage',item.acreage)}${metric('Buildability Score',item.score)}</div>`),
      section('Development Screening', `<div class="report-grid">${metric('Well Feasibility',text('waterGrade'))}${metric('Well Depth',text('wellMetric'))}${metric('Septic Feasibility',text('soilGrade'))}${metric('Soil',text('soilMetric'))}${metric('Power',text('utilityMetric'))}${metric('Site-Work',text('slopeGrade'))}${metric('Average Grade',text('slopeMetric'))}</div>`),
      section('Land & Hazard Screening', `<div class="report-grid">${metric('Flood Screening',text('floodGrade') || text('floodStatus'))}${metric('Wetland Screening',text('wetlandGrade') || text('wetlandStatus'))}${metric('Zoning',text('zoningMetric'))}</div>`),
      section('Development Notes', `<p>${esc(text('scoreNote') || 'Preliminary public-record screening.')}</p><p><strong>Likely permits:</strong> Building, septic, well, access and critical-area approvals may apply depending on the project and jurisdiction.</p>`)
    ].join('');

    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to generate the report.');
    const reportEntry={id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name,...item,generatedAt:new Date().toISOString()};
    const reports=read(REPORTS_KEY); reports.unshift(reportEntry); write(REPORTS_KEY,reports.slice(0,100)); refreshLibraryIfOpen();

    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} — AcresX Property Report</title><style>
      *{box-sizing:border-box}body{margin:0;background:#f3f6f2;color:#18251e;font-family:Arial,sans-serif}.report{max-width:900px;margin:28px auto;background:white;padding:46px;border-radius:18px}.head{display:flex;justify-content:space-between;gap:30px;border-bottom:3px solid #185b3a;padding-bottom:25px;margin-bottom:28px}.brand{font-size:28px;font-weight:900;color:#185b3a}.kicker{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#4a7e63}.reference{font-size:13px;font-weight:800;color:#185b3a;margin-top:10px}.head h1{font-size:30px;margin:6px 0}.muted{color:#65736b;font-size:13px}.score{font-size:38px;font-weight:900;color:#185b3a;text-align:right}.score small{display:block;font-size:11px;color:#65736b;text-transform:uppercase}.report-section{margin:28px 0}.report-section h2{font-size:17px;border-bottom:1px solid #dce5df;padding-bottom:9px}.report-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 30px}.report-metric{padding:12px 0;border-bottom:1px solid #edf1ee}.report-metric span{display:block;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#738078}.report-metric strong{display:block;margin-top:5px;font-size:15px}.disclaimer{margin-top:35px;padding:16px;background:#f3f6f2;border-radius:10px;font-size:11px;line-height:1.5;color:#65736b}.actions{max-width:900px;margin:20px auto;display:flex;justify-content:flex-end}.actions button{border:0;border-radius:9px;background:#185b3a;color:white;padding:12px 18px;font-weight:800;cursor:pointer}@media print{body{background:white}.actions{display:none}.report{margin:0;max-width:none;padding:28px;border-radius:0}@page{margin:.45in}}@media(max-width:650px){.report{margin:0;padding:24px;border-radius:0}.report-grid{grid-template-columns:1fr}.head{display:block}.score{text-align:left;margin-top:20px}}
    </style></head><body><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div><main class="report"><div class="head"><div><div class="brand">AcresX</div><div class="kicker">Property Development Screening Report</div><div class="reference">${esc(name)}</div><h1>${esc(address)}</h1><div class="muted">${esc(subtitle)} · ${esc(item.county)} County · Parcel ${esc(item.parcelId)}</div></div><div class="score">${esc(item.score || '—')}<small>Buildability score</small></div></div>${reportSections}<div class="disclaimer"><strong>Preliminary screening only.</strong> AcresX compiles public-record and mapped data to support early land research. Results are not a survey, wetland delineation, septic design, title report, utility availability confirmation, zoning determination, engineering analysis, or guarantee of development approval. Verify findings with the applicable county, agencies, utilities, licensed professionals, and recorded CCRs/HOA documents before purchase or development.</div><div class="muted" style="margin-top:14px">Generated ${esc(new Date().toLocaleString())}</div></main></body></html>`);
    w.document.close();
  }

  function ensureLibraryView(){
    let view=$('propertyLibraryView'); if(view)return view;
    const main=document.querySelector('.workspace main'); if(!main)return null;
    view=document.createElement('section'); view.id='propertyLibraryView'; view.className='property-library'; view.style.display='none'; main.prepend(view); return view;
  }
  function pageNodes(){return ['search-card','status','emptyState','dashboard'].map(id=>$(id)).filter(Boolean)}
  function showDashboard(){ const v=ensureLibraryView(); if(v)v.style.display='none'; pageNodes().forEach(n=>n.style.removeProperty('display')); setActiveNav('Property Dashboard'); }
  function setActiveNav(label){document.querySelectorAll('.sidebar .nav button').forEach(b=>b.classList.toggle('active',(b.textContent||'').includes(label)))}
  function humanDate(value){try{return new Date(value).toLocaleString()}catch{return ''}}

  function openSavedProperty(item){
    showDashboard();
    const state=$('state'),county=$('county'),parcel=$('parcel');
    if(!state||!county||!parcel)return;
    state.value=item.state; state.dispatchEvent(new Event('change',{bubbles:true}));
    setTimeout(()=>{county.value=item.county; parcel.value=item.parcelId; const form=$('searchForm'); if(form)form.requestSubmit();},50);
  }

  let savedViewMode = 'split';
  let savedMarkers = new Map();
  let savedBasemap = 'street';
  let savedMap = null;
  async function backfillSavedLocations(items, view) {
    const missing = items.filter(item => !item.location &&
      item.parcelId && item.county && item.state === 'WA' &&
      typeof countyCodes !== 'undefined' && countyCodes[item.county]);
    if (!missing.length || typeof findParcel !== 'function' || typeof turf === 'undefined') return;
    const notice = document.createElement('p');
    notice.className = 'saved-map-note';
    notice.textContent = 'Locating ' + missing.length + ' previously saved ' +
      (missing.length === 1 ? 'parcel' : 'parcels') + '…';
    view.querySelector('#savedPropertiesMap')?.after(notice);
    let found = 0;
    // Resolve the saved parcel IDs against the same county parcel source used by search.
    // Never guess a location from the property name or a nearby address.
    for (const item of missing) {
      if (view.style.display === 'none' || !view.querySelector('#savedPropertiesMap')) break;
      try {
        const parcel = await findParcel(item.county, String(item.parcelId));
        const center = turf.centroid(parcel).geometry.coordinates;
        if (!center.every(Number.isFinite)) continue;
        const saved = read(SAVED_KEY);
        const target = saved.find(x => x.key === item.key);
        if (!target || target.location) continue;
        target.location = { lat: center[1], lng: center[0] };
        write(SAVED_KEY, saved);
        found++;
      } catch (error) {
        console.warn('[AcresX saved map] Could not locate saved parcel', item.key, error);
      }
    }
    notice.remove();
    if (found && view.style.display !== 'none' && view.querySelector('#savedPropertiesMap')) {
      renderLibrary('saved');
    }
  }
  function showSavedMap(items, view) {
    const container = view.querySelector('#savedPropertiesMap');
    if (!container) return;
    const located = items.filter(item => item.location &&
      Number.isFinite(item.location.lat) && Number.isFinite(item.location.lng) &&
      Math.abs(item.location.lat) <= 90 && Math.abs(item.location.lng) <= 180);
    if (typeof L === 'undefined') {
      container.textContent = 'Map unavailable. Your saved properties remain in List view.';
      return;
    }
    if (!located.length) {
      container.textContent = items.length
        ? 'Locating previously saved parcels from their parcel IDs…'
        : 'Save a property to see it on the map.';
      if (items.length) backfillSavedLocations(items, view);
      return;
    }
    savedMap = L.map(container, { scrollWheelZoom: true });
    savedMarkers = new Map();
    const esriAttribution = 'Tiles &copy; Esri and its data providers';
    const imagery = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, maxNativeZoom: 19, attribution: esriAttribution }
    );
    const labels = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, maxNativeZoom: 19, attribution: esriAttribution }
    );
    const street = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OpenStreetMap contributors &copy; CARTO' }
    );
    // The legacy Esri imagery endpoint can return an API-access tile instead
    // of an image. Fall back to the working street basemap rather than
    // displaying that tile across the saved-property map.
    let imageryUnavailable = false;
    let imageryErrorCount = 0;
    imagery.on('tileerror', () => {
      if (++imageryErrorCount < 2 || imageryUnavailable) return;
      imageryUnavailable = true;
      setBasemap('street');
      toast('Satellite imagery needs provider access. Showing Street view instead.');
    });
    function setBasemap(mode) {
      [imagery, labels, street].forEach(layer => savedMap.removeLayer(layer));
      if (mode === 'street' || imageryUnavailable) {
        mode = 'street';
        street.addTo(savedMap);
        if (imageryUnavailable) {
          const hybridButton = container.querySelector('[data-basemap="hybrid"]');
          if (hybridButton) {
            hybridButton.disabled = true;
            hybridButton.title = 'Satellite imagery requires a licensed map provider';
          }
        }
      } else { imagery.addTo(savedMap); labels.addTo(savedMap); }
      savedBasemap = mode;
      container.querySelectorAll('.saved-basemap-btn').forEach(button => {
        const selected = button.dataset.basemap === mode;
        button.classList.toggle('saved-basemap-active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
    }
    const basemapControls = document.createElement('div');
    basemapControls.className = 'saved-basemap-controls';
    basemapControls.setAttribute('role', 'group');
    basemapControls.setAttribute('aria-label', 'Map style');
    [['hybrid', 'Hybrid'], ['street', 'Street']].forEach(([mode, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'saved-basemap-btn';
      button.dataset.basemap = mode;
      button.textContent = label;
      button.onclick = () => setBasemap(mode);
      basemapControls.appendChild(button);
    });
    container.appendChild(basemapControls);
    L.DomEvent.disableClickPropagation(basemapControls);
    L.DomEvent.disableScrollPropagation(basemapControls);
    setBasemap(savedBasemap);
    const bounds = [];
    located.forEach(item => {
      const point = [item.location.lat, item.location.lng];
      bounds.push(point);
      const marker = L.marker(point).addTo(savedMap);
      const popup = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = item.name || 'Untitled property';
      const detail = document.createElement('div');
      detail.textContent = item.county + ' County · Parcel ' + item.parcelId;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Open property';
      button.className = 'ghost';
      button.style.marginTop = '8px';
      button.onclick = () => openSavedProperty(item);
      popup.append(heading, detail, button);
      marker.bindPopup(popup);
      savedMarkers.set(item.key, marker);
    });
    if (bounds.length === 1) savedMap.setView(bounds[0], 13);
    else savedMap.fitBounds(bounds, { padding: [35, 35], maxZoom: 13 });
    requestAnimationFrame(() => savedMap?.invalidateSize());
    const missing = items.length - located.length;
    if (missing) {
      const notice = document.createElement('p');
      notice.className = 'saved-map-note';
      notice.textContent = missing + ' saved ' + (missing === 1 ? 'property is' : 'properties are') +
        ' not mapped yet. AcresX will look up supported parcel IDs automatically; unmatched parcels remain in List view.';
      container.after(notice);
      backfillSavedLocations(items, view);
    }
  }

  function renderLibrary(type){
    const view=ensureLibraryView(); if(!view)return;
    if (savedMap) { savedMap.remove(); savedMap = null; }
    pageNodes().forEach(n=>n.style.display='none'); view.style.display='block'; setActiveNav(type==='saved'?'Saved Properties':'Reports');
    const items=read(type==='saved'?SAVED_KEY:REPORTS_KEY);
    const title=type==='saved'?'Saved Properties':'Reports';
    const subtitle=type==='saved'?'Properties saved on this browser during the AcresX beta.':'Report history saved on this browser.';
    view.innerHTML=`<div class="library-head"><div><div class="eyebrow">Beta workspace</div><h2>${title}</h2><p>${subtitle}</p></div><button type="button" class="ghost" id="libraryBack">Back to Dashboard</button></div><div class="library-list">${items.length?'':`<div class="library-empty">No ${type==='saved'?'saved properties':'reports'} yet.</div>`}</div>`;
    $('libraryBack').onclick=showDashboard;
    const list=view.querySelector('.library-list');
    if (type === 'saved') {
      const controls = document.createElement('div');
      controls.className = 'saved-view-controls';
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', 'Saved properties view');
      [['split', 'List + Map'], ['list', 'List only'], ['map', 'Map only']].forEach(([mode, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ghost' + (savedViewMode === mode ? ' saved-view-active' : '');
        button.textContent = label;
        button.setAttribute('aria-pressed', String(savedViewMode === mode));
        button.onclick = () => { savedViewMode = mode; renderLibrary('saved'); };
        controls.appendChild(button);
      });
      list.before(controls);
      if (savedViewMode !== 'list') {
        const layout = document.createElement('div');
        layout.className = 'saved-split-layout' + (savedViewMode === 'map' ? ' saved-map-only' : '');
        list.before(layout);
        layout.appendChild(list);
        const map = document.createElement('div');
        map.id = 'savedPropertiesMap';
        map.className = 'saved-properties-map';
        layout.appendChild(map);
        if (savedViewMode === 'map') list.style.display = 'none';
      }
    }
    items.forEach(item=>{
      const card=document.createElement('article'); card.className='library-card';
      card.innerHTML=`<div class="library-card-main"><div class="library-name">${esc(item.name || 'Untitled property')}</div><div class="library-meta">${esc(stateName(item.state))} · ${esc(item.county)} County${item.acreage?` · ${esc(item.acreage)}`:''}${item.score?` · Score ${esc(item.score)}`:''}</div><div class="library-address">${esc(item.address || 'No situs address')}</div><div class="library-parcel">Parcel ${esc(item.parcelId)}</div><div class="library-date">${type==='saved'?'Saved':'Generated'} ${esc(humanDate(type==='saved'?item.savedAt:item.generatedAt))}</div></div><div class="library-actions"><button type="button" class="ghost open-item">Open property</button><button type="button" class="ghost remove-item">Remove</button></div>`;
      if (type === 'saved' && savedViewMode === 'split') {
        card.classList.add('saved-compact-card');
        card.tabIndex = 0;
        card.setAttribute('aria-label', 'Locate ' + (item.name || item.parcelId) + ' on map');
        const focusParcel = () => {
          const marker = savedMarkers.get(item.key);
          if (marker && savedMap) {
            savedMap.setView(marker.getLatLng(), Math.max(savedMap.getZoom(), 14));
            marker.openPopup();
          } else toast('Map location not available for this parcel yet.');
        };
        card.addEventListener('click', event => {
          if (!event.target.closest('button')) focusParcel();
        });
        card.addEventListener('keydown', event => {
          if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault(); focusParcel();
          }
        });
      }
      card.querySelector('.open-item').onclick=()=>openSavedProperty(item);
      card.querySelector('.remove-item').onclick=()=>{const key=type==='saved'?SAVED_KEY:REPORTS_KEY;const remaining=read(key).filter(x=>(type==='saved'?x.key:x.id)!==(type==='saved'?item.key:item.id));write(key,remaining);renderLibrary(type)};
      list.appendChild(card);
    });
    if (type === 'saved' && savedViewMode !== 'list') showSavedMap(items, view);
  }
  function refreshLibraryIfOpen(){const v=$('propertyLibraryView');if(!v||v.style.display==='none')return;const active=[...document.querySelectorAll('.sidebar .nav button')].find(b=>b.classList.contains('active'));if((active?.textContent||'').includes('Saved'))renderLibrary('saved');else if((active?.textContent||'').includes('Reports'))renderLibrary('reports')}

  function initNav(){
    document.querySelectorAll('.sidebar .nav button').forEach(btn=>{
      const label=(btn.textContent||'').trim();
      if(label.includes('Saved Properties')){btn.disabled=false;btn.onclick=()=>renderLibrary('saved')}
      else if(label.includes('Reports')){btn.disabled=false;btn.onclick=()=>renderLibrary('reports')}
      else if(label.includes('Property Dashboard')){btn.disabled=false;btn.onclick=showDashboard}
    });
  }

  function init() {
    const topActions = document.querySelector('.top-actions'); if (!topActions) return;
    const buttons = topActions.querySelectorAll('button'); const saveBtn=buttons[0], reportBtn=buttons[1];
    if (saveBtn) { saveBtn.disabled=false; saveBtn.id='savePropertyBtn'; saveBtn.addEventListener('click',saveCurrent); }
    if (reportBtn) { reportBtn.disabled=false; reportBtn.id='generateReportBtn'; reportBtn.addEventListener('click',generateReport); }
    initNav(); ensureLibraryView();
    const style=document.createElement('style'); style.textContent=`
      #propertyActionToast{position:fixed;right:24px;bottom:24px;background:#174f34;color:white;padding:12px 16px;border-radius:10px;font-weight:800;box-shadow:0 10px 30px #0003;opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s;z-index:99999}#propertyActionToast.show{opacity:1;transform:none}
      #propertyNameModal{position:fixed;inset:0;background:rgba(13,30,20,.45);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;padding:20px;z-index:99998}#propertyNameModal.show{display:flex}.name-dialog{width:min(480px,100%);background:#fff;border-radius:18px;padding:28px;box-shadow:0 30px 80px #0004}.name-kicker{font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#2d7950}.name-dialog h2{font:800 24px Manrope;margin:5px 0 8px}.name-dialog p{color:#66736b;font-size:13px;line-height:1.5;margin:0 0 20px}.name-dialog label{display:block;font-size:12px;font-weight:800;margin-bottom:7px}.name-dialog input{width:100%;border:1px solid #cfdad2;border-radius:11px;padding:13px 14px;font:inherit;outline:none}.name-dialog input:focus{border-color:#2d7950;box-shadow:0 0 0 3px rgba(45,121,80,.12)}.name-dialog input.invalid{border-color:#b8463f}.name-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
      .saved-split-layout{display:grid;grid-template-columns:minmax(290px,0.85fr) minmax(0,1.4fr);gap:16px;align-items:start}.saved-split-layout .library-list{max-height:650px;overflow-y:auto;min-width:0;padding-right:4px}.saved-split-layout .saved-properties-map{height:650px;min-height:400px;position:sticky;top:12px}.saved-split-layout .saved-compact-card{padding:15px;display:block;cursor:pointer}.saved-compact-card .library-name{font-size:15px}.saved-compact-card .library-actions{margin-top:12px}.saved-compact-card .library-actions button{font-size:12px}.saved-split-layout.saved-map-only{display:block}.saved-map-only .saved-properties-map{height:min(72vh,700px)}@media(max-width:850px){.saved-split-layout{grid-template-columns:1fr}.saved-split-layout .library-list{max-height:310px}.saved-split-layout .saved-properties-map{height:430px;min-height:350px;position:relative;top:auto}.saved-split-layout .saved-compact-card{display:block}.saved-compact-card .library-actions{width:auto}}
      .saved-basemap-controls{position:absolute;top:12px;right:12px;z-index:800;display:flex;gap:4px;padding:4px;background:#fff;border-radius:10px;box-shadow:0 2px 12px #0003}.saved-basemap-btn{border:0;background:transparent;border-radius:7px;padding:8px 12px;font:700 12px Manrope,Arial,sans-serif;cursor:pointer;color:#365544}.saved-basemap-btn.saved-basemap-active{background:#185b3a;color:#fff}.saved-view-controls{display:flex;gap:8px;margin:0 0 14px}.saved-view-controls .saved-view-active{background:#185b3a;color:#fff;border-color:#185b3a}.saved-properties-map{height:min(65vh,580px);min-height:340px;width:100%;border:1px solid #dce4de;border-radius:16px;overflow:hidden;background:#f2f6f2}.saved-map-note{font-size:12px;color:#66736b;margin-top:12px}
      .property-library{max-width:1200px;margin:0 auto}.library-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:22px}.library-head h2{font:800 28px Manrope;margin:4px 0}.library-head p{margin:0;color:#66736b}.library-list{display:grid;gap:12px}.library-card{background:#fff;border:1px solid #dce4de;border-radius:16px;padding:20px;display:flex;justify-content:space-between;align-items:center;gap:20px;box-shadow:0 8px 28px rgba(28,55,38,.05)}.library-name{font:800 18px Manrope}.library-meta,.library-address,.library-parcel,.library-date{font-size:12px;color:#66736b;margin-top:4px}.library-meta{color:#2d7950;font-weight:700}.library-actions{display:flex;gap:8px;flex-shrink:0}.library-empty{background:#fff;border:1px dashed #cbd7ce;border-radius:16px;padding:50px;text-align:center;color:#66736b}@media(max-width:700px){.library-head,.library-card{align-items:flex-start;flex-direction:column}.library-actions{width:100%}.library-actions button{flex:1}}
    `; document.head.appendChild(style);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
