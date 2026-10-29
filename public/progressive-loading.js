// Progressive property loading. The search form's submit handler (index.html) calls
// window.AcresXProgress.search(). As soon as the parcel is found, the dashboard opens with the
// parcel overview and map, and each section card says "Checking…". Every section request starts
// at once, with its own time limit; when one settles, its data goes into `last` and the whole
// summary re-renders (debounced, so a burst of answers re-renders once). A section that runs out of
// time shows "Timed out — try again" with a Retry button; the rest of the report is unaffected.
//
// window.AcresXSections is the shared per-search state the other public/*.js modules read:
//   placeholder(name)    'pending' | 'timeout' | null. A pending section has not answered yet; a
//                        failed one has answered (with its usual "unavailable" data) and is null.
//   claim(key)           true the first time per search; follow-up requests (power intelligence,
//                        existing well, assessment, RESO) use it to fire once per search.
//   settle(key)          a claimed follow-up finished; score/cost inputs re-render the summary.
//   isCurrent(searchId)  false once a newer search started (drop that answer).
//   ready('score'|'cost') whether every input of the buildability score / cost estimate settled.
//
// Loaded by a <script> tag in index.html, before the injected modules. It wraps renderSummary
// and renderResults on DOMContentLoaded, after every injected module has added its own wrapper,
// so its placeholders are painted last.
(function (root) {
  const DEBOUNCE_MS = 150;
  const FOLLOWUP_TIMEOUT_MS = 15000;
  const PENDING_TEXT = 'Checking…';
  const TIMEOUT_TEXT = 'Timed out — try again';

  // name: key in `last`, the find* function (looked up on window at call time, so the
  // state-selector.js overrides apply), the time limit, and the data a failure leaves behind
  // (the same fallbacks the old all-at-once handler used).
  const SECTIONS = {
    wells: { fn: 'findWells', ms: 15000, label: 'wells', fallback: () => [] },
    utility: { fn: 'findUtility', ms: 15000, label: 'utility', fallback: () => [] },
    evidence: { fn: 'findListingEvidence', ms: 12000, label: 'listing', fallback: why => ({ status: 'unavailable', matches: [], error: why === 'timeout' ? 'Listing search timed out' : 'Listing evidence search failed' }) },
    flood: { fn: 'findFlood', ms: 20000, label: 'flood', fallback: why => ({ available: false, ...(why === 'timeout' ? { error: 'Timed out', timedOut: true } : {}) }) },
    wetlands: { fn: 'findWetlands', ms: 20000, label: 'wetlands', fallback: why => ({ available: false, ...(why === 'timeout' ? { error: 'Timed out', timedOut: true } : {}) }) },
    zoningPermits: { fn: 'findZoningPermits', ms: 20000, label: 'zoning', fallback: why => ({ available: false, permits: [], zoning: { status: 'unavailable' }, ...(why === 'timeout' ? { error: 'Timed out', timedOut: true } : {}) }) },
    land: { fn: 'findLandAnalysis', ms: 20000, label: 'soil & terrain', fallback: why => ({ available: false, error: why === 'timeout' ? 'Timed out' : 'Land analysis unavailable', soil: { available: false }, terrain: { available: false } }) }
  };
  const SECTION_NAMES = Object.keys(SECTIONS);
  // Inputs of the buildability score (score-cost.js / screening-refinements.js scoreFactors()).
  const SCORE_INPUTS = ['wells', 'utility', 'flood', 'wetlands', 'zoningPermits', 'land'];
  // Follow-up requests whose answers feed the score or the cost estimate.
  const SCORE_FOLLOWUPS = ['powerIntelligence'];
  const COST_FOLLOWUPS = ['existingWell'];
  const FOLLOWUP_LABELS = { powerIntelligence: 'power proximity', existingWell: 'well records' };

  // Where each section shows on the dashboard: snapshot cards (value + status line) and
  // overview facts. Flood and wetlands have no snapshot card; their overview facts are the section.
  const CARDS = {
    wells: [{ card: 'wells', metric: 'wellMetric', status: 'waterStatus', pending: 'Checking nearby well records…' }],
    utility: [{ card: 'power', metric: 'utilityMetric', status: 'powerStatus', pending: 'Checking utility territory…' }],
    evidence: [{ card: 'listing', metric: 'evidenceMetric', status: 'listingStatus', pending: 'Searching public listings…' }],
    zoningPermits: [{ card: 'zoning', metric: 'zoningMetric', status: 'zoningNote', pending: 'Checking the county zoning source…' }],
    land: [
      { card: 'soil', metric: 'soilMetric', status: 'soilStatus', pending: 'Checking USDA soil data…' },
      { card: 'slope', metric: 'slopeMetric', status: 'slopeStatus', pending: 'Checking USGS elevation data…' }
    ]
  };
  const FACTS = {
    wells: ['overviewWellDepth'],
    utility: ['overviewUtility'],
    flood: ['overviewFlood'],
    wetlands: ['overviewWetlands'],
    land: ['overviewSoil', 'overviewAvgGrade']
  };
  // Detail tab -> section.
  const TABS = { wells: 'wells', power: 'utility', listing: 'evidence', soil: 'land', slope: 'land', zoning: 'zoningPermits', permits: 'zoningPermits' };

  const byId = id => document.getElementById(id);
  const isSettled = s => s === 'done' || s === 'failed' || s === 'timeout';

  let searchSeq = 0;
  let run = null; // { id, status: {}, claims: Set, attempts: {}, controllers: Set, renderTimer, dirty, mapDirty, rendered }

  const S = {
    TIMEOUT_TEXT, PENDING_TEXT, SECTIONS, SCORE_INPUTS,
    get searchId() { return run ? run.id : 0; },
    isCurrent(id) { return Boolean(run) && run.id === id; },
    status(name) { return run ? run.status[name] : undefined; },
    placeholder(name) {
      const s = run?.status[name];
      return s === 'pending' || s === 'timeout' ? s : null;
    },
    placeholderText(name) {
      const s = S.placeholder(name);
      return s === 'pending' ? PENDING_TEXT : s === 'timeout' ? TIMEOUT_TEXT : null;
    },
    claim(key) {
      if (!run || run.claims.has(key)) return false;
      run.claims.add(key);
      run.status[key] = 'pending';
      return true;
    },
    settle(key, outcome = 'done') {
      if (!run || run.status[key] !== 'pending') return;
      run.status[key] = outcome;
      if (SCORE_FOLLOWUPS.includes(key) || COST_FOLLOWUPS.includes(key)) {
        run.dirty = true;
        scheduleRender();
      }
    },
    // An AbortSignal that fires after ms (follow-up requests use it as their time limit).
    timeoutSignal(ms = FOLLOWUP_TIMEOUT_MS) {
      if (typeof AbortController !== 'function') return undefined;
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    },
    // Score inputs still unsettled (section labels), or [] when the score can be shown.
    waitingFor(kind = 'score') {
      if (!run) return [];
      const waiting = SCORE_INPUTS.filter(n => !isSettled(run.status[n])).map(n => SECTIONS[n].label);
      const followups = kind === 'cost' ? [...SCORE_FOLLOWUPS, ...COST_FOLLOWUPS] : SCORE_FOLLOWUPS;
      followups.forEach(k => { if (run.status[k] === 'pending') waiting.push(FOLLOWUP_LABELS[k]); });
      return waiting;
    },
    // Ready only after a render has seen the latest settled data (so a follow-up the render
    // would claim, e.g. power intelligence once a utility is found, is counted).
    ready(kind = 'score') {
      if (!run) return true;
      return !run.dirty && S.waitingFor(kind).length === 0;
    },
    timedOut() { return run ? SECTION_NAMES.filter(n => run.status[n] === 'timeout') : []; },
    allSettled() { return Boolean(run) && SECTION_NAMES.every(n => isSettled(run.status[n])); }
  };

  function begin() {
    if (run) {
      clearTimeout(run.renderTimer);
      run.controllers.forEach(c => { try { c.abort(); } catch (_) {} });
    }
    run = { id: ++searchSeq, status: {}, claims: new Set(), attempts: {}, controllers: new Set(), renderTimer: null, dirty: false, mapDirty: false, rendered: false };
    return run;
  }

  function startSection(name) {
    const def = SECTIONS[name];
    const current = run;
    const attempt = (current.attempts[name] || 0) + 1;
    current.attempts[name] = attempt;
    current.status[name] = 'pending';
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) current.controllers.add(controller);
    const parcel = last.parcel;
    let timer;
    const TIMEOUT = {};
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(TIMEOUT), def.ms); });
    let call;
    try { call = Promise.resolve(root[def.fn](parcel, controller?.signal)); } catch (error) { call = Promise.reject(error); }
    const outcome = call.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    return Promise.race([outcome, timeout]).then(result => {
      clearTimeout(timer);
      if (controller) current.controllers.delete(controller);
      // A newer search, or a retry of this section, owns the result now.
      if (run !== current || current.attempts[name] !== attempt) return;
      if (result === TIMEOUT) {
        try { controller?.abort(); } catch (_) {}
        last[name] = def.fallback('timeout');
        current.status[name] = 'timeout';
      } else if (result.ok) {
        last[name] = result.value;
        current.status[name] = 'done';
      } else {
        console.warn(`AcresX ${def.label} lookup failed`, result.error);
        last[name] = def.fallback('error', result.error);
        current.status[name] = 'failed';
      }
      if (name === 'wells') current.mapDirty = true;
      current.dirty = true;
      scheduleRender();
    });
  }

  function scheduleRender(delay = DEBOUNCE_MS) {
    if (!run) return;
    const current = run;
    clearTimeout(current.renderTimer);
    current.renderTimer = setTimeout(() => { if (run === current) renderNow(); }, delay);
  }

  function renderNow() {
    const current = run;
    if (!current || typeof last === 'undefined' || !last?.parcel) return;
    try { renderSummary(last.parcel); } catch (error) { console.error('AcresX summary render failed', error); }
    try {
      if (!current.rendered) renderMap(true);
      else if (current.mapDirty) renderMap(false);
      current.mapDirty = false;
    } catch (error) { console.error('AcresX map render failed', error); }
    current.rendered = true;
    try { if (byId('detailCard')?.classList.contains('show') && typeof renderResults === 'function') renderResults(); } catch (error) { console.error('AcresX detail render failed', error); }
    updateStatusLine();
  }

  function updateStatusLine() {
    const status = byId('status');
    if (!status || !S.allSettled()) return;
    const ev = last.evidence || {};
    const evText = ev.status === 'found' ? `${ev.claims?.length || 0} listing claim${ev.claims?.length === 1 ? '' : 's'}` : ev.status === 'none' ? 'no reliable listing match' : 'listing search unavailable';
    const wells = Array.isArray(last.wells) ? last.wells.length : 0;
    const utility = Array.isArray(last.utility) && last.utility.length;
    const timedOut = S.timedOut().map(n => SECTIONS[n].label);
    status.className = 'status show warning';
    status.textContent = `Analysis complete: parcel boundary loaded, ${wells} nearby well record${wells === 1 ? '' : 's'}, ${utility ? 'likely utility identified' : 'utility not identified'}, ${evText}, FEMA flood, NWI wetland, zoning-source and permit screening complete.${timedOut.length ? ` Timed out: ${timedOut.join(', ')} (use Retry on that section).` : ''}`;
  }

  async function search() {
    const btn = byId('searchBtn');
    const status = byId('status');
    const current = begin();
    btn.disabled = true;
    btn.textContent = 'Analyzing…';
    status.className = 'status show';
    status.textContent = 'Finding parcel…';
    byId('emptyState').style.display = 'none';
    let parcel;
    try {
      parcel = await root.findParcel(byId('county').value, byId('parcel').value);
    } catch (err) {
      if (run !== current) return;
      byId('dashboard').classList.remove('show');
      byId('emptyState').style.display = 'block';
      status.className = 'status show error';
      status.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Analyze property';
      return;
    }
    if (run !== current) return;
    last = { parcel, wells: [], utility: [], evidence: null, flood: null, wetlands: null, zoningPermits: null, land: null };
    root.__acresxLast = last;
    SECTION_NAMES.forEach(startSection);
    byId('dashboard').classList.add('show');
    byId('detailCard').classList.remove('show');
    status.className = 'status show';
    status.textContent = 'Parcel found. Dashboard ready — checking wells, utilities, listing context, hazards, zoning and permits…';
    renderNow();
    btn.disabled = false;
    btn.textContent = 'Analyze property';
    try { root.scrollTo?.({ top: 340, behavior: 'smooth' }); } catch (_) {}
  }

  function retry(name) {
    if (!run || !SECTIONS[name] || run.status[name] !== 'timeout' || typeof last === 'undefined' || !last?.parcel) return;
    startSection(name);
    run.dirty = true;
    renderNow();
  }

  // ---------- Painting placeholders over whatever the other modules rendered ----------

  function addStyles() {
    if (byId('progressiveLoadingStyles')) return;
    const style = document.createElement('style');
    style.id = 'progressiveLoadingStyles';
    style.textContent = `
      .section-pending-text{color:var(--muted)!important;animation:axSectionPulse 1.4s ease-in-out infinite}
      .section-timeout-text{color:var(--amber)!important}
      .snapshot-card.section-timeout{background:var(--amber-bg)!important;border-color:#ead5aa!important}
      .section-retry{display:block;width:max-content;margin:8px 0 0;align-self:flex-start;border:1px solid #d9b46a;background:#fff;color:var(--amber);border-radius:8px;padding:6px 10px;font:800 11px/1 "DM Sans",sans-serif;cursor:pointer}
      .section-retry:hover{background:var(--amber-bg)}
      .property-overview-fact .section-retry{margin-top:4px;padding:4px 8px;font-size:10px}
      .score-updating .score-factor-line,.score-updating .score-constraint{display:none!important}
      .score-updating .metric-value{font-size:30px!important;color:inherit!important}
      .cost-updating .cost-value{opacity:.75}
      .cost-updating .cost-pill{display:none!important}
      @keyframes axSectionPulse{0%,100%{opacity:1}50%{opacity:.5}}
      @media(prefers-reduced-motion:reduce){.section-pending-text{animation:none}}
    `;
    document.head.appendChild(style);
  }

  function markText(el, state, text) {
    if (!el) return;
    if (text != null) el.textContent = text;
    el.classList?.toggle('section-pending-text', state === 'pending');
    el.classList?.toggle('section-timeout-text', state === 'timeout');
  }

  function retryButton(name) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section-retry';
    btn.dataset.section = name;
    btn.textContent = 'Retry';
    btn.setAttribute('aria-label', `Retry ${SECTIONS[name].label}`);
    return btn;
  }

  function setRetry(container, name, show, before) {
    if (!container) return;
    const existing = [...container.querySelectorAll('.section-retry')].filter(b => b.dataset.section === name && b.parentNode === container);
    if (!show) { existing.forEach(b => b.remove()); return; }
    if (existing.length) return;
    const btn = retryButton(name);
    if (before && before.parentNode === container) container.insertBefore(btn, before);
    else container.appendChild(btn);
  }

  function paintSection(name) {
    const state = S.placeholder(name);
    for (const c of CARDS[name] || []) {
      const card = document.querySelector(`.snapshot-card[data-detail="${c.card}"]`);
      markText(byId(c.metric), state, state === 'pending' ? PENDING_TEXT : state === 'timeout' ? 'Timed out' : null);
      markText(byId(c.status), state, state === 'pending' ? c.pending : state === 'timeout' ? TIMEOUT_TEXT : null);
      if (card) {
        card.classList.toggle('section-pending', state === 'pending');
        card.classList.toggle('section-timeout', state === 'timeout');
        if (state) {
          card.classList.remove('snapshot-good', 'snapshot-limited', 'snapshot-bad', 'snapshot-neutral');
          card.classList.add(state === 'timeout' ? 'snapshot-limited' : 'snapshot-neutral');
        }
        // Right after the status line, inside its own container (the zoning card is a grid).
        const statusEl = byId(c.status);
        const holder = statusEl?.parentNode || card;
        setRetry(holder, name, state === 'timeout', statusEl?.nextSibling || null);
      }
    }
    for (const id of FACTS[name] || []) {
      const el = byId(id);
      markText(el, state, state === 'pending' ? PENDING_TEXT : state === 'timeout' ? TIMEOUT_TEXT : null);
      if (el?.parentNode) setRetry(el.parentNode, name, state === 'timeout');
    }
  }

  function paintScore() {
    const card = document.querySelector('.overview-grid .score-card');
    const metric = byId('scoreMetric');
    const note = byId('scoreNote');
    if (S.ready('score')) {
      card?.classList.remove('score-updating');
      metric?.classList.remove('section-pending-text');
      const timedOut = S.timedOut().filter(n => SCORE_INPUTS.includes(n)).map(n => SECTIONS[n].label);
      if (note && timedOut.length) note.textContent = `${note.textContent} · ${timedOut.join(', ')} timed out (scored as unavailable)`;
    } else {
      card?.classList.add('score-updating');
      markText(metric, 'pending', 'Updating…');
      if (note) note.textContent = `Waiting for ${S.waitingFor('score').join(', ') || 'data'}…`;
    }
  }

  function paintCost() {
    const card = byId('developmentCostCard');
    if (!card) return;
    if (S.ready('cost')) { card.classList.remove('cost-updating'); return; }
    card.classList.add('cost-updating');
    const value = card.querySelector('.cost-value');
    const note = card.querySelector('.cost-note');
    markText(value, 'pending', 'Updating…');
    if (note) note.textContent = `Planning range updates once ${S.waitingFor('cost').join(', ') || 'the data'} ${S.waitingFor('cost').length === 1 ? 'has' : 'have'} loaded.`;
    // The cost details would show a partial estimate; they open once the estimate is final.
    card.onclick = null;
    card.onkeydown = null;
  }

  function paint() {
    if (!run || typeof last === 'undefined' || !last?.parcel) return;
    run.dirty = false;
    addStyles();
    SECTION_NAMES.forEach(paintSection);
    paintScore();
    paintCost();
  }

  function paintResults() {
    if (!run || typeof activeTab === 'undefined') return;
    const name = TABS[activeTab];
    const state = name && S.placeholder(name);
    if (!state) return;
    const results = byId('results');
    if (!results) return;
    const label = SECTIONS[name].label;
    results.innerHTML = state === 'pending'
      ? `<div class="notice"><strong>${PENDING_TEXT}</strong><br>Waiting for the ${label} source. This section fills in as soon as it answers.</div>`
      : `<div class="notice"><strong>${TIMEOUT_TEXT}</strong><br>The ${label} source did not answer within ${Math.round(SECTIONS[name].ms / 1000)} seconds. The rest of the report is unaffected. Verify with the responsible agency if it keeps timing out.</div>`;
    if (state === 'timeout') results.appendChild(retryButton(name));
  }

  function wrapRenderers() {
    if (typeof renderSummary === 'function' && !renderSummary.__progressive) {
      const base = renderSummary;
      renderSummary = function (...args) {
        const result = base.apply(this, args);
        try { paint(); } catch (error) { console.error('AcresX section placeholders failed', error); }
        return result;
      };
      renderSummary.__progressive = true;
    }
    if (typeof renderResults === 'function' && !renderResults.__progressive) {
      const base = renderResults;
      const wrapped = function (...args) {
        const result = base.apply(this, args);
        try { paintResults(); } catch (error) { console.error('AcresX detail placeholders failed', error); }
        return result;
      };
      wrapped.__progressive = true;
      renderResults = wrapped;
    }
  }

  document.addEventListener('click', event => {
    const btn = event.target?.closest?.('.section-retry');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    retry(btn.dataset.section);
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrapRenderers);
  else wrapRenderers();

  root.AcresXSections = S;
  root.AcresXProgress = { search, retry, begin, startSection, renderNow, paint, wrapRenderers, DEBOUNCE_MS };
})(typeof window !== 'undefined' ? window : globalThis);
