(() => {
  function addStyles() {
    if (document.getElementById('scoreCostStyles')) return;
    const style = document.createElement('style');
    style.id = 'scoreCostStyles';
    style.textContent = `
      .overview-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;justify-content:stretch!important;gap:16px;margin-top:16px}
      .overview-grid .parcel-card{display:none!important}
      .overview-grid .score-card,.development-cost-placeholder{min-height:190px;width:100%}
      .overview-grid .score-card{padding:24px 26px;display:flex;flex-direction:column;justify-content:space-between}
      .overview-grid .score-card .metric-value{font-size:42px;line-height:1;margin-top:20px}
      .overview-grid .score-card .metric-title{font-size:15px}
      .development-cost-placeholder{padding:24px 26px;display:flex;flex-direction:column;justify-content:space-between;background:#fff}
      .development-cost-placeholder .cost-icon{width:40px;height:40px;border-radius:12px;background:var(--pale);display:grid;place-items:center;font-size:19px}
      .development-cost-placeholder .cost-kicker{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--green2);font-weight:800;margin-bottom:5px}
      .development-cost-placeholder .cost-value{font:800 30px Manrope;line-height:1.1;color:var(--ink)}
      .development-cost-placeholder .cost-note{font-size:12px;color:var(--muted);margin-top:8px;max-width:520px;line-height:1.45}
      .development-cost-placeholder .cost-pill{align-self:flex-start;margin-top:16px;border-radius:999px;background:var(--pale);color:var(--green);font-size:10px;font-weight:800;padding:6px 9px}
      @media(max-width:800px){.overview-grid{grid-template-columns:1fr!important}.overview-grid .score-card,.development-cost-placeholder{min-height:165px}}
    `;
    document.head.appendChild(style);
  }

  function ensureCostCard() {
    addStyles();
    const grid = document.querySelector('.overview-grid');
    if (!grid || document.getElementById('developmentCostPlaceholder')) return;

    const card = document.createElement('article');
    card.id = 'developmentCostPlaceholder';
    card.className = 'card development-cost-placeholder';
    card.innerHTML = `
      <div class="cost-icon">$</div>
      <div>
        <div class="cost-kicker">Development cost estimate</div>
        <div class="cost-value">Coming soon</div>
        <div class="cost-note">Estimated well, power, septic, driveway and site-work costs will appear here.</div>
        <div class="cost-pill">Cost Engine in development</div>
      </div>
    `;
    grid.appendChild(card);

    const version = document.querySelector('.version');
    if (version) version.textContent = 'AcresX v0.12 Property Feasibility';
  }

  ensureCostCard();
})();
