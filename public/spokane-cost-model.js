(() => {
  const PROFILE = {
    wellPerFt: { low: 42, high: 60 },
    wellFixed: { low: 3500, high: 5500 },
    existingWellDueDiligence: { low: 700, high: 1800 },
    septic: {
      favorable: { low: 7500, high: 11500 },
      moderate: { low: 10500, high: 15500 },
      limited: { low: 14500, high: 22000 },
      unknown: { low: 10000, high: 17000 }
    },
    septicPermit: 890,
    sitework: {
      flat: { low: 4500, high: 7500 },
      rolling: { low: 6500, high: 10500 },
      steep: { low: 9500, high: 15500 },
      verySteep: { low: 14000, high: 24000 },
      unknown: { low: 6500, high: 12000 }
    },
    driveway: {
      flat: { low: 3500, high: 6500 },
      rolling: { low: 5000, high: 8500 },
      steep: { low: 7000, high: 12000 },
      unknown: { low: 4500, high: 9000 }
    },
    powerBase: { low: 3500, high: 6000 },
    powerPerFt: { low: 14, high: 22 },
    powerUnknown: { low: 7000, high: 14000 },
    permitsMisc: { low: 1500, high: 3000 }
  };

  function money(n) { return `$${Math.round(Number(n || 0) / 1000)}k`; }
  function currentCounty() {
    const p = typeof last !== 'undefined' ? last?.parcel?.properties || {} : {};
    return String(p._countyDisplay || p.COUNTY_NM || document.getElementById('county')?.value || '').replace(/\s+County$/i, '').trim();
  }
  function isSpokane() { return /^spokane$/i.test(currentCounty()); }
  function avgWellDepth() {
    if (typeof last === 'undefined' || !Array.isArray(last?.wells)) return null;
    const values = last.wells.slice(0, 7).map(w => Number(w?.properties?.CompletedDepth)).filter(v => Number.isFinite(v) && v >= 30 && v <= 1500);
    if (!values.length) return null;
    values.sort((a,b) => a-b);
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    return { median, count: values.length };
  }
  function terrainBand() {
    const terrain = typeof last !== 'undefined' ? last?.land?.terrain || {} : {};
    if (!terrain.available || !Number.isFinite(Number(terrain.gradePct))) return 'unknown';
    const grade = Number(terrain.gradePct);
    if (grade <= 5) return 'flat';
    if (grade <= 10) return 'rolling';
    if (grade <= 15) return 'steep';
    return 'verySteep';
  }
  function component(low, high, basis, confidence = 'Moderate') { return { low: Math.round(low), high: Math.round(high), basis, confidence }; }

  function estimateSpokane() {
    if (typeof last === 'undefined') return null;
    const wells = avgWellDepth();
    const existing = last?.existingWell || {};
    const soil = last?.land?.soil || {};
    const terrain = last?.land?.terrain || {};
    const power = last?.powerIntelligence || {};
    const distance = Number(power?.distribution?.estimatedDistanceFt ?? power?.proximity?.estimatedDistanceFt);
    const band = terrainBand();

    let well;
    if (existing?.available && existing?.match && Number(existing.score || 0) >= 55) {
      const a = PROFILE.existingWellDueDiligence;
      well = component(a.low, a.high, `Existing well association detected (${existing.confidence || 'screening'} confidence); allowance is for inspection, flow/water-quality testing and basic due diligence rather than a new well.`, 'Moderate');
    } else if (wells) {
      const depth = Math.round(wells.median);
      well = component(depth * PROFILE.wellPerFt.low + PROFILE.wellFixed.low, depth * PROFILE.wellPerFt.high + PROFILE.wellFixed.high, `${depth} ft median from ${wells.count} nearby reported wells × Spokane planning drilling rate, plus pump/casing allowance.`, wells.count >= 3 ? 'Moderate' : 'Low');
    } else {
      well = component(17500, 26000, 'No usable nearby depth sample; Spokane planning allowance for a typical private well.', 'Low');
    }

    const feasibility = String(soil.feasibility || '').toLowerCase();
    const septicBand = soil.available && feasibility === 'favorable' ? 'favorable' : soil.available && feasibility === 'limited' ? 'limited' : soil.available ? 'moderate' : 'unknown';
    const s = PROFILE.septic[septicBand];
    const septic = component(s.low + PROFILE.septicPermit, s.high + PROFILE.septicPermit, `${soil.available ? `${septicBand[0].toUpperCase()+septicBand.slice(1)} USDA soil screening` : 'Soil suitability not resolved'}; includes the 2026 SRHD residential OSS permit fee ($890).`, soil.available ? 'Moderate' : 'Low');

    const sw = PROFILE.sitework[band] || PROFILE.sitework.unknown;
    const gradeText = terrain.available && Number.isFinite(Number(terrain.gradePct)) ? `${Number(terrain.gradePct).toFixed(1)}% mapped average grade` : 'terrain not resolved';
    const sitework = component(sw.low, sw.high, `${gradeText}; Spokane grading/site-prep planning allowance adjusted for terrain.`, terrain.available ? 'Moderate' : 'Low');

    const dwKey = band === 'verySteep' ? 'steep' : band;
    const dw = PROFILE.driveway[dwKey] || PROFILE.driveway.unknown;
    const driveway = component(dw.low, dw.high, `Typical rural residential driveway/access allowance adjusted for ${band === 'unknown' ? 'unknown terrain' : band + ' terrain'}. Exact driveway length is not yet modeled.`, 'Low');

    let electric;
    if (Number.isFinite(distance) && distance >= 0 && distance <= 2640) {
      const modeledFt = Math.max(50, distance);
      electric = component(PROFILE.powerBase.low + modeledFt * PROFILE.powerPerFt.low, PROFILE.powerBase.high + modeledFt * PROFILE.powerPerFt.high, `${Math.round(distance)} ft to mapped electric infrastructure; includes connection allowance plus a parcel-specific extension/trenching planning factor. Utility engineering quote still required.`, 'Moderate');
    } else {
      const p = PROFILE.powerUnknown;
      electric = component(p.low, p.high, 'Serving utility identified or screened, but a reliable parcel-to-distribution distance was not available.', 'Low');
    }

    const pm = PROFILE.permitsMisc;
    const permits = component(pm.low, pm.high, 'Planning allowance for miscellaneous site-development review, testing and permit costs not already included above.', 'Low');
    const components = { well, septic, electric, driveway, sitework, permits };
    const low = Object.values(components).reduce((sum, x) => sum + x.low, 0);
    const high = Object.values(components).reduce((sum, x) => sum + x.high, 0);
    const midpoint = Math.round((low + high) / 2);
    const moderate = Object.values(components).filter(x => x.confidence === 'Moderate').length;
    const confidence = moderate >= 4 ? 'Moderate' : 'Low';
    return { low, high, midpoint, confidence, components };
  }

  function render() {
    if (!isSpokane()) return;
    const card = document.getElementById('developmentCostCard');
    if (!card) return;
    const estimate = estimateSpokane();
    if (!estimate) return;
    card.innerHTML = `
      <div class="cost-icon">$</div>
      <div>
        <div class="cost-kicker">Parcel-specific site improvement estimate</div>
        <div class="cost-value">${money(estimate.low)}–${money(estimate.high)}</div>
        <div class="cost-note">Planning midpoint ${money(estimate.midpoint)} · ${estimate.confidence} confidence. Uses Spokane-area costs plus this parcel's wells, soils, terrain and mapped power proximity.</div>
        <div class="cost-pill">See cost breakdown →</div>
      </div>`;
    const open = () => showDetails(estimate);
    card.onclick = open;
    card.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  }

  function showDetails(estimate = estimateSpokane()) {
    const root = document.getElementById('results');
    const title = document.getElementById('resultsTitle');
    const detail = document.getElementById('detailCard');
    if (!root || !title || !detail || !estimate) return;
    const labels = { well: 'Well / water', septic: 'Septic', electric: 'Power', driveway: 'Driveway / access', sitework: 'Site work', permits: 'Permits / testing' };
    title.textContent = 'Spokane Site Improvement Estimate';
    root.innerHTML = `
      <div class="cost-detail-total"><span>Expected planning range · midpoint ${money(estimate.midpoint)}</span><strong>${money(estimate.low)}–${money(estimate.high)}</strong></div>
      ${Object.entries(estimate.components).map(([key,item]) => `<div class="result-item"><div class="result-top"><h4>${labels[key]}</h4><span class="badge">${money(item.low)}–${money(item.high)}</span></div><div class="notice"><strong>${item.confidence} confidence.</strong> ${item.basis}</div></div>`).join('')}
      <div class="notice"><strong>Planning estimate, not a bid.</strong><br>AcresX uses parcel screening data and 2026 Spokane-area planning benchmarks to narrow the likely site-improvement budget. Contractor bids, septic design, drilling conditions, final homesite/access location and utility engineering can materially change actual costs.</div>`;
    detail.classList.add('show');
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function schedule() { setTimeout(render, 0); setTimeout(render, 900); setTimeout(render, 2200); }
  schedule();
  const dashboard = document.getElementById('dashboard');
  if (dashboard) new MutationObserver(() => { if (!window.__acresxCostRenderQueued) { window.__acresxCostRenderQueued = true; requestAnimationFrame(() => { window.__acresxCostRenderQueued = false; render(); }); } }).observe(dashboard, { childList: true, subtree: true });
})();
