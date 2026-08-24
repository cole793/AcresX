(() => {
  const YELLOW = '#ffd400';
  const YELLOW_FILL = '#ffe45c';

  function applyParcelStyle() {
    if (typeof parcelLayer === 'undefined' || !parcelLayer?.eachLayer) return;
    parcelLayer.eachLayer(group => {
      if (group?.eachLayer) group.eachLayer(layer => {
        if (layer?.setStyle) layer.setStyle({ color: YELLOW, weight: 4, fillColor: YELLOW_FILL, fillOpacity: 0.20 });
      });
      else if (group?.setStyle) group.setStyle({ color: YELLOW, weight: 4, fillColor: YELLOW_FILL, fillOpacity: 0.20 });
    });
  }

  function fitParcelTightly() {
    if (typeof map === 'undefined' || typeof parcelLayer === 'undefined' || !parcelLayer?.getBounds) return;
    const bounds = parcelLayer.getBounds();
    if (!bounds?.isValid?.()) return;
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [42, 42], maxZoom: 18, animate: true });
  }

  const style = document.createElement('style');
  style.textContent = `.legend-parcel{border-color:${YELLOW}!important;background:rgba(255,228,92,.28)!important}`;
  document.head.appendChild(style);

  if (typeof renderMap === 'function') {
    const baseRenderMap = renderMap;
    renderMap = function (...args) {
      const shouldFit = args.length ? args[0] !== false : true;
      const result = baseRenderMap.apply(this, args);
      applyParcelStyle();
      if (shouldFit) setTimeout(fitParcelTightly, 130);
      return result;
    };
  }

  const fitButton = document.getElementById('fitMapBtn');
  if (fitButton) fitButton.addEventListener('click', () => setTimeout(fitParcelTightly, 140));
})();
