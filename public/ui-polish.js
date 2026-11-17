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
      // The parcel's state, as findUtility (index.html) reads it, for the territory label.
      state: document.getElementById('state')?.value || p._stateCode || 'WA',
      parcelId: p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || '',
      address: [p.SITUS_ADDRESS, p.SITUS_CITY_NM, p.SITUS_ZIP_NR].filter(Boolean).join(', '),
      lon: center[0],
      lat: center[1],
      geometry: parcel.geometry || null,
      // Ranked by /api/utility-territory: the primary first (findUtility, index.html). The
      // ranking tells power intelligence whether the others are a resolved or open overlap.
      providers: Array.isArray(last.utility) ? last.utility : [],
      providerRanking: { basis: last.utility?.basis || '', resolved: last.utility?.resolved === true, note: last.utility?.note || '' }
    };
  }

  function infrastructureLabel(value) {
    if (value === 'overhead_distribution') return 'Overhead distribution';
    if (value === 'underground_distribution') return 'Underground distribution';
    if (value === 'distribution_cable') return 'Distribution cable';
    if (value === 'transformer') return 'Transformer';
    if (value === 'utility_distribution_line') return 'Utility-published distribution line';
    return 'Mapped power infrastructure';
  }

  // Other utilities whose territory also covers the parcel (power intelligence, else the list).
  function alsoListedProviders(power) {
    if (Array.isArray(power?.alsoListed)) return power.alsoListed;
    return Array.isArray(last?.utility) ? last.utility.slice(1) : [];
  }

  // ---- The nearest-line wording (one definition: the card, the power details and the printable
  // report, public/property-report-v2.js, read window.AcresXPowerLine.describe).
  //
  // OpenStreetMap maps very few local distribution lines in our counties (src/services/
  // power-intelligence.js osmDistribution), so an OSM distance is "mapped lines only" and is never
  // read as "far from power": when the server marks it usableForCost === false (farther than
  // 1,000 ft, or a line whose type is unknown or transmission) the card reads "Distance not
  // confirmed — likely served, verify with <utility>", with the territory, road access and
  // existing-structure context that suggests service. A utility's own map (Avista, Flathead
  // Electric) is named as such and takes precedence on the server.
  const OSM_ATTRIBUTION_TEXT = '\u00a9 OpenStreetMap contributors';
  const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
  const OSM_FEATURES = { pole: 'power pole', transformer: 'transformer', minor_line: 'line', cable: 'cable', line: 'line' };
  const cap = s => String(s || '').replace(/^./, c => c.toUpperCase());

  // Why the parcel is likely served even though no nearby line is mapped (what the page has).
  function servedContext(power, data) {
    const out = [];
    const provider = power?.provider || '';
    if (provider) out.push(`inside ${provider} territory`);
    const ra = data?.costContext?.roadAccess;
    if (ra?.available && ra.status === 'found' && Number.isFinite(Number(ra.distanceFt))) out.push(`${ra.road?.public === false ? 'private' : 'public'} road ~${Math.round(Number(ra.distanceFt)).toLocaleString('en-US')} ft away`);
    let structure = null;
    try { structure = window.AcresXCoverage?.existingStructure?.(data) || null; } catch { structure = null; }
    if (structure?.improvements) out.push('assessor lists improvements on the parcel');
    else if (structure || (data?.existingWell?.match && Number(data.existingWell.score || 0) >= 55)) out.push('a well record maps to the parcel');
    return out;
  }

  // { status, grade, dot, line, osm, usableForCost, context } for the nearest mapped line, or null.
  function describePowerLine(power, data) {
    const line = power?.nearestLine;
    if (!line || !Number.isFinite(Number(line.distanceFt))) return null;
    const ft = Math.round(Number(line.distanceFt)).toLocaleString('en-US');
    const provider = power.provider || '';
    const osm = line.mappedOnly === true || line.source === 'OpenStreetMap';
    const usableForCost = line.usableForCost === true || (line.usableForCost == null && line.lineType === 'distribution');
    const context = servedContext(power, data);
    const notConfirmed = provider ? `Distance not confirmed — likely served, verify with ${provider}` : 'Distance not confirmed — verify with the local utility';
    const likely = context.length ? ` Likely served: ${context.join('; ')}.` : '';
    if (osm) {
      const what = line.lineType === 'distribution' ? (OSM_FEATURES[line.featureType] || 'line') : line.lineType === 'transmission' ? 'transmission line' : 'power line (voltage not mapped)';
      if (usableForCost && line.lineType === 'distribution') {
        return { line, osm, usableForCost: true, context,
          status: `Nearest ${what} mapped in OpenStreetMap ~${ft} ft — OSM maps few local lines here; the actual nearest line may be closer. The utility confirms the route. ${OSM_ATTRIBUTION_TEXT}`,
          grade: `${cap(line.confidence || 'low')} confidence · mapped lines only`,
          dot: `traffic-dot ${line.confidence && line.confidence !== 'low' ? 'green' : 'amber'}` };
      }
      return { line, osm, usableForCost: false, context,
        status: `Nearest ${what} mapped in OpenStreetMap ~${ft} ft — OSM maps few local lines here; the actual nearest line may be much closer. The utility confirms the route.${likely} ${OSM_ATTRIBUTION_TEXT}`,
        grade: notConfirmed, dot: 'traffic-dot amber' };
    }
    if (line.lineType === 'transmission') {
      return { line, osm, usableForCost: false, context,
        status: `Nearest mapped transmission line ~${ft} ft (${line.sourceLabel || 'mapped data'}) — transmission lines do not serve homes directly, and local distribution lines are not mapped here. The utility confirms the route.${likely}`,
        grade: notConfirmed, dot: 'traffic-dot amber' };
    }
    return { line, osm, usableForCost, context,
      status: `Nearest distribution line on the ${line.sourceLabel || 'utility map'} ~${ft} ft — the utility confirms the route`,
      grade: `${cap(line.confidence || 'low')} confidence`,
      dot: `traffic-dot ${line.confidence && line.confidence !== 'low' ? 'green' : 'amber'}` };
  }
  window.AcresXPowerLine = { describe: describePowerLine, servedContext, OSM_ATTRIBUTION_TEXT, OSM_COPYRIGHT_URL };

  function applyPowerIntelligence(power) {
    if (!power) return;
    const provider = power.provider || (Array.isArray(last?.utility) ? last.utility[0] : '') || 'Utility not identified';
    const distribution = power.distribution || {};
    const status = document.getElementById('powerStatus');
    const grade = document.getElementById('powerGrade');
    const dot = document.getElementById('powerDot');

    // nearestLine (src/services/power-intelligence.js chooseNearestLine): the nearest mapped
    // distribution line, else the nearest other mapped line (transmission or unclassified).
    const described = describePowerLine(power, typeof last !== 'undefined' ? last : null);
    if (described) {
      if (status) status.textContent = described.status;
      if (grade) grade.textContent = described.grade;
      if (dot) dot.className = described.dot;
    } else if (Number.isFinite(distribution.estimatedDistanceFt)) {
      if (status) status.textContent = `${infrastructureLabel(distribution.infrastructure)} mapped ~${Math.round(distribution.estimatedDistanceFt).toLocaleString()} ft from parcel`;
      if (grade) grade.textContent = `${String(distribution.confidence || 'Low').replace(/^./, c => c.toUpperCase())} confidence`;
      if (dot) dot.className = `traffic-dot ${distribution.confidence === 'low' ? 'amber' : 'green'}`;
    } else if (power.available) {
      const notVerified = ['timed_out', 'source_unavailable'].includes(power.proximity?.status);
      if (status) status.textContent = notVerified ? `${provider} territory identified · distance not verified` : `${provider} territory identified · no nearby OSM distribution mapping found`;
      if (grade) grade.textContent = 'Verify utility';
      if (dot) dot.className = 'traffic-dot amber';
    }
  }

  // Once per search (window.AcresXSections, progressive-loading.js), with a time limit; an answer
  // for an older search is dropped.
  async function loadPowerIntelligence() {
    const identity = getParcelIdentity();
    if (!identity || !identity.providers.length) return;
    const sections = window.AcresXSections;
    if (sections && !sections.claim('powerIntelligence')) return;
    const searchId = sections?.searchId;
    const stale = () => (sections && !sections.isCurrent(searchId));
    const requestId = ++powerRequestId;
    try {
      const response = await fetch('/api/power-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identity),
        signal: sections?.timeoutSignal()
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Power intelligence returned ${response.status}`);
      if (requestId !== powerRequestId || stale() || typeof last === 'undefined') return;
      last.powerIntelligence = data;
      applyPowerIntelligence(data);
      if (typeof activeTab !== 'undefined' && activeTab === 'power' && document.getElementById('detailCard')?.classList.contains('show')) polishPowerDetails();
      sections?.settle('powerIntelligence');
    } catch (error) {
      if (requestId !== powerRequestId || stale() || typeof last === 'undefined') return;
      last.powerIntelligence = { available: false, error: error.message };
      sections?.settle('powerIntelligence');
    }
  }

  function polishSummary() {
    if (typeof last === 'undefined') return;
    // The well card's depth, status and note are screening-refinements.js's (one definition:
    // window.AcresXWellDepth in screening-inputs.js).

    const soil = last?.land?.soil || {};
    if (soil.available) {
      const soilNote = document.getElementById('soilNote');
      const soilStatus = document.getElementById('soilStatus');
      const details = [soil.backup ? 'USDA SSURGO via Esri Living Atlas (backup)' : 'USDA NRCS Soil Survey', soil.drainage || '', soil.hydrologicGroup ? `Group ${soil.hydrologicGroup}` : ''].filter(Boolean);
      if (soilNote) soilNote.textContent = details.join(' · ');
      if (soilStatus) soilStatus.textContent = `${soil.component || soil.mapUnit || 'Mapped soil'} · Preliminary septic screening`;
    }

    if (Array.isArray(last.utility) && last.utility.length) {
      // The summary re-renders as sections arrive: keep an answer already loaded for this search.
      if (last.powerIntelligence) applyPowerIntelligence(last.powerIntelligence);
      else {
        const powerStatus = document.getElementById('powerStatus');
        if (powerStatus) powerStatus.textContent = 'Checking mapped distribution proximity…';
        loadPowerIntelligence();
      }
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
    const provider = power?.provider || (typeof utilityText === 'function' ? utilityText(last?.utility) : (Array.isArray(last?.utility) ? last.utility.join(' / ') : '') || 'Not identified');
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
    const alsoListed = alsoListedProviders(power);
    const rankingNote = power.providerRanking?.note || last?.utility?.note || '';
    const ranked = /^avista_line_/.test(power.providerRanking?.basis || last?.utility?.basis || '');
    const providerLine = alsoListed.length
      ? `${ranked ? 'Most likely provider.' : 'Overlapping territories (listed first, not ranked).'} Also listed: ${esc(alsoListed.join(', '))}.${rankingNote ? `<br>${esc(rankingNote)}` : ''}`
      : territory.confirmed ? 'Likely electric utility territory identified.' : 'Serving utility identified from available territory data.';
    const publishedLabel = distribution.sourceLabel && !/avista/i.test(distribution.sourceLabel) ? distribution.sourceLabel : "Avista's distribution map";
    const sourceLabel = distribution.status === 'utility_published_proximity' ? publishedLabel : 'OpenStreetMap';
    const line = power.nearestLine || null;
    const described = describePowerLine(power, last);
    // An OSM-derived distance is shown: the attribution, with its link (the card is a button, so
    // the link lives here).
    const osmShown = Boolean(described?.osm) || distribution.mappedOnly === true;
    const osmCredit = osmShown ? `<div class="notice osm-attribution">Power line data <a href="${OSM_COPYRIGHT_URL}" target="_blank" rel="noopener">${OSM_ATTRIBUTION_TEXT}</a>. OpenStreetMap shows mapped lines only and maps few local lines here; the actual nearest line may be much closer.</div>` : '';
    const notConfirmed = described && !described.usableForCost;
    const nearestText = Number.isFinite(distribution.estimatedDistanceFt)
      ? `${Math.round(distribution.estimatedDistanceFt).toLocaleString()} ft${distribution.mappedOnly ? ' (mapped lines only)' : ''}`
      : notConfirmed ? 'Distance not confirmed' : 'Not mapped nearby';
    const radiusMi = Number(proximity.searchRadiusFt) > 0 ? (Number(proximity.searchRadiusFt) / 5280).toFixed(1) : '3.1';

    root.innerHTML = `
      <div class="notice"><strong>${esc(provider)}</strong><br>${providerLine}</div>
      <div class="result-item">
        <h4>Distribution proximity screening</h4>
        <div class="data-grid">
          <div class="datum"><span>Nearest mapped infrastructure</span><strong>${esc(nearestText)}</strong></div>
          <div class="datum"><span>Infrastructure type</span><strong>${esc(infrastructureLabel(distribution.infrastructure))}</strong></div>
          <div class="datum"><span>Confidence</span><strong>${esc(String(distribution.confidence || 'Low').replace(/^./, c => c.toUpperCase()))}</strong></div>
          <div class="datum"><span>Source</span><strong>${esc(sourceLabel)}</strong></div>
          ${line && notConfirmed && Number.isFinite(line.distanceFt) ? `<div class="datum"><span>Nearest mapped line (${esc(line.lineType === 'distribution' ? 'distribution, not confirmed' : line.lineType === 'transmission' ? 'transmission' : 'type not mapped')})</span><strong>${Math.round(line.distanceFt).toLocaleString()} ft · ${esc(line.sourceLabel || '')}</strong></div>` : ''}
        </div>
        ${notConfirmed ? `<div class="notice"><strong>${esc(described.grade)}.</strong><br>${described.context.length ? `Likely served: ${esc(described.context.join('; '))}. ` : ''}This mapped distance is not used in the cost estimate.</div>` : ''}
        <div class="notice">${esc(distribution.note || proximity.note || 'Public distribution mapping is incomplete.')}</div>
        ${osmCredit}
      </div>
      <div class="result-item">
        <h4>Mapped evidence within ~${radiusMi} miles</h4>
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
