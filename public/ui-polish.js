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
      providers: Array.isArray(last.utility) ? last.utility : []
    };
  }

  function applyPowerIntelligence(power) {
    if (!power) return;
    const provider = power.provider || (Array.isArray(last?.utility) ? last.utility[0] : '') || 'Utility not identified';
    const status = document.getElementById('powerStatus');
    const note = document.querySelector('[data-detail="power"] .snapshot-foot');
    const grade = document.getElementById('powerGrade');
    const dot = document.getElementById('powerDot');

    if (power.adapter === 'avista-v1') {
      if (status) status.textContent = 'Avista territory confirmed · parcel-level distribution not publicly mapped';
      if (note) note.textContent = 'Power Intelligence v1 · utility verification required';
      if (grade) grade.textContent = 'Confirmed provider';
      if (dot) dot.className = 'traffic-dot green';
    } else if (power.available) {
      if (status) status.textContent = `${provider} territory identified · dedicated infrastructure adapter pending`;
      if (note) note.textContent = 'Provider identified · line distance not yet available';
      if (grade) grade.textContent = 'Provider found';
      if (dot) dot.className = 'traffic-dot green';
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
      if (typeof activeTab !== 'undefined' && activeTab === 'power' && document.getElementById('detailCard')?.classList.contains('show')) {
        polishPowerDetails();
      }
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
      if (powerStatus) powerStatus.textContent = 'Utility territory identified · checking infrastructure intelligence…';
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
    if (version) version.textContent = 'AcresX v0.9 Power Intelligence';
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

  function polishPowerDetails() {
    if (typeof activeTab === 'undefined' || activeTab !== 'power') return;
    const root = document.getElementById('results');
    const title = document.getElementById('resultsTitle');
    if (!root) return;
    if (title) title.textContent = 'Power Intelligence';

    const power = typeof last !== 'undefined' ? last?.powerIntelligence : null;
    const provider = power?.provider || (Array.isArray(last?.utility) ? last.utility.join(' / ') : '') || 'Not identified';

    if (!power) {
      root.innerHTML = `<div class="notice"><strong>${esc(provider)}</strong><br>Utility territory identified. AcresX is checking provider-specific infrastructure sources.</div>`;
      return;
    }

    if (!power.available) {
      root.innerHTML = `<div class="notice"><strong>${esc(provider)}</strong><br>Power intelligence is temporarily unavailable. Confirm service availability directly with the utility.</div>`;
      return;
    }

    const territory = power.territory || {};
    const distribution = power.distribution || {};
    const transmission = power.transmission || {};
    const cost = power.costEstimate || {};
    const publicMap = power.publicInfrastructure || {};
    const verification = power.verification || {};

    root.innerHTML = `
      <div class="notice"><strong>${esc(provider)}</strong><br>${territory.confirmed ? 'Electric utility territory identified for this parcel.' : 'Likely utility provider identified.'}</div>
      <div class="result-item">
        <h4>Residential distribution</h4>
        <div class="data-grid">
          <div class="datum"><span>Status</span><strong>${esc(distribution.status === 'not_publicly_mapped' ? 'Not publicly mapped' : distribution.status === 'adapter_not_built' ? 'Adapter pending' : distribution.status || 'Unknown')}</strong></div>
          <div class="datum"><span>Line distance</span><strong>${Number.isFinite(distribution.estimatedDistanceFt) ? Math.round(distribution.estimatedDistanceFt) + ' ft' : 'Not yet available'}</strong></div>
          <div class="datum"><span>Confidence</span><strong>${esc(distribution.confidence || 'Low')}</strong></div>
          <div class="datum"><span>Cost engine</span><strong>${cost.available ? 'Estimate available' : 'Pending distance'}</strong></div>
        </div>
        <div class="notice">${esc(distribution.note || 'Parcel-level distribution infrastructure has not been verified.')}</div>
      </div>
      ${power.adapter === 'avista-v1' ? `<div class="result-item"><h4>Avista public infrastructure context</h4><div class="notice">Avista publishes geospatial planning maps that include transmission and other system-planning information. AcresX intentionally does not treat transmission infrastructure as a residential service point.</div>${publicMap.mapUrl ? `<a class="primary" style="display:inline-block;text-decoration:none;margin-top:10px" href="${esc(publicMap.mapUrl)}" target="_blank" rel="noopener">Open Avista geospatial maps ↗</a>` : ''}</div>` : ''}
      ${transmission.note ? `<div class="notice"><strong>Transmission warning:</strong> ${esc(transmission.note)}</div>` : ''}
      <div class="notice"><strong>Utility verification required.</strong><br>${esc(verification.recommendation || `Contact ${provider} for an official service-availability and extension estimate.`)}</div>
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
