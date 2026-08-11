(() => {
  const WEIGHTS = { water: 15, soil: 20, terrain: 20, flood: 15, wetlands: 10, power: 10, zoning: 10 };

  function number(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function wellText(well) {
    const p = well?.properties || {};
    return [
      p.WellProjectType, p.WellSubType, p.ProjectName, p.SiteType, p.WaterUse,
      p.WELL_USE, p.USE, p.Status, p.STATUS
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function excludedWell(well) {
    const text = wellText(well);
    return /\b(irrigat|agricultur|industrial|monitor|observation|injection|dewater|geothermal|environmental|remediation|municipal)\w*/i.test(text);
  }

  function wellStats() {
    if (typeof last === 'undefined' || !Array.isArray(last?.wells)) return null;
    const wells = last.wells.slice(0, 5);
    const comparable = wells.filter(w => !excludedWell(w));
    const depths = comparable.map(w => number(w?.properties?.CompletedDepth)).filter(v => v && v > 0);
    const fallbackDepths = wells.map(w => number(w?.properties?.CompletedDepth)).filter(v => v && v > 0);
    const med = median(depths);
    return {
      median: med,
      count: depths.length,
      excluded: wells.filter(excludedWell).length,
      total: wells.length,
      fallbackMedian: median(fallbackDepths)
    };
  }

  function wetlandsScore(wetlands) {
    if (!wetlands?.available) return 50;
    if (!wetlands.intersects) return 96;
    const pct = number(wetlands.coveragePct);
    if (pct == null) return 55;
    if (pct < 5) return 90;
    if (pct < 15) return 80;
    if (pct < 30) return 65;
    if (pct < 50) return 45;
    return 22;
  }

  function scoreFactors() {
    const wells = wellStats();
    const depth = wells?.median ?? wells?.fallbackMedian;
    const soil = last?.land?.soil || {};
    const terrain = last?.land?.terrain || {};
    const flood = last?.flood || {};
    const wetlands = last?.wetlands || {};
    const zoning = last?.zoningPermits?.zoning || {};
    const utilityFound = Array.isArray(last?.utility) && last.utility.length > 0;

    const water = depth != null ? (depth <= 200 ? 92 : depth <= 400 ? 76 : 55) : 40;
    const soilScore = !soil.available ? 50 : soil.feasibility === 'favorable' ? 92 : soil.feasibility === 'limited' ? 38 : 66;
    const terrainScore = !terrain.available ? 50 : terrain.gradePct <= 5 ? 96 : terrain.gradePct <= 10 ? 82 : terrain.gradePct <= 15 ? 62 : 35;
    const floodScore = !flood.available ? 50 : flood.high ? 20 : flood.intersects ? 55 : 96;
    const powerScore = last?.powerIntelligence?.territory?.confirmed ? 78 : utilityFound ? 70 : 45;
    const zoningScore = zoning.status === 'gis_match' ? 86 : zoning.status === 'no_match' ? 52 : 45;

    return {
      water: { score: water, label: 'Water' },
      soil: { score: soilScore, label: 'Septic' },
      terrain: { score: terrainScore, label: 'Terrain' },
      flood: { score: floodScore, label: 'Flood' },
      wetlands: { score: wetlandsScore(wetlands), label: 'Wetlands' },
      power: { score: powerScore, label: 'Power' },
      zoning: { score: zoningScore, label: 'Zoning' }
    };
  }

  function renderWellSummary() {
    const stats = wellStats();
    if (!stats) return;
    const depth = stats.median ?? stats.fallbackMedian;
    const metric = document.getElementById('wellMetric');
    const note = document.getElementById('wellNote');
    const grade = document.getElementById('waterGrade');
    const status = document.getElementById('waterStatus');
    const card = document.querySelector('.snapshot-card[data-detail="wells"]');

    if (metric) metric.textContent = depth != null ? `${Math.round(depth)} ft` : 'Not found';
    if (note) {
      if (stats.median != null) note.textContent = `${stats.count} residential-comparable well${stats.count === 1 ? '' : 's'} · median depth${stats.excluded ? ` · ${stats.excluded} nonresidential excluded` : ''}`;
      else if (stats.fallbackMedian != null) note.textContent = `No clearly residential well type identified · ${stats.total} nearby depth record${stats.total === 1 ? '' : 's'}`;
      else note.textContent = 'No nearby depth records returned';
    }

    if (depth != null) {
      const label = depth <= 200 ? 'Shallow' : depth <= 400 ? 'Moderate' : 'Deep';
      if (grade) grade.textContent = label;
      if (status) status.textContent = stats.excluded ? `${stats.excluded} nonresidential well${stats.excluded === 1 ? '' : 's'} excluded from depth estimate` : 'Residential-comparable nearby well depths';
      if (card) {
        card.classList.remove('snapshot-good', 'snapshot-limited', 'snapshot-bad', 'snapshot-neutral');
        card.classList.add(depth <= 200 ? 'snapshot-good' : depth <= 400 ? 'snapshot-limited' : 'snapshot-bad');
      }
    }
  }

  function renderScore() {
    const factors = scoreFactors();
    let weighted = 0;
    Object.entries(factors).forEach(([key, factor]) => { weighted += factor.score * WEIGHTS[key] / 100; });
    const score = weighted / 10;
    const rating = score >= 8.5 ? 'Excellent' : score >= 7 ? 'Good' : score >= 5.5 ? 'Moderate' : 'Challenging';
    const constraint = Object.values(factors).sort((a, b) => a.score - b.score)[0];

    const metric = document.getElementById('scoreMetric');
    const note = document.getElementById('scoreNote');
    const card = document.querySelector('.overview-grid .score-card');
    if (!metric || !card) return;
    metric.textContent = score.toFixed(1);
    if (note) note.textContent = `${rating} buildability · 7-factor screening`;

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
    const pct = number(w.coveragePct);
    const acres = number(w.wetlandAcres);
    wetlandNote.textContent = !w.available ? 'Mapped wetlands: unavailable'
      : !w.intersects ? 'Mapped wetlands: none detected'
      : pct != null ? `Mapped wetlands: ${pct.toFixed(1)}% of parcel${acres != null ? ` · ${acres.toFixed(2)} ac` : ''}`
      : 'Mapped wetlands detected · coverage percentage unavailable';
  }

  function money(n) { return `$${Math.round(n / 1000)}k`; }

  function costEstimate() {
    const wells = wellStats();
    const depth = wells?.median ?? wells?.fallbackMedian;
    const soil = last?.land?.soil || {};
    const terrain = last?.land?.terrain || {};
    const utilityFound = Array.isArray(last?.utility) && last.utility.length > 0;

    let well;
    if (depth == null) well = { low: 20000, high: 40000, basis: 'No nearby comparable well depths; broad planning allowance' };
    else if (depth <= 200) well = { low: 14000, high: 24000, basis: `${Math.round(depth)} ft median residential-comparable well depth` };
    else if (depth <= 400) well = { low: 20000, high: 35000, basis: `${Math.round(depth)} ft median residential-comparable well depth` };
    else well = { low: 30000, high: 50000, basis: `${Math.round(depth)} ft median residential-comparable well depth` };

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
    const components = { well, septic, power, driveway, sitework };
    return {
      components,
      low: Object.values(components).reduce((s, x) => s + x.low, 0),
      high: Object.values(components).reduce((s, x) => s + x.high, 0)
    };
  }

  function showCosts() {
    const estimate = costEstimate();
    const root = document.getElementById('results');
    const title = document.getElementById('resultsTitle');
    const detail = document.getElementById('detailCard');
    if (!root || !title || !detail) return;
    const labels = { well: 'Well', septic: 'Septic', power: 'Power', driveway: 'Driveway', sitework: 'Site work' };
    title.textContent = 'Preliminary Development Cost';
    root.innerHTML = `<div class="cost-detail-total"><span>Preliminary planning range</span><strong>${money(estimate.low)}–${money(estimate.high)}</strong></div>${Object.entries(estimate.components).map(([key,item]) => `<div class="result-item"><div class="result-top"><h4>${labels[key]}</h4><span class="badge">${money(item.low)}–${money(item.high)}</span></div><div class="notice">${item.basis}</div></div>`).join('')}<div class="notice"><strong>Screening estimate only.</strong><br>Actual costs depend on final homesite location, utility design, drilling conditions, septic design, access, permitting and contractor pricing.</div>`;
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
