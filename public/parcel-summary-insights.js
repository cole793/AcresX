(() => {
  function avgWellDepth() {
    if (typeof last === 'undefined' || !Array.isArray(last?.wells)) return null;
    const values = last.wells.slice(0, 5)
      .map(w => Number(w?.properties?.CompletedDepth ?? w?.CompletedDepth ?? w?.depth ?? w?.wellDepth))
      .filter(v => Number.isFinite(v) && v > 0);
    if (!values.length) return null;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }

  function soilName() {
    if (typeof last === 'undefined') return null;
    const s = last?.land?.soil || {};
    const direct = s.name || s.soilName || s.mapUnitName || s.mapunitName || s.dominantSoil || s.dominant || s.muname || s.label;
    if (direct && typeof direct === 'string') return direct;
    const units = s.mapUnits || s.units || s.soils || [];
    if (Array.isArray(units) && units.length) {
      const sorted = [...units].sort((a, b) => Number(b?.percent || b?.pct || b?.coverage || 0) - Number(a?.percent || a?.pct || a?.coverage || 0));
      const u = sorted[0] || {};
      return u.name || u.soilName || u.mapUnitName || u.muname || u.label || null;
    }
    return null;
  }

  function factsByLabel(label) {
    return [...document.querySelectorAll('.property-overview-fact')].filter(el =>
      el.querySelector('span')?.textContent?.trim().toLowerCase() === label.toLowerCase());
  }

  function render() {
    // Remove wrappers created by the older summary-insights implementation.
    document.getElementById('overviewDominantSoilWrap')?.remove();
    document.getElementById('overviewNearbyWellDepthWrap')?.remove();

    const soil = soilName();
    const well = avgWellDepth();

    // Keep exactly one Dominant Soil row and use the populated/current value when available.
    const soilFacts = factsByLabel('Dominant soil');
    if (soilFacts.length) {
      const primary = soilFacts.find(f => {
        const value = String(f.querySelector('strong')?.textContent || '').trim().toLowerCase();
        return value && value !== 'not available' && value !== '—';
      }) || soilFacts[0];
      const strong = primary.querySelector('strong');
      if (strong && soil) strong.textContent = soil;
      soilFacts.forEach(f => { if (f !== primary) f.remove(); });
    }

    // Keep exactly one Avg. Nearby Well Depth row and show only the average depth.
    const wellFacts = factsByLabel('Avg. nearby well depth');
    if (wellFacts.length) {
      const primary = wellFacts[0];
      const strong = primary.querySelector('strong');
      if (strong) strong.textContent = well ? `${well.toLocaleString()} ft` : 'Not available';
      wellFacts.slice(1).forEach(f => f.remove());
    }
  }

  render();

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      requestAnimationFrame(render);
      setTimeout(render, 100);
      setTimeout(render, 350);
      return result;
    };
  }
})();
