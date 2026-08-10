(() => {
  let powerRequestId = 0;

  function listingIsFound() {
    return typeof last !== 'undefined' && last?.evidence?.status === 'found';
  }

  function getParcelIdentity() {
    if (typeof last === 'undefined' || !last?.parcel) return null;
    const parcel = last.parcel;
    const p = parcel.properties || {};
    const center = typeof turf !== 'undefined' ? turf.centroid(parcel).geometry.coordinates : [null, null];
    return {
      parcelId: p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || '',
      address: [p.SITUS_ADDRESS, p.SITUS_CITY_NM, p.SITUS_ZIP_NR].filter(Boolean).join(', '),
      lon: center[0],
      lat: center[1],
      geometry: parcel.geometry || null,
      providers: Array.isArray(last.utility) ? last.utility : []
    };
  }

  function infrastructureLabel(value) {
    if (value === 'overhead_distribution') return 'Overhead distribution';
    if (value === 'underground_distribution') return 'Underground distribution';
    if (value === 'distribution_cable') return 'Distribution cable';
    if (value === 'transformer') return 'Transformer';
    return 'Mapped power infrastructure';
  }

  function applyPowerIntelligence(power) {
    if (!power) return;
    const provider = power.provider || (Array.isArray(last?.utility) ? last.utility[0] : '') || 'Utility not identified';
    const distribution = power.distribution || {};
    const status = document.getElementById('powerStatus');
    const grade = document.getElementById('powerGrade');
    const dot = document.getElementById('powerDot');

    if (Number.isFinite(distribution.estimatedDistanceFt)) {
      if (status) status.textContent = `${infrastructureLabel(distribution.infrastructure)} mapped ~${Math.round(distribution.estimatedDistanceFt).toLocaleString()} ft from parcel`;
      if (grade) grade.textContent = `${String(distribution.confidence || 'Low').replace(/^./, c => c.toUpperCase())} confidence`;
      if (dot) dot.className = `traffic-dot ${distribution.confidence === 'low' ? 'amber' : 'green'}`;
    } else if (power.available) {
      if (status) status.textContent = `${provider} territory identified · no nearby OSM distribution mapping found`;
      if (grade) grade.textContent = 'Verify utility';
      if (dot) dot.className = 'traffic-dot amber';
    }
  }

  async function loadPowerIntelligence() {
    const identity = getParcelIdentity();
    if (!identity || !identity.providers.length) return;
    const requestId = ++powerRequestId;
    try {
      const response = await fetch('/api/power-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identity)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Power intelligence returned ${response.status}`);
      if (requestId !== powerRequestId || typeof last === 'undefined') return;
      last.powerIntelligence = data;
      applyPowerIntelligence(data);
      if (typeof activeTab !== 'undefined' && activeTab === 'power' && document.getElementById('detailCard')?.classList.contains('show')) polishPowerDetails();
    } catch (error) {
      if (requestId !== powerRequestId || typeof last === 'undefined') return;
      last.powerIntelligence = { available: false, error: error.message };
    }
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
      const details = ['USDA NRCS Soil Survey', soil.drainage || '', soil.hydrologicGroup ? `Group ${soil.hydrologicGroup}` : ''].filter(Boolean);
      if (soilNote) soilNote.textContent = details.join(' · ');
      if (soilStatus) soilStatus.textContent = `${soil.component || soil.mapUnit || 'Mapped soil'} · Preliminary septic screening`;
    }

    if (Array.isArray(last.utility) && last.utility.length) {
      const powerStatus = document.getElementById('powerStatus');
      if (powerStatus) powerStatus.textContent = 'Checking mapped distribution proximity…';
      loadPowerIntelligence();
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
    if (version) version.textContent = 'AcresX v0.15 Power Proximity';
  }

  function polishListingDetails() {
    if (typeof activeTab === 'undefined' || activeTab !== 'listing' || listingIsFound()) return;
    const root = document.getElementById('results');
    const title = document.getElementById('resultsTitle');
    if (title) title.textContent = 'Listing context';
    if (!root) return;
    const searchedAddress = typeof last !== 'undefined' ? last?.evidence?.searchedAddress : '';
    root.innerHTML = `<div class="notice"><strong>No Active Listing Found for this property.</strong><br>No public listing matched the parcel strongly enough to present as property context.</div>${searchedAddress ? `<div class="notice"><strong>Address searched:</strong> ${esc(searchedAddress)}</div>` : ''}<div class="notice">This is common for privately owned, off-market, recently removed, or not-yet-indexed land.</div>`;
  }

  function polishPowerDetails() {
    if (typeof activeTab === 'undefined' || activeTab !== 'power') return;
    const root = document.getElementById('results');
    const title = document.getElementById('resultsTitle');
    if (!root) return;
    if (title) title.textContent = 'Power Proximity';

    const power = typeof last !== 'undefined' ? last?.powerIntelligence : null;
    const provider = power?.provider || (Array.isArray(last?.utility) ? last.utility.join(' / ') : '') || 'Not identified';
    if (!power) {
      root.innerHTML = `<div class="notice"><strong>${esc(provider)}</strong><br>AcresX is checking nearby mapped power infrastructure.</div>`;
      return;
    }

    const territory = power.territory || {};
    const distribution = power.distribution || {};
    const proximity = power.proximity || {};
    const evidence = proximity.evidence || {};
    const verification = power.verification || {};
    const nearest = proximity.nearest || null;

    root.innerHTML = `
      <div class="notice"><strong>${esc(provider)}</strong><br>${territory.confirmed ? 'Likely electric utility territory identified.' : 'Serving utility identified from available territory data.'}</div>
      <div class="result-item">
        <h4>Distribution proximity screening</h4>
        <div class="data-grid">
          <div class="datum"><span>Nearest mapped infrastructure</span><strong>${Number.isFinite(distribution.estimatedDistanceFt) ? Math.round(distribution.estimatedDistanceFt).toLocaleString() + ' ft' : 'Not mapped nearby'}</strong></div>
          <div class="datum"><span>Infrastructure type</span><strong>${esc(infrastructureLabel(distribution.infrastructure))}</strong></div>
          <div class="datum"><span>Confidence</span><strong>${esc(String(distribution.confidence || 'Low').replace(/^./, c => c.toUpperCase()))}</strong></div>
          <div class="datum"><span>Source</span><strong>OpenStreetMap</strong></div>
        </div>
        <div class="notice">${esc(distribution.note || proximity.note || 'Public distribution mapping is incomplete.')}</div>
      </div>
      <div class="result-item">
        <h4>Mapped evidence within ~3.1 miles</h4>
        <div class="data-grid">
          <div class="datum"><span>Power poles</span><strong>${Number(evidence.mappedPoles || 0)}</strong></div>
          <div class="datum"><span>Distribution lines / cables</span><strong>${Number(evidence.mappedDistributionLines || 0)}</strong></div>
          <div class="datum"><span>Transformers</span><strong>${Number(evidence.mappedTransformers || 0)}</strong></div>
          <div class="datum"><span>Nearest feature</span><strong>${nearest ? esc(nearest.type.replaceAll('_', ' ')) : 'None mapped'}</strong></div>
        </div>
      </div>
      <div class="notice"><strong>Screening limitation.</strong><br>OpenStreetMap coverage varies significantly by area. A missing pole, line, cable, or transformer does not mean power is unavailable, and mapped infrastructure is not an official utility service point.</div>
      <div class="notice"><strong>Utility verification required.</strong><br>${esc(verification.recommendation || `Contact ${provider} to confirm service availability, transformer capacity, and extension pricing.`)}</div>
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
      polishPowerDetails();
      return result;
    };
  }
})();
