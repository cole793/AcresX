// Independent, read-only diagnostic for matched MLS infrastructure remarks.
// This file never calls the listing API, changes listing state, or updates cards.
(() => {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  function scan(remarks) {
    const text = normalize(remarks);
    const out = { well: [], septic: [], power: [] };
    if (!text) return out;
    const rules = {
      well: [
        ['well_count', /\b(?:property (?:has|includes|features) )?(one|two|three|four|five|[1-5]) (?:existing |private |drilled )?wells?\b/i],
        ['well_existing', /\b(?:existing|private|drilled|domestic) well\b|\bwell (?:is )?(?:installed|drilled|on (?:the )?property)\b/i],
        ['well_shared', /\b(?:shared|community) well\b/i],
        ['well_needed', /\b(?:buyer to drill|well (?:is )?needed|needs? (?:a )?well)\b/i]
      ],
      septic: [
        ['septic_installed', /\b(?:existing septic|septic (?:system )?(?:is )?(?:installed|in place)|installed septic)\b/i],
        ['perc_test', /\b(?:perc(?:olation)? test (?:is )?(?:approved|completed|done|passed)|approved perc|perc approved)\b/i],
        ['septic_needed', /\b(?:buyer to install septic|septic (?:is )?needed|needs? (?:a )?septic(?: system)?)\b/i]
      ],
      power: [
        ['power_connected', /\b(?:power|electric(?:ity)?) (?:is )?(?:connected|installed|hooked up|on (?:the )?property)|\bmeter (?:is )?installed\b/i],
        ['power_nearby', /\b(?:power|electric(?:ity)?) (?:is )?(?:at (?:the )?road|at (?:the )?property line|nearby|available nearby)\b/i],
        ['provider_inland', /\bInland Power(?:\s*(?:&|and)\s*Light)?\b/i],
        ['provider_avista', /\bAvista(?: Utilities)?\b/i],
        ['provider_vera', /\bVera (?:Water (?:and|&) )?Power\b/i]
      ]
    };
    for (const [category, patterns] of Object.entries(rules)) {
      for (const [claim, regex] of patterns) {
        const match = text.match(regex);
        if (match) out[category].push({ claim, phrase: match[0], source: 'MLS PublicRemarks', confidence: 'listing_reported' });
      }
    }
    return out;
  }
  let seen = null;
  function inspect() {
    try {
      const data = window.__acresxLast;
      const listing = data?.resoListings;
      if (!listing || listing === seen) return;
      seen = listing;
      const best = listing.best;
      const remarks = best?.publicRemarks || best?.PublicRemarks || '';
      const result = {
        status: best ? (remarks ? 'scanned' : 'matched_without_remarks') : 'no_match',
        listingId: best?.listingId || null,
        remarksLength: normalize(remarks).length,
        evidence: best ? scan(remarks) : { well: [], septic: [], power: [] }
      };
      window.__acresxMlsScannerDiagnostic = result;
      console.info('[AcresX MLS scanner diagnostic]', result);
    } catch (error) {
      console.warn('[AcresX MLS scanner diagnostic] scan failed', error);
    }
  }
  // Presentation-only enhancement. The matched listing remains the sole source of MLS claims.
  const numberWords = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  function wellReport() {
    const listing = window.__acresxLast?.resoListings;
    const remarks = listing?.best?.publicRemarks || listing?.best?.PublicRemarks || '';
    if (!remarks) return null;
    const claims = scan(remarks).well.filter(item =>
      item.claim === 'well_count' || item.claim === 'well_existing');
    // A negative or future-tense statement is not evidence of an existing well.
    if (!claims.length || /\\b(?:no (?:existing |private )?wells?|without (?:a )?well|well (?:to be|will be) drilled)\\b/i.test(remarks)) return null;
    const countClaim = claims.find(item => item.claim === 'well_count');
    const token = countClaim?.phrase.match(/\\b(one|two|three|four|five|[1-5])\\b/i)?.[1]?.toLowerCase();
    const count = token ? (numberWords[token] || Number(token)) : null;
    return { listing, claims, count, remarks };
  }
  function updateWellCard() {
    const card = document.querySelector('.snapshot-card[data-detail="wells"]');
    const value = document.getElementById('wellMetric');
    const status = document.getElementById('waterStatus');
    if (!card || !value || !status) return;
    const report = wellReport();
    const previous = card.__mlsWellPresentation;
    if (!report) {
      if (previous) {
        value.textContent = previous.value;
        status.textContent = previous.status;
        previous.note?.remove();
        card.classList.remove('mls-well-reported');
        delete card.__mlsWellPresentation;
      }
      return;
    }
    const signature = String(report.listing.best.listingId || '') + ':' + report.remarks;
    if (previous?.signature === signature) return;
    if (previous) {
      previous.note?.remove();
      value.textContent = previous.value;
      status.textContent = previous.status;
    }
    const baseline = { signature, value: value.textContent, status: status.textContent };
    const note = document.createElement('div');
    note.className = 'mls-well-card-note';
    note.textContent = 'Nearby well depth: ' + baseline.value + ' · Public well records shown in details';
    const button = card.querySelector('.snapshot-details-btn');
    if (button) card.insertBefore(note, button);
    else card.appendChild(note);
    baseline.note = note;
    card.__mlsWellPresentation = baseline;
    card.classList.add('mls-well-reported');
    value.textContent = report.count ? report.count + ' wells reported' : 'Well reported';
    status.textContent = 'Matched listing reports existing well' +
      (report.count === 1 ? '' : 's') + ' · Verify on property';
  }
  function addWellStyles() {
    if (document.getElementById('acresxMlsWellStyles')) return;
    const style = document.createElement('style');
    style.id = 'acresxMlsWellStyles';
    style.textContent = `
      .snapshot-card[data-detail="wells"].mls-well-reported{border-color:#93c7a4;background:#f0faf3}
      .snapshot-card[data-detail="wells"].mls-well-reported .snapshot-value{font-size:23px}
      .snapshot-card[data-detail="wells"].mls-well-reported .snapshot-top:after{
        content:"LISTING REPORTED · VERIFY";position:absolute;top:52px;left:18px;
        font:800 10px/1.2 "DM Sans",sans-serif;letter-spacing:.025em;color:#155b36;
        background:#d5f4df;border-radius:999px;padding:5px 8px}
      .snapshot-card[data-detail="wells"].mls-well-reported .snapshot-value{margin-top:36px}
      .mls-well-card-note{font-size:11px;line-height:1.45;color:#42634d;
        padding-top:9px;margin:10px 0;border-top:1px solid #c7dfce}
      [data-mls-well-note]{background:#edf9f2;border:1px solid #c5e7d1;color:#244b32;
        padding:16px;border-radius:12px}
      [data-mls-well-note] strong{color:#155b36;font-size:13px}
    `;
    document.head.appendChild(style);
  }
  // Read-only Well detail annotation. Do not wrap listing lookup or dashboard renderers.
  function showWellEvidence() {
    try {
      const detail = document.getElementById('detailCard');
      const root = detail?.querySelector('.results-scroll');
      if (!root) return;
      const existing = root.querySelector('[data-mls-well-note]');
      const isWellOpen = detail.classList.contains('show') &&
        typeof activeTab !== 'undefined' && activeTab === 'wells';
      const data = window.__acresxLast;
      const listing = data?.resoListings;
      const remarks = listing?.best?.publicRemarks || listing?.best?.PublicRemarks || '';
      const report = isWellOpen ? wellReport() : null;
      const claims = report?.claims || [];
      if (!claims.length) {
        existing?.remove();
        return;
      }
      // Avoid presenting a listing statement as a verified on-parcel well.
      const signature = String(listing.best.listingId || '') + ':' + remarks;
      if (existing?.dataset.signature === signature) return;
      existing?.remove();
      const notice = document.createElement('div');
      notice.className = 'notice';
      notice.dataset.mlsWellNote = 'true';
      notice.dataset.signature = signature;
      const heading = document.createElement('strong');
      heading.textContent = report.count ? report.count + ' WELLS REPORTED IN LISTING' : 'WELL REPORTED IN LISTING';
      notice.appendChild(heading);
      const description = document.createElement('p');
      description.textContent = 'Matched listing description mentions: ' +
        claims.map(item => '“' + item.phrase + '”').join('; ') +
        '. Seller/broker statement only; confirm the well location, ownership, yield and records independently.';
      notice.appendChild(description);
      root.prepend(notice);
    } catch (error) {
      console.warn('[AcresX MLS scanner] Well note unavailable', error);
    }
  }
  // Separate, presentation-only septic/power evidence; never changes the RESO resolver or scores.
  function infrastructureReport(category) {
    const listing = window.__acresxLast?.resoListings;
    const remarks = listing?.best?.publicRemarks || listing?.best?.PublicRemarks || '';
    if (!remarks) return null;
    const found = scan(remarks)[category] || [];
    const positive = category === 'septic'
      ? found.filter(x => x.claim === 'septic_installed' || x.claim === 'perc_test')
      : found.filter(x => x.claim === 'power_connected' || x.claim === 'power_nearby' || x.claim.startsWith('provider_'));
    if (!positive.length) return null;
    // Avoid interpreting negated or future improvements as already installed.
    const blocked = category === 'septic'
      ? /\b(?:no|without|needs?|requires?|proposed|future)\s+(?:existing\s+)?septic\b|\bseptic\s+(?:not\s+installed|to\s+be\s+installed)\b/i
      : /\b(?:no|without|needs?|requires?)\s+(?:existing\s+)?(?:power|electricity|electrical service)\b|\b(?:power|electricity)\s+(?:not\s+connected|to\s+be\s+installed)\b/i;
    if (blocked.test(remarks)) return null;
    const signature = String(listing.best.listingId || '') + ':' + remarks;
    return { listing, remarks, positive, signature };
  }
  function infrastructureLabel(category, report) {
    if (category === 'septic') {
      const installed = report.positive.some(x => x.claim === 'septic_installed');
      return installed ? 'Septic reported in listing' : 'Perc test reported';
    }
    if (report.positive.some(x => x.claim === 'power_connected')) return 'Power reported on property';
    if (report.positive.some(x => x.claim === 'power_nearby')) return 'Power reported nearby';
    const provider = report.positive.find(x => x.claim.startsWith('provider_'));
    return provider ? provider.phrase + ' reported' : 'Power mentioned in listing';
  }
  function updateInfrastructureCard(category) {
    const detail = category === 'septic' ? 'soil' : 'power';
    const card = document.querySelector('.snapshot-card[data-detail="' + detail + '"]');
    const value = document.getElementById(category === 'septic' ? 'soilMetric' : 'utilityMetric');
    const status = document.getElementById(category === 'septic' ? 'soilStatus' : 'powerStatus');
    if (!card || !value || !status) return;
    const key = '__mls_' + category + '_presentation';
    const previous = card[key];
    const report = infrastructureReport(category);
    if (!report) {
      if (previous) {
        value.textContent = previous.value;
        status.textContent = previous.status;
        previous.note.remove();
        card.classList.remove('mls-' + category + '-reported');
        delete card[key];
      }
      return;
    }
    if (previous?.signature === report.signature) return;
    if (previous) {
      value.textContent = previous.value;
      status.textContent = previous.status;
      previous.note.remove();
    }
    const baseline = { signature: report.signature, value: value.textContent, status: status.textContent };
    const note = document.createElement('div');
    note.className = 'mls-infrastructure-card-note';
    note.textContent = category === 'septic'
      ? 'Soil screening: ' + baseline.value
      : 'Mapped utility territory: ' + baseline.value;
    const button = card.querySelector('.snapshot-details-btn');
    if (button) card.insertBefore(note, button);
    else card.appendChild(note);
    baseline.note = note;
    card[key] = baseline;
    card.classList.add('mls-' + category + '-reported');
    value.textContent = infrastructureLabel(category, report);
    status.textContent = 'Matched listing statement · Verify ' +
      (category === 'septic' ? 'permit and system status' : 'service and connection');
  }
  function showInfrastructureDetail(category) {
    const detail = category === 'septic' ? 'soil' : 'power';
    const panel = document.getElementById('detailCard');
    const root = panel?.querySelector('.results-scroll');
    if (!root) return;
    const attr = 'data-mls-' + category + '-note';
    const existing = root.querySelector('[' + attr + ']');
    const open = panel.classList.contains('show') &&
      typeof activeTab !== 'undefined' && activeTab === detail;
    const report = open ? infrastructureReport(category) : null;
    if (!report) { existing?.remove(); return; }
    if (existing?.dataset.signature === report.signature) return;
    existing?.remove();
    const notice = document.createElement('div');
    notice.className = 'notice mls-infrastructure-detail';
    notice.setAttribute(attr, 'true');
    notice.dataset.signature = report.signature;
    const heading = document.createElement('strong');
    heading.textContent = infrastructureLabel(category, report).toUpperCase() + ' · LISTING REPORTED';
    const description = document.createElement('p');
    description.textContent = 'Matched listing description mentions: ' +
      report.positive.map(x => '“' + x.phrase + '”').join('; ') +
      (category === 'septic'
        ? '. Verify permits, installation, capacity and condition with the health department.'
        : '. Verify provider, line location, meter and connection availability directly with the utility.');
    notice.append(heading, description);
    root.prepend(notice);
  }
  function updateAdditionalInfrastructure() {
    try {
      for (const category of ['septic', 'power']) {
        updateInfrastructureCard(category);
        showInfrastructureDetail(category);
      }
    } catch (error) {
      console.warn('[AcresX MLS scanner] Infrastructure presentation unavailable', error);
    }
  }
  function addInfrastructureStyles() {
    if (document.getElementById('acresxMlsInfrastructureStyles')) return;
    const style = document.createElement('style');
    style.id = 'acresxMlsInfrastructureStyles';
    style.textContent = `
      .snapshot-card.mls-septic-reported,.snapshot-card.mls-power-reported{
        border-color:#93c7a4;background:#f0faf3}
      .snapshot-card.mls-septic-reported .snapshot-top:after,
      .snapshot-card.mls-power-reported .snapshot-top:after{
        content:"LISTING REPORTED · VERIFY";position:absolute;top:52px;left:18px;
        font:800 10px/1.2 "DM Sans",sans-serif;color:#155b36;
        background:#d5f4df;border-radius:999px;padding:5px 8px}
      .snapshot-card.mls-septic-reported .snapshot-value,
      .snapshot-card.mls-power-reported .snapshot-value{margin-top:36px;font-size:19px;line-height:1.25}
      .mls-infrastructure-card-note{font-size:11px;line-height:1.45;color:#42634d;
        padding-top:9px;margin:10px 0;border-top:1px solid #c7dfce}
      .mls-infrastructure-detail{background:#edf9f2;border:1px solid #c5e7d1;color:#244b32;
        padding:16px;border-radius:12px}
      .mls-infrastructure-detail strong{color:#155b36;font-size:13px}
    `;
    document.head.appendChild(style);
  }
  window.__acresxScanMlsRemarks = scan;
  addWellStyles();
  addInfrastructureStyles();
  window.setInterval(() => { inspect(); updateWellCard(); showWellEvidence(); updateAdditionalInfrastructure(); }, 750);
  inspect();
  updateWellCard();
  showWellEvidence();
  updateAdditionalInfrastructure();
})();
