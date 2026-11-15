(() => {
  const WEIGHTS = { water: 15, soil: 20, terrain: 20, flood: 15, wetlands: 10, power: 10, zoning: 10 };

  function number(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Nearby well depth: the one definition in screening-inputs.js (window.AcresXWellDepth), the
  // median of the residential-comparable wells among the closest five.
  function wellStats() {
    if (typeof last === 'undefined') return null;
    return window.AcresXWellDepth ? window.AcresXWellDepth.stats(last) : null;
  }

  // ---- Buildable area in the score (owner request 2026-11-14)
  // window.AcresXBuildable / POST /api/buildable-area: the parcel minus mapped flood zones,
  // wetlands, steep slopes (and a plain zoning setback). Kept simple on purpose:
  // - Homesite minimum: 0.5 ac, or half the parcel on a parcel under 1 acre (a small city lot
  //   that is all buildable is not penalized). The zoning minimum lot is not used: it applies to
  //   the whole lot, not to the area left outside constraints.
  // - Buildable acres below that minimum: the score is capped at 2.5 + 2.5 x (buildable / minimum),
  //   2.5 at 0 ac up to 5.0 at the minimum ("Challenging"): a house may not fit.
  // - At or above it: no buildable-area penalty. Flood and wetlands are already scored by how much
  //   of the parcel they cover, so the area they remove is not penalized a second time.
  // - Not measured (still loading, or unavailable): no change; the score updates when it arrives.
  const HOMESITE_MIN_AC = 0.5;
  const REMOVED_NAMES = { flood: 'the flood zone', wetland: 'wetlands', slope: 'steep slopes', setback: 'setbacks' };
  const andList = list => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

  function buildableCheck() {
    const b = last?.buildableArea;
    const B = window.AcresXBuildable;
    const ok = b && (b.status === 'measured' || b.status === 'partial') && number(b.buildableAcres) != null;
    if (!ok) return { measured: false, pending: !b };
    const acres = number(b.buildableAcres);
    const parcel = number(b.parcelAcres);
    const need = parcel != null && parcel < 1 ? Math.min(HOMESITE_MIN_AC, parcel / 2) : HOMESITE_MIN_AC;
    const tight = acres < need;
    const fmt = a => (B ? B.fmtAcres(a, parcel ?? a) : (parcel ?? a) >= 10 ? a.toFixed(1) : a.toFixed(2));
    const removed = [...new Set((b.removed || []).filter(r => number(r.acres) > 0).map(r => REMOVED_NAMES[r.key] || String(r.reason || r.key).toLowerCase()))];
    let why;
    if (tight) why = `Only ${fmt(acres)} ac remain outside ${andList(removed) || 'mapped constraints'}: a homesite may not fit`;
    else if (removed.length) why = `${fmt(acres)} ac remain outside ${andList(removed)}`;
    else why = `All ${fmt(acres)} ac outside mapped flood zones, wetlands and steep slopes`;
    return { measured: true, acres, need, tight, cap: tight ? 2.5 + 2.5 * (acres / need) : null, why };
  }

  function wetlandsScore(wetlands) {
    const WX = window.AcresXWetlands;
    if (WX) return WX.score(wetlands);
    // Without wetlands-status.js loaded yet. A null coveragePct is unmeasured, not 0%.
    if (!wetlands?.available) return 50;
    if (!wetlands.intersects) return 96;
    const pct = wetlands.coveragePct == null ? null : number(wetlands.coveragePct);
    if (pct == null) return 55;
    if (pct < 5) return 90;
    if (pct < 15) return 80;
    if (pct < 30) return 65;
    if (pct < 50) return 45;
    return 22;
  }

  function scoreFactors() {
    const wells = wellStats();
    const depth = wells?.depth ?? null;
    const soil = last?.land?.soil || {};
    const terrain = last?.land?.terrain || {};
    const flood = last?.flood || {};
    const wetlands = last?.wetlands || {};
    const zoning = last?.zoningPermits?.zoning || {};
    const utilityFound = Array.isArray(last?.utility) && last.utility.length > 0;

    // Public water / sewer (public-utilities.js) replace the well and septic inputs when served or likely.
    const PU = window.AcresXUtilities;
    const wellWater = depth != null ? (depth <= 200 ? 92 : depth <= 400 ? 76 : 55) : 40;
    // Septic: USDA drainage and hydrologic group with the measured parcel slope (screening-inputs.js).
    const SX = window.AcresXSeptic;
    const soilSeptic = SX ? SX.score(last?.land) : !soil.available ? 50 : soil.feasibility === 'favorable' ? 92 : soil.feasibility === 'limited' ? 38 : 66;
    const water = PU ? PU.waterScore(wellWater, last) : wellWater;
    const soilScore = PU ? PU.septicScore(soilSeptic, last) : soilSeptic;
    const terrainScore = !terrain.available ? 50 : terrain.gradePct <= 5 ? 96 : terrain.gradePct <= 10 ? 82 : terrain.gradePct <= 15 ? 62 : 35;
    const FX = window.AcresXFlood;
    // Without flood-status.js loaded yet: the older scale, without throwing.
    const floodScore = FX ? FX.score(flood) : !flood.available || flood.source?.emptyResult ? 50 : flood.high ? 20 : flood.intersects ? 55 : 96;
    // With measured zone shares, the flood factor follows how much of the parcel is in the SFHA
    // (flood-status.js shareScore); unmeasured shares keep the category score above.
    const floodShareScore = FX?.shareScore ? FX.shareScore(flood) : null;
    const floodFactor = floodShareScore ?? floodScore;
    const powerScore = last?.powerIntelligence?.territory?.confirmed ? 78 : utilityFound ? 70 : 45;
    const zoningScore = zoning.status === 'gis_match' ? 86 : zoning.status === 'no_match' ? 52 : 45;

    return {
      water: { score: water, label: 'Water' },
      soil: { score: soilScore, label: 'Septic' },
      terrain: { score: terrainScore, label: 'Terrain' },
      flood: { score: floodFactor, label: 'Flood' },
      wetlands: { score: wetlandsScore(wetlands), label: 'Wetlands' },
      power: { score: powerScore, label: 'Power' },
      zoning: { score: zoningScore, label: 'Zoning' }
    };
  }

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
      const label = depth <= 200 ? 'Shallow' : depth <= 400 ? 'Moderate' : 'Deep';
      if (grade) grade.textContent = label;
      if (dot) dot.className = `traffic-dot ${depth <= 200 ? 'green' : depth <= 400 ? 'amber' : 'red'}`;
      if (status) status.textContent = stats.excluded ? `${stats.excluded} nonresidential well${stats.excluded === 1 ? '' : 's'} excluded from depth estimate` : 'Residential-comparable nearby well depths';
      if (card) {
        card.classList.remove('snapshot-good', 'snapshot-limited', 'snapshot-bad', 'snapshot-neutral');
        card.classList.add(depth <= 200 ? 'snapshot-good' : depth <= 400 ? 'snapshot-limited' : 'snapshot-bad');
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
    if (note) note.textContent = `${sx.context}. ${sx.note}`;
  }

  // The buildability score: 7 factors (0-100) weighted by WEIGHTS, shown /10, then the
  // buildable-area homesite check (buildableCheck above). Listing/MLS data and the cost
  // estimate never feed it.
  function calculateScore() {
    const factors = scoreFactors();
    let weighted = 0;
    Object.entries(factors).forEach(([key, factor]) => { weighted += factor.score * WEIGHTS[key] / 100; });
    const buildable = buildableCheck();
    const factorScore = weighted / 10;
    const score = buildable.cap != null ? Math.min(factorScore, buildable.cap) : factorScore;
    const rating = score >= 8.5 ? 'Excellent' : score >= 7 ? 'Good' : score >= 5.5 ? 'Moderate' : 'Challenging';
    const constraint = Object.values(factors).sort((a, b) => a.score - b.score)[0];
    // One line for "why this score", under the score on the dashboard and on report page 1.
    const why = buildable.measured ? buildable.why
      : buildable.pending ? `Buildable area still measuring · main constraint: ${constraint.label.toLowerCase()}`
      : `Buildable area not measured · main constraint: ${constraint.label.toLowerCase()}`;
    return { score, factorScore, rating, factors, constraint, buildable, why, weights: { ...WEIGHTS } };
  }
  // The same score and factors for the printable report (property-report-v2.js), so its score and
  // its "top drivers" come from the inputs the dashboard card uses.
  window.AcresXScore = { calculate: calculateScore, wellStats, WEIGHTS, HOMESITE_MIN_AC, render: () => renderAll() };

  function renderScore() {
    const { score, rating, factors, constraint, why } = calculateScore();

    const metric = document.getElementById('scoreMetric');
    const note = document.getElementById('scoreNote');
    const card = document.querySelector('.overview-grid .score-card');
    if (!metric || !card) return;
    metric.textContent = score.toFixed(1);
    if (note) note.textContent = `${rating} buildability · 7-factor screening`;
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
    if (chips) chips.innerHTML = Object.values(factors).map(f => `<span class="score-factor-chip">${f.label} ${Math.round(f.score)}</span>`).join('');
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

  function money(n) { return `$${Math.round(n / 1000)}k`; }

  function costEstimate() {
    const wells = wellStats();
    const depth = wells?.depth ?? null;
    const soil = last?.land?.soil || {};
    const terrain = last?.land?.terrain || {};
    const utilityFound = Array.isArray(last?.utility) && last.utility.length > 0;
    const wellBasis = () => `${Math.round(depth)} ft median nearby well depth (${wells.count} well${wells.count === 1 ? '' : 's'})`;

    let well;
    if (depth == null) well = { low: 20000, high: 40000, basis: 'No nearby comparable well depths; broad planning allowance' };
    else if (depth <= 200) well = { low: 14000, high: 24000, basis: wellBasis() };
    else if (depth <= 400) well = { low: 20000, high: 35000, basis: wellBasis() };
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

    const power = utilityFound ? { low: 5000, high: 25000, basis: 'Utility territory identified; distribution distance not yet mapped' } : { low: 10000, high: 35000, basis: 'Utility service proximity unverified' };
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
    root.innerHTML = `<div class="cost-detail-total"><span>Preliminary planning range</span><strong>${money(estimate.low)}–${money(estimate.high)}</strong></div>${Object.entries(estimate.components).map(([key,item]) => `<div class="result-item"><div class="result-top"><h4>${item.label || labels[key]}</h4><span class="badge">${money(item.low)}–${money(item.high)}</span></div><div class="notice">${item.basis}</div></div>`).join('')}<div class="notice"><strong>Screening estimate only.</strong><br>${window.AcresXCostModel ? `${window.AcresXCostModel.GENERIC_NOTE} ` : ''}Actual costs depend on final homesite location, utility design, drilling conditions, septic design, access, permitting and contractor pricing.</div>`;
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
