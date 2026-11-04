(() => {
  let assessmentRequestId = 0;
  // The assessor's property class is a tax category, not zoning (Zillow labels it "Zoning").
  const CLASS_NOTE = 'Tax category, not zoning';

  function escapeText(value) {
    return String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function money(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : '—';
  }

  // Number(null) is 0; a missing value must stay missing (NaN), not show as $0.
  function amount(value) {
    return value === null || value === undefined || value === '' ? NaN : Number(value);
  }

  function currentSearch() {
    const state = document.getElementById('state')?.value || '';
    const county = document.getElementById('county')?.value || '';
    const parcelId = document.getElementById('parcel')?.value?.trim() || document.getElementById('overviewParcelId')?.textContent?.trim() || '';
    if (!state || !county || !parcelId) return null;
    return { state, county, parcelId };
  }

  function normalize(data) {
    if (!data?.available) return null;

    // County assessor records already mapped by the Worker: Kootenai (src/counties/kootenai-assessor.js)
    // and Stevens WA (src/counties/stevens-assessor.js).
    if ((data.state === 'ID' || data.state === 'WA') && Array.isArray(data.countyRecords) && data.countyRecords.length) {
      const r = data.countyRecords[0] || {};
      return {
        totalValue: amount(r.totalValue),
        landValue: amount(r.landValue),
        improvementValue: amount(r.improvementValue),
        homeownerExemption: amount(r.homeownerExemption),
        netValue: amount(r.netValue),
        marketValue: amount(r.marketValue),
        currentUse: currentUseText(r.currentUse),
        valuesNote: String(r.valuesNote || ''),
        assessorAcres: amount(r.assessorAcres),
        propertySearchUrl: propertySearchUrl(r.propertySearchUrl, r.propertyId),
        year: r.taxYear || null,
        propertyClass: classText(r),
        label: 'Assessor value',
        source: `${data.county || 'Kootenai'} County Assessor`
      };
    }

    if (data.state === 'WA') {
      const r = data.records?.[0] || {};
      return {
        totalValue: null,
        landValue: Number(r.land_value),
        improvementValue: null,
        year: r.tax_year || r.asmt_year || null,
        label: 'Assessor land value',
        source: 'Spokane County Assessor'
      };
    }

    if (data.state === 'MT') {
      const r = data.statewideRecords?.[0] || {};
      return {
        totalValue: Number(r.TotalValue),
        landValue: Number(r.TotalLandValue),
        improvementValue: Number(r.TotalBuildingValue),
        year: r.TaxYear || null,
        label: 'Assessor value',
        source: 'Montana Cadastral / ORION'
      };
    }

    if (data.state === 'ID') {
      const r = data.statewideRecords?.[0] || {};
      const updated = r.UPDATED ? new Date(Number(r.UPDATED)) : null;
      return {
        totalValue: Number(r.VAL_TOTAL),
        landValue: Number(r.VAL_LAND),
        improvementValue: Number(r.VAL_IMPVTS),
        year: updated && !Number.isNaN(updated.getTime()) ? updated.getFullYear() : null,
        label: 'Assessor value',
        source: 'Idaho Statewide Standardized Parcel Layer'
      };
    }

    return null;
  }

  // "512 – Rural residential tract", or '' when the record has no class.
  function classText(record) {
    const code = String(record?.propertyClass || '').trim();
    const descr = String(record?.propertyClassDescription || '').trim();
    return code && descr ? `${code} – ${descr}` : code || descr;
  }

  // Stevens: the county's property search page (hosted by True Automation), from the county layer's
  // Propertyinformation field (src/counties/stevens-assessor.js). Checked again here before it is
  // shown: https, exactly that host and path, one numeric prop_id equal to the record's.
  const PROPERTY_SEARCH_LABEL = 'View on the Stevens County property search (hosted by True Automation)';
  function propertySearchUrl(value, propertyId) {
    let url;
    try { url = new URL(String(value ?? '')); } catch { return ''; }
    if (url.protocol !== 'https:' || url.hostname !== 'propertysearch.trueautomation.com' || url.port || url.username || url.password) return '';
    if (url.pathname !== '/PropertyAccess/Property.aspx') return '';
    const propId = url.searchParams.getAll('prop_id');
    if (propId.length !== 1 || !/^\d+$/.test(propId[0]) || propertyId == null || Number(propId[0]) !== Number(propertyId)) return '';
    return url.toString();
  }

  // Stevens currentUse { status, program, note } -> one line, or '' when the record has none.
  function currentUseText(currentUse) {
    if (!currentUse || typeof currentUse !== 'object') return '';
    if (currentUse.status === 'classified' && currentUse.program) return String(currentUse.program);
    if (currentUse.status === 'reduced_land_value') return 'Land assessed below market (possible current-use or forest program; verify with the assessor)';
    if (currentUse.status === 'not_classified') return 'Not in a current-use program';
    return '';
  }

  // Assessor acres from the assessment, for the "show both" acreage display (public/acreage.js),
  // when the parcel search record had none (the WA statewide layer has no assessor acreage).
  // Kootenai parcels already carry ACRES, so they are unchanged.
  function shareAssessorAcres(result) {
    const acres = result?.assessorAcres;
    const props = typeof last !== 'undefined' ? last?.parcel?.properties : null;
    if (!props || !Number.isFinite(acres) || acres <= 0) return;
    if (window.AcresXAcreage?.assessorAcres?.(props) != null) return;
    props.ACRES = acres;
    window.AcresXOverview?.refreshAcreage?.();
  }

  function ensureStyles() {
    if (document.getElementById('propertyAssessmentStyles')) return;
    const style = document.createElement('style');
    style.id = 'propertyAssessmentStyles';
    style.textContent = `
      .property-assessment-source{grid-column:1/-1;padding:9px 0 2px;font-size:9px;color:var(--muted);line-height:1.35}
      .property-assessment-source strong{font-weight:700;color:#526158}
      .property-overview-fact small.assessor-class-note{display:block;font-size:10px;color:var(--muted);margin-top:1px}
    `;
    document.head.appendChild(style);
  }

  function addFact(id, label) {
    const grid = document.querySelector('.property-overview-facts');
    if (!grid) return null;
    let wrap = document.getElementById(`${id}Wrap`);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = `${id}Wrap`;
      wrap.className = 'property-overview-fact';
      wrap.innerHTML = `<span>${label}</span><strong id="${id}">Checking…</strong>`;
      // Keep facts above the source line, so a fact added on a later search stays in place.
      const source = document.getElementById('propertyAssessmentSource');
      if (source && source.parentNode === grid) grid.insertBefore(wrap, source);
      else grid.appendChild(wrap);
    }
    return document.getElementById(id);
  }

  // Only counties whose assessor returns a property class get this fact; otherwise it is removed
  // so a previous Kootenai search does not leave it behind.
  function renderAssessorClass(result) {
    const text = result?.propertyClass || '';
    const existing = document.getElementById('overviewAssessorClassWrap');
    if (!text) { existing?.remove(); return; }
    const el = addFact('overviewAssessorClass', 'Assessor class');
    if (!el) return;
    el.textContent = text;
    const wrap = document.getElementById('overviewAssessorClassWrap');
    let note = wrap.querySelector('small.assessor-class-note');
    if (!note) {
      note = document.createElement('small');
      note.className = 'assessor-class-note';
      wrap.appendChild(note);
    }
    note.textContent = CLASS_NOTE;
  }

  function renderAssessment(result) {
    ensureStyles();
    const grid = document.querySelector('.property-overview-facts');
    if (!grid) return;

    const valueEl = addFact('overviewAssessorValue', result?.label || 'Assessor value');
    const landEl = addFact('overviewLandValue', 'Land value');
    const yearEl = addFact('overviewAssessmentYear', 'Assessment / tax year');

    renderAssessorClass(result);

    if (!result) {
      if (valueEl) valueEl.textContent = 'Not available';
      if (landEl) landEl.textContent = 'Not available';
      if (yearEl) yearEl.textContent = 'Not available';
      return;
    }

    const shown = value => (Number.isFinite(value) ? money(value) : 'Not available');
    if (valueEl) valueEl.textContent = shown(Number.isFinite(result.totalValue) && result.totalValue > 0 ? result.totalValue : result.landValue);
    if (landEl) landEl.textContent = shown(result.landValue);
    if (yearEl) yearEl.textContent = result.year ? String(result.year) : '—';

    let source = document.getElementById('propertyAssessmentSource');
    if (!source) {
      source = document.createElement('div');
      source.id = 'propertyAssessmentSource';
      source.className = 'property-assessment-source';
      grid.appendChild(source);
    }
    const improvements = Number.isFinite(result.improvementValue)
      ? ` · Improvements ${money(result.improvementValue)}`
      : '';
    const exemption = Number.isFinite(result.homeownerExemption) && result.homeownerExemption > 0
      ? ` · Homeowner exemption ${money(result.homeownerExemption)}`
      : '';
    const net = Number.isFinite(result.netValue) ? ` · Net taxable ${money(result.netValue)}` : '';
    const market = Number.isFinite(result.marketValue) ? ` · Market value ${money(result.marketValue)}` : '';
    const currentUse = result.currentUse ? ` · ${escapeText(result.currentUse)}` : '';
    const valuesNote = result.valuesNote ? ` ${escapeText(result.valuesNote)}` : '';
    const link = result.propertySearchUrl
      ? ` <a href="${escapeText(result.propertySearchUrl)}" target="_blank" rel="noopener">${PROPERTY_SEARCH_LABEL} ↗</a>`
      : '';
    source.innerHTML = `<strong>Assessment source:</strong> ${result.source}${improvements}${exemption}${net}${market}${currentUse}.${valuesNote} Assessor values are informational and are not the current tax bill.${link}`;
  }

  async function loadAssessment() {
    const search = currentSearch();
    if (!search) return;
    // Once per search: the summary re-renders as sections arrive (progressive-loading.js).
    const sections = window.AcresXSections;
    if (sections && !sections.claim('assessment')) return;
    const searchId = sections?.searchId;
    const stale = () => (sections && !sections.isCurrent(searchId));
    const requestId = ++assessmentRequestId;
    document.getElementById('overviewAssessorClassWrap')?.remove();

    addFact('overviewAssessorValue', 'Assessor value');
    addFact('overviewLandValue', 'Land value');
    addFact('overviewAssessmentYear', 'Assessment / tax year');

    try {
      const response = await fetch('/api/property-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(search)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Assessment lookup returned ${response.status}`);
      if (requestId !== assessmentRequestId || stale()) return;
      if (typeof last !== 'undefined') last.propertyAssessment = data;
      const result = normalize(data);
      renderAssessment(result);
      shareAssessorAcres(result);
      sections?.settle('assessment');
    } catch (error) {
      if (requestId !== assessmentRequestId || stale()) return;
      console.warn('Property assessment lookup failed', error);
      renderAssessment(null);
      sections?.settle('assessment', 'failed');
    }
  }

  function correctLocationState() {
    const state = document.getElementById('state')?.value;
    const location = document.getElementById('overviewLocation');
    if (!location) return;
    const county = document.getElementById('county')?.value || '';
    if (state === 'MT') location.textContent = `${county} County, Montana`;
    else if (state === 'ID') location.textContent = `${county} County, Idaho`;
    else if (state === 'WA') location.textContent = `${county} County, Washington`;
  }

  window.AcresXAssessment = { normalize, classText, CLASS_NOTE, renderAssessment, shareAssessorAcres };

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      requestAnimationFrame(() => {
        correctLocationState();
        loadAssessment();
      });
      return result;
    };
  }
})();