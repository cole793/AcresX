// Public water and sewer for the report (owner decision 2026-11-09, "Swap to hookups", narrowed by
// the owner bug of 2026-11-15).
//
// The answer of POST /api/public-utilities (src/services/public-utilities.js) is loaded as the
// progressive-loading section `publicUtilities` (public/progressive-loading.js calls
// window.findPublicUtilities) and kept in last.publicUtilities:
//   { water: { status, provider, basis, source, distanceM?, asOf?, cityLimits? }, sewer: { ... } }
//   status: served | likely | not_found | unavailable
//
// window.AcresXUtilities is the single source of truth for what that answer changes. The score
// and cost modules (score-cost.js, screening-refinements.js, local-cost-model.js, index.html
// renderSummary, property-report-v2.js through the cost calculators) call it at render time and
// keep their old behaviour when it has not loaded.
// - Water served: the water factor scores SCORE.served (92), and the well cost line becomes
//   "Water connection" WATER_COST ($3k-$15k). Sewer served: the same for septic, SEWER_COST
//   ($4k-$20k).
// - Water or sewer likely (owner bug 2026-11-15: a Yellowstone parcel outside Billings was
//   "likely" and priced as a city connection while its listing said no public water or sewer):
//   NOT counted. The water/septic factors score from wells and soil exactly as for not_found, and
//   the private well/septic stays the primary cost line. The connection is attached to that line
//   as `alternative` ("If public water (City of X) can serve the parcel: water connection
//   ~$3k-$15k instead of the well — confirm with City of X."), shown on the dashboard cost card,
//   the cost details and report page 3, and never added to the total. Outside city limits a city
//   system's alternative says city service usually requires annexation or an extension agreement.
//   (Before 2026-11-15 "likely" scored 85 and swapped the cost line.)
// - not_found, unavailable, timed out or not loaded: wells and soil decide, as before.
// Water and sewer are independent (public water without sewer keeps the septic line).
// Scale: the water factor is 92 for nearby wells <= 200 ft deep, 76 for <= 400 ft, 55 deeper, 40
// with no depths; septic is 92 for favorable soil, 66 moderate, 38 limited, 50 unavailable. A
// mapped public connection is as good as the best private case, so served = 92.
// Costs: a planning allowance for the connection/capacity (system development) fee plus a
// service line or side sewer from the street, not a fee lookup. Rural wells here run $14k-$50k
// and septic $12k-$45k in the same model; city hookups are a fraction of that but vary by
// district and meter size, hence the wide range and the basis "connection/capacity fees vary;
// check the city or district fee schedule".
// Listing/MLS data never feeds the score or the cost choice. When a matched listing says there is
// no public water/sewer (or names a well/septic), listingNote() shows it as an unverified note
// next to the utilities and the cost (claims parsed by public/mls-description-scanner.js).
// Loaded through maybeInjectUiPolish() (src/index.js), after the score and cost modules, so its
// renderSummary wrapper paints the water/septic cards last.
(function (root) {
  // The score rule (served replaces the factor with SCORE.served; likely never counts) is in
  // score-core.js (window.AcresXScoreCore.utilities, loaded before this file).
  const C = root.AcresXScoreCore;
  if (!C) throw new Error('AcresX: public/score-core.js must load before public-utilities.js');
  const SCORE = C.utilities.SCORE;
  const WATER_COST = Object.freeze({ low: 3000, high: 15000 });
  const SEWER_COST = Object.freeze({ low: 4000, high: 20000 });
  const FEE_BASIS = 'connection/capacity fees vary; check the city or district fee schedule';
  const VERIFY = 'verify with the city/district';
  const SHOWN = new Set(['served', 'likely']);
  const NOUN = { water: 'water', sewer: 'sewer' };
  const PRIVATE = { water: 'well', sewer: 'septic system' };
  const ANNEX = 'Outside city limits, city service usually requires annexation or an extension agreement.';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const current = l => (l !== undefined ? l : typeof last !== 'undefined' ? last : root.__acresxLast);
  const k = n => `$${Math.round(Number(n || 0) / 1000)}k`;

  const raw = (service, l) => current(l)?.publicUtilities?.[service] || null;
  // The finding that counts (score and primary cost): served only.
  const finding = (service, l) => C.utilities.finding(service, current(l));
  // A "likely" finding: shown as context and as the alternative cost line, never counted.
  function likely(service, l) {
    const f = raw(service, l);
    return f && f.status === 'likely' ? f : null;
  }

  function pending() {
    const S = root.AcresXSections;
    return S ? S.placeholder('publicUtilities') : null;
  }

  // The owner's wording: inside a service area or next to a main is 'likely available' (still to be
  // verified); a main a block away, a district outside city limits or city limits without a map
  // is 'may be available'.
  const statusPhrase = f => (f.status === 'served' ? 'likely available' : 'may be available');
  const isCity = f => /^(city|town) of /i.test(String(f?.provider || ''));
  const who = f => String(f?.provider || 'the city or district').replace(/\s*\(.*?\)\s*$/, '');

  // "Public water: likely available — City of Spokane" / "Public sewer: not found" / "Checking…"
  function line(service, l) {
    const label = `Public ${NOUN[service]}`;
    const p = pending();
    if (p) return `${label}: ${p === 'pending' ? 'checking…' : 'timed out'}`;
    const f = raw(service, l);
    if (!f) return `${label}: not checked`;
    if (SHOWN.has(f.status)) return `${label}: ${statusPhrase(f)}${f.provider ? ` — ${f.provider}` : ''}`;
    return `${label}: ${f.status === 'not_found' ? 'not found' : 'not checked (source unavailable)'}`;
  }

  function overviewText(l) {
    const p = pending();
    if (p) return p === 'pending' ? 'Checking…' : 'Timed out — try again';
    if (!current(l)?.publicUtilities) return 'Not checked';
    const any = SHOWN.has(raw('water', l)?.status) || SHOWN.has(raw('sewer', l)?.status);
    const note = listingNote(l);
    return `${line('water', l)} · ${line('sewer', l)}${any ? ` — ${VERIFY}` : ''}${note ? ` · ${note}` : ''}`;
  }

  // "If public water (City of Billings) can serve the parcel: water connection ~$3k–$15k instead
  // of the well — confirm with City of Billings." + the annexation sentence outside city limits.
  function alternativeText(service, f, low, high) {
    const name = who(f);
    const outside = isCity(f) && f.cityLimits && f.cityLimits !== 'inside';
    return `If public ${NOUN[service]}${f.provider ? ` (${f.provider})` : ''} can serve the parcel: ${NOUN[service]} connection ~${k(low)}–${k(high)} instead of the ${PRIVATE[service]} — confirm with ${name}.${outside ? ` ${ANNEX}` : ''}`;
  }

  // The connection alternative for a likely finding, or null. range: { low, high } (default: the
  // generic connection range); extra: fields from the caller (published fee sources).
  function alternative(service, l, range, extra = {}) {
    const f = likely(service, l);
    if (!f) return null;
    const r = range || (service === 'water' ? WATER_COST : SEWER_COST);
    return {
      service, status: 'likely', provider: f.provider || null, cityLimits: f.cityLimits || null,
      low: r.low, high: r.high, label: service === 'water' ? 'Water connection (alternative)' : 'Sewer connection (alternative)',
      text: alternativeText(service, f, r.low, r.high),
      basis: `Public ${NOUN[service]} may be available (${f.basis}); not counted in the total or the score.`,
      ...extra
    };
  }

  function costLine(service, base, l) {
    const f = finding(service, l);
    if (!f) {
      const alt = alternative(service, l);
      return alt && base && typeof base === 'object' ? { ...base, alternative: alt } : base;
    }
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
      label: `Public ${NOUN[service]}`,
      cls: 'green',
      detail: `Public ${NOUN[service]} ${statusPhrase(f)}${f.provider ? ` — ${f.provider}` : ''} · ${VERIFY}`
    };
  }

  // ---- Listing context (unverified; never feeds the score or the cost choice)

  // What a matched listing says about public water/sewer: { water: bool, sewer: bool, wellSeptic:
  // bool, phrase, source } or null. Reads the accepted RESO listing's remarks
  // (reso-listing-context.js, last.resoListings.best) and, when the web listing search found a
  // listing (last.evidence.status 'found'), its result snippets, through the claim rules in
  // public/mls-description-scanner.js (window.__acresxScanMlsRemarks).
  function listingClaims(l) {
    const scan = root.__acresxScanMlsRemarks;
    const d = current(l);
    if (typeof scan !== 'function' || !d) return null;
    const texts = [];
    const best = d.resoListings?.best;
    if (best) texts.push({ text: best.publicRemarks || best.PublicRemarks || '', source: 'MLS listing remarks' });
    if (d.evidence?.status === 'found') for (const m of d.evidence.matches || []) texts.push({ text: `${m.title || ''}. ${m.snippet || ''}`, source: 'listing search result' });
    for (const t of texts) {
      let claims = [];
      try { claims = scan(t.text)?.utilities || []; } catch { claims = []; }
      if (!claims.length) continue;
      const has = c => claims.some(x => x.claim === c);
      const both = has('no_public_water_sewer');
      return { water: both || has('no_public_water'), sewer: both || has('no_public_sewer'), wellSeptic: has('well_septic'), phrase: claims[0].phrase, source: t.source };
    }
    return null;
  }

  // "Listing says: no public water or sewer (unverified)" / "... no public sewer ..." /
  // "Listing says: well and septic (unverified)"; '' when no matched listing says either.
  function listingNote(l) {
    const c = listingClaims(l);
    if (!c) return '';
    const none = c.water && c.sewer ? 'no public water or sewer' : c.water ? 'no public water' : c.sewer ? 'no public sewer' : '';
    const what = [none, c.wellSeptic ? 'well and septic' : ''].filter(Boolean).join('; ');
    return what ? `Listing says: ${what} (unverified)` : '';
  }

  const U = {
    SCORE, WATER_COST, SEWER_COST, FEE_BASIS, ANNEX,
    water: l => finding('water', l),
    sewer: l => finding('sewer', l),
    likely: (service, l) => likely(service, l),
    alternative, alternativeText,
    waterScore: (base, l) => C.utilities.waterScore(base, current(l)),
    septicScore: (base, l) => C.utilities.septicScore(base, current(l)),
    waterCost: (base, l) => costLine('water', base, l),
    sewerCost: (base, l) => costLine('sewer', base, l),
    waterGrade: l => grade('water', l),
    sewerGrade: l => grade('sewer', l),
    listingClaims, listingNote,
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
    style.textContent = '.public-utilities-detail .notice{margin-bottom:10px}.public-utilities-private{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px}.public-utilities-listing{color:#8a5a00;font-weight:700}';
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
    const f0 = current()?.publicUtilities?.[service];
    const f = finding(service), maybe = likely(service);
    const head = line(service);
    const p = pending();
    const privateWord = service === 'water' ? 'well' : 'septic system';
    const alt = maybe ? alternative(service) : null;
    const body = p ? 'Waiting for the public water/sewer maps.'
      : !f0 ? 'Public water/sewer maps were not checked.'
      : f ? `Public ${NOUN[service]} ${statusPhrase(f)} — ${VERIFY}. ${f0.basis || ''}${f0.asOf ? ` (map as of ${f0.asOf})` : ''}.`
      : maybe ? `${f0.basis || ''}${f0.asOf ? ` (map as of ${f0.asOf})` : ''}. Not confirmed, so the private ${privateWord} is priced and scored below. ${alt.text}`
      : f0.status === 'not_found' ? `${f0.basis || 'No public service area or main was found near the parcel.'} A private ${privateWord} is likely needed; verify with the county.`
      : `${f0.basis || 'The public water/sewer source did not answer.'} The private ${service === 'water' ? 'well' : 'septic'} screening below applies.`;
    const note = p ? '' : listingNote();
    const link = f0?.source?.url && !p ? `<br><a href="${esc(f0.source.url)}" target="_blank" rel="noopener">Open ${esc(f0.source.name || 'source map')} ↗</a>` : '';
    const block = document.createElement('div');
    block.className = 'public-utilities-detail';
    block.innerHTML = `<div class="notice"><strong>${esc(head)}</strong><br>${esc(body)}${note ? `<br><span class="public-utilities-listing">${esc(note)}</span>` : ''}${link}</div>${f ? `<div class="public-utilities-private">If a private ${privateWord} were needed</div>` : ''}`;
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
