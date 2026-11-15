(() => {
  // The one nearby-well-depth definition (screening-inputs.js).
  function nearbyWellDepth() {
    if (typeof last === 'undefined' || !window.AcresXWellDepth) return null;
    return window.AcresXWellDepth.stats(last);
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
    const well = nearbyWellDepth();

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

    // Keep exactly one Median Nearby Well Depth row (the same number as the well card and report).
    const wellFacts = factsByLabel('Median nearby well depth');
    if (wellFacts.length) {
      const primary = wellFacts[0];
      const strong = primary.querySelector('strong');
      // While nearby wells are loading or timed out, progressive-loading.js's placeholder stays.
      const placeholder = window.AcresXSections?.placeholderText('wells');
      if (strong) strong.textContent = placeholder || (window.AcresXWellDepth ? window.AcresXWellDepth.fact(well) : 'Not available');
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
