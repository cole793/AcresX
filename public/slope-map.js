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

  function renderSlope() {
    slopeLayer.clearLayers();
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
      const response = await fetch('/api/slope-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry: last.parcel.geometry })
      });
      const data = await response.json();
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
})();
