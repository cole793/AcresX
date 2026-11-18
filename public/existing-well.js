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
    const state = p._stateCode || stateEl?.value || (county === 'Spokane' ? 'WA' : '');
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

  // A recorded well on this parcel. Montana answers say so in evidence.onParcel (a section-centre
  // GWIC point or a far owner-matched record never counts); Spokane answers predate it.
  function onParcel(evidence) {
    if (typeof evidence?.onParcel === 'boolean') return evidence.onParcel;
    return Boolean(evidence?.insideParcel || evidence?.ownerMatch);
  }
  window.AcresXExistingWell = { onParcel };

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
      // not_supported: no matcher for this county. unavailable / a failed request: the well
      // record services did not answer (src/services/existing-well-montana.js).
      el.innerHTML = data?.status === 'unavailable' || data?.error
        ? '<strong>Well-record association:</strong> well records did not answer; try again later'
        : '<strong>Well-record association:</strong> matching not available for this county yet';
      return;
    }

    const confidence = String(data.confidence || 'Low').toLowerCase();
    el.className = `existing-well-summary ${confidence === 'high' ? 'high' : confidence === 'moderate' ? 'moderate' : 'low'}`;
    if (data.match) {
      const evidence = data.match.evidence || {};
      // Existing-well language is reserved for strong on-parcel evidence:
      // mapped coordinates inside the parcel, or a strong owner-linked well record.
      // Listing-confirmed wells are handled independently by the MLS scanner.
      const confirmedExisting = onParcel(evidence);
      const why = evidence.insideParcel ? 'Mapped well location falls within parcel'
        : evidence.parcelMatch ? 'Well record lists this parcel number'
        : 'Well-record owner matches current assessor owner';
      // While nearby wells are pending or timed out, the card keeps that placeholder.
      const wellsShown = !window.AcresXSections?.placeholder('wells');
      const metric = wellsShown ? document.getElementById('wellMetric') : null;
      const status = wellsShown ? document.getElementById('waterStatus') : null;
      const note = wellsShown ? document.getElementById('wellNote') : null;
      const depth = Number(data.match.completedDepth);
      if (confirmedExisting) {
        if (metric) metric.textContent = Number.isFinite(depth) && depth > 0
          ? 'Existing well · ' + Math.round(depth) + ' ft'
          : 'Existing well';
        if (status) status.textContent = evidence.insideParcel
          ? 'Well coordinates mapped within parcel · Verify record'
          : evidence.parcelMatch ? 'Well record lists this parcel · Verify record'
          : 'Well record owner matches assessor owner · Verify record';
        if (note) note.textContent = 'Strong public-record evidence of an existing well on this property';
        el.innerHTML = `<strong>${escHtml(data.summary || 'Existing well identified')}</strong><br>${escHtml(why)}`;
      } else {
        // Do not overwrite the card's median nearby well depth with a single nearby candidate.
        // The association belongs in supporting copy/details only.
        if (status) status.textContent = 'Nearby well records found · no existing well confirmed';
        if (note && !note.textContent) note.textContent = window.AcresXWellDepth?.note(window.AcresXWellDepth.stats(typeof last !== 'undefined' ? last : null)) || 'Median nearby well depth';
        el.innerHTML = data.summary
          ? `<strong>${escHtml(data.summary)}</strong><br>Verify whether the record belongs to this parcel`
          : `<strong>Possible nearby well-record association</strong><br>${escHtml(data.confidence)} confidence · verify whether record belongs to this parcel`;
      }
    } else {
      el.innerHTML = '<strong>No parcel well confirmed</strong><br>Nearby well records still shown below';
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
      block.innerHTML = `<div class="notice"><strong>Well-record screening</strong><br>${escHtml(data.label || 'Matching is not configured for this county yet.')}</div>`;
      root.insertBefore(block, root.firstChild);
      return;
    }

    const m = data.match;
    if (!m) {
      const records = data.state === 'MT' ? 'Montana GWIC well logs and DNRC groundwater rights' : 'Ecology well records';
      block.innerHTML = `<div class="notice"><strong>Well-record screening: no strong association found</strong><br>AcresX did not find a strong association between the current parcel and nearby ${records}. This does not prove the parcel has no well.</div>`;
      root.insertBefore(block, root.firstChild);
      return;
    }

    const evidence = m.evidence || {};
    const confirmedExisting = onParcel(evidence);
    const montana = data.state === 'MT';
    const datum = (label, value) => `<div class="datum"><span>${escHtml(label)}</span><strong>${value}</strong></div>`;
    const ft = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? `${escHtml(Math.round(Number(v)))} ft` : 'Not reported');
    const link = (url, text) => (/^https:\/\//.test(String(url || '')) ? `<a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(text)}</a>` : '');
    const wr = data.waterRight;
    const grid = montana
      ? (m.source === 'gwic'
        ? [datum('GWIC well', escHtml(m.gwicId || 'Not reported')), datum('Completed depth', ft(m.completedDepth)), datum('Completed', escHtml(m.completionYear || 'Not reported')),
          datum('Static water level', ft(m.staticWaterLevelFt)), datum('Yield', m.yieldGpm ? `${escHtml(m.yieldGpm)} gpm` : 'Not reported'), datum('Location method', escHtml(m.locationMethod || 'Not reported'))]
        : [datum('DNRC water right', escHtml(m.waterRightNumber || 'Not reported')), datum('Type', escHtml(m.type || 'Not reported')), datum('Purposes', escHtml(m.purposes || 'Not reported'))]).join('')
      : [datum('Well parcel number', escHtml(m.parcelNumber || 'Not reported')), datum('Well tag', escHtml(m.wellTag || 'Not reported')), datum('Completed depth', m.completedDepth ? `${escHtml(m.completedDepth)} ft` : 'Not reported')].join('');
    const reason = evidence.insideParcel ? 'Well location maps within the selected parcel' : evidence.parcelMatch ? 'Well record lists this parcel number' : 'Well-record owner matches the current assessor owner';
    const headline = data.summary || (confirmedExisting ? 'Existing well identified' : 'Possible nearby well-record association');
    const links = [link(m.recordUrl, m.source === 'gwic' ? 'GWIC well record' : 'DNRC water right abstract'),
      wr && wr !== m && wr.evidence?.onParcel ? `${escHtml('DNRC groundwater right ' + wr.waterRightNumber + ' lists this parcel')} ${link(wr.recordUrl, '(abstract)')}` : ''].filter(Boolean).join(' · ');
    block.innerHTML = `
      <div class="notice"><strong>${escHtml(headline)}</strong><br>${confirmedExisting
        ? escHtml(reason) + ' · verify record and current well status'
        : escHtml(data.confidence) + ' confidence · match score ' + Number(data.score || 0) + '/100 · not confirmation of an existing well on this parcel'}</div>
      <div class="data-grid">${grid}</div>
      <div class="existing-well-evidence">
        ${evidenceLabel(montana ? 'Parcel geocode match' : 'Parcel number match', evidence.parcelMatch)}
        ${evidenceLabel('Mapped inside parcel', evidence.insideParcel)}
        ${evidenceLabel('Owner name match', evidence.ownerMatch)}
        ${montana ? evidenceLabel('Water right lists parcel', Boolean(wr?.evidence?.geocodeListed)) : evidenceLabel('Address match', evidence.addressMatch)}
      </div>
      ${links ? `<div class="notice">${links}</div>` : ''}
      <div class="notice">${escHtml(data.caution || 'Well records are historical and should be verified before relying on them.')}</div>
    `;
    root.insertBefore(block, root.firstChild);
  }

  // The request for this search, or null when it has no inputs yet or already fired. Claimed
  // synchronously in the renderSummary wrapper, so the cost card knows to wait for it.
  function claimExistingWell() {
    const payload = currentParcelPayload();
    if (!payload?.parcelId || !payload?.geometry) return null;
    const sections = window.AcresXSections;
    if (sections && !sections.claim('existingWell')) return null;
    return { payload, searchId: sections?.searchId };
  }

  async function loadExistingWell(job) {
    if (!job) return;
    const sections = window.AcresXSections;
    const stale = () => (sections && !sections.isCurrent(job.searchId));
    const id = ++requestId;
    try {
      const response = await fetch('/api/existing-well', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job.payload),
        signal: sections?.timeoutSignal()
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Existing well screening returned ${response.status}`);
      if (id !== requestId || stale() || typeof last === 'undefined') return;
      last.existingWell = data;
      renderCard(data);
      renderWellDetails();
      sections?.settle('existingWell');
    } catch (error) {
      if (id !== requestId || stale() || typeof last === 'undefined') return;
      last.existingWell = { available: false, label: 'Well-record screening unavailable', error: error.message };
      renderCard(last.existingWell);
      sections?.settle('existingWell');
    }
  }

  addStyles();

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      // A re-render (progressive-loading.js) rewrites the well card: show the answer again.
      if (typeof last !== 'undefined' && last?.existingWell) renderCard(last.existingWell);
      const job = claimExistingWell();
      if (job) requestAnimationFrame(() => loadExistingWell(job));
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
