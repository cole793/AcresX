// County coverage and trust labels on the dashboard (owner request 2026-11-14, after a Flathead
// parcel scored 9.1 "Excellent" with "Confirmed" chips although Flathead is not validated).
//
// - Reads GET /api/county-coverage (src/services/county-coverage.js, built from
//   src/config/county-coverage.js) once per page load.
// - Coverage badge in the Property overview header: "Validated county" (level 3), "Partially
//   validated" (level 2), "Limited coverage — statewide data only, not validated" (level <= 1).
// - Limited-coverage counties: the score stays, its label says "limited data".
// - Existing structures: assessor improvements > 0, or a well record matched to the parcel, adds a
//   finding that the parcel may already have a home or buildings. Information only; the score is
//   not changed here.
// - Status chips (public/demo-housekeeping.js) and the printable report (property-report-v2.js)
//   ask this module for the well and zoning chip wording.
// window.AcresXCoverage: { ready, supportedCounties, forCounty, forData, zoningChip, wellChip,
//   wellOnParcel, existingStructure, softRating }
// If the registry does not answer, no badge is shown and the county list stays flat.
(() => {
  const byKey = new Map();
  const supportedByState = {};
  let loaded = false;
  const norm = s => String(s || '').replace(/\s+County$/i, '').trim().toLowerCase();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const usd = n => `$${Math.round(Number(n)).toLocaleString('en-US')}`;
  const currentData = () => { try { return typeof last !== 'undefined' ? last : window.__acresxLast || null; } catch { return window.__acresxLast || null; } };

  function accept(body) {
    byKey.clear();
    Object.keys(supportedByState).forEach(k => delete supportedByState[k]);
    for (const c of Array.isArray(body?.counties) ? body.counties : []) {
      byKey.set(`${String(c.state).toUpperCase()}:${norm(c.county)}`, c);
      if (c.supported) (supportedByState[String(c.state).toUpperCase()] ||= []).push(c.county);
    }
    loaded = byKey.size > 0;
  }

  function forCounty(state, county) {
    if (!loaded || !county) return null;
    return byKey.get(`${String(state || 'WA').toUpperCase()}:${norm(county)}`) || null;
  }

  // State and county of the analyzed parcel, read the way the report reads them.
  function forData(data = currentData()) {
    const p = data?.parcel?.properties;
    if (!p) return null;
    const state = p._stateCode || document.getElementById('state')?.value || 'WA';
    const county = p._countyDisplay || p.COUNTY_NM || document.getElementById('county')?.value || '';
    return forCounty(state, county);
  }

  const limited = data => Boolean(forData(data)?.coverage?.limited);

  // "Excellent" -> "Excellent · limited data" in a limited-coverage county.
  const softRating = (rating, data = currentData()) => (rating && limited(data) ? `${rating} · limited data` : rating);

  function wellOnParcel(data = currentData()) {
    const m = data?.existingWell?.available ? data.existingWell.match : null;
    return Boolean(m && (m.evidence?.insideParcel || m.evidence?.ownerMatch));
  }

  // Well feasibility chip: nearby well logs are not a record of a well on this parcel.
  function wellChip(data = currentData()) {
    if (wellOnParcel(data)) return { label: 'On-parcel record', cls: 'confirmed', note: 'A public well record maps to this parcel; verify the record and the well\'s current status' };
    if (Array.isArray(data?.wells) && data.wells.length) return { label: 'Nearby records', cls: 'screening', note: 'Public well records near the parcel; they do not show a well on this parcel' };
    return { label: 'Verify', cls: 'verify', note: 'No nearby public well records returned' };
  }

  // Zoning chip for a mapped zone: "County GIS" only where the county's zoning source is validated.
  function zoningChip(data = currentData()) {
    const zp = data?.zoningPermits || {};
    if (zp.zoning?.status !== 'gis_match') return { label: 'Verify', cls: 'verify', note: 'Zoning record requires agency verification' };
    const who = /^City /i.test(zp.jurisdiction || '') ? 'city' : 'county';
    const cov = forData(data);
    if (cov?.coverage?.limited) return { label: 'Statewide data — verify', cls: 'verify', note: `Zoning found automatically for a county AcresX has not validated; verify the zone with the ${who}` };
    if (cov?.zoningValidated) return { label: 'County GIS', cls: 'confirmed', note: `Mapped ${who} zoning record from the jurisdiction's GIS; permitted uses still require agency verification` };
    return { label: 'Mapped — verify', cls: 'screening', note: `Mapped ${who} zoning record; the source is not validated for this county yet` };
  }

  // Assessor improvements > 0 or a well record on the parcel: there may already be a home.
  function existingStructure(data = currentData()) {
    let a = null;
    try { a = window.AcresXReport?.assessment?.(data) || null; } catch { a = null; }
    const imp = Number(a?.improvements);
    if (Number.isFinite(imp) && imp > 0) {
      return { improvements: imp, title: `Assessor lists improvements (${usd(imp)})`, detail: 'The parcel may already have a home or buildings. The buildable-area estimate does not subtract existing structures; check what is on the site.' };
    }
    if (wellOnParcel(data)) {
      return { improvements: null, title: 'A well record maps to this parcel', detail: 'The parcel may already have a home, well or septic system. Check what is on the site.' };
    }
    return null;
  }

  // ---- Dashboard

  function addStyles() {
    if (document.getElementById('coverageTrustStyles')) return;
    const style = document.createElement('style');
    style.id = 'coverageTrustStyles';
    style.textContent = `
      .coverage-badge{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin:2px 0 8px;font:600 12px/1.4 "DM Sans",sans-serif;color:#526158}
      .coverage-badge strong{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 10px;font:800 11px/1.2 "DM Sans",sans-serif;letter-spacing:.02em}
      .coverage-badge strong:before{content:"";width:7px;height:7px;min-width:7px;border-radius:50%;background:currentColor}
      .coverage-badge.tier-validated strong{background:#e6f3ea;color:#267247}
      .coverage-badge.tier-partial strong{background:#eef2f7;color:#2b5283}
      .coverage-badge.tier-limited strong{background:#fff3dc;color:#8a5b13}
      .coverage-badge span{flex:1 1 260px;min-width:0}
      .coverage-structure-note{margin:10px 0 2px;padding:9px 12px;border-radius:10px;background:#fff3dc;border:1px solid #ead29e;border-left:4px solid #d39a2a;font:600 12.5px/1.4 "DM Sans",sans-serif;color:#5e4210}
      .coverage-structure-note strong{display:block;font-weight:800;color:#68430b}
      .coverage-score-flag{margin-top:6px;font:800 11px/1.3 "DM Sans",sans-serif;color:#8a5b13}
    `;
    document.head.appendChild(style);
  }

  function ensure(id, cls, parent, after) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = cls;
      if (after && after.parentNode === parent) after.insertAdjacentElement('afterend', el);
      else parent.appendChild(el);
    }
    return el;
  }
  // Writes only when the text changes, so the MutationObservers on the dashboard settle.
  function setHtml(el, cls, html) {
    if (el.className !== cls) el.className = cls;
    // Compared with what was last written, not innerHTML (the browser re-serializes entities).
    if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
    if (el.hidden !== !html) el.hidden = !html;
  }

  function renderBadge(data) {
    const info = document.querySelector('.property-overview-info');
    if (!info) return;
    const badge = ensure('coverageBadge', 'coverage-badge', info, info.querySelector('.property-overview-eyebrow'));
    const cov = forData(data);
    const c = cov?.coverage;
    setHtml(badge, `coverage-badge${c ? ` tier-${c.tier}` : ''}`, c ? `<strong>${esc(c.label)}</strong><span>${esc(c.summary)}</span>` : '');
  }

  function renderStructure(data) {
    const info = document.querySelector('.property-overview-info');
    if (!info) return;
    const anchor = document.getElementById('overviewAcreageNote') || info.querySelector('.property-overview-acres');
    const note = ensure('existingStructureNote', 'coverage-structure-note', info, anchor);
    const s = existingStructure(data);
    setHtml(note, 'coverage-structure-note', s ? `<strong>${esc(s.title)}</strong>${esc(s.detail)}` : '');
  }

  function renderScore(data) {
    const card = document.querySelector('.overview-grid .score-card');
    const note = document.getElementById('scoreNote');
    if (!card || !note) return;
    const isLimited = limited(data);
    const text = note.textContent || '';
    // "Excellent buildability · 7-factor screening" (screening-refinements.js) -> "Excellent
    // buildability · limited data". The number is unchanged.
    if (isLimited && !/limited data/i.test(text)) {
      const m = /^(Excellent|Good|Moderate|Challenging)\b/.exec(text.trim());
      if (m) note.textContent = `${m[1]} buildability · limited data`;
    }
    const host = card.querySelector(':scope > div:last-child') || card;
    let flag = card.querySelector('.coverage-score-flag');
    if (isLimited && !flag) { flag = document.createElement('div'); flag.className = 'coverage-score-flag'; host.appendChild(flag); }
    if (flag) {
      const want = isLimited ? 'County not validated: statewide sources only' : '';
      if (flag.textContent !== want) flag.textContent = want;
      flag.hidden = !isLimited;
    }
  }

  function refresh() {
    const data = currentData();
    if (!data?.parcel) return;
    addStyles();
    renderBadge(data);
    renderStructure(data);
    renderScore(data);
  }

  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; refresh(); }); };

  const ready = (async () => {
    try {
      const response = await fetch('/api/county-coverage', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`County coverage returned ${response.status}`);
      accept(await response.json());
    } catch (error) {
      console.warn('County coverage registry unavailable; coverage badges are hidden', error);
    }
    try { window.dispatchEvent(new Event('acresx:coverage')); } catch { /* no event support (tests) */ }
    schedule();
    return loaded;
  })();

  window.AcresXCoverage = {
    ready, accept, forCounty, forData, softRating, wellChip, zoningChip, wellOnParcel, existingStructure,
    supportedCounties: state => (supportedByState[String(state || '').toUpperCase()] || []).slice(),
    refresh
  };

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      refresh();
      return result;
    };
  }
  // The assessment and the well-record match arrive after the summary renders
  // (property-assessment.js, existing-well.js), and other modules repaint the score note.
  const dashboard = document.getElementById('dashboard');
  if (dashboard && typeof MutationObserver !== 'undefined') new MutationObserver(schedule).observe(dashboard, { childList: true, subtree: true, characterData: true });
})();
