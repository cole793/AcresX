(() => {
  let assessmentRequestId = 0;

  function money(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : '—';
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

  function ensureStyles() {
    if (document.getElementById('propertyAssessmentStyles')) return;
    const style = document.createElement('style');
    style.id = 'propertyAssessmentStyles';
    style.textContent = `
      .property-assessment-source{grid-column:1/-1;padding:9px 0 2px;font-size:9px;color:var(--muted);line-height:1.35}
      .property-assessment-source strong{font-weight:700;color:#526158}
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
      grid.appendChild(wrap);
    }
    return document.getElementById(id);
  }

  function renderAssessment(result) {
    ensureStyles();
    const grid = document.querySelector('.property-overview-facts');
    if (!grid) return;

    const valueEl = addFact('overviewAssessorValue', result?.label || 'Assessor value');
    const landEl = addFact('overviewLandValue', 'Land value');
    const yearEl = addFact('overviewAssessmentYear', 'Assessment / tax year');

    if (!result) {
      if (valueEl) valueEl.textContent = 'Not available';
      if (landEl) landEl.textContent = 'Not available';
      if (yearEl) yearEl.textContent = 'Not available';
      return;
    }

    if (valueEl) valueEl.textContent = money(Number.isFinite(result.totalValue) && result.totalValue > 0 ? result.totalValue : result.landValue);
    if (landEl) landEl.textContent = money(result.landValue);
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
    source.innerHTML = `<strong>Assessment source:</strong> ${result.source}${improvements}. Assessor values are informational and are not the current tax bill.`;
  }

  async function loadAssessment() {
    const search = currentSearch();
    if (!search) return;
    const requestId = ++assessmentRequestId;

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
      if (requestId !== assessmentRequestId) return;
      if (typeof last !== 'undefined') last.propertyAssessment = data;
      renderAssessment(normalize(data));
    } catch (error) {
      if (requestId !== assessmentRequestId) return;
      console.warn('Property assessment lookup failed', error);
      renderAssessment(null);
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