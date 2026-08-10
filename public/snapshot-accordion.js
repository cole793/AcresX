(() => {
  const improvementDetails = ['wells','soil','power','listing','slope'];
  const allDetails = [...improvementDetails, 'zoning', 'permits'];

  const titles = {
    wells: 'Well Feasibility',
    soil: 'Septic Feasibility',
    power: 'Power',
    listing: 'Listing Context',
    slope: 'Site-Work Feasibility'
  };

  function titleCase(value) {
    return String(value || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  function addStyles() {
    if (document.getElementById('snapshotAccordionStyles')) return;
    const style = document.createElement('style');
    style.id = 'snapshotAccordionStyles';
    style.textContent = `
      .snapshot-grid{align-items:stretch}
      .snapshot-card[data-detail]{min-height:230px;padding:18px 18px 16px;display:flex;flex-direction:column;align-items:stretch;overflow:hidden;transition:.18s ease;cursor:default}
      .snapshot-card[data-detail].snapshot-good{background:#edf7f0;border-color:#c9e2d0}
      .snapshot-card[data-detail].snapshot-limited{background:#fff6e8;border-color:#ead5aa}
      .snapshot-card[data-detail].snapshot-bad{background:#fbeceb;border-color:#ebc6c2}
      .snapshot-card[data-detail].snapshot-neutral{background:#f3f5f4;border-color:#dce4de}
      .snapshot-card[data-detail].snapshot-open{box-shadow:0 14px 34px rgba(28,55,38,.13);transform:translateY(-1px);border-color:#7eaa8d}
      .snapshot-card[data-detail] .snapshot-top{margin-bottom:14px;align-items:center}
      .snapshot-card[data-detail] .traffic-dot{display:none!important}
      .snapshot-card[data-detail] .snapshot-title{font:800 18px/1.2 Manrope;margin:0;color:var(--ink)}
      .snapshot-card[data-detail] .snapshot-value{font:800 24px/1.2 Manrope;margin:10px 0 5px;min-height:0;color:var(--ink)}
      .snapshot-card[data-detail] .snapshot-value.compact{font-size:24px;line-height:1.2}
      .snapshot-grid .snapshot-card[data-detail]>strong{display:none!important}
      .snapshot-card[data-detail]>span:not(.snapshot-icon):not(.traffic-dot):not(.chevron){font:400 12px/1.45 "DM Sans",sans-serif;margin-top:6px;color:#526158}
      .snapshot-card[data-detail]>b,.snapshot-card[data-detail] .snapshot-foot{display:none!important}
      .snapshot-details-btn{margin-top:auto;align-self:flex-start;border:1px solid #b9c9be;background:rgba(255,255,255,.82);color:var(--green);padding:9px 14px;border-radius:9px;font:800 11px/1 "DM Sans",sans-serif;box-shadow:none;cursor:pointer;transition:.16s ease}
      .snapshot-details-btn:hover{background:#fff;border-color:#8eac99}
      .snapshot-open .snapshot-details-btn{background:var(--green);border-color:var(--green);color:#fff;box-shadow:0 5px 12px rgba(29,93,58,.18)}
      .snapshot-card[data-detail] .snapshot-icon{background:rgba(255,255,255,.74)}
      .improvement-inline-detail{margin-top:14px}
      .improvement-inline-detail .card-head{height:auto;min-height:66px}
      .improvement-inline-detail .results-scroll{max-height:none}
      .snapshot-card[data-detail="soil"] #soilMetric{text-transform:capitalize}

      .zoning-grid .snapshot-card[data-detail]{min-height:120px;display:grid;grid-template-columns:48px minmax(0,1fr) auto;grid-template-rows:auto;align-items:center;gap:14px;padding:18px}
      .zoning-grid .snapshot-card[data-detail] .chevron{display:none!important}
      .zoning-grid .snapshot-card[data-detail] .snapshot-details-btn{margin:0;align-self:center;white-space:nowrap}
      .zoning-grid .snapshot-card[data-detail].snapshot-open{border-color:#7eaa8d;box-shadow:0 12px 28px rgba(28,55,38,.11)}

      @media(max-width:1250px){.snapshot-grid .snapshot-card[data-detail]{min-height:205px}}
      @media(max-width:700px){
        .snapshot-grid .snapshot-card[data-detail]{min-height:180px}
        .zoning-grid .snapshot-card[data-detail]{grid-template-columns:44px minmax(0,1fr);grid-template-rows:auto auto}
        .zoning-grid .snapshot-details-btn{grid-column:1/-1;justify-self:start;margin-top:4px}
      }
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
    if (improvementDetails.includes(detail)) {
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
    const detailCardOpen = document.getElementById('detailCard')?.classList.contains('show');
    document.querySelectorAll('.snapshot-card[data-detail]').forEach(card => {
      const open = detailCardOpen && card.dataset.detail === detail;
      card.classList.toggle('snapshot-open', open);
      const btn = card.querySelector('.snapshot-details-btn');
      if (btn) {
        btn.textContent = open ? 'Hide Details' : 'Details';
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    });
  }

  function statusClass(card) {
    const detail = card.dataset.detail;
    const gradeEl = detail === 'wells' ? document.getElementById('waterGrade')
      : detail === 'soil' ? document.getElementById('soilGrade')
      : detail === 'power' ? document.getElementById('powerGrade')
      : detail === 'listing' ? document.getElementById('listingGrade')
      : detail === 'slope' ? document.getElementById('slopeGrade')
      : null;

    const text = String(gradeEl?.textContent || '').toLowerCase();
    if (/good|favorable|shallow|low slope|confirmed provider|provider found/.test(text)) return 'snapshot-good';
    if (/limited|moderate|conditional|amber|verify/.test(text)) return 'snapshot-limited';
    if (/poor|high risk|red|unfavorable/.test(text)) return 'snapshot-bad';
    return 'snapshot-neutral';
  }

  function replaceOuterButton(card) {
    if (card.tagName !== 'BUTTON') return card;
    const replacement = document.createElement('article');
    [...card.attributes].forEach(attr => {
      if (attr.name !== 'type') replacement.setAttribute(attr.name, attr.value);
    });
    replacement.innerHTML = card.innerHTML;
    card.replaceWith(replacement);
    return replacement;
  }

  function decorateImprovementCard(card) {
    const detail = card.dataset.detail;
    const top = card.querySelector('.snapshot-top');
    if (top && !top.querySelector('.snapshot-title')) {
      const title = document.createElement('div');
      title.className = 'snapshot-title';
      title.textContent = titles[detail] || 'Property Detail';
      top.insertBefore(title, top.firstChild);
      const icon = top.querySelector('.snapshot-icon');
      if (icon) top.appendChild(icon);
    }

    card.classList.remove('snapshot-good','snapshot-limited','snapshot-bad','snapshot-neutral');
    card.classList.add(statusClass(card));
  }

  function addDetailsButton(card) {
    if (card.querySelector('.snapshot-details-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'snapshot-details-btn';
    btn.textContent = 'Details';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', `Show ${titles[card.dataset.detail] || card.dataset.detail} details`);
    card.appendChild(btn);
  }

  function standardizeCards() {
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

    document.querySelectorAll('.snapshot-card[data-detail]').forEach(original => {
      const card = replaceOuterButton(original);
      if (improvementDetails.includes(card.dataset.detail)) decorateImprovementCard(card);
      addDetailsButton(card);
      card.querySelector('.chevron')?.remove();
    });
  }

  function toggleDetail(detail) {
    const detailCard = document.getElementById('detailCard');
    if (!detailCard) return;

    const isSameOpen = detailCard.classList.contains('show') && typeof activeTab !== 'undefined' && activeTab === detail;
    if (isSameOpen) {
      detailCard.classList.remove('show');
      setOpenCard(null);
      return;
    }

    moveDetailFor(detail);
    if (typeof switchTab === 'function') switchTab(detail);
    else if (typeof openDetails === 'function') openDetails(detail);
    detailCard.classList.add('show');
    setOpenCard(detail);
  }

  addStyles();
  standardizeCards();

  document.addEventListener('click', event => {
    const btn = event.target.closest('.snapshot-details-btn');
    if (btn) {
      event.preventDefault();
      event.stopPropagation();
      const card = btn.closest('.snapshot-card[data-detail]');
      if (card) toggleDetail(card.dataset.detail);
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
      standardizeCards();
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
