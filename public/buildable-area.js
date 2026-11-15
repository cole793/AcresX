// Buildable-acres screening estimate on the dashboard: a card above the Improvement Snapshot and
// shading on the interactive map (green: buildable, hatched red: removed, hatched amber: mapped
// wetland buffers, shown but not subtracted, owner decision 2026-11-14). The buildability score
// reads last.buildableArea for its homesite check (screening-refinements.js buildableCheck, owner
// request 2026-11-14); the answer arriving re-renders the dashboard so the score updates.
//
// Data: POST /api/buildable-area (src/services/buildable-area.js), one request per search, sent
// once the flood, wetlands, zoning and soil/terrain sections have settled (the Worker reuses their
// cached answers, so the lookups are not repeated) and kept in last.buildableArea. The zoning
// rules answer's setback text goes with it when the rules have loaded (the Worker only applies a
// single plain number). A failed request leaves { status: 'unavailable' } and the card says so;
// nothing else on the page changes.
//
// window.AcresXBuildable: { headline, breakdown, notCounted, fmtAcres, claim, load, render }
// (property-report-v2.js reads the same text helpers for page 1).
(function (root) {
  const WAIT_FOR = ['flood', 'wetlands', 'zoningPermits', 'land'];
  const REQUEST_MS = 35000;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const current = () => { try { return typeof last !== 'undefined' ? last : root.last; } catch (_) { return root.last; } };
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  // 14.2 / 0.26 / 274.1. ref: the parcel acres, so every number on a parcel uses the same decimals.
  function fmtAcres(a, ref = a) { a = num(a); if (a == null) return ''; return (num(ref) ?? a) >= 10 ? a.toFixed(1) : a.toFixed(2); }
  // "Mapped wetland buffers (190/250 ft, Spokane County) 8.2 ac (39.9%)": shown, not subtracted.
  function mayAlso(b) {
    if (!measured(b)) return [];
    return (b.mayAlsoRestrict || []).map(r => `${r.reason} ${fmtAcres(r.acres, b.parcelAcres)} ac (${num(r.pct) ?? 0}%)`);
  }
  const measured = b => b && (b.status === 'measured' || b.status === 'partial') && num(b.buildableAcres) != null;

  function headline(b) {
    if (!b) return 'Measuring buildable area…';
    if (!measured(b)) return 'Buildable area not measured';
    return `About ${fmtAcres(b.buildableAcres, b.parcelAcres)} of ${fmtAcres(b.parcelAcres)} acres buildable`;
  }
  // ["FEMA high-risk flood zone A: 13.85 ac (67.1%)", ...]
  function breakdown(b) {
    if (!measured(b)) return [];
    return (b.removed || []).map(r => `${r.reason}: ${fmtAcres(r.acres, b.parcelAcres)} ac (${num(r.pct) ?? 0}%)`);
  }
  // Constraints that could not be checked, by label.
  function notCounted(b) {
    return (b?.layers || []).filter(l => l.status === 'unavailable' || l.status === 'not_mapped').map(l => l.label || l.key);
  }

  // ---- Request

  let requestId = 0, inflight = null; // inflight: the parcel a request is out for
  const settled = s => s === 'done' || s === 'failed' || s === 'timeout';
  function ready(S) {
    if (!S || typeof S.status !== 'function') return true;
    return WAIT_FOR.every(n => settled(S.status(n)));
  }
  function where(l) {
    const p = l?.parcel?.properties || {};
    const stateEl = typeof document !== 'undefined' ? document.getElementById('state') : null;
    const countyEl = typeof document !== 'undefined' ? document.getElementById('county') : null;
    return {
      state: String(p._stateCode || stateEl?.value || '').toUpperCase(),
      county: String(p._countyDisplay || countyEl?.value || '').replace(/\s+County$/i, '').trim()
    };
  }
  function claim() {
    const l = current();
    if (!l?.parcel?.geometry || l.buildableArea || inflight === l.parcel) return null;
    const S = root.AcresXSections;
    if (!ready(S)) return null;
    if (S && !S.claim('buildableArea')) return null;
    const zdp = l.zoningDevelopmentPotential || {};
    const code = l.zoningPermits?.zoning?.code || zdp.code || '';
    const w = where(l);
    inflight = l.parcel;
    const body = { geometry: l.parcel.geometry, state: w.state, county: w.county, ...(zdp.available && zdp.setback ? { zoning: { code, setback: zdp.setback } } : {}) };
    return { body, parcel: l.parcel, searchId: S?.searchId };
  }
  async function load(job) {
    if (!job) return;
    const S = root.AcresXSections;
    const id = ++requestId;
    let data;
    try {
      const signal = S?.timeoutSignal ? S.timeoutSignal(REQUEST_MS) : undefined;
      const response = await fetch('/api/buildable-area', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job.body), signal });
      data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Buildable area returned ${response.status}`);
    } catch (error) {
      data = { status: 'unavailable', removed: [], layers: [], notes: [`Buildable area could not be measured (${error?.message || 'request failed'}).`], geometry: null };
    }
    if (inflight === job.parcel) inflight = null;
    const l = current();
    if (id !== requestId || (S && !S.isCurrent(job.searchId)) || !l || l.parcel !== job.parcel) return;
    l.buildableArea = data;
    if (S) S.settle('buildableArea'); // progressive-loading.js then re-renders the summary (score included)
    render();
    if (!S) { try { root.AcresXScore?.render?.(); } catch (error) { console.warn('AcresX score refresh failed', error); } }
  }

  // ---- Dashboard card

  function addStyles() {
    if (typeof document === 'undefined' || document.getElementById('buildableStyles')) return;
    const s = document.createElement('style');
    s.id = 'buildableStyles';
    s.textContent = `
      .buildable-card{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:22px;padding:20px 24px;margin-bottom:6px}
      .buildable-kicker{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--green2)}
      .buildable-value{font-size:26px;font-weight:850;color:var(--green);line-height:1.15;margin:6px 0 4px}
      .buildable-sub{font-size:12px;color:var(--muted)}
      .buildable-bar{display:flex;height:12px;border-radius:999px;overflow:hidden;background:#eef2ef;margin:12px 0 6px;border:1px solid var(--line)}
      .buildable-bar .keep{background:#2f8a58}.buildable-bar .cut{background:repeating-linear-gradient(135deg,#c0392b 0 4px,#e8a59e 4px 8px)}
      .buildable-legend{display:flex;gap:14px;font-size:11px;color:var(--muted)}.buildable-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
      .buildable-list{list-style:none;margin:0;padding:0}.buildable-list li{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:6px 0;border-bottom:1px solid var(--line)}
      .buildable-list li b{white-space:nowrap;color:var(--red)}.buildable-list li.none{color:var(--muted)}
      .buildable-maybe{margin-top:8px;background:var(--amber-bg);border-left:3px solid #d39a2a;border-radius:6px;padding:7px 10px;font-size:12px;color:var(--ink);line-height:1.4}.buildable-maybe b{color:var(--amber)}
      .buildable-notes{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.45}.buildable-notes strong{color:var(--amber)}
      .buildable-disclaimer{font-size:11px;color:var(--muted);margin-top:10px;line-height:1.45}
      @media(max-width:860px){.buildable-card{grid-template-columns:1fr}}
      .legend-buildable{display:inline-block;width:14px;height:10px;border-radius:2px;background:rgba(47,138,88,.45);border:1px solid #2f8a58}
      .legend-buffer{display:inline-block;width:14px;height:10px;border-radius:2px;background:repeating-linear-gradient(135deg,#d39a2a 0 3px,rgba(240,190,90,.3) 3px 6px)}
      .legend-removed{display:inline-block;width:14px;height:10px;border-radius:2px;background:repeating-linear-gradient(135deg,#c0392b 0 3px,rgba(192,57,43,.25) 3px 6px)}
    `;
    document.head?.appendChild(s);
  }

  function cardHtml(b) {
    const S = root.AcresXSections;
    if (!b) {
      return `<div><div class="buildable-kicker">Buildable area · screening estimate</div><div class="buildable-value">${esc(S?.status?.('buildableArea') === 'pending' ? 'Measuring buildable area…' : 'Waiting for flood, wetland, zoning and slope data…')}</div><div class="buildable-sub">Parcel minus mapped flood zones, wetlands and steep slopes; mapped wetland buffers are shown separately.</div></div><div></div>`;
    }
    if (!measured(b)) {
      return `<div><div class="buildable-kicker">Buildable area · screening estimate</div><div class="buildable-value">Buildable area not measured</div><div class="buildable-sub">${esc((b.notes || [])[0] || 'The constraint layers did not answer.')}</div></div><div></div>`;
    }
    const keep = Math.max(0, Math.min(100, num(b.buildablePct) ?? 0));
    const removed = (b.removed || []).map(r => `<li><span>${esc(r.reason)}</span><b>−${esc(fmtAcres(r.acres, b.parcelAcres))} ac · ${esc(num(r.pct) ?? 0)}%</b></li>`).join('');
    const missing = notCounted(b);
    const overlap = num(b.overlapAcres) >= 0.01 ? `<li class="none"><span>Overlapping areas counted once</span><span>${esc(fmtAcres(b.overlapAcres, b.parcelAcres))} ac</span></li>` : '';
    return `<div>
      <div class="buildable-kicker">Buildable area · screening estimate</div>
      <div class="buildable-value">${esc(headline(b))}</div>
      <div class="buildable-sub">${esc(num(b.buildablePct) ?? 0)}% of the mapped parcel outline is outside mapped constraints${b.status === 'partial' ? ' · not every layer answered' : ''}</div>
      <div class="buildable-bar" role="img" aria-label="${esc(keep)}% buildable"><span class="keep" style="width:${keep}%"></span><span class="cut" style="width:${100 - keep}%"></span></div>
      <div class="buildable-legend"><span><i style="background:#2f8a58"></i>Buildable ${esc(fmtAcres(b.buildableAcres, b.parcelAcres))} ac</span><span><i style="background:#c0392b"></i>Removed ${esc(fmtAcres(b.removedAcres, b.parcelAcres))} ac</span></div>
      <div class="buildable-disclaimer">${esc(b.disclaimer || '')} Verify with the responsible agency before design.</div>
    </div><div>
      <ul class="buildable-list">${removed || '<li class="none"><span>No mapped flood zone, wetland or steep slope removed</span><span>0 ac</span></li>'}${overlap}</ul>
      ${mayAlsoHtml(b)}
      <div class="buildable-notes">${missing.length ? `<strong>Not counted:</strong> ${esc(missing.join(', '))}. ` : ''}${esc((b.notes || []).join(' '))}</div>
    </div>`;
  }

  function mayAlsoHtml(b) {
    return (b.mayAlsoRestrict || []).map(r => `<div class="buildable-maybe"><b>May also be restricted:</b> ${esc(String(r.reason).replace(/^Mapped/, 'mapped'))} ${esc(fmtAcres(r.acres, b.parcelAcres))} ac (${esc(num(r.pct) ?? 0)}%) — the buffer that applies depends on a wetland delineation. Included in the buildable acres above.</div>`).join('');
  }

  function ensureCard() {
    if (typeof document === 'undefined') return null;
    let card = document.getElementById('buildableAreaCard');
    if (card) return card;
    const dash = document.getElementById('dashboard');
    if (!dash) return null;
    const section = document.createElement('section');
    section.className = 'dashboard-section';
    section.id = 'buildableSection';
    section.innerHTML = '<div class="section-heading"><div><div class="eyebrow">Site capacity</div><h2>Buildable Area</h2></div><span>Screening estimate, not a survey</span></div><article id="buildableAreaCard" class="card buildable-card"></article>';
    const anchor = dash.querySelector('.dashboard-section');
    if (anchor) anchor.parentNode.insertBefore(section, anchor); else dash.appendChild(section);
    return document.getElementById('buildableAreaCard');
  }

  // ---- Map

  let layer = null, shownFor = null, enabled = true;
  function hatchPattern() {
    // Leaflet's SVG renderer: one <pattern> in its <defs>, used by the removed area's fill.
    try {
      const svg = document.querySelector('#map svg.leaflet-zoom-animated') || document.querySelector('#map svg');
      if (!svg || svg.querySelector('#buildableHatch')) return Boolean(svg);
      let defs = svg.querySelector('defs');
      if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); svg.insertBefore(defs, svg.firstChild); }
      defs.innerHTML += '<pattern id="bufferHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="8" height="8" fill="rgba(240,190,90,.22)"/><rect width="2.5" height="8" fill="rgba(211,154,42,.85)"/></pattern>';
      defs.innerHTML += '<pattern id="buildableHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="8" height="8" fill="rgba(192,57,43,.18)"/><rect width="3" height="8" fill="rgba(192,57,43,.75)"/></pattern>';
      return true;
    } catch (_) { return false; }
  }
  function renderMap(b, l) {
    if (typeof L === 'undefined' || typeof map === 'undefined' || !map) return;
    if (!layer) layer = L.layerGroup();
    if (shownFor !== l.parcel) { layer.clearLayers(); shownFor = null; }
    if (!measured(b) || shownFor === l.parcel) { syncLayer(); return; }
    if (b.geometry) L.geoJSON(b.geometry, { interactive: false, style: { stroke: false, fillColor: '#2f8a58', fillOpacity: 0.42 } }).addTo(layer);
    const hatched = [];
    if (b.removedGeometry) hatched.push([L.geoJSON(b.removedGeometry, { interactive: false, style: { stroke: false, fillColor: '#c0392b', fillOpacity: 0.5 } }).addTo(layer), 'buildableHatch']);
    if (b.bufferGeometry) hatched.push([L.geoJSON(b.bufferGeometry, { interactive: false, style: { stroke: false, fillColor: '#d39a2a', fillOpacity: 0.35 } }).addTo(layer), 'bufferHatch']);
    if (hatched.length) {
      layer.addTo(map);
      if (hatchPattern()) hatched.forEach(([g, id]) => g.eachLayer(p => { try { p._path?.setAttribute('fill', `url(#${id})`); p._path?.setAttribute('fill-opacity', '1'); } catch (_) {} }));
    }
    shownFor = l.parcel;
    addMapControls();
    syncLayer();
  }
  function syncLayer() {
    if (!layer || typeof map === 'undefined') return;
    const on = enabled && shownFor;
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    try { if (typeof parcelLayer !== 'undefined') parcelLayer.eachLayer(x => x.bringToFront?.()); } catch (_) {}
    const btn = document.getElementById('buildableLayerBtn');
    if (btn) btn.classList.toggle('active', Boolean(on));
  }
  function addMapControls() {
    if (document.getElementById('buildableLayerBtn')) return;
    const toolbar = document.getElementById('mapToolbar');
    if (toolbar) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'buildableLayerBtn'; btn.className = 'map-tool active'; btn.textContent = 'Buildable';
      btn.title = 'Show the screening estimate of the buildable area';
      const ref = document.getElementById('wetlandLayerBtn');
      if (ref) ref.insertAdjacentElement('afterend', btn); else toolbar.appendChild(btn);
      btn.addEventListener('click', () => { enabled = !enabled; syncLayer(); });
    }
    const legend = document.querySelector('.map-legend');
    if (legend && !legend.querySelector('.legend-buildable')) {
      legend.insertAdjacentHTML('beforeend', '<div class="legend-row"><span class="legend-buildable"></span>Buildable (estimate)</div><div class="legend-row"><span class="legend-removed"></span>Removed: flood, wetland, steep slope</div><div class="legend-row"><span class="legend-buffer"></span>Mapped wetland buffer (not removed)</div>');
    }
  }

  function render() {
    if (typeof document === 'undefined') return;
    const l = current();
    if (!l?.parcel) return;
    addStyles();
    const card = ensureCard();
    if (card) card.innerHTML = cardHtml(l.buildableArea);
    try { renderMap(l.buildableArea, l); } catch (error) { console.warn('AcresX buildable map shading failed', error); }
  }

  root.AcresXBuildable = { headline, breakdown, mayAlso, notCounted, fmtAcres, measured, claim, load, render };

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      try {
        const job = claim();
        if (job) (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(() => load(job));
        render();
      } catch (error) { console.error('AcresX buildable area failed', error); }
      return result;
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
