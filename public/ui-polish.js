(() => {
  function listingIsFound() {
    return typeof last !== 'undefined' && last?.evidence?.status === 'found';
  }

  function polishSummary() {
    if (typeof last === 'undefined') return;

    const wells = Array.isArray(last.wells) ? last.wells : [];
    const depthCount = wells.slice(0, 5).map(w => Number(w?.properties?.CompletedDepth)).filter(Number.isFinite).length;
    if (depthCount) {
      const waterStatus = document.getElementById('waterStatus');
      const wellNote = document.getElementById('wellNote');
      if (waterStatus) waterStatus.textContent = `Average reported well depth · ${depthCount} nearby well log${depthCount === 1 ? '' : 's'}`;
      if (wellNote) wellNote.textContent = 'Washington Ecology well records';
    }

    const soil = last?.land?.soil || {};
    if (soil.available) {
      const soilNote = document.getElementById('soilNote');
      const soilStatus = document.getElementById('soilStatus');
      const details = [
        'USDA NRCS Soil Survey',
        soil.drainage || '',
        soil.hydrologicGroup ? `Group ${soil.hydrologicGroup}` : ''
      ].filter(Boolean);
      if (soilNote) soilNote.textContent = details.join(' · ');
      if (soilStatus) soilStatus.textContent = `${soil.component || soil.mapUnit || 'Mapped soil'} · preliminary septic screening`;
    }

    if (Array.isArray(last.utility) && last.utility.length) {
      const powerStatus = document.getElementById('powerStatus');
      if (powerStatus) powerStatus.textContent = 'Utility territory identified · service extension may be required';
    }

    const terrain = last?.land?.terrain || {};
    if (terrain.available) {
      const slopeStatus = document.getElementById('slopeStatus');
      const slopeNote = document.getElementById('slopeNote');
      if (slopeStatus) slopeStatus.textContent = `Average grade ${Number(terrain.gradePct).toFixed(1)}%`;
      if (slopeNote) slopeNote.textContent = `${Math.round(terrain.reliefFt)} ft total relief · USGS elevation screening`;
    }

    if (!listingIsFound()) {
      const metric = document.getElementById('evidenceMetric');
      const note = document.getElementById('evidenceNote');
      const status = document.getElementById('listingStatus');
      const grade = document.getElementById('listingGrade');
      const dot = document.getElementById('listingDot');

      if (metric) metric.textContent = 'No Active Listing Found';
      if (status) status.textContent = 'No public listing matched this property';
      if (note) note.textContent = 'Property may be privately owned, off-market, or not indexed';
      if (grade) grade.textContent = 'No listing';
      if (dot) dot.className = 'traffic-dot';
    }

    const version = document.querySelector('.version');
    if (version) version.textContent = 'AcresX v0.8 UI Polish';
  }

  function polishListingDetails() {
    if (typeof activeTab === 'undefined' || activeTab !== 'listing' || listingIsFound()) return;
    const root = document.getElementById('results');
    const title = document.getElementById('resultsTitle');
    if (title) title.textContent = 'Listing context';
    if (!root) return;

    const searchedAddress = typeof last !== 'undefined' ? last?.evidence?.searchedAddress : '';
    root.innerHTML = `
      <div class="notice"><strong>No Active Listing Found for this property.</strong><br>No public listing matched the parcel strongly enough to present as property context.</div>
      ${searchedAddress ? `<div class="notice"><strong>Address searched:</strong> ${esc(searchedAddress)}</div>` : ''}
      <div class="notice">This is common for privately owned, off-market, recently removed, or not-yet-indexed land. AcresX will continue using public-record sources for the rest of the property analysis.</div>
    `;
  }

  if (typeof renderSummary === 'function') {
    const baseRenderSummary = renderSummary;
    renderSummary = function (...args) {
      const result = baseRenderSummary.apply(this, args);
      polishSummary();
      return result;
    };
  }

  if (typeof renderResults === 'function') {
    const baseRenderResults = renderResults;
    renderResults = function (...args) {
      const result = baseRenderResults.apply(this, args);
      polishListingDetails();
      return result;
    };
  }
})();
