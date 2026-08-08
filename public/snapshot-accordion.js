(() => {
  function titleCase(value) {
    return String(value || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  function addStyles() {
    if (document.getElementById('snapshotAccordionStyles')) return;
    const style = document.createElement('style');
    style.id = 'snapshotAccordionStyles';
    style.textContent = `
      .snapshot-grid{align-items:stretch}
      .snapshot-card[data-detail]{min-height:220px;padding:20px;display:flex;flex-direction:column;align-items:stretch}
      .snapshot-card[data-detail] .snapshot-top{margin-bottom:18px}
      .snapshot-card[data-detail] .snapshot-value{font:800 22px/1.25 Manrope;margin:0 0 5px;min-height:0}
      .snapshot-card[data-detail] .snapshot-value.compact{font-size:22px;line-height:1.25}
      .snapshot-card[data-detail]>strong{font:700 14px/1.35 "DM Sans",sans-serif;margin:0}
      .snapshot-card[data-detail]>span:not(.snapshot-icon):not(.traffic-dot):not(.chevron){font:400 12px/1.45 "DM Sans",sans-serif;margin-top:7px;color:var(--muted)}
      .snapshot-card[data-detail]>b,.snapshot-card[data-detail] .snapshot-foot{display:none!important}
      .snapshot-card[data-detail]::after{content:'⌄';display:block;margin-top:auto;padding-top:18px;text-align:center;font:700 22px/1 "DM Sans";color:var(--ink);transition:transform .18s ease}
      .snapshot-card[data-detail].snapshot-open{border-color:#8ab59a;box-shadow:0 14px 34px rgba(28,55,38,.11)}
      .snapshot-card[data-detail].snapshot-open::after{transform:rotate(180deg)}
      .improvement-inline-detail{margin-top:14px}
      .improvement-inline-detail .card-head{height:auto;min-height:66px}
      .improvement-inline-detail .results-scroll{max-height:none}
      .snapshot-card[data-detail="soil"] #soilMetric{text-transform:capitalize}
      @media(max-width:1250px){.snapshot-card[data-detail]{min-height:190px}}
      @media(max-width:700px){.snapshot-card[data-detail]{min-height:165px}}
    `;
    document.head.appendChild(style);
  }

  function improvementSection() {
    const first = document.querySelector('.snapshot-grid .snapshot-card[data-detail]');
    return first?.closest('.dashboard-section') || null;
  }

  function zoningSection() {
    return document.querySelector('.zoning-grid')?.closest('.dashboard-section') || null;
  }

  function moveDetailFor(detail) {
    const card = document.getElementById('detailCard');
    if (!card) return;
    if (['wells','soil','power','listing','slope'].includes(detail)) {
      const section = improvementSection();
      if (section && card.previousElementSibling !== section) section.insertAdjacentElement('afterend', card);
      card.classList.add('improvement-inline-detail');
    } else {
      const section = zoningSection();
      if (section && card.previousElementSibling !== section) section.insertAdjacentElement('afterend', card);
      card.classList.remove('improvement-inline-detail');
    }
  }

  function setOpenCard(detail) {
    document.querySelectorAll('.snapshot-grid .snapshot-card[data-detail]').forEach(card => {
      card.classList.toggle('snapshot-open', card.dataset.detail === detail && document.getElementById('detailCard')?.classList.contains('show'));
    });
  }

  function standardizeSummary() {
    addStyles();
    const soilMetric = document.getElementById('soilMetric');
    if (soilMetric && soilMetric.textContent.trim() && soilMetric.textContent.trim() !== '—') {
      soilMetric.textContent = titleCase(soilMetric.textContent.trim());
    }
    const soilStatus = document.getElementById('soilStatus');
    if (soilStatus) {
      let text = soilStatus.textContent.trim();
      text = text.replace(/\bpreliminary septic screening\b/i, 'Preliminary septic screening');
      soilStatus.textContent = text;
    }
  }

  addStyles();

  document.addEventListener('click', event => {
    const button = event.target.closest('.snapshot-card[data-detail]');
    if (button) {
      const detail = button.dataset.detail;
      moveDetailFor(detail);
      requestAnimationFrame(() => setOpenCard(detail));
      return;
    }
    if (event.target.closest('#closeDetails')) {
      requestAnimationFrame(() => setOpenCard(null));
    }
  }, true);

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      standardizeSummary();
      return result;
    };
  }

  if (typeof renderResults === 'function') {
    const base = renderResults;
    renderResults = function (...args) {
      const detail = typeof activeTab !== 'undefined' ? activeTab : null;
      moveDetailFor(detail);
      const result = base.apply(this, args);
      requestAnimationFrame(() => setOpenCard(detail));
      return result;
    };
  }
})();
