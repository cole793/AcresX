(() => {
  let requestId = 0;

  function escHtml(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function currentParcelPayload() {
    if (typeof last === 'undefined' || !last?.parcel) return null;
    const parcel = last.parcel;
    const p = parcel.properties || {};
    const stateEl = document.getElementById('state');
    const countyEl = document.getElementById('county');
    const county = p._countyDisplay || p.COUNTY_NM || countyEl?.value || '';
    const state = stateEl?.value || (county === 'Spokane' ? 'WA' : '');
    const parcelId = p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || p.PARCEL_ID || '';
    const address = [p.SITUS_ADDRESS, p.SITUS_CITY_NM, p.SITUS_ZIP_NR].filter(Boolean).join(', ');
    return { state, county, parcelId, address, geometry: parcel.geometry };
  }

  function addStyles() {
    if (document.getElementById('existingWellStyles')) return;
    const style = document.createElement('style');
    style.id = 'existingWellStyles';
    style.textContent = `
      .existing-well-summary{margin-top:10px;padding-top:10px;border-top:1px solid rgba(23,35,28,.10);font:700 11px/1.35 "DM Sans",sans-serif;color:#526158}
      .existing-well-summary strong{font-weight:800;color:var(--ink)}
      .existing-well-summary.high strong{color:#267247}
      .existing-well-summary.moderate strong{color:#8a5b13}
      .existing-well-summary.low strong{color:#66736b}
      .existing-well-evidence{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
      .existing-well-evidence span{display:inline-flex;align-items:center;gap:5px;padding:5px 7px;border:1px solid var(--line);border-radius:999px;background:#f7f9f7;font:700 10px/1 "DM Sans",sans-serif;color:#526158}
      .existing-well-evidence span.yes{background:#edf7f0;border-color:#c9e2d0;color:#267247}
      .existing-well-evidence span.no{color:#7b817d}
    `;
    document.head.appendChild(style);
  }

  function evidenceLabel(label, yes) {
    return `<span class="${yes ? 'yes' : 'no'}">${yes ? '✓' : '–'} ${escHtml(label)}</span>`;
  }

  function renderCard(data) {
    const card = document.querySelector('.snapshot-card[data-detail="wells"]');
    if (!card) return;
    let el = card.querySelector('.existing-well-summary');
    if (!el) {
      el = document.createElement('div');
      el.className = 'existing-well-summary';
      const details = card.querySelector('.snapshot-details-btn');
      if (details) card.insertBefore(el, details);
      else card.appendChild(el);
    }

    if (!data?.available) {
      el.className = 'existing-well-summary low';
      el.innerHTML = '<strong>Existing well:</strong> matching not available for this county yet';
      return;
    }

    const confidence = String(data.confidence || 'Low').toLowerCase();
    el.className = `existing-well-summary ${confidence === 'high' ? 'high' : confidence === 'moderate' ? 'moderate' : 'low'}`;
    if (data.match) {
      // The nearby-depth search and the on-parcel well match are independent sources.
      // A matched well must take precedence over the generic "Not found" depth placeholder.
      const metric = document.getElementById('wellMetric');
      const status = document.getElementById('waterStatus');
      const note = document.getElementById('wellNote');
      const depth = Number(data.match.completedDepth);
      if (metric) metric.textContent = Number.isFinite(depth) && depth > 0
        ? 'Existing well · ' + Math.round(depth) + ' ft'
        : 'Existing well matched';
      if (status) status.textContent = (data.confidence || 'Record') +
        ' confidence · Assessor + well record match · Verify';
      if (note) note.textContent = 'Matched on-parcel well record; nearby depth search is separate';
      el.innerHTML = `<strong>${escHtml(data.label)}</strong><br>${escHtml(data.confidence)} confidence from assessor + well records`;
    } else {
      el.innerHTML = '<strong>No existing well match found</strong><br>Nearby well records still shown below';
    }
  }

  function renderWellDetails() {
    if (typeof activeTab === 'undefined' || activeTab !== 'wells') return;
    const root = document.getElementById('results');
    if (!root || typeof last === 'undefined') return;
    const data = last.existingWell;
    root.querySelector('.existing-well-detail')?.remove();
    if (!data) return;

    const block = document.createElement('div');
    block.className = 'existing-well-detail result-item';
    if (!data.available) {
      block.innerHTML = `<div class="notice"><strong>Existing well screening</strong><br>${escHtml(data.label || 'Matching is not configured for this county yet.')}</div>`;
      root.insertBefore(block, root.firstChild);
      return;
    }

    const m = data.match;
    if (!m) {
      block.innerHTML = `<div class="notice"><strong>Existing well screening: no match found</strong><br>AcresX did not find a strong association between the current assessor parcel and nearby Ecology well records. This does not prove the parcel has no well.</div>`;
      root.insertBefore(block, root.firstChild);
      return;
    }

    const evidence = m.evidence || {};
    block.innerHTML = `
      <div class="notice"><strong>${escHtml(data.label)}</strong><br>${escHtml(data.confidence)} confidence · match score ${Number(data.score || 0)}/100</div>
      <div class="data-grid">
        <div class="datum"><span>Current assessor owner</span><strong>${escHtml(data.currentOwner || 'Not returned')}</strong></div>
        <div class="datum"><span>Well record owner</span><strong>${escHtml(m.ownerName || 'Not reported')}</strong></div>
        <div class="datum"><span>Well parcel number</span><strong>${escHtml(m.parcelNumber || 'Not reported')}</strong></div>
        <div class="datum"><span>Well tag</span><strong>${escHtml(m.wellTag || 'Not reported')}</strong></div>
        <div class="datum"><span>Completed depth</span><strong>${m.completedDepth ? `${escHtml(m.completedDepth)} ft` : 'Not reported'}</strong></div>
        <div class="datum"><span>Well address</span><strong>${escHtml(m.wellAddress || 'Not reported')}</strong></div>
      </div>
      <div class="existing-well-evidence">
        ${evidenceLabel('Parcel number match', evidence.parcelMatch)}
        ${evidenceLabel('Mapped inside parcel', evidence.insideParcel)}
        ${evidenceLabel('Owner name match', evidence.ownerMatch)}
        ${evidenceLabel('Address match', evidence.addressMatch)}
      </div>
      <div class="notice">${escHtml(data.caution || 'Well records are historical and should be verified before relying on them.')}</div>
    `;
    root.insertBefore(block, root.firstChild);
  }

  async function loadExistingWell() {
    const payload = currentParcelPayload();
    if (!payload?.parcelId || !payload?.geometry) return;
    const id = ++requestId;
    try {
      const response = await fetch('/api/existing-well', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Existing well screening returned ${response.status}`);
      if (id !== requestId || typeof last === 'undefined') return;
      last.existingWell = data;
      renderCard(data);
      renderWellDetails();
    } catch (error) {
      if (id !== requestId || typeof last === 'undefined') return;
      last.existingWell = { available: false, label: 'Existing well screening unavailable', error: error.message };
      renderCard(last.existingWell);
    }
  }

  addStyles();

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      requestAnimationFrame(loadExistingWell);
      return result;
    };
  }

  if (typeof renderResults === 'function') {
    const base = renderResults;
    renderResults = function (...args) {
      const result = base.apply(this, args);
      requestAnimationFrame(renderWellDetails);
      return result;
    };
  }
})();
