(() => {
  let zoningRequestId = 0;

  function addStyles() {
    if (document.getElementById('zoningPotentialStyles')) return;
    const style = document.createElement('style');
    style.id = 'zoningPotentialStyles';
    style.textContent = `
      .zone-potential{margin-top:14px;border-top:1px solid var(--line);padding-top:16px}
      .zone-potential-head{display:flex;justify-content:space-between;align-items:start;gap:14px;margin-bottom:12px}
      .zone-potential-head h4{font:800 15px Manrope;margin:0}
      .zone-family{font-size:10px;font-weight:800;border-radius:999px;padding:5px 8px;background:var(--pale);color:var(--green)}
      .zone-density{padding:13px 14px;border-radius:11px;background:#f5f7f5;margin-bottom:12px}
      .zone-density span{display:block;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:800}
      .zone-density strong{display:block;font-size:13px;margin-top:4px;line-height:1.4}
      .zone-use-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .zone-use{border:1px solid var(--line);border-radius:10px;padding:10px 11px;display:flex;gap:9px;align-items:flex-start;min-width:0}
      .zone-use-dot{width:9px;height:9px;border-radius:50%;margin-top:4px;flex:0 0 auto;background:#a9b2ac}
      .zone-use-dot.permitted{background:#2f8a58}.zone-use-dot.limited{background:#d08b25}.zone-use-dot.conditional{background:#c27c16}.zone-use-dot.not_permitted{background:#bd4b42}
      .zone-use strong{display:block;font-size:11px;line-height:1.3}.zone-use span{display:block;color:var(--muted);font-size:9px;margin-top:2px;text-transform:capitalize}
      .zone-context{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
      .zone-context-pill{border-radius:999px;background:#eef2ef;padding:6px 9px;font-size:10px;font-weight:800;color:var(--ink)}
      .zone-private-warning{margin-top:12px;padding:11px 12px;border-radius:10px;background:#fff8e8;border:1px solid #ead8aa;font-size:10px;line-height:1.5;color:var(--ink)}
      .zone-private-warning strong{display:block;font-size:10px;margin-bottom:2px}
      .zone-source{font-size:10px;color:var(--muted);line-height:1.5;margin-top:12px}
      .zone-source a{color:var(--green);font-weight:800;text-decoration:none}
      @media(max-width:700px){.zone-use-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function currentZoningIdentity() {
    if (typeof last === 'undefined') return null;
    const zp = last?.zoningPermits || {};
    const z = zp.zoning || {};
    if (!z.code) return null;
    return {
      county: zp.county || last?.parcel?.properties?._countyDisplay || last?.parcel?.properties?.COUNTY_NM || '',
      zoneCode: z.code,
      zoneName: z.name || '',
      jurisdiction: zp.jurisdiction || zp.permitJurisdiction?.name || '',
      uga: Boolean(zp.urbanGrowthArea?.intersects),
      developmentAgreement: z.developmentAgreement || zp.comprehensivePlan?.developmentAgreement || ''
    };
  }

  async function loadPotential() {
    const identity = currentZoningIdentity();
    if (!identity) return null;
    const county = String(identity.county).replace(/\s+County$/i, '').trim();
    if (!/^(spokane|yellowstone|kootenai)$/i.test(county)) return null;

    const cacheKey = `${county}|${identity.jurisdiction}|${identity.zoneCode}`;
    if (last?.zoningDevelopmentPotential?._cacheKey === cacheKey) return last.zoningDevelopmentPotential;

    const requestId = ++zoningRequestId;
    try {
      const response = await fetch('/api/zoning-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identity)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Zoning rules returned ${response.status}`);
      if (requestId !== zoningRequestId || typeof last === 'undefined') return null;
      data._cacheKey = cacheKey;
      last.zoningDevelopmentPotential = data;
      return data;
    } catch (error) {
      if (typeof last !== 'undefined') last.zoningDevelopmentPotential = { available: false, error: error.message, _cacheKey: cacheKey };
      return null;
    }
  }

  function statusLabel(value) {
    if (value === 'permitted') return 'Permitted';
    if (value === 'limited') return 'Limited / Standards Apply';
    if (value === 'conditional') return 'Special / Conditional Review';
    if (value === 'not_permitted') return 'Not Permitted';
    return value || 'Verify';
  }

  function appendPotential(power) {
    if (typeof activeTab === 'undefined' || activeTab !== 'zoning' || !power?.available) return;
    addStyles();
    const root = document.getElementById('results');
    if (!root || root.querySelector('.zone-potential')) return;

    const uses = Array.isArray(power.uses) ? power.uses : [];
    const county = String(power.county || '').toLowerCase();
    const context = county === 'yellowstone'
      ? [power.jurisdiction || 'Yellowstone County', power.sourceChapter || 'Zoning regulations']
      : county === 'kootenai'
        ? [power.jurisdiction || 'Kootenai County', power.sourceChapter || 'County zoning code']
        : [power.uga ? 'Inside mapped UGA' : 'Outside / no mapped UGA', power.developmentAgreement ? `Development agreement: ${power.developmentAgreement}` : 'No development agreement flagged', `Code ${power.sourceChapter}`];
    const sourceLabel = county === 'yellowstone'
      ? `${power.jurisdiction || 'Yellowstone County'} zoning regulations`
      : county === 'kootenai'
        ? 'Kootenai County Zoning Code'
        : 'Spokane County Zoning Code';

    const block = document.createElement('div');
    block.className = 'zone-potential';
    block.innerHTML = `
      <div class="zone-potential-head">
        <div><div class="eyebrow">Development potential</div><h4>${esc(power.name || power.code)} (${esc(power.code)})</h4></div>
        <span class="zone-family">${esc(power.family || 'Zoning')}</span>
      </div>
      <div class="zone-density"><span>Residential / development intensity</span><strong>${esc(power.density || 'Verify project-specific density standards')}</strong></div>
      <div class="zone-context">${context.filter(Boolean).map(x => `<span class="zone-context-pill">${esc(x)}</span>`).join('')}</div>
      <div class="zone-use-grid">
        ${uses.map(use => `<div class="zone-use"><span class="zone-use-dot ${esc(use.status)}"></span><div><strong>${esc(use.label)}</strong><span>${esc(statusLabel(use.status))}</span>${use.note ? `<span style="text-transform:none;line-height:1.35">${esc(use.note)}</span>` : ''}</div></div>`).join('')}
      </div>
      <div class="zone-private-warning"><strong>Private restrictions may apply</strong>Zoning eligibility does not override recorded CC&Rs, HOA rules, deed restrictions, plat conditions, or other private covenants. Review title documents and applicable association rules before relying on a listed use, especially for manufactured homes and additional dwellings.</div>
      <div class="zone-source">${esc(power.disclaimer || '')}<br><a href="${esc(power.sourceUrl || '#')}" target="_blank" rel="noopener">${esc(sourceLabel)} ↗</a></div>
    `;
    root.appendChild(block);
  }

  async function renderPotential() {
    if (typeof activeTab === 'undefined' || activeTab !== 'zoning') return;
    const cached = typeof last !== 'undefined' ? last?.zoningDevelopmentPotential : null;
    if (cached?.available) {
      appendPotential(cached);
      return;
    }
    const loaded = await loadPotential();
    if (typeof activeTab !== 'undefined' && activeTab === 'zoning' && loaded?.available) appendPotential(loaded);
  }

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      loadPotential();
      return result;
    };
  }

  if (typeof renderResults === 'function') {
    const base = renderResults;
    renderResults = function (...args) {
      const result = base.apply(this, args);
      renderPotential();
      return result;
    };
  }
})();
