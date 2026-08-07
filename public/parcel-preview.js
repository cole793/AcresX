(() => {
  let previewMap = null;
  let previewBoundary = null;

  function addPreviewStyles() {
    if (document.getElementById('parcelPreviewStyles')) return;
    const style = document.createElement('style');
    style.id = 'parcelPreviewStyles';
    style.textContent = `
      .parcel-media-section{margin-top:16px}
      .parcel-media-card{position:relative;overflow:hidden;min-height:340px;background:#dfe7e1}
      #parcelAerialPreview{height:340px;width:100%;background:#dfe7e1}
      .parcel-media-overlay{position:absolute;z-index:450;left:16px;top:16px;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border:1px solid rgba(23,35,28,.12);border-radius:12px;padding:10px 12px;box-shadow:0 5px 18px rgba(0,0,0,.12);pointer-events:none}
      .parcel-media-overlay strong{display:block;font:800 13px Manrope;color:var(--ink)}
      .parcel-media-overlay span{display:block;margin-top:2px;font-size:10px;color:var(--muted)}
      .parcel-media-actions{position:absolute;z-index:450;right:16px;top:16px;display:flex;gap:8px}
      .parcel-media-btn{border:1px solid rgba(23,35,28,.14);background:rgba(255,255,255,.94);backdrop-filter:blur(8px);padding:9px 11px;border-radius:10px;font-size:11px;font-weight:800;color:var(--ink);box-shadow:0 5px 18px rgba(0,0,0,.10)}
      .parcel-media-source{position:absolute;z-index:450;right:10px;bottom:8px;background:rgba(255,255,255,.86);padding:4px 7px;border-radius:7px;font-size:9px;color:#47554c;pointer-events:none}
      @media(max-width:700px){#parcelAerialPreview,.parcel-media-card{height:260px;min-height:260px}.parcel-media-overlay{left:10px;top:10px}.parcel-media-actions{right:10px;top:10px}}
    `;
    document.head.appendChild(style);
  }

  function ensurePreviewCard() {
    addPreviewStyles();
    let section = document.getElementById('parcelMediaSection');
    if (section) return section;

    const overview = document.querySelector('.overview-grid');
    if (!overview) return null;

    section = document.createElement('section');
    section.id = 'parcelMediaSection';
    section.className = 'parcel-media-section';
    section.innerHTML = `
      <article class="card parcel-media-card">
        <div id="parcelAerialPreview" aria-label="Satellite aerial view of selected parcel"></div>
        <div class="parcel-media-overlay">
          <strong>Parcel aerial</strong>
          <span>Satellite imagery with selected parcel boundary</span>
        </div>
        <div class="parcel-media-actions">
          <button id="openFullParcelMap" class="parcel-media-btn" type="button">Open interactive map</button>
        </div>
        <div class="parcel-media-source">Imagery © Esri and contributors</div>
      </article>
    `;
    overview.insertAdjacentElement('afterend', section);

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

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19
    }).addTo(previewMap);

    return previewMap;
  }

  function renderParcelPreview() {
    if (typeof last === 'undefined' || !last?.parcel || typeof L === 'undefined') return;
    if (!ensurePreviewCard()) return;
    const map = initPreviewMap();
    if (!map) return;

    if (previewBoundary) {
      previewBoundary.removeFrom(map);
      previewBoundary = null;
    }

    previewBoundary = L.geoJSON(last.parcel, {
      style: {
        color: '#f2b94b',
        weight: 4,
        opacity: 1,
        fillColor: '#f2b94b',
        fillOpacity: 0.12
      }
    }).addTo(map);

    const bounds = previewBoundary.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.28), { maxZoom: 18, animate: false });
    setTimeout(() => map.invalidateSize(false), 80);

    const version = document.querySelector('.version');
    if (version) version.textContent = 'AcresX v0.10 Parcel Aerial Preview';
  }

  if (typeof renderSummary === 'function') {
    const baseRenderSummary = renderSummary;
    renderSummary = function (...args) {
      const result = baseRenderSummary.apply(this, args);
      renderParcelPreview();
      return result;
    };
  }
})();
