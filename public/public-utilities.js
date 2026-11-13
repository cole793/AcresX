// Public water and sewer for the report (owner decision 2026-11-09, "Swap to hookups").
//
// The answer of POST /api/public-utilities (src/services/public-utilities.js) is loaded as the
// progressive-loading section `publicUtilities` (public/progressive-loading.js calls
// window.findPublicUtilities) and kept in last.publicUtilities:
//   { water: { status, provider, basis, source, distanceM?, asOf? }, sewer: { ... } }
//   status: served | likely | not_found | unavailable
//
// window.AcresXUtilities is the single source of truth for what that answer changes. The score
// and cost modules (score-cost.js, screening-refinements.js, local-cost-model.js, index.html
// renderSummary, property-report-v2.js through the cost calculators) call it at render time and
// keep their old behaviour when it has not loaded.
// - Water served or likely: the water factor scores SCORE.served (92) or SCORE.likely (85), and the
//   well cost line becomes "Water connection" WATER_COST ($3k-$15k).
// - Sewer served or likely: the septic factor scores the same, and the septic line becomes
//   "Sewer connection" SEWER_COST ($4k-$20k).
// - not_found, unavailable, timed out or not loaded: wells and soil decide, as before.
// Water and sewer are independent (public water without sewer keeps the septic line).
// Scale: the water factor is 92 for nearby wells <= 200 ft deep, 76 for <= 400 ft, 55 deeper, 40
// with no depths; septic is 92 for favorable soil, 66 moderate, 38 limited, 50 unavailable. A
// mapped public connection is as good as the best private case, so served = 92; likely (main
// 30-100 m away, a district polygon outside city limits, city limits without a utility map, a
// planning area) is a notch lower, 85, still
// above a moderate well or soil.
// Costs: a planning allowance for the connection/capacity (system development) fee plus a
// service line or side sewer from the street, not a fee lookup. Rural wells here run $14k-$50k
// and septic $12k-$45k in the same model; city hookups are a fraction of that but vary by
// district and meter size, hence the wide range and the basis "connection/capacity fees vary;
// check the city or district fee schedule".
// Listing/MLS data never feeds any of this.
// Loaded through maybeInjectUiPolish() (src/index.js), after the score and cost modules, so its
// renderSummary wrapper paints the water/septic cards last.
(function (root) {
  const SCORE = Object.freeze({ served: 92, likely: 85 });
  const WATER_COST = Object.freeze({ low: 3000, high: 15000 });
  const SEWER_COST = Object.freeze({ low: 4000, high: 20000 });
  const FEE_BASIS = 'connection/capacity fees vary; check the city or district fee schedule';
  const VERIFY = 'verify with the city/district';
  const PUBLIC = new Set(['served', 'likely']);
  const NOUN = { water: 'water', sewer: 'sewer' };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const current = l => (l !== undefined ? l : typeof last !== 'undefined' ? last : root.__acresxLast);

  // The served/likely finding for a service, or null (not found, unavailable, not loaded yet).
  function finding(service, l) {
    const f = current(l)?.publicUtilities?.[service];
    return f && PUBLIC.has(f.status) ? f : null;
  }

  function pending() {
    const S = root.AcresXSections;
    return S ? S.placeholder('publicUtilities') : null;
  }

  // The owner's wording: inside a service area or next to a main is 'likely available' (still to be
  // verified); a main a block away or city limits without a map is 'may be available'.
  const statusPhrase = f => (f.status === 'served' ? 'likely available' : 'may be available');

  // "Public water: available — City of Spokane" / "Public sewer: not found" / "Checking…"
  function line(service, l) {
    const label = `Public ${NOUN[service]}`;
    const p = pending();
    if (p) return `${label}: ${p === 'pending' ? 'checking…' : 'timed out'}`;
    const raw = current(l)?.publicUtilities?.[service];
    if (!raw) return `${label}: not checked`;
    const f = finding(service, l);
    if (f) return `${label}: ${statusPhrase(f)}${f.provider ? ` — ${f.provider}` : ''}`;
    return `${label}: ${raw.status === 'not_found' ? 'not found' : 'not checked (source unavailable)'}`;
  }

  function overviewText(l) {
    const p = pending();
    if (p) return p === 'pending' ? 'Checking…' : 'Timed out — try again';
    if (!current(l)?.publicUtilities) return 'Not checked';
    const any = finding('water', l) || finding('sewer', l);
    return `${line('water', l)} · ${line('sewer', l)}${any ? ` — ${VERIFY}` : ''}`;
  }

  function costLine(service, base, l) {
    const f = finding(service, l);
    if (!f) return base;
    const range = service === 'water' ? WATER_COST : SEWER_COST;
    return {
      ...(base && typeof base === 'object' ? base : {}),
      low: range.low, high: range.high,
      label: service === 'water' ? 'Water connection' : 'Sewer connection',
      basis: `Public ${NOUN[service]} ${statusPhrase(f)}${f.provider ? ` (${f.provider})` : ''}: ${f.basis}. Replaces the private ${service === 'water' ? 'well' : 'septic'} allowance; ${FEE_BASIS}. Planning range, not a quote — ${VERIFY}.`,
      confidence: 'Low',
      publicUtility: f.status
    };
  }

  function grade(service, l) {
    const f = finding(service, l);
    if (!f) return null;
    return {
      score: SCORE[f.status],
      label: f.status === 'served' ? `Public ${NOUN[service]}` : `Public ${NOUN[service]} likely`,
      cls: 'green',
      detail: `Public ${NOUN[service]} ${statusPhrase(f)}${f.provider ? ` — ${f.provider}` : ''} · ${VERIFY}`
    };
  }

  const U = {
    SCORE, WATER_COST, SEWER_COST, FEE_BASIS,
    water: l => finding('water', l),
    sewer: l => finding('sewer', l),
    waterScore: (base, l) => { const f = finding('water', l); return f ? SCORE[f.status] : base; },
    septicScore: (base, l) => { const f = finding('sewer', l); return f ? SCORE[f.status] : base; },
    waterCost: (base, l) => costLine('water', base, l),
    sewerCost: (base, l) => costLine('sewer', base, l),
    waterGrade: l => grade('water', l),
    sewerGrade: l => grade('sewer', l),
    line, overviewText
  };

  // ---- Loading (progressive-loading.js section `publicUtilities`).

  function parcelPoint(parcel) {
    try { if (typeof zoningPoint === 'function') return zoningPoint(parcel); } catch (_) {}
    try { if (typeof turf !== 'undefined') return turf.centroid(parcel).geometry.coordinates; } catch (_) {}
    return null;
  }

  async function findPublicUtilities(parcel, signal) {
    const p = parcel?.properties || {};
    const point = parcelPoint(parcel);
    const unavailable = why => ({ available: false, error: why, water: { status: 'unavailable', basis: why }, sewer: { status: 'unavailable', basis: why } });
    if (!point) return unavailable('Parcel location unavailable');
    try {
      const response = await fetch('/api/public-utilities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ state: String(p._stateCode || 'WA').toUpperCase(), county: p._countyDisplay || p.COUNTY_NM || '', lat: point[1], lon: point[0], geometry: parcel.geometry })
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || `Public utilities returned ${response.status}`);
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return unavailable(error?.message || 'Public water/sewer lookup failed');
    }
  }

  // ---- Painting

  function addStyles() {
    if (document.getElementById('publicUtilitiesStyles')) return;
    const style = document.createElement('style');
    style.id = 'publicUtilitiesStyles';
    style.textContent = '.public-utilities-detail .notice{margin-bottom:10px}.public-utilities-private{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px}';
    document.head?.appendChild(style);
  }

  function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

  function paintCards() {
    if (pending()) return;
    for (const [service, prefix, noteId, privateWord] of [['water', 'water', 'wellNote', 'well'], ['sewer', 'soil', 'soilNote', 'septic system']]) {
      const g = grade(service);
      if (!g) continue;
      const dot = document.getElementById(`${prefix}Dot`);
      if (dot) dot.className = `traffic-dot ${g.cls}`;
      setText(`${prefix}Grade`, g.label);
      setText(`${prefix}Status`, g.detail);
      const note = document.getElementById(noteId);
      if (note && !/^If a private /.test(note.textContent || '')) note.textContent = `If a private ${privateWord} were needed: ${note.textContent || 'see details'}`;
      const card = document.querySelector(`.snapshot-card[data-detail="${service === 'water' ? 'wells' : 'soil'}"]`);
      if (card) { card.classList.remove('snapshot-limited', 'snapshot-bad', 'snapshot-neutral'); card.classList.add('snapshot-good'); }
    }
  }

  function detailBlock(service) {
    const raw = current()?.publicUtilities?.[service];
    const f = finding(service);
    const head = line(service);
    const p = pending();
    const body = p ? 'Waiting for the public water/sewer maps.'
      : !raw ? 'Public water/sewer maps were not checked.'
      : f ? `Public ${NOUN[service]} ${statusPhrase(f)} — ${VERIFY}. ${raw.basis || ''}${raw.asOf ? ` (map as of ${raw.asOf})` : ''}.`
      : raw.status === 'not_found' ? `${raw.basis || 'No public service area or main was found near the parcel.'} A private ${service === 'water' ? 'well' : 'septic system'} is likely needed; verify with the county.`
      : `${raw.basis || 'The public water/sewer source did not answer.'} The private ${service === 'water' ? 'well' : 'septic'} screening below applies.`;
    const link = raw?.source?.url && !p ? `<br><a href="${esc(raw.source.url)}" target="_blank" rel="noopener">Open ${esc(raw.source.name || 'source map')} ↗</a>` : '';
    const block = document.createElement('div');
    block.className = 'public-utilities-detail';
    block.innerHTML = `<div class="notice"><strong>${esc(head)}</strong><br>${esc(body)}${link}</div>${f ? `<div class="public-utilities-private">If a private ${service === 'water' ? 'well' : 'septic system'} were needed</div>` : ''}`;
    return block;
  }

  function paintDetails() {
    if (typeof activeTab === 'undefined' || (activeTab !== 'wells' && activeTab !== 'soil')) return;
    const results = document.getElementById('results');
    if (!results) return;
    results.querySelectorAll('.public-utilities-detail').forEach(el => el.remove());
    results.insertBefore(detailBlock(activeTab === 'wells' ? 'water' : 'sewer'), results.firstChild);
  }

  addStyles();
  root.AcresXUtilities = U;
  root.findPublicUtilities = findPublicUtilities;

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      try { paintCards(); } catch (error) { console.error('AcresX public utilities paint failed', error); }
      return result;
    };
  }
  if (typeof renderResults === 'function') {
    const base = renderResults;
    renderResults = function (...args) {
      const result = base.apply(this, args);
      try { paintDetails(); requestAnimationFrame(() => { try { paintDetails(); } catch (_) {} }); } catch (error) { console.error('AcresX public utilities details failed', error); }
      return result;
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
