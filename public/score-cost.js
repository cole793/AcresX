(() => {
  const WEIGHTS = { water: 15, soil: 20, terrain: 20, flood: 15, wetlands: 10, power: 10, zoning: 10 };

  function addStyles() {
    if (document.getElementById('scoreCostStyles')) return;
    const style = document.createElement('style');
    style.id = 'scoreCostStyles';
    style.textContent = `
      .overview-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;justify-content:stretch!important;gap:16px;margin-top:16px}
      .overview-grid .parcel-card{display:none!important}
      .overview-grid .score-card,.development-cost-card{min-height:205px;width:100%}
      .overview-grid .score-card{padding:24px 26px;display:flex;flex-direction:column;justify-content:space-between}
      .overview-grid .score-card .metric-value{font-size:44px;line-height:1;margin-top:17px}
      .overview-grid .score-card .metric-title{font-size:15px}
      .score-factor-line{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
      .score-factor-chip{font-size:9px;font-weight:800;border-radius:999px;padding:5px 7px;background:rgba(255,255,255,.12);color:#e4f1e9}
      .score-constraint{font-size:11px;color:#d1e0d6;margin-top:9px;line-height:1.35}
      .development-cost-card{padding:24px 26px;display:flex;flex-direction:column;justify-content:space-between;background:#fff;cursor:pointer;transition:.18s ease}
      .development-cost-card:hover{transform:translateY(-2px);border-color:#b8cbbd;box-shadow:0 16px 40px rgba(28,55,38,.12)}
      .development-cost-card .cost-icon{width:40px;height:40px;border-radius:12px;background:var(--pale);display:grid;place-items:center;font-size:19px;font-weight:800;color:var(--green)}
      .development-cost-card .cost-kicker{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--green2);font-weight:800;margin-bottom:5px}
      .development-cost-card .cost-value{font:800 clamp(27px,3vw,38px) Manrope;line-height:1.05;color:var(--ink)}
      .development-cost-card .cost-note{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.45}
      .development-cost-card .cost-pill{align-self:flex-start;margin-top:14px;border-radius:999px;background:var(--pale);color:var(--green);font-size:10px;font-weight:800;padding:6px 9px}
      .phase2-terrain-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #edf1ee}
      .phase2-terrain-item span{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:800}
      .phase2-terrain-item strong{display:block;font-size:12px;margin-top:3px}
      .property-quick-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
      .property-quick-action{border:1px solid var(--line);background:#f8faf8;color:var(--ink);padding:7px 9px;border-radius:8px;font-size:10px;font-weight:800}
      .property-quick-action:hover{border-color:#afc5b5;background:#f0f5f1}
      .cost-detail-total{display:flex;justify-content:space-between;gap:20px;align-items:center;padding:16px;border-radius:12px;background:var(--pale);margin-bottom:12px}
      .cost-detail-total span{font-size:11px;color:var(--muted)}
      .cost-detail-total strong{font:800 23px Manrope;color:var(--green)}
      @media(max-width:800px){.overview-grid{grid-template-columns:1fr!important}.overview-grid .score-card,.development-cost-card{min-height:175px}.phase2-terrain-row{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function money(n) {
    return `$${Math.round(n / 1000)}k`;
  }

  function avgWellDepth() {
    if (typeof last === 'undefined' || !Array.isArray(last?.wells)) return null;
    const values = last.wells.slice(0, 5).map(w => Number(w?.properties?.CompletedDepth)).filter(v => Number.isFinite(v) && v > 0);
    if (!values.length) return null;
    return { average: values.reduce((a, b) => a + b, 0) / values.length, count: values.length };
  }

  function scoreFactors() {
    const wells = avgWellDepth();
    const soil = last?.land?.soil || {};
    const terrain = last?.land?.terrain || {};
    const flood = last?.flood || {};
    const wetlands = last?.wetlands || {};
    const zoning = last?.zoningPermits?.zoning || {};
    const utilityFound = Array.isArray(last?.utility) && last.utility.length > 0;

    const water = wells ? (wells.average <= 200 ? 92 : wells.average <= 400 ? 76 : 55) : 40;
    const soilScore = !soil.available ? 50 : soil.feasibility === 'favorable' ? 92 : soil.feasibility === 'limited' ? 38 : 66;
    const terrainScore = !terrain.available ? 50 : terrain.gradePct <= 5 ? 96 : terrain.gradePct <= 10 ? 82 : terrain.gradePct <= 15 ? 62 : 35;
    const floodScore = !flood.available ? 50 : flood.high ? 20 : flood.intersects ? 55 : 96;
    const wetlandsScore = !wetlands.available ? 50 : wetlands.intersects ? 42 : 96;
    const powerScore = last?.powerIntelligence?.territory?.confirmed ? 78 : utilityFound ? 70 : 45;
    const zoningScore = zoning.status === 'gis_match' ? 86 : zoning.status === 'no_match' ? 52 : 45;

    return {
      water: { score: water, label: 'Water' },
      soil: { score: soilScore, label: 'Septic' },
      terrain: { score: terrainScore, label: 'Terrain' },
      flood: { score: floodScore, label: 'Flood' },
      wetlands: { score: wetlandsScore, label: 'Wetlands' },
      power: { score: powerScore, label: 'Power' },
      zoning: { score: zoningScore, label: 'Zoning' }
    };
  }

  function calculateScore() {
    const factors = scoreFactors();
    let weighted = 0;
    for (const [key, factor] of Object.entries(factors)) weighted += factor.score * WEIGHTS[key] / 100;
    const score = weighted / 10;
    const rating = score >= 8.5 ? 'Excellent' : score >= 7 ? 'Good' : score >= 5.5 ? 'Moderate' : 'Challenging';
    const constraint = Object.values(factors).sort((a, b) => a.score - b.score)[0];
    return { score, rating, factors, constraint };
  }

  function rangeForCosts() {
    const wells = avgWellDepth();
    const soil = last?.land?.soil || {};
    const terrain = last?.land?.terrain || {};
    const utilityFound = Array.isArray(last?.utility) && last.utility.length > 0;

    let well;
    if (!wells) well = { low: 20000, high: 40000, basis: 'No nearby reported well depths; broad planning allowance' };
    else if (wells.average <= 200) well = { low: 14000, high: 24000, basis: `${Math.round(wells.average)} ft average nearby well depth` };
    else if (wells.average <= 400) well = { low: 20000, high: 35000, basis: `${Math.round(wells.average)} ft average nearby well depth` };
    else well = { low: 30000, high: 50000, basis: `${Math.round(wells.average)} ft average nearby well depth` };

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

    const power = utilityFound
      ? { low: 5000, high: 25000, basis: 'Utility territory identified; distribution distance not yet mapped' }
      : { low: 10000, high: 35000, basis: 'Utility service proximity unverified' };

    const driveway = { low: 5000, high: 20000, basis: 'Placeholder allowance until access/driveway length is modeled' };
    const components = { well, septic, power, driveway, sitework };
    const low = Object.values(components).reduce((sum, item) => sum + item.low, 0);
    const high = Object.values(components).reduce((sum, item) => sum + item.high, 0);
    return { low, high, components };
  }

  function ensureCostCard() {
    addStyles();
    const grid = document.querySelector('.overview-grid');
    if (!grid) return null;

    let card = document.getElementById('developmentCostPlaceholder') || document.getElementById('developmentCostCard');
    if (!card) {
      card = document.createElement('article');
      grid.appendChild(card);
    }
    card.id = 'developmentCostCard';
    card.className = 'card development-cost-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    return card;
  }

  function renderScore() {
    const result = calculateScore();
    const metric = document.getElementById('scoreMetric');
    const note = document.getElementById('scoreNote');
    const card = document.querySelector('.overview-grid .score-card');
    if (!metric || !card) return;

    metric.textContent = result.score.toFixed(1);
    if (note) note.textContent = `${result.rating} buildability · 7-factor screening`;

    let chips = card.querySelector('.score-factor-line');
    if (!chips) {
      chips = document.createElement('div');
      chips.className = 'score-factor-line';
      card.appendChild(chips);
    }
    chips.innerHTML = Object.values(result.factors).map(f => `<span class="score-factor-chip">${f.label} ${Math.round(f.score)}</span>`).join('');

    let constraint = card.querySelector('.score-constraint');
    if (!constraint) {
      constraint = document.createElement('div');
      constraint.className = 'score-constraint';
      card.appendChild(constraint);
    }
    constraint.textContent = `Primary screening constraint: ${result.constraint.label}`;
  }

  function renderCost() {
    const card = ensureCostCard();
    if (!card) return;
    const estimate = rangeForCosts();
    card.innerHTML = `
      <div class="cost-icon">$</div>
      <div>
        <div class="cost-kicker">Preliminary development estimate</div>
        <div class="cost-value">${money(estimate.low)}–${money(estimate.high)}</div>
        <div class="cost-note">Planning range for well, septic, power, driveway and site work. This is a screening allowance, not a contractor or utility quote.</div>
        <div class="cost-pill">View assumptions →</div>
      </div>
    `;
    card.onclick = showCostDetails;
    card.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showCostDetails(); } };
  }

  function showCostDetails() {
    const estimate = rangeForCosts();
    const root = document.getElementById('results');
    const title = document.getElementById('resultsTitle');
    const detail = document.getElementById('detailCard');
    if (!root || !title || !detail) return;

    title.textContent = 'Preliminary Development Cost';
    const labels = { well: 'Well', septic: 'Septic', power: 'Power', driveway: 'Driveway', sitework: 'Site work' };
    root.innerHTML = `
      <div class="cost-detail-total"><span>Preliminary planning range</span><strong>${money(estimate.low)}–${money(estimate.high)}</strong></div>
      ${Object.entries(estimate.components).map(([key, item]) => `
        <div class="result-item">
          <div class="result-top"><h4>${labels[key]}</h4><span class="badge">${money(item.low)}–${money(item.high)}</span></div>
          <div class="notice">${item.basis}</div>
        </div>
      `).join('')}
      <div class="notice"><strong>Screening estimate only.</strong><br>Actual costs depend on final homesite location, utility design, drilling conditions, septic design, access, permitting and contractor pricing. AcresX will tighten these ranges as parcel-specific infrastructure data is added.</div>
    `;
    detail.classList.add('show');
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function addTerrainFacts() {
    const info = document.querySelector('.property-overview-info');
    if (!info) return;
    let row = document.getElementById('phase2TerrainRow');
    if (!row) {
      row = document.createElement('div');
      row.id = 'phase2TerrainRow';
      row.className = 'phase2-terrain-row';
      const facts = info.querySelector('.property-overview-facts');
      facts?.insertAdjacentElement('afterend', row);
    }
    const terrain = last?.land?.terrain || {};
    if (!terrain.available) {
      row.innerHTML = '<div class="phase2-terrain-item"><span>Terrain</span><strong>Not available</strong></div>';
      return;
    }
    row.innerHTML = `
      <div class="phase2-terrain-item"><span>Avg grade</span><strong>${Number(terrain.gradePct).toFixed(1)}%</strong></div>
      <div class="phase2-terrain-item"><span>Relief</span><strong>${Math.round(terrain.reliefFt)} ft</strong></div>
      <div class="phase2-terrain-item"><span>Low elevation</span><strong>${Number.isFinite(Number(terrain.minFt)) ? Math.round(terrain.minFt) + ' ft' : '—'}</strong></div>
      <div class="phase2-terrain-item"><span>High elevation</span><strong>${Number.isFinite(Number(terrain.maxFt)) ? Math.round(terrain.maxFt) + ' ft' : '—'}</strong></div>
    `;
  }

  async function copyText(text, button, success) {
    try {
      await navigator.clipboard.writeText(text);
      const old = button.textContent;
      button.textContent = success;
      setTimeout(() => { button.textContent = old; }, 1200);
    } catch {}
  }

  function addQuickActions() {
    const info = document.querySelector('.property-overview-info');
    if (!info || typeof last === 'undefined' || !last?.parcel) return;
    let actions = document.getElementById('propertyQuickActions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'propertyQuickActions';
      actions.className = 'property-quick-actions';
      const foot = info.querySelector('.property-overview-foot');
      foot?.insertAdjacentElement('beforebegin', actions);
    }

    const p = last.parcel.properties || {};
    const parcelId = p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || '';
    let coords = '';
    if (typeof turf !== 'undefined') {
      const [lon, lat] = turf.centroid(last.parcel).geometry.coordinates;
      coords = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    }
    const assessor = p.DATA_LINK || '';
    actions.innerHTML = `
      <button type="button" class="property-quick-action" data-action="parcel">Copy parcel ID</button>
      <button type="button" class="property-quick-action" data-action="coords">Copy coordinates</button>
      ${assessor ? '<button type="button" class="property-quick-action" data-action="assessor">Open county record ↗</button>' : ''}
      <button type="button" class="property-quick-action" data-action="map">Open full map</button>
    `;
    actions.querySelector('[data-action="parcel"]')?.addEventListener('click', e => copyText(parcelId, e.currentTarget, 'Copied ✓'));
    actions.querySelector('[data-action="coords"]')?.addEventListener('click', e => copyText(coords, e.currentTarget, 'Copied ✓'));
    actions.querySelector('[data-action="assessor"]')?.addEventListener('click', () => window.open(assessor, '_blank', 'noopener'));
    actions.querySelector('[data-action="map"]')?.addEventListener('click', () => document.getElementById('mapCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function renderPhase2() {
    if (typeof last === 'undefined' || !last?.parcel) return;
    addStyles();
    renderScore();
    renderCost();
    addTerrainFacts();
    addQuickActions();
    const version = document.querySelector('.version');
    if (version) version.textContent = 'AcresX v0.13 Feasibility Engine';
  }

  const baseRenderSummary = typeof renderSummary === 'function' ? renderSummary : null;
  if (baseRenderSummary) {
    renderSummary = function (...args) {
      const result = baseRenderSummary.apply(this, args);
      renderPhase2();
      return result;
    };
  }
})();
