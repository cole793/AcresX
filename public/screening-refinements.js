(() => {
  // The score rules (WEIGHTS, factor scores, missing inputs, the buildable-area check and the
  // weighted score) are in score-core.js (window.AcresXScoreCore, injected first). This file
  // renders the score card, the well and septic cards and the cost card, and keeps
  // window.AcresXScore as a thin wrapper over the core that reads the page's `last`.
  const C = window.AcresXScoreCore;
  if (!C) throw new Error('AcresX: public/score-core.js must load before screening-refinements.js');
  const { WEIGHTS, HOMESITE_MIN_AC, MIN_MEASURED, andList } = C;

  function number(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const currentLast = () => (typeof last === 'undefined' ? undefined : last);

  // Nearby well depth: the one definition (score-core.js wellDepth.stats, window.AcresXWellDepth):
  // terrain-aware (wells at similar elevation), else the closest-five median at low confidence.
  function wellStats() {
    if (typeof last === 'undefined') return null;
    return window.AcresXWellDepth ? window.AcresXWellDepth.stats(last) : null;
  }

  // The page's inputs to the core: the progressive-loading section states
  // (window.AcresXSections.status) and the septic grade, which AcresXSeptic.score also stores on
  // the land answer for the septic card (screening-inputs.js).
  const pageOptions = () => ({
    sectionStatus: name => window.AcresXSections?.status?.(name),
    septicScore: window.AcresXSeptic ? land => window.AcresXSeptic.score(land) : undefined
  });

  // Missing inputs (score-core.js missingInputs): a factor whose source failed, timed out or has
  // not answered yet is left out of the score, instead of being scored as a low 40-50.
  const missingInputs = (l = currentLast()) => C.missingInputs(l, pageOptions().sectionStatus);

  const factorNames = list => andList(list.map(f => f.label));

  function renderWellSummary() {
    const WD = window.AcresXWellDepth;
    const stats = wellStats();
    if (!stats || !WD) return;
    const depth = stats.depth;
    const metric = document.getElementById('wellMetric');
    const note = document.getElementById('wellNote');
    const grade = document.getElementById('waterGrade');
    const status = document.getElementById('waterStatus');
    const dot = document.getElementById('waterDot');
    const card = document.querySelector('.snapshot-card[data-detail="wells"]');

    if (metric) metric.textContent = depth != null ? WD.value(stats) : 'Not found';
    if (note) note.textContent = WD.note(stats);

    // With public water the card's grade and status are public-utilities.js's; the depths stay as
    // the "if a private well were needed" figures.
    if (depth != null && !window.AcresXUtilities?.water(last)) {
      // One grade (AcresXWellDepth.grade): never "Shallow" at low confidence.
      const g = WD.grade(stats);
      if (grade) grade.textContent = g.label;
      if (dot) dot.className = `traffic-dot ${g.cls}`;
      if (status) status.textContent = WD.status(stats);
      if (card) {
        card.classList.remove('snapshot-good', 'snapshot-limited', 'snapshot-bad', 'snapshot-neutral');
        card.classList.add(g.cls === 'green' ? 'snapshot-good' : g.cls === 'amber' ? 'snapshot-limited' : 'snapshot-bad');
      }
    }
  }

  // Septic card: the grade from the measured parcel slope, with the soil map unit's slope class as
  // context. public-utilities.js (loaded later) replaces grade and status when sewer is likely.
  function renderSepticSummary() {
    const soil = last?.land?.soil;
    if (!soil?.available) return;
    window.AcresXSeptic?.apply(last.land);
    const sx = soil.septic;
    if (!sx) return;
    const f = soil.feasibility;
    const grade = document.getElementById('soilGrade');
    const dot = document.getElementById('soilDot');
    const status = document.getElementById('soilStatus');
    const note = document.getElementById('soilNote');
    if (grade) grade.textContent = f === 'favorable' ? 'Favorable' : f === 'limited' ? 'Limited' : 'Moderate';
    if (dot) dot.className = `traffic-dot ${f === 'favorable' ? 'green' : f === 'limited' ? 'red' : 'amber'}`;
    if (status) status.textContent = [soil.component || soil.mapUnit || 'Mapped soil', soil.drainage, soil.hydrologicGroup ? `Group ${soil.hydrologicGroup}` : '', sx.limits.length ? `limited by ${sx.limits.join(', ')}` : ''].filter(Boolean).join(' · ');
    // The card's last word on the note (ui-polish.js writes it first); public-utilities.js may
    // prefix it. A backup soil answer (soil.backup) names its source here so the label survives.
    const source = window.AcresXSeptic?.sourceLabel?.(soil) || '';
    if (note) note.textContent = [`${sx.context}. ${sx.note}`, source].filter(Boolean).join(' ');
  }

  // The buildability score (score-core.js calculate): 7 factors (0-100) weighted by WEIGHTS,
  // shown /10, then the buildable-area homesite check. Listing/MLS data and the cost estimate
  // never feed it. Factors with missing inputs are left out and the weights of the measured ones
  // re-normalized; the score is then "Incomplete — N of 7 factors measured", and "Provisional"
  // below 4 measured.
  const calculateScore = () => C.calculate(currentLast(), pageOptions());
  // The same score and factors for the printable report (property-report-v2.js), so its score and
  // its "top drivers" come from the inputs the dashboard card uses.
  window.AcresXScore = { calculate: calculateScore, missingInputs: l => missingInputs(l), wellStats, WEIGHTS, HOMESITE_MIN_AC, MIN_MEASURED, render: () => renderAll() };

  // "Good buildability · 7-factor screening", "Good buildability · Incomplete — 5 of 7 factors
  // measured", "Provisional score · Incomplete — 3 of 7 factors measured".
  function scoreNoteText(r) {
    const c = r.completeness;
    if (r.score == null) return `Not scored · ${c.label}`;
    const head = c.provisional ? 'Provisional score' : `${r.rating} buildability`;
    return `${head} · ${c.complete ? '7-factor screening' : c.label}`;
  }
  window.AcresXScore.noteText = scoreNoteText;
  // The score card alone (score-cost.js paints it with the cost card).
  window.AcresXScore.renderCard = () => renderScore();

  function retryMissing(sections) {
    const P = window.AcresXProgress;
    if (P?.retryMissing) P.retryMissing(sections);
  }

  function renderScore() {
    const result = calculateScore();
    const { score, factors, constraint, why, completeness } = result;

    const metric = document.getElementById('scoreMetric');
    const note = document.getElementById('scoreNote');
    const card = document.querySelector('.overview-grid .score-card');
    if (!metric || !card) return;
    metric.textContent = score == null ? '—' : score.toFixed(1);
    if (note) note.textContent = scoreNoteText(result);
    renderMissing(card, completeness);
    let whyEl = card.querySelector('.score-why');
    if (!whyEl) {
      whyEl = document.createElement('div');
      // Its own class: .score-constraint is the "Primary screening constraint" line's selector.
      whyEl.className = 'score-why';
      whyEl.setAttribute('style', 'font-size:11px;color:#d1e0d6;margin-top:9px;line-height:1.35;font-weight:700');
      const ref = card.querySelector('.score-factor-line');
      if (ref) card.insertBefore(whyEl, ref); else card.appendChild(whyEl);
    }
    whyEl.textContent = why;

    const chips = card.querySelector('.score-factor-line');
    if (chips) chips.innerHTML = Object.values(factors).map(f => (f.measured ? `<span class="score-factor-chip">${f.label} ${Math.round(f.score)}</span>` : `<span class="score-factor-chip score-factor-missing" title="${f.missing.reason}">${f.label} not checked</span>`)).join('');
    const constraintEl = card.querySelector('.score-constraint');
    if (constraintEl) constraintEl.textContent = `Primary screening constraint: ${constraint.label}`;

    let wetlandNote = card.querySelector('.wetland-coverage-note');
    if (!wetlandNote) {
      wetlandNote = document.createElement('div');
      wetlandNote.className = 'score-constraint wetland-coverage-note';
      card.appendChild(wetlandNote);
    }
    const w = last?.wetlands || {};
    const WX = window.AcresXWetlands;
    // Null means not measured; Number(null) would read as 0%.
    const pct = w.coveragePct == null ? null : number(w.coveragePct);
    const acres = w.wetlandAcres == null ? null : number(w.wetlandAcres);
    wetlandNote.textContent = WX ? WX.grade(w).note
      : !w.available ? 'Mapped wetlands: unavailable'
      : !w.intersects ? 'Mapped wetlands: none detected'
      : pct != null ? `Mapped wetlands: ${pct > 0 && pct < 0.05 ? '<0.1' : pct.toFixed(1)}% of parcel${acres != null ? ` · ${acres.toFixed(2)} ac` : ''}`
      : 'Mapped wetlands detected · coverage percentage unavailable';
  }

  // "Not measured: Septic (USDA soil service didn't answer); …" and a "Retry missing layers"
  // button under the "why" line, while any factor is missing.
  function renderMissing(card, c) {
    let el = card.querySelector('.score-missing');
    if (c.complete) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'score-missing';
      el.setAttribute('style', 'font-size:11px;color:#f3cf86;margin-top:7px;line-height:1.35;font-weight:700');
      const ref = card.querySelector('.score-factor-line');
      if (ref) card.insertBefore(el, ref); else card.appendChild(el);
    }
    const canRetry = c.retry.length && typeof window.AcresXProgress?.retryMissing === 'function';
    const button = canRetry ? ` <button type="button" class="score-retry-missing" data-sections="${c.retry.join(',')}" style="display:inline-block;margin-top:5px;border:1px solid #d9b46a;background:#fff;color:#8a5b13;border-radius:8px;padding:4px 9px;font:800 11px/1 'DM Sans',sans-serif;cursor:pointer">Retry missing layers</button>` : '';
    el.innerHTML = `<span class="score-missing-text">${c.detail}</span>${button}`;
  }
  // One delegated listener: the card's HTML is rewritten on every render.
  document.addEventListener?.('click', event => {
    const btn = event.target?.closest?.('.score-retry-missing');
    if (!btn) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    retryMissing(String(btn.dataset?.sections || '').split(',').filter(Boolean));
  }, true);

  function money(n) { return `$${Math.round(n / 1000)}k`; }

  function costEstimate() {
    const wells = wellStats();
    const depth = wells?.depth ?? null;
    const soil = last?.land?.soil || {};
    const terrain = last?.land?.terrain || {};
    const utilityFound = Array.isArray(last?.utility) && last.utility.length > 0;
    const wellBasis = () => window.AcresXWellDepth?.basis(wells) || `${Math.round(depth)} ft median nearby well depth (${wells.count} well${wells.count === 1 ? '' : 's'})`;
    // Priced at the high end of the depth range (AcresXWellDepth.planningDepth).
    const costDepth = wells?.planningDepth ?? depth;

    let well;
    if (depth == null) well = { low: 20000, high: 40000, basis: 'No nearby comparable well depths; broad planning allowance' };
    else if (costDepth <= 200) well = { low: 14000, high: 24000, basis: wellBasis() };
    else if (costDepth <= 400) well = { low: 20000, high: 35000, basis: wellBasis() };
    else well = { low: 30000, high: 50000, basis: wellBasis() };

    let septic;
    if (!soil.available) septic = { low: 18000, high: 32000, basis: 'Soil screening unavailable; broad planning allowance' };
    else if (soil.feasibility === 'favorable') septic = { low: 12000, high: 20000, basis: 'Favorable USDA soil screening' };
    else if (soil.feasibility === 'limited') septic = { low: 25000, high: 45000, basis: 'USDA soil screening indicates potential limitations' };
    else septic = { low: 18000, high: 30000, basis: 'Moderate USDA soil screening' };

    let sitework;
    if (!terrain.available) sitework = { low: 10000, high: 25000, basis: 'Terrain screening unavailable; broad planning allowance' };
    else if (terrain.gradePct <= 5) sitework = { low: 5000, high: 12000, basis: `${terrain.gradePct.toFixed(1)}% estimated average grade` };
    else if (terrain.gradePct <= 10) sitework = { low: 9000, high: 20000, basis: `${terrain.gradePct.toFixed(1)}% estimated average grade` };
    else if (terrain.gradePct <= 15) sitework = { low: 16000, high: 32000, basis: `${terrain.gradePct.toFixed(1)}% estimated average grade` };
    else sitework = { low: 28000, high: 60000, basis: `${terrain.gradePct.toFixed(1)}% estimated average grade` };

    // A county with local power prices only (Stevens: public/cost-tables.js scope 'power') prices
    // power from the utility's tariff and the mapped line (public/local-cost-model.js); the
    // other lines stay on these generic ranges.
    const localPower = window.AcresXCostModel?.powerOnlyLine?.(last) || null;
    const power = localPower || (utilityFound ? { low: 5000, high: 25000, basis: 'Utility territory identified; distribution distance not yet mapped' } : { low: 10000, high: 35000, basis: 'Utility service proximity unverified' });
    const driveway = { low: 5000, high: 20000, basis: 'Placeholder allowance until access/driveway length is modeled' };
    const PU = window.AcresXUtilities;
    if (PU) { well = PU.waterCost(well, last); septic = PU.sewerCost(septic, last); }
    const components = { well, septic, power, driveway, sitework };
    return {
      components,
      low: Object.values(components).reduce((s, x) => s + x.low, 0),
      high: Object.values(components).reduce((s, x) => s + x.high, 0)
    };
  }

  // The estimate this card shows, for public/local-cost-model.js (generic counties) and the report.
  window.__acresxScreeningCostEstimate = () => costEstimate();

  function showCosts() {
    const estimate = costEstimate();
    const root = document.getElementById('results');
    const title = document.getElementById('resultsTitle');
    const detail = document.getElementById('detailCard');
    if (!root || !title || !detail) return;
    const labels = { well: 'Well', septic: 'Septic', power: 'Power', driveway: 'Driveway', sitework: 'Site work' };
    title.textContent = 'Preliminary Development Cost';
    // Which inputs were missing, when soil / terrain did not load (local-cost-model.js).
    const missing = window.AcresXCostModel?.missingNote ? window.AcresXCostModel.missingNote(window.AcresXCostModel.missingInputs(last)) : '';
    root.innerHTML = `<div class="cost-detail-total"><span>Preliminary planning range</span><strong>${money(estimate.low)}–${money(estimate.high)}</strong></div>${missing ? `<div class="notice cost-missing">${missing}</div>` : ''}${Object.entries(estimate.components).map(([key,item]) => `<div class="result-item"><div class="result-top"><h4>${item.label || labels[key]}</h4><span class="badge">${money(item.low)}–${money(item.high)}</span></div><div class="notice">${item.basis}</div></div>`).join('')}<div class="notice"><strong>Screening estimate only.</strong><br>${window.AcresXCostModel ? `${window.AcresXCostModel.coverageNote ? window.AcresXCostModel.coverageNote(last) : window.AcresXCostModel.GENERIC_NOTE} ` : ''}Actual costs depend on final homesite location, utility design, drilling conditions, septic design, access, permitting and contractor pricing.</div>`;
    detail.classList.add('show');
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCost() {
    const card = document.getElementById('developmentCostCard');
    if (!card) return;
    const estimate = costEstimate();
    const value = card.querySelector('.cost-value');
    if (value) value.textContent = `${money(estimate.low)}–${money(estimate.high)}`;
    card.onclick = showCosts;
    card.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showCosts(); } };
  }

  function renderAll() {
    if (typeof last === 'undefined' || !last?.parcel) return;
    renderWellSummary();
    renderSepticSummary();
    renderScore();
    renderCost();
  }

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      renderAll();
      return result;
    };
  }
})();
