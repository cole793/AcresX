(() => {
  let previewMap = null;
  let previewBoundary = null;

  function addOverviewStyles() {
    if (document.getElementById('propertyOverviewStyles')) return;
    const style = document.createElement('style');
    style.id = 'propertyOverviewStyles';
    style.textContent = `
      .property-overview-section{margin-top:0;margin-bottom:16px}
      .property-overview-card{overflow:hidden;display:grid;grid-template-columns:minmax(320px,.82fr) minmax(0,1.18fr);min-height:330px}
      .property-overview-media{position:relative;min-height:330px;background:#dfe7e1;border-right:1px solid var(--line)}
      #parcelAerialPreview{position:absolute;inset:0;background:#dfe7e1}
      .property-overview-media-label{position:absolute;z-index:450;left:14px;top:14px;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border:1px solid rgba(23,35,28,.12);border-radius:11px;padding:9px 11px;box-shadow:0 5px 18px rgba(0,0,0,.11);pointer-events:none}
      .property-overview-media-label strong{display:block;font:800 12px Manrope;color:var(--ink)}
      .property-overview-media-label span{display:block;margin-top:2px;font-size:9px;color:var(--muted)}
      .property-overview-map-btn{position:absolute;z-index:450;right:14px;top:14px;border:1px solid rgba(23,35,28,.14);background:rgba(255,255,255,.94);backdrop-filter:blur(8px);padding:9px 11px;border-radius:10px;font-size:11px;font-weight:800;color:var(--ink);box-shadow:0 5px 18px rgba(0,0,0,.10)}
      .property-overview-source{position:absolute;z-index:450;right:9px;bottom:7px;background:rgba(255,255,255,.84);padding:4px 7px;border-radius:7px;font-size:9px;color:#47554c;pointer-events:none}
      .property-overview-info{padding:26px 28px;display:flex;flex-direction:column;min-width:0}
      .property-overview-eyebrow{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--green2);font-weight:800;margin-bottom:7px}
      .property-overview-info h2{font:800 clamp(21px,2.2vw,30px) Manrope;margin:0;line-height:1.15}
      .property-overview-location{margin-top:6px;color:var(--muted);font-size:13px}
      .property-overview-acres{display:flex;align-items:end;gap:9px;margin-top:24px;padding-bottom:20px;border-bottom:1px solid var(--line)}
      .property-overview-acres strong{font:800 34px Manrope;line-height:1;color:var(--green)}
      .property-overview-acres span{font-size:12px;color:var(--muted);padding-bottom:3px}
      .property-overview-acres small{display:block;font-size:10px;color:var(--muted);margin-left:auto;padding-bottom:4px}
      .property-overview-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px;margin-top:10px}
      .property-overview-fact{padding:11px 0;border-bottom:1px solid #edf1ee;min-width:0}
      .property-overview-fact span{display:block;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:800;margin-bottom:3px}
      .property-overview-fact strong{display:block;font-size:12px;line-height:1.35;overflow:hidden;text-overflow:ellipsis}
      .property-overview-fact strong.good{color:var(--green)}
      .property-overview-fact strong.warn{color:var(--amber)}
      .property-overview-foot{margin-top:auto;padding-top:12px;font-size:10px;color:var(--muted)}
      .overview-grid .parcel-card{display:none}
      .overview-grid{grid-template-columns:280px;justify-content:end}
      @media(max-width:1000px){.property-overview-card{grid-template-columns:1fr}.property-overview-media{min-height:300px;border-right:0;border-bottom:1px solid var(--line)}.overview-grid{grid-template-columns:1fr}}
      @media(max-width:700px){.property-overview-media{min-height:245px}.property-overview-info{padding:20px}.property-overview-facts{grid-template-columns:1fr 1fr}.property-overview-acres strong{font-size:30px}.property-overview-map-btn{right:10px;top:10px}.property-overview-media-label{left:10px;top:10px}}
    `;
    document.head.appendChild(style);
  }

  function mappedArea(parcel) {
    if (!parcel || typeof turf === 'undefined' || typeof turf.area !== 'function') return null;
    try {
      const squareMeters = turf.area(parcel);
      if (!Number.isFinite(squareMeters) || squareMeters <= 0) return null;
      const acres = squareMeters / 4046.8564224;
      const squareFeet = squareMeters * 10.7639104167;
      return { acres, squareFeet };
    } catch {
      return null;
    }
  }

  function hazardLabel(result, kind) {
    if (!result?.available) return { text: 'Not verified', cls: 'warn' };
    if (kind === 'flood') {
      if (result.high) return { text: 'High-risk zone mapped', cls: 'warn' };
      if (result.intersects) return { text: 'Mapped flood zone', cls: 'warn' };
      return { text: 'No mapped flood hazard', cls: 'good' };
    }
    if (result.intersects) return { text: 'Mapped wetlands present', cls: 'warn' };
    return { text: 'No mapped wetlands', cls: 'good' };
  }

  function propertyIdentity() {
    if (typeof last === 'undefined' || !last?.parcel) return null;
    const p = last.parcel.properties || {};
    const parcelId = p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || 'Unknown';
    const address = [p.SITUS_ADDRESS, p.SITUS_CITY_NM, p.SITUS_ZIP_NR].filter(Boolean).join(', ') || `Parcel ${parcelId}`;
    const county = p._countyDisplay || p.COUNTY_NM || '—';
    const utility = Array.isArray(last.utility) && last.utility.length ? last.utility.join(' / ') : 'Not identified';
    return { parcelId, address, county, utility };
  }

  function averageNearbyWellDepth() {
    if (typeof last === 'undefined' || !Array.isArray(last?.wells)) return null;
    const depths = last.wells.slice(0, 5).map(w => Number(w?.properties?.CompletedDepth)).filter(d => Number.isFinite(d) && d > 0);
    if (!depths.length) return null;
    return { depth: Math.round(depths.reduce((sum, d) => sum + d, 0) / depths.length), count: depths.length };
  }

  function dominantSoil() {
    const soil = typeof last !== 'undefined' ? last?.land?.soil : null;
    if (!soil?.available) return null;
    return soil.component || soil.mapUnit || null;
  }

  function ensureOverviewCard() {
    addOverviewStyles();
    let section = document.getElementById('propertyOverviewSection');
    if (section) return section;

    const dashboard = document.getElementById('dashboard');
    const overview = document.querySelector('.overview-grid');
    if (!dashboard || !overview) return null;

    section = document.createElement('section');
    section.id = 'propertyOverviewSection';
    section.className = 'property-overview-section';
    section.innerHTML = `
      <article class="card property-overview-card">
        <div class="property-overview-media">
          <div id="parcelAerialPreview" aria-label="Satellite aerial view of selected parcel"></div>
          <div class="property-overview-media-label"><strong>Aerial parcel view</strong><span>Selected parcel outlined</span></div>
          <button id="openFullParcelMap" class="property-overview-map-btn" type="button">Open map</button>
          <div class="property-overview-source">Imagery © Esri and contributors</div>
        </div>
        <div class="property-overview-info">
          <div class="property-overview-eyebrow">Property overview</div>
          <h2 id="overviewAddress">Selected parcel</h2>
          <div id="overviewLocation" class="property-overview-location">—</div>
          <div class="property-overview-acres">
            <div><strong id="overviewAcres">—</strong><span> acres</span></div>
            <small id="overviewSqFt">Mapped parcel area</small>
          </div>
          <div class="property-overview-facts">
            <div class="property-overview-fact"><span>Parcel ID</span><strong id="overviewParcelId">—</strong></div>
            <div class="property-overview-fact"><span>County</span><strong id="overviewCounty">—</strong></div>
            <div class="property-overview-fact"><span>Utility provider</span><strong id="overviewUtility">—</strong></div>
            <div class="property-overview-fact"><span>Flood screening</span><strong id="overviewFlood">—</strong></div>
            <div class="property-overview-fact"><span>Wetland screening</span><strong id="overviewWetlands">—</strong></div>
            <div class="property-overview-fact"><span>Dominant soil</span><strong id="overviewSoil">—</strong></div>
            <div class="property-overview-fact"><span>Avg. nearby well depth</span><strong id="overviewWellDepth">—</strong></div>
          </div>
          <div class="property-overview-foot">Mapped acreage is calculated from the public parcel boundary and may differ slightly from assessor-recorded acreage.</div>
        </div>
      </article>
    `;
    overview.insertAdjacentElement('beforebegin', section);

    document.getElementById('openFullParcelMap')?.addEventListener('click', () => {
      document.getElementById('mapCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return section;
  }

  function initPreviewMap() {
    if (previewMap || typeof L === 'undefined') return previewMap;
    const el = document.getElementById('parcelAerialPreview');
    if (!el) return null;

    previewMap = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      dragging: false,
      tap: false
    });

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(previewMap);
    return previewMap;
  }

  function setFact(id, value, cls = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
    el.className = cls;
  }

  function renderPropertyOverview() {
    if (typeof last === 'undefined' || !last?.parcel || typeof L === 'undefined') return;
    if (!ensureOverviewCard()) return;

    const identity = propertyIdentity();
    const area = mappedArea(last.parcel);
    const flood = hazardLabel(last.flood, 'flood');
    const wetlands = hazardLabel(last.wetlands, 'wetlands');
    const soil = dominantSoil();
    const wellDepth = averageNearbyWellDepth();

    document.getElementById('overviewAddress').textContent = identity.address;
    document.getElementById('overviewLocation').textContent = `${identity.county} County, Washington`;
    document.getElementById('overviewParcelId').textContent = identity.parcelId;
    document.getElementById('overviewCounty').textContent = identity.county;
    document.getElementById('overviewUtility').textContent = identity.utility;
    setFact('overviewFlood', flood.text, flood.cls);
    setFact('overviewWetlands', wetlands.text, wetlands.cls);
    setFact('overviewSoil', soil || 'Not available');
    setFact('overviewWellDepth', wellDepth ? `${wellDepth.depth.toLocaleString()} ft · ${wellDepth.count} nearby log${wellDepth.count === 1 ? '' : 's'}` : 'Not available');

    if (area) {
      const decimals = area.acres >= 100 ? 1 : 2;
      document.getElementById('overviewAcres').textContent = area.acres.toFixed(decimals);
      document.getElementById('overviewSqFt').textContent = `${Math.round(area.squareFeet).toLocaleString()} sq ft · mapped area`;
    } else {
      document.getElementById('overviewAcres').textContent = '—';
      document.getElementById('overviewSqFt').textContent = 'Mapped acreage unavailable';
    }

    const map = initPreviewMap();
    if (map) {
      if (previewBoundary) {
        previewBoundary.removeFrom(map);
        previewBoundary = null;
      }
      previewBoundary = L.geoJSON(last.parcel, {
        style: { color: '#f2b94b', weight: 4, opacity: 1, fillColor: '#f2b94b', fillOpacity: 0.12 }
      }).addTo(map);
      const bounds = previewBoundary.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.24), { maxZoom: 18, animate: false });
      setTimeout(() => map.invalidateSize(false), 80);
    }

    const version = document.querySelector('.version');
    if (version) version.textContent = 'AcresX v0.11 Property Overview';
  }

  if (typeof renderSummary === 'function') {
    const baseRenderSummary = renderSummary;
    renderSummary = function (...args) {
      const result = baseRenderSummary.apply(this, args);
      renderPropertyOverview();
      return result;
    };
  }
})();