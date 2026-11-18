(() => {
  if (typeof map === 'undefined' || typeof L === 'undefined') return;

  const streetBtn = document.getElementById('streetBtn');
  const satelliteBtn = document.getElementById('satelliteBtn');
  if (!streetBtn || !satelliteBtn || document.getElementById('slopeBtn')) return;

  const slopeLayer = L.layerGroup();
  let slopeEnabled = false;
  let slopeLoading = false;
  let slopeCacheKey = '';
  let slopeData = null;

  const slopeBtn = document.createElement('button');
  slopeBtn.type = 'button';
  slopeBtn.id = 'slopeBtn';
  slopeBtn.className = 'map-tool';
  slopeBtn.textContent = 'Slope';
  slopeBtn.title = 'Show approximate parcel slope heat map';
  satelliteBtn.insertAdjacentElement('afterend', slopeBtn);

  const style = document.createElement('style');
  style.id = 'slopeMapStyles';
  style.textContent = `
    .slope-legend{position:absolute;z-index:451;left:12px;bottom:84px;background:rgba(255,255,255,.96);border:1px solid rgba(23,35,28,.14);border-radius:11px;padding:10px 12px;font-size:10px;box-shadow:0 4px 14px rgba(0,0,0,.1);display:none;min-width:150px}
    .slope-legend.show{display:block}.slope-legend strong{display:block;font-size:11px;margin-bottom:6px}.slope-legend-row{display:flex;align-items:center;gap:7px;margin:5px 0;color:#48554d}.slope-swatch{width:18px;height:10px;border-radius:3px;border:1px solid rgba(0,0,0,.12)}
    .slope-legend-note{margin-top:7px;padding-top:7px;border-top:1px solid #e1e7e2;color:#748077;line-height:1.35}
  `;
  document.head.appendChild(style);

  const legend = document.createElement('div');
  legend.className = 'slope-legend';
  legend.id = 'slopeLegend';
  legend.innerHTML = `
    <strong>Approx. slope</strong>
    <div class="slope-legend-row"><span class="slope-swatch" style="background:#2f8a58"></span><span>0–5% · flatter</span></div>
    <div class="slope-legend-row"><span class="slope-swatch" style="background:#d4a72c"></span><span>5–10% · moderate</span></div>
    <div class="slope-legend-row"><span class="slope-swatch" style="background:#d97824"></span><span>10–20% · steeper</span></div>
    <div class="slope-legend-row"><span class="slope-swatch" style="background:#b83a32"></span><span>20%+ · steep</span></div>
    <div class="slope-legend-note">Screening visualization from USGS elevation samples. Not a survey or grading plan.</div>
  `;
  const mapWrap = document.querySelector('.map-wrap');
  if (mapWrap) mapWrap.appendChild(legend);

  function colorForBand(band) {
    if (band === 'flat') return '#2f8a58';
    if (band === 'moderate') return '#d4a72c';
    if (band === 'steep') return '#d97824';
    return '#b83a32';
  }

  function parcelKey() {
    if (typeof last === 'undefined' || !last?.parcel) return '';
    const p = last.parcel.properties || {};
    return String(p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || JSON.stringify(last.parcel.geometry));
  }

  function pointInsideParcel(center) {
    try {
      if (typeof turf === 'undefined' || !last?.parcel) return true;
      return turf.booleanPointInPolygon(turf.point(center), last.parcel);
    } catch {
      return true;
    }
  }

  function bringParcelFront() {
    try {
      if (typeof parcelLayer !== 'undefined') parcelLayer.eachLayer(layer => layer.bringToFront?.());
    } catch {}
  }

  // Slope raster (POST /api/slope-raster, src/services/slope-raster.js): per-pixel slope classes
  // as rectangles, one canvas-drawn layer per class. The 5 x 5 slope grid (/api/slope-grid) is the
  // fallback when the raster is unavailable.
  const RASTER_COLORS = { '0-8': '#2f8a58', '8-15': '#d4a72c', '15-25': '#d97824', '25-30': '#c4512b', '30+': '#8e1f1a' };
  const GRID_LEGEND = legend.innerHTML;
  function rasterLegend(data) {
    const rows = (data.classes || []).map(c => `<div class="slope-legend-row"><span class="slope-swatch" style="background:${RASTER_COLORS[c.key] || '#999'}"></span><span>${c.label} · ${c.pct}%</span></div>`).join('');
    return `<strong>Slope (${data.pixelM} m pixels)</strong>${rows}<div class="slope-legend-note">Average ${Number(data.meanPct).toFixed(1)}% · steepest 10% of the parcel: ${Number(data.p90Pct).toFixed(0)}%+. Over 30% is removed from the buildable estimate. USGS 3DEP elevation; not a survey.</div>`;
  }
  function renderRaster() {
    let renderer;
    try { renderer = L.canvas({ padding: 0.2 }); } catch { renderer = undefined; }
    const byClass = {};
    for (const r of slopeData.displayRects || []) (byClass[r.cls] ||= []).push(r.b);
    for (const c of slopeData.classes || []) {
      const rects = byClass[c.key];
      if (!rects?.length) continue;
      const geo = { type: 'MultiPolygon', coordinates: rects.map(([w, s, e, n]) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]]) };
      L.geoJSON(geo, { renderer, style: { stroke: false, fill: true, fillColor: RASTER_COLORS[c.key] || '#999', fillOpacity: 0.55 } })
        .bindPopup(`<strong>${c.label} slope</strong><br>About ${c.pct}% of the parcel`).addTo(slopeLayer);
    }
    legend.innerHTML = rasterLegend(slopeData);
  }

  function renderSlope() {
    slopeLayer.clearLayers();
    if (slopeData?.available && Array.isArray(slopeData.displayRects)) {
      renderRaster();
      if (slopeEnabled && !map.hasLayer(slopeLayer)) slopeLayer.addTo(map);
      bringParcelFront();
      return;
    }
    legend.innerHTML = GRID_LEGEND;
    if (!slopeData?.available || !Array.isArray(slopeData.cells)) return;

    slopeData.cells.forEach(cell => {
      if (!Array.isArray(cell.center) || !pointInsideParcel(cell.center)) return;
      const grade = Number(cell.gradePct);
      const elevation = Number(cell.elevationFt);
      const color = colorForBand(cell.band);
      L.rectangle(cell.bounds, {
        stroke: false,
        fill: true,
        fillColor: color,
        fillOpacity: 0.58,
        interactive: true
      }).bindPopup(`<strong>Approx. local slope</strong><br>${Number.isFinite(grade) ? grade.toFixed(1) + '%' : 'Not available'}<br><span style="color:#66736b">Elevation: ${Number.isFinite(elevation) ? Math.round(elevation) + ' ft' : 'Not available'}</span>`).addTo(slopeLayer);
    });

    if (slopeEnabled && !map.hasLayer(slopeLayer)) slopeLayer.addTo(map);
    bringParcelFront();
  }

  async function loadSlope() {
    if (slopeLoading || typeof last === 'undefined' || !last?.parcel?.geometry) return;
    const key = parcelKey();
    if (slopeData && slopeCacheKey === key) {
      renderSlope();
      return;
    }

    slopeLoading = true;
    const original = slopeBtn.textContent;
    slopeBtn.textContent = 'Loading…';
    slopeBtn.disabled = true;
    try {
      const post = route => fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry: last.parcel.geometry })
      });
      let response = null, data = null;
      try {
        response = await post('/api/slope-raster');
        data = await response.json();
      } catch (error) {
        console.warn('Slope raster unavailable; using the slope grid', error);
      }
      if (!response?.ok || !data?.available) {
        response = await post('/api/slope-grid');
        data = await response.json();
      }
      if (!response.ok || !data?.available) throw new Error(data?.error || `Slope service returned ${response.status}`);
      slopeData = data;
      slopeCacheKey = key;
      renderSlope();
    } catch (error) {
      console.warn('Slope heat map unavailable', error);
      slopeEnabled = false;
      slopeBtn.classList.remove('active');
      legend.classList.remove('show');
      if (map.hasLayer(slopeLayer)) map.removeLayer(slopeLayer);
      window.alert?.(`Slope heat map unavailable: ${error.message}`);
    } finally {
      slopeLoading = false;
      slopeBtn.disabled = false;
      slopeBtn.textContent = original;
    }
  }

  slopeBtn.addEventListener('click', async () => {
    if (typeof last === 'undefined' || !last?.parcel) return;
    slopeEnabled = !slopeEnabled;
    slopeBtn.classList.toggle('active', slopeEnabled);
    legend.classList.toggle('show', slopeEnabled);

    if (!slopeEnabled) {
      if (map.hasLayer(slopeLayer)) map.removeLayer(slopeLayer);
      return;
    }

    if (!map.hasLayer(slopeLayer)) slopeLayer.addTo(map);
    await loadSlope();
    bringParcelFront();
  });

  if (typeof renderMap === 'function') {
    const baseRenderMap = renderMap;
    renderMap = function (...args) {
      const result = baseRenderMap.apply(this, args);
      const key = parcelKey();
      if (slopeCacheKey && key && slopeCacheKey !== key) {
        slopeData = null;
        slopeCacheKey = '';
        slopeLayer.clearLayers();
      }
      if (slopeEnabled && slopeData) {
        renderSlope();
        if (!map.hasLayer(slopeLayer)) slopeLayer.addTo(map);
      }
      bringParcelFront();
      return result;
    };
  }
  // Phase 1 land-cover presentation. Read-only: does not change score or costs.
  function renderLandCoverScreening() {
    try {
      if (typeof last === 'undefined') return;
      const lc = last?.land?.landCover;
      const note = document.getElementById('slopeNote');
      // Checked by text, not a flag: a summary re-render (progressive-loading.js) rewrites the note.
      if (note && lc?.available && !note.textContent.includes('% wooded')) {
        note.textContent += ' · ~' + lc.woodedPct + '% wooded';
      }
      const detail = document.getElementById('detailCard');
      const root = detail?.querySelector('.results-scroll');
      const open = typeof activeTab !== 'undefined' && activeTab === 'slope';
      const existing = root?.querySelector('[data-land-cover-screening]');
      if (!open || !root) return;
      if (!lc?.available) {
        if (existing?.dataset.signature === 'unavailable:' + (lc?.error || '')) return;
        existing?.remove();
        const block = document.createElement('div');
        block.className = 'notice';
        block.dataset.landCoverScreening = 'true';
        block.dataset.signature = 'unavailable:' + (lc?.error || '');
        block.innerHTML = '<strong>Tree cover & open area</strong><br>' +
          (lc?.error || 'USDA Forest Service tree-canopy screening is unavailable for this parcel.') +
          '<br><span style="color:#66736b">Slope results are unaffected. Tree cover is not included in the score or cost estimate.</span>';
        root.appendChild(block);
        return;
      }
      const signature = [lc.year, lc.woodedPct, lc.openPct, lc.sampleCount].join(':');
      if (existing?.dataset.signature === signature) return;
      existing?.remove();
      const block = document.createElement('div');
      block.className = 'notice';
      block.dataset.landCoverScreening = 'true';
      block.dataset.signature = signature;
      const classes = (lc.topClasses || []).map(item => item.label + ' ' + item.pct + '%').join(' · ');
      block.innerHTML =
        '<strong>Tree cover & open area</strong><br>' +
        'USDA Forest Service tree-canopy screening estimates <strong>~' + lc.woodedPct +
        '% tree canopy</strong> and <strong>~' + lc.openPct + '% non-canopy</strong>' +
        (lc.otherPct ? ', with ~' + lc.otherPct + '% other/unclassified cover.' : '.') +
        '<br><br><strong>Data year:</strong> ' + (lc.year || '—') +
        ' · <strong>Samples:</strong> ' + (lc.sampleCount || 0) +
        (classes ? '<br><strong>Dominant mapped cover:</strong> ' + classes : '') +
        '<br><br><span style="color:#66736b">Source: USDA Forest Service NLCD Tree Canopy Cover. Preliminary 30 m satellite estimate; not a tree survey or clearing plan. Phase 1 does not affect the Buildability Score or cost estimate.</span>';
      root.appendChild(block);
    } catch (error) {
      console.warn('[AcresX land cover] Presentation unavailable', error);
    }
  }

  window.setInterval(renderLandCoverScreening, 700);
  renderLandCoverScreening();

})();
