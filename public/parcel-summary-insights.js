(() => {
  function avgWellDepth() {
    if (typeof last === 'undefined' || !Array.isArray(last?.wells)) return null;
    const values = last.wells.slice(0, 5)
      .map(w => Number(w?.properties?.CompletedDepth ?? w?.CompletedDepth ?? w?.depth ?? w?.wellDepth))
      .filter(v => Number.isFinite(v) && v > 0);
    if (!values.length) return null;
    return Math.round(values.reduce((a,b) => a+b, 0) / values.length);
  }

  function soilName() {
    if (typeof last === 'undefined') return null;
    const s = last?.land?.soil || {};
    const direct = s.name || s.soilName || s.mapUnitName || s.mapunitName || s.dominantSoil || s.dominant || s.muname || s.label;
    if (direct && typeof direct === 'string') return direct;
    const units = s.mapUnits || s.units || s.soils || [];
    if (Array.isArray(units) && units.length) {
      const sorted = [...units].sort((a,b) => Number(b?.percent || b?.pct || b?.coverage || 0) - Number(a?.percent || a?.pct || a?.coverage || 0));
      const u = sorted[0] || {};
      return u.name || u.soilName || u.mapUnitName || u.muname || u.label || null;
    }
    return null;
  }

  function factByLabel(label) {
    return [...document.querySelectorAll('.property-overview-fact')].find(el =>
      el.querySelector('span')?.textContent?.trim().toLowerCase() === label.toLowerCase());
  }

  function setFact(wrap, label, value) {
    if (!wrap) return;
    const span = wrap.querySelector('span');
    const strong = wrap.querySelector('strong');
    if (span) span.textContent = label;
    if (strong) strong.textContent = value || 'Not available';
  }

  function addFact(id, label, value) {
    const grid = document.querySelector('.property-overview-facts');
    if (!grid) return;
    let wrap = document.getElementById(id);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = id;
      wrap.className = 'property-overview-fact';
      wrap.innerHTML = `<span></span><strong></strong>`;
      grid.appendChild(wrap);
    }
    setFact(wrap, label, value);
  }

  function render() {
    const soil = soilName();
    const well = avgWellDepth();

    // Replace low-value Data Basis field with the dominant soil result.
    const dataBasis = factByLabel('Data Basis');
    if (dataBasis) setFact(dataBasis, 'Dominant soil', soil || 'Not available');
    else addFact('overviewDominantSoilWrap', 'Dominant soil', soil || 'Not available');

    addFact('overviewNearbyWellDepthWrap', 'Avg. nearby well depth', well ? `${well.toLocaleString()} ft` : 'Not available');
  }

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function(...args) {
      const result = base.apply(this, args);
      requestAnimationFrame(render);
      setTimeout(render, 250);
      return result;
    };
  }
})();
