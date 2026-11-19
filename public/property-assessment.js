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

    // County assessor records already mapped by the Worker: Kootenai (src/counties/kootenai-assessor.js),
    // Stevens WA (src/counties/stevens-assessor.js) and Spokane WA (src/counties/spokane-assessor.js).
    if ((data.state === 'ID' || data.state === 'WA') && Array.isArray(data.countyRecords) && data.countyRecords.length) {
      const r = data.countyRecords[0] || {};
      const link = propertySearchLink(r);
      return {
        totalValue: amount(r.totalValue),
        landValue: amount(r.landValue),
        improvementValue: amount(r.improvementValue),
        improvementValueNote: String(r.improvementValueNote || ''),
        marketLandValue: amount(r.marketLandValue),
        exemption: exemptionText(r.exemption),
        // Only records that carry the key (Spokane) say the tax amount is not available.
        taxAmount: 'taxAmount' in r ? amount(r.taxAmount) : undefined,
        taxAmountNote: String(r.taxAmountNote || ''),
        homeownerExemption: amount(r.homeownerExemption),
        netValue: amount(r.netValue),
        marketValue: amount(r.marketValue),
        currentUse: currentUseText(r.currentUse),
        valuesNote: String(r.valuesNote || ''),
        assessorAcres: amount(r.assessorAcres),
        propertySearchUrl: link?.href || '',
        propertySearchLabel: link?.label || '',
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

    // Montana (Gallatin, Yellowstone): the state cadastral record, mapped by the Worker
    // (cadastralRecords, src/states/montana/assessment.js). The Yellowstone tax-parcel layer
    // (countyRecords) has no values, so it is never read here. An answer without cadastralRecords
    // (older Worker) falls back to the raw statewide record's values.
    if (data.state === 'MT') {
      const m = data.cadastralRecords?.[0];
      const r = data.statewideRecords?.[0] || {};
      // No state record (DNRC down or slow): values stay "Not available", but Yellowstone's own
      // tax-parcel layer still gives the short legal description (countyLegalDescription).
      if (!m && !data.statewideRecords?.length) {
        const legal = String(data.countyLegalDescription || '').trim();
        return legal ? {
          totalValue: NaN, landValue: NaN, improvementValue: NaN, year: null, assessorAcres: NaN, propertyClass: '', landUse: [],
          legalDescription: legal, valuesNote: 'The Montana Cadastral values did not load; try again later.',
          label: 'Assessor value', source: `${data.county || 'Yellowstone'} County tax parcel record`
        } : null;
      }
      const parcelNumber = m?.parcelNumber || r.PARCELID || data.parcelId;
      const cadastral = cadastralUrl(m ? m.propertySearchUrl : r.PropertyCardLink, parcelNumber);
      const landUse = Array.isArray(m?.landUse) ? m.landUse.filter(u => u && u.label && Number.isFinite(Number(u.acres)) && Number(u.acres) > 0).map(u => ({ label: String(u.label), acres: Number(u.acres) })) : [];
      return {
        totalValue: amount(m ? m.totalValue : r.TotalValue),
        landValue: amount(m ? m.landValue : r.TotalLandValue),
        improvementValue: amount(m ? m.improvementValue : r.TotalBuildingValue),
        year: (m ? m.taxYear : r.TaxYear) || null,
        // TotalAcres is the assessor acreage on the Montana cadastral record (the Yellowstone
        // county tax-parcel layer has none); AddressLine1 + CityStateZip is the property address.
        assessorAcres: amount(m ? m.assessorAcres : r.TotalAcres),
        propertyClass: m ? classText(m) : String(r.PropType || '').trim(),
        propertyTypeNote: String(m?.propertyTypeNote || ''),
        landUse,
        agriculturalNote: m?.agricultural ? String(m.agriculturalNote || '') : '',
        levyDistrict: String(m?.levyDistrict || '').trim(),
        legalDescription: String(m?.legalDescription || '').trim(),
        situsAddress: String(r.AddressLine1 || '').trim(),
        situsCity: String(r.CityStateZip || '').trim(),
        propertySearchUrl: cadastral,
        propertySearchLabel: cadastral ? CADASTRAL_LABEL : '',
        valuesNote: 'Montana Department of Revenue appraisal for the tax year.',
        label: 'Assessor value',
        source: 'Montana Cadastral / ORION (Department of Revenue)'
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

  // "38.6 ac wild hay · 14.4 ac grazing" from the Montana assessed land use, or ''.
  function acresText(acres) {
    const n = Number(acres);
    return `${n >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/\.?0+$/, '')} ac`;
  }
  function landUseText(landUse) {
    if (!Array.isArray(landUse) || !landUse.length) return '';
    return landUse.map(u => `${acresText(u.acres)} ${String(u.label).toLowerCase()}`).join(' · ');
  }

  // "512 – Rural residential tract", or '' when the record has no class.
  function classText(record) {
    const code = String(record?.propertyClass || '').trim();
    const descr = String(record?.propertyClassDescription || '').trim();
    return code && descr ? `${code} – ${descr}` : code || descr;
  }

  // The county property page link, checked again here before it is shown, against an exact
  // host and path per county; the label comes from this table, never from the answer.
  //   Stevens: the county's property search (hosted by True Automation), from the county layer's
  //   Propertyinformation field (src/counties/stevens-assessor.js): https, exactly that host and
  //   path, one numeric prop_id equal to the record's.
  //   Spokane: SCOUT (src/counties/spokane-assessor.js spokaneScoutUrl): https, exactly
  //   cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx, only PID, equal to the record's.
  const PROPERTY_SEARCH_LABEL = 'View on the Stevens County property search (hosted by True Automation)';
  const SCOUT_LABEL = 'View on Spokane County SCOUT';
  //   Montana (Gallatin, Yellowstone): the state cadastral property page (PropertyCardLink on the
  //   DNRC Cadastral layer): https, exactly svc.mt.gov/msl/cadastral/, only page=PropertyDetails
  //   and geocode, the geocode equal to the record's 17-digit PARCELID.
  const CADASTRAL_LABEL = 'View on the Montana Cadastral property record';
  function cadastralUrl(value, parcelId) {
    const geocode = String(parcelId ?? '').replace(/[^0-9A-Za-z]/g, '');
    if (!/^\d{17}$/.test(geocode)) return '';
    let url;
    try { url = new URL(String(value ?? '')); } catch { return ''; }
    if (url.protocol !== 'https:' || url.hostname !== 'svc.mt.gov' || url.port || url.username || url.password) return '';
    if (url.pathname !== '/msl/cadastral/' && url.pathname !== '/msl/cadastral') return '';
    const keys = [...url.searchParams.keys()].sort().join(',');
    if (keys !== 'geocode,page' || url.searchParams.get('page') !== 'PropertyDetails') return '';
    if (url.searchParams.get('geocode').replace(/[^0-9A-Za-z]/g, '') !== geocode) return '';
    return `https://svc.mt.gov/msl/cadastral/?page=PropertyDetails&geocode=${geocode}`;
  }
  function propertySearchLink(record) {
    const value = record?.propertySearchUrl;
    const stevens = propertySearchUrl(value, record?.propertyId);
    if (stevens) return { href: stevens, label: PROPERTY_SEARCH_LABEL };
    const scout = scoutUrl(value, record?.parcelNumber);
    return scout ? { href: scout, label: SCOUT_LABEL } : null;
  }
  function scoutUrl(value, parcelNumber) {
    const pid = String(parcelNumber ?? '').trim();
    if (!/^\d{5}\.\d{4}$/.test(pid)) return '';
    let url;
    try { url = new URL(String(value ?? '')); } catch { return ''; }
    if (url.protocol !== 'https:' || url.hostname !== 'cp.spokanecounty.org' || url.port || url.username || url.password) return '';
    if (url.pathname.toLowerCase() !== '/scout/propertyinformation/summary.aspx') return '';
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 1 || keys[0] !== 'PID' || url.searchParams.get('PID') !== pid) return '';
    return `https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=${pid}`;
  }
  function propertySearchUrl(value, propertyId) {
    let url;
    try { url = new URL(String(value ?? '')); } catch { return ''; }
    if (url.protocol !== 'https:' || url.hostname !== 'propertysearch.trueautomation.com' || url.port || url.username || url.password) return '';
    if (url.pathname !== '/PropertyAccess/Property.aspx') return '';
    // Only cid, year and prop_id, each at most once and all digits; prop_id is required and must be
    // the record's. The link is rebuilt from those three, so nothing else (e.g. redirect=) survives.
    const kept = [];
    if ([...url.searchParams.keys()].some(k => !['cid', 'year', 'prop_id'].includes(k))) return '';
    for (const k of ['cid', 'year', 'prop_id']) {
      const v = url.searchParams.getAll(k);
      if (v.length > 1 || (v.length === 1 && !/^\d+$/.test(v[0]))) return '';
      if (v.length) kept.push([k, v[0]]);
    }
    const propId = url.searchParams.get('prop_id');
    if (propId == null || propertyId == null || Number(propId) !== Number(propertyId)) return '';
    return `https://propertysearch.trueautomation.com/PropertyAccess/Property.aspx?${new URLSearchParams(kept)}`;
  }

  // Spokane exemption { code, description, value } -> "Homeowner exemption ($20,000 exempt)",
  // "Personal exemption applied (details on SCOUT) ($512,534 exempt)" (the Worker never sends a
  // Senior/Disabled code or name).
  function exemptionText(exemption) {
    if (!exemption || typeof exemption !== 'object') return '';
    const name = String(exemption.description || '').trim() || (exemption.code ? `code ${String(exemption.code).trim()}` : '');
    const value = amount(exemption.value);
    const exempt = Number.isFinite(value) && value > 0 ? `${money(value)} exempt` : '';
    if (!name && !exempt) return '';
    return name && exempt ? `${name} (${exempt})` : name || exempt;
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

  // The situs address and county record link from the assessment, when the parcel search record
  // had none (the Yellowstone tax-parcel layer's FULLADD is often blank; Kootenai and some WA
  // parcels have no DATA_LINK). A generic search page (Yellowstone Treasurer) gives way to the
  // parcel's own record. Only links checked by propertySearchLink()/cadastralUrl() get here.
  function shareRecordDetails(result) {
    const props = typeof last !== 'undefined' ? last?.parcel?.properties : null;
    if (!props || !result) return;
    const hasSitus = [props.SITUS_ADDRESS, props.SITUS_CITY_NM, props.SITUS_ZIP_NR].some(v => String(v ?? '').trim());
    if (result.situsAddress && !hasSitus) {
      props.SITUS_ADDRESS = result.situsAddress;
      if (result.situsCity) props.SITUS_CITY_NM = result.situsCity;
      window.AcresXOverview?.refreshIdentity?.();
    }
    const link = result.propertySearchUrl;
    if (link && (!props.DATA_LINK || /propertysearch\/?$/i.test(String(props.DATA_LINK)))) {
      props.DATA_LINK = link;
      window.AcresXQuickActions?.refresh?.();
    }
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
    note.textContent = result.propertyTypeNote ? `${CLASS_NOTE}. ${result.propertyTypeNote}` : CLASS_NOTE;
  }

  // Montana only: the assessed land-use acres (grazing, wild hay, ...), with the agricultural
  // classification note when any of it is agricultural or forest land; removed otherwise.
  function renderLandUse(result) {
    const text = landUseText(result?.landUse);
    const existing = document.getElementById('overviewAssessorLandUseWrap');
    if (!text) { existing?.remove(); return; }
    const el = addFact('overviewAssessorLandUse', 'Assessed land use');
    if (!el) return;
    el.textContent = text;
    const wrap = document.getElementById('overviewAssessorLandUseWrap');
    let note = wrap.querySelector('small.assessor-class-note');
    if (!result.agriculturalNote) { note?.remove(); return; }
    if (!note) {
      note = document.createElement('small');
      note.className = 'assessor-class-note';
      wrap.appendChild(note);
    }
    note.textContent = result.agriculturalNote;
  }

  function renderAssessment(result) {
    ensureStyles();
    const grid = document.querySelector('.property-overview-facts');
    if (!grid) return;

    const valueEl = addFact('overviewAssessorValue', result?.label || 'Assessor value');
    const landEl = addFact('overviewLandValue', 'Land value');
    const yearEl = addFact('overviewAssessmentYear', 'Assessment / tax year');

    renderAssessorClass(result);
    renderLandUse(result);

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
      ? ` · Improvements ${money(result.improvementValue)}${result.improvementValueNote ? ` (${escapeText(result.improvementValueNote.toLowerCase())})` : ''}`
      : '';
    // Spokane current-use land: no assessed land value is published, so show the market land value.
    const marketLand = Number.isFinite(result.marketLandValue) && !Number.isFinite(result.landValue)
      ? ` · Market land value ${money(result.marketLandValue)}` : '';
    const exemptionNote = result.exemption ? ` · Exemption: ${escapeText(result.exemption)}` : '';
    // A missing tax amount is no longer called out here ("Tax amount Not available (Not published
    // in the county GIS…)"): the Property tax card (/api/property-tax, property-tax.js) answers it.
    // The API still sends taxAmount / taxAmountNote unchanged.
    const tax = Number.isFinite(result.taxAmount) ? ` · Tax amount ${money(result.taxAmount)}` : '';
    const exemption = Number.isFinite(result.homeownerExemption) && result.homeownerExemption > 0
      ? ` · Homeowner exemption ${money(result.homeownerExemption)}`
      : '';
    const net = Number.isFinite(result.netValue) ? ` · Net taxable ${money(result.netValue)}` : '';
    const market = Number.isFinite(result.marketValue) ? ` · Market value ${money(result.marketValue)}` : '';
    const currentUse = result.currentUse ? ` · ${escapeText(result.currentUse)}` : '';
    const acres = Number.isFinite(result.assessorAcres) && result.assessorAcres > 0 && Array.isArray(result.landUse) ? ` · Assessor acres ${result.assessorAcres.toFixed(2)} ac` : '';
    const levy = result.levyDistrict ? ` · Levy district ${escapeText(result.levyDistrict)}` : '';
    const legal = result.legalDescription ? ` · Legal: ${escapeText(result.legalDescription)}` : '';
    const valuesNote = result.valuesNote ? ` ${escapeText(result.valuesNote)}` : '';
    const link = result.propertySearchUrl
      ? ` <a href="${escapeText(result.propertySearchUrl)}" target="_blank" rel="noopener">${escapeText(result.propertySearchLabel || PROPERTY_SEARCH_LABEL)} ↗</a>`
      : '';
    source.innerHTML = `<strong>Assessment source:</strong> ${result.source}${improvements}${marketLand}${exemption}${exemptionNote}${net}${market}${currentUse}${acres}${levy}${legal}${tax}.${valuesNote} Assessor values are informational and are not the current tax bill.${link}`;
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
    document.getElementById('overviewAssessorLandUseWrap')?.remove();

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
      shareRecordDetails(result);
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

  window.AcresXAssessment = { normalize, classText, landUseText, CLASS_NOTE, renderAssessment, shareAssessorAcres, shareRecordDetails, cadastralUrl };

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