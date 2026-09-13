(() => {
  const ICONS = {
    wells: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s5 5.4 5 9a5 5 0 1 1-10 0c0-3.6 5-9 5-9Z"/><path d="M9.5 13.2c.4 1.5 1.4 2.3 2.8 2.5"/></svg>',
    soil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V9"/><path d="M12 12c-4.5 0-7-2.4-7-6 4.5 0 7 2.4 7 6Z"/><path d="M12 15c4.5 0 7-2.4 7-6-4.5 0-7 2.4-7 6Z"/><path d="M5 20h14"/></svg>',
    power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-7 12h6l-1 8 7-12h-6l1-8Z"/></svg>',
    listing: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/><path d="M8.5 10.5h4M10.5 8.5v4"/></svg>',
    slope: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16"/><path d="m5 17 6-7 3 3 5-7"/><path d="M16 6h3v3"/></svg>',
    zoning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
    permits: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 9h8M8 13h8M8 17h5"/></svg>'
  };

  function addStyles() {
    if (document.getElementById('demoHousekeepingStyles')) return;
    const style = document.createElement('style');
    style.id = 'demoHousekeepingStyles';
    style.textContent = `
      .snapshot-icon{font-size:0!important;color:var(--green);border:0!important;background:transparent!important;box-shadow:none!important;width:28px!important;height:28px!important;min-width:28px!important;padding:2px!important;display:flex!important;align-items:center;justify-content:center}
      .snapshot-icon svg{width:21px;height:21px;display:block;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
      .snapshot-confidence{display:inline-flex;align-items:center;gap:5px;font:800 9px/1 "DM Sans",sans-serif;letter-spacing:.045em;text-transform:uppercase;white-space:nowrap;background:transparent!important;border:0!important;padding:0!important}
      .snapshot-confidence:before{content:"";width:6px;height:6px;min-width:6px;border-radius:50%;background:currentColor}
      .snapshot-confidence.confirmed{color:#267247}
      .snapshot-confidence.screening{color:#68776e}
      .snapshot-confidence.verify{color:#986614}
      .snapshot-card[data-detail] .snapshot-top{display:grid!important;grid-template-columns:minmax(0,1fr) 28px;grid-template-rows:auto auto;column-gap:10px;row-gap:8px;align-items:start!important}
      .snapshot-card[data-detail] .snapshot-top .snapshot-title{grid-column:1;grid-row:1;margin:0!important;min-width:0}
      .snapshot-card[data-detail] .snapshot-top .snapshot-icon{grid-column:2;grid-row:1;justify-self:end}
      .snapshot-card[data-detail] .snapshot-top .snapshot-confidence{grid-column:1/-1;grid-row:2;justify-self:start;margin:0!important}
      .zoning-grid .snapshot-card[data-detail]{grid-template-columns:48px minmax(0,1fr) auto!important;grid-template-rows:auto!important}
      .zoning-grid .snapshot-card[data-detail]>.snapshot-icon{grid-column:1;align-self:center}
      .zoning-grid .snapshot-card[data-detail] .snapshot-confidence{display:flex;margin-top:8px!important;justify-self:start;grid-column:auto}
      .parcel-card .parcel-card-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
      .parcel-new-search{border:1px solid #cfdad2;background:#f8faf8;color:var(--green);border-radius:9px;padding:8px 11px;font:800 11px/1 "DM Sans",sans-serif;white-space:nowrap;transition:.16s ease}
      .parcel-new-search:hover{background:#edf4ef;border-color:#9fb7a6;transform:translateY(-1px)}
      .parcel-new-search:focus-visible{outline:3px solid rgba(45,121,80,.2);outline-offset:2px}
      @media(max-width:1250px){
        .snapshot-confidence{font-size:8.5px}
        .snapshot-icon{width:26px!important;height:26px!important;min-width:26px!important}
        .snapshot-icon svg{width:20px;height:20px}
      }
      @media(max-width:700px){
        .parcel-card .parcel-card-toolbar{align-items:flex-start}.parcel-new-search{padding:7px 9px}
        .snapshot-card[data-detail] .snapshot-top{grid-template-columns:minmax(0,1fr) 26px}
      }
    `;
    document.head.appendChild(style);
  }

  function setIcon(card) {
    const icon = card.querySelector('.snapshot-icon');
    const svg = ICONS[card.dataset.detail];
    if (icon && svg && icon.dataset.lineIcon !== card.dataset.detail) {
      icon.innerHTML = svg;
      icon.dataset.lineIcon = card.dataset.detail;
    }
  }

  function confidenceFor(detail) {
    if (typeof last === 'undefined' || !last?.parcel) return { label: 'Verify', cls: 'verify', note: 'No property analysis loaded' };
    if (detail === 'wells') return Array.isArray(last.wells) && last.wells.length ? { label: 'Confirmed', cls: 'confirmed', note: 'Public well records returned for this search' } : { label: 'Verify', cls: 'verify', note: 'No nearby public well records returned' };
    if (detail === 'soil') return last?.land?.soil?.available ? { label: 'Screening', cls: 'screening', note: 'Derived from mapped USDA soil data; field verification required' } : { label: 'Verify', cls: 'verify', note: 'Soil screening is not available for this parcel' };
    if (detail === 'power') return Array.isArray(last.utility) && last.utility.length ? { label: 'Screening', cls: 'screening', note: 'Likely utility territory; service availability requires provider verification' } : { label: 'Verify', cls: 'verify', note: 'Serving utility has not been identified' };
    if (detail === 'listing') return last?.evidence?.status === 'found' ? { label: 'Verify', cls: 'verify', note: 'Public listing information should be independently verified' } : { label: 'Verify', cls: 'verify', note: 'No reliable active listing was matched' };
    if (detail === 'slope') return last?.land?.terrain?.available ? { label: 'Screening', cls: 'screening', note: 'Estimated from elevation data; not a survey' } : { label: 'Verify', cls: 'verify', note: 'Terrain screening is not available for this parcel' };
    if (detail === 'zoning') { const z = last?.zoningPermits?.zoning; return z?.status === 'gis_match' ? { label: 'Confirmed', cls: 'confirmed', note: 'Mapped county zoning record returned; permitted uses still require agency verification' } : { label: 'Verify', cls: 'verify', note: 'Zoning record requires agency verification' }; }
    if (detail === 'permits') return { label: 'Verify', cls: 'verify', note: 'Permit requirements depend on the proposed project and jurisdiction' };
    return { label: 'Verify', cls: 'verify', note: 'Verification recommended' };
  }

  function setConfidence(card) {
    const detail = card.dataset.detail;
    const state = confidenceFor(detail);
    let chip = card.querySelector('.snapshot-confidence');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'snapshot-confidence';
      if (card.closest('.snapshot-grid')) {
        const top = card.querySelector('.snapshot-top');
        if (top) top.appendChild(chip);
      } else {
        const content = card.querySelector(':scope > div');
        if (content) content.appendChild(chip); else card.appendChild(chip);
      }
    }
    chip.className = `snapshot-confidence ${state.cls}`;
    chip.textContent = state.label;
    chip.title = state.note;
    chip.setAttribute('aria-label', `${state.label}: ${state.note}`);
  }

  function polishCards() { document.querySelectorAll('.snapshot-card[data-detail]').forEach(card => { setIcon(card); setConfidence(card); }); }

  function addNewSearch() {
    const parcelCard = document.querySelector('.parcel-card');
    if (!parcelCard || parcelCard.querySelector('.parcel-new-search')) return;
    const label = parcelCard.querySelector('.label'); if (!label) return;
    const toolbar = document.createElement('div'); toolbar.className = 'parcel-card-toolbar'; label.parentNode.insertBefore(toolbar, label); toolbar.appendChild(label);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'parcel-new-search'; button.textContent = 'New Search'; button.setAttribute('aria-label', 'Start a new parcel search');
    button.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => { const input = document.getElementById('parcel'); if (input) { input.focus({ preventScroll: true }); input.select(); } }, 450); });
    toolbar.appendChild(button);
  }

  function refresh() { addStyles(); addNewSearch(); polishCards(); }
  refresh();
  if (typeof renderSummary === 'function') { const baseRenderSummary = renderSummary; renderSummary = function (...args) { const result = baseRenderSummary.apply(this, args); requestAnimationFrame(refresh); return result; }; }
  const observer = new MutationObserver(() => requestAnimationFrame(polishCards)); const dashboard = document.getElementById('dashboard'); if (dashboard) observer.observe(dashboard, { childList: true, subtree: true });
})();
