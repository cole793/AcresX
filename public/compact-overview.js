(() => {
  if (!document.getElementById('compactOverviewStyles')) {
    const style = document.createElement('style');
    style.id = 'compactOverviewStyles';
    style.textContent = `
      /* Compact Property Overview: less vertical space, more readable type */
      .property-overview-card{
        grid-template-columns:minmax(300px,.72fr) minmax(0,1.28fr)!important;
        min-height:275px!important;
      }
      .property-overview-media{min-height:275px!important}
      .property-overview-info{padding:19px 24px 17px!important}
      .property-overview-eyebrow{font-size:11px!important;margin-bottom:5px!important}
      .property-overview-info h2{font-size:26px!important;line-height:1.1!important}
      .property-overview-location{font-size:14px!important;margin-top:5px!important}
      .property-overview-acres{margin-top:14px!important;padding-bottom:13px!important;gap:7px!important}
      .property-overview-acres strong{font-size:32px!important}
      .property-overview-acres span{font-size:13px!important}
      .property-overview-acres small{font-size:11px!important}
      .property-overview-facts{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:0 18px!important;margin-top:5px!important}
      .property-overview-fact{padding:8px 0!important}
      .property-overview-fact span{font-size:10.5px!important;letter-spacing:.055em!important;margin-bottom:3px!important}
      .property-overview-fact strong{font-size:13.5px!important;line-height:1.3!important}
      .property-assessment-source{padding:8px 0 2px!important;font-size:10.5px!important;line-height:1.4!important}
      .property-overview-foot{padding-top:8px!important;font-size:10.5px!important;line-height:1.35!important}
      #phase2TerrainRow{display:none!important}

      @media(max-width:1200px){.property-overview-facts{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
      @media(max-width:1000px){.property-overview-card{grid-template-columns:1fr!important}.property-overview-media{min-height:260px!important}.property-overview-info{padding:20px!important}}
      @media(max-width:700px){.property-overview-media{min-height:225px!important}.property-overview-facts{grid-template-columns:1fr 1fr!important}.property-overview-info h2{font-size:23px!important}.property-overview-fact span{font-size:10px!important}.property-overview-fact strong{font-size:13px!important}}
    `;
    document.head.appendChild(style);
  }

  function labelText(fact) {
    return String(fact?.querySelector('span')?.textContent || '').trim().toLowerCase();
  }

  function cleanupOverviewFacts() {
    const grid = document.querySelector('.property-overview-facts');
    if (!grid) return;

    // Remove duplicate soil/well facts, preserving the first populated instance.
    for (const target of ['dominant soil', 'avg. nearby well depth']) {
      const matches = [...grid.querySelectorAll('.property-overview-fact')].filter(f => labelText(f) === target);
      if (matches.length > 1) {
        const populated = matches.find(f => {
          const value = String(f.querySelector('strong')?.textContent || '').trim().toLowerCase();
          return value && !['not available','—','checking…','checking...'].includes(value);
        }) || matches[0];
        matches.forEach(f => { if (f !== populated) f.remove(); });
      }
    }

    // Add average grade to the main fact grid.
    let gradeFact = [...grid.querySelectorAll('.property-overview-fact')].find(f => labelText(f) === 'avg. grade');
    if (!gradeFact) {
      gradeFact = document.createElement('div');
      gradeFact.className = 'property-overview-fact';
      gradeFact.innerHTML = '<span>Avg. grade</span><strong id="overviewAvgGrade">Not available</strong>';
      grid.appendChild(gradeFact);
    }
    const gradeEl = gradeFact.querySelector('strong');
    const grade = Number(typeof last !== 'undefined' ? last?.land?.terrain?.gradePct : NaN);
    if (gradeEl) gradeEl.textContent = Number.isFinite(grade) ? `${grade.toFixed(1)}%` : 'Not available';

    // Remove the old terrain/elevation strip below the summary.
    document.getElementById('phase2TerrainRow')?.remove();
  }

  cleanupOverviewFacts();

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      requestAnimationFrame(cleanupOverviewFacts);
      setTimeout(cleanupOverviewFacts, 250);
      return result;
    };
  }
})();
