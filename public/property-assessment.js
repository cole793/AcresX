(() => {
  let assessmentRequestId = 0;
  // The assessor's property class is a tax category, not zoning (Zillow labels it "Zoning").
  const CLASS_NOTE = 'Tax category, not zoning';

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

    // Kootenai: county assessor record, already mapped by src/counties/kootenai-assessor.js.
    if (data.state === 'ID' && Array.isArray(data.countyRecords) && data.countyRecords.length) {
      const r = data.countyRecords[0] || {};
      return {
        totalValue: amount(r.totalValue),
        landValue: amount(r.landValue),
        improvementValue: amount(r.improvementValue),
        homeownerExemption: amount(r.homeownerExemption),
        netValue: amount(r.netValue),
        year: r.taxYear || null,
        propertyClass: classText(r),
        label: 'Assessor value',
        source: `${data.county || 'Kootenai'} County Assessor`
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
    source.innerHTML = `<strong>Assessment source:</strong> ${result.source}${improvements}${exemption}${net}. Assessor values are informational and are not the current tax bill.`;
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
      renderAssessment(normalize(data));
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

  window.AcresXAssessment = { normalize, classText, CLASS_NOTE, renderAssessment };

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