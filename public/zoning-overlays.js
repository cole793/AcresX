// Zoning tab: mapped overlays (critical areas, shoreline, airport zones) from /api/zoning-permits
// `overlays` / `overlaysUnavailable` / `overlayNote` (Spokane County, src/counties/spokane-overlays.js).
// Additive screening information: it never changes the zone, the rules or the score. A layer that
// did not answer is named, so "none listed" is never read as "none there". Injected after
// zoning-potential.js (src/index.js maybeInjectUiPolish).
(() => {
  const escape = value => (typeof esc === 'function' ? esc(value) : String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  function addStyles() {
    if (document.getElementById('zoningOverlayStyles')) return;
    const style = document.createElement('style');
    style.id = 'zoningOverlayStyles';
    style.textContent = `
      .zone-overlays{margin-top:14px;border-top:1px solid var(--line);padding-top:16px}
      .zone-overlays h4{font:800 15px Manrope;margin:0 0 10px}
      .zone-overlay{border:1px solid var(--line);border-radius:10px;padding:10px 11px;margin-bottom:8px}
      .zone-overlay strong{display:block;font-size:12px;line-height:1.35}
      .zone-overlay span{display:block;color:var(--muted);font-size:10px;line-height:1.45;margin-top:3px}
      .zone-overlay a{color:var(--green);font-weight:800;text-decoration:none}
      .zone-overlay.unavailable{background:#fff8e8;border-color:#ead8aa}
      .zone-overlay-note{font-size:10px;color:var(--muted);line-height:1.5;margin-top:10px}
    `;
    document.head.appendChild(style);
  }

  const coverage = share => (Number(share) >= 0.995 ? 'covers the whole parcel'
    : Number(share) >= 0.01 ? `covers about ${Math.round(Number(share) * 100)}% of the parcel`
      : 'touches the parcel edge');

  function overlaysHtml(zp) {
    const overlays = Array.isArray(zp.overlays) ? zp.overlays : [];
    const down = Array.isArray(zp.overlaysUnavailable) ? zp.overlaysUnavailable : [];
    const items = overlays.map(o => `<div class="zone-overlay"><strong>${escape(o.name)}</strong><span>${escape(coverage(o.share))}. ${escape(o.detail || '')}</span><span>Source: ${o.sourceUrl ? `<a href="${escape(o.sourceUrl)}" target="_blank" rel="noopener">${escape(o.source)} ↗</a>` : escape(o.source)}</span></div>`);
    const unknown = down.map(d => `<div class="zone-overlay unavailable"><strong>${escape(d.source)}: did not answer</strong><span>This overlay is unknown for the parcel, not absent. Check with the county or city.</span></div>`);
    // City overlay layers that answered (Cheney's PUD Overlay): the city is named as a source too.
    const cityChecked = (Array.isArray(zp.cityOverlaysChecked) ? zp.cityOverlaysChecked : []).filter(c => c && c.source);
    const cities = [...new Set(cityChecked.map(c => c.source))];
    const noneTitle = cities.length ? `No mapped Spokane County or ${cities.join(' or ')} overlay on this parcel` : 'No mapped county overlay on this parcel';
    const countyList = 'shoreline designations, channel migration zones (50- and 100-year), critical aquifer recharge areas, county-mapped wetlands and wetland buffers, airfield overlay zones and FAR Part 77 height-restricted parcels';
    const checkedText = cities.length
      ? `Checked: Spokane County ${countyList}; ${cityChecked.map(c => `${c.source} ${c.layer || 'overlays'}`).join('; ')}.`
      : `Checked: ${countyList}.`;
    const none = !overlays.length && !down.length ? [`<div class="zone-overlay"><strong>${escape(noneTitle)}</strong><span>${escape(checkedText)}</span></div>`] : [];
    return `<div class="eyebrow">Overlays and critical areas</div><h4>${overlays.length ? `${overlays.length} mapped overlay${overlays.length === 1 ? '' : 's'}` : down.length ? 'Overlays partly unavailable' : 'None mapped'}</h4>${[...items, ...unknown, ...none].join('')}<div class="zone-overlay-note">${escape(zp.overlayNote || 'Overlays are screening information only. Verify with the county or city before design.')}</div>`;
  }

  function appendOverlays() {
    if (typeof activeTab === 'undefined' || activeTab !== 'zoning' || typeof last === 'undefined') return;
    const zp = last?.zoningPermits || {};
    // Only answers that carry the overlay fields (Spokane); other counties are unchanged.
    if (!Array.isArray(zp.overlaysUnavailable)) return;
    const root = document.getElementById('results');
    if (!root || root.querySelector('.zone-overlays')) return;
    addStyles();
    const block = document.createElement('div');
    block.className = 'zone-overlays';
    block.innerHTML = overlaysHtml(zp);
    root.appendChild(block);
  }

  if (typeof renderResults === 'function') {
    const base = renderResults;
    renderResults = function (...args) {
      const result = base.apply(this, args);
      appendOverlays();
      return result;
    };
  }
})();
