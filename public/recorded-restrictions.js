// "Recorded restrictions" card (Zoning & Permits section) and its details, from
// POST /api/recorded-restrictions (src/services/recorded-restrictions.js). The answer is kept in
// last.recordedRestrictions; window.AcresXRestrictions.describe() turns it into the lines the card,
// the details panel and the printable report (public/property-report-v2.js, page 3) show.
//
// What it shows (free official data only):
// - the plat: recorded subdivision / short plat / certificate of survey with its name, record or
//   recording number, block, lot, plat image or property record link; or "not in a recorded plat".
//   A platted parcel always gets "Platted subdivision: likely has recorded covenants (CC&Rs) and
//   plat easements; review the plat and covenants."
// - Spokane recorded development agreements, mapped conservation easements (PAD-US 4.1, Montana
//   State Library, Stevens County) with the share of the parcel covered.
// - flags the page already has (no new request): private road / road status not mapped / nearest
//   public road (last.costContext.roadAccess), a transmission line crossing the parcel
//   (last.powerIntelligence.transmissionLine, 0 ft), mapped wetland buffers
//   (last.buildableArea.mayAlsoRestrict).
// - MLS association fields (AssociationYN, AssociationFee) when the matched listing has them, as
//   "Listing says HOA: … (unverified)".
// - the county's free recorder search and "Order a preliminary title report — it lists recorded
//   easements, covenants (CC&Rs) and HOA". It never says there are no restrictions.
// Screening info only: nothing here feeds the buildability score or the cost estimate.
// Loaded through maybeInjectUiPolish() (src/index.js), before browser-fallback.js.
(function (root) {
  let requestId = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const current = () => { try { return typeof last !== 'undefined' && last ? last : root.__acresxLast || null; } catch { return root.__acresxLast || null; } };
  const num = v => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const feet = n => `${Math.round(n).toLocaleString('en-US')} ft`;
  const TITLE_LINE = 'Order a preliminary title report — it lists recorded easements, covenants (CC&Rs) and HOA.';
  const PLATTED_NOTE = 'Platted subdivision: likely has recorded covenants (CC&Rs) and plat easements; review the plat and covenants.';

  // Links are shown only for https pages on the hosts the Worker returns them for.
  const HOSTS = new Set(['recording.spokanecounty.org', 'selfservice.stevenscountywa.gov', 'recorder.kcgov.us', 'crdocs.yellowstonecountymt.gov',
    'eagleweb.gallatin.mt.gov', 'ftp.gallatin.mt.gov', 'svc.mt.gov']);
  function safeUrl(value) {
    try { const u = new URL(String(value || '')); return u.protocol === 'https:' && HOSTS.has(u.hostname) && !u.username && !u.port ? u.href : ''; } catch { return ''; }
  }
  // "HARVEY SUBD" -> "Harvey Subd"; mixed case kept.
  const titleCase = s => { s = String(s || '').trim(); return s && s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Cos|Sp|Bsp)\b/g, w => w.toUpperCase()) : s; };

  // Flags from data the page already loaded.
  function flags(data) {
    const out = [];
    const ra = data?.costContext?.roadAccess;
    if (ra?.available && ra.status === 'found' && ra.road?.public === false) {
      const unknown = ra.road?.ownership === 'unknown';
      const near = ra.nearestPublic && num(ra.nearestPublic.distanceFt) != null ? `Nearest public road: ${ra.nearestPublic.road?.name || 'unnamed'} at ${feet(ra.nearestPublic.distanceFt)}.` : 'No public road mapped nearby.';
      out.push({ title: unknown ? 'Road status not mapped' : 'Access is by a private road', detail: `${ra.road?.name ? `${ra.road.name}: ` : ''}${near} Confirm a recorded access easement and any road maintenance agreement.` });
    } else if (ra?.available && ra.status === 'none_within') {
      out.push({ title: 'No mapped road nearby', detail: 'Confirm legal access (a recorded easement) before buying.' });
    }
    const t = data?.powerIntelligence?.transmissionLine;
    if (t?.available && num(t.distanceFt) === 0) {
      out.push({ title: 'Transmission line crosses the parcel', detail: `${t.voltageKv ? `${t.voltageKv} kV line. ` : ''}High-voltage lines usually sit in a recorded utility easement that limits building under them; check the title report.` });
    }
    const b = data?.buildableArea;
    const buffer = (Array.isArray(b?.mayAlsoRestrict) ? b.mayAlsoRestrict : []).find(r => /buffer/i.test(r?.reason || '')) || null;
    if (buffer) out.push({ title: 'Mapped wetland buffer', detail: `About ${num(buffer.acres) != null ? Number(buffer.acres).toFixed(1) : '?'} ac may be restricted by a critical-area buffer (a county rule, not a recorded easement); the buffer depends on a wetland delineation.` });
    return out;
  }

  // MLS association fields from the matched listing (unverified context, never scored).
  function hoa(data) {
    const listing = data?.resoListings || data?.listingContext || {};
    const rec = listing.best || listing.match || null;
    if (!rec) return null;
    const pickField = key => rec[key] ?? rec.raw?.[key] ?? null;
    const yn = pickField('AssociationYN');
    const fee = num(pickField('AssociationFee'));
    const freq = String(pickField('AssociationFeeFrequency') || '').trim();
    const yes = yn === true || /^(y|yes|true)$/i.test(String(yn ?? ''));
    const no = yn === false || /^(n|no|false)$/i.test(String(yn ?? ''));
    if (!yes && !no && fee == null) return null;
    const feeText = fee != null && fee > 0 ? `, fee $${Math.round(fee).toLocaleString('en-US')}${freq ? ` ${freq.toLowerCase()}` : ''}` : '';
    return `Listing says HOA: ${yes || (fee != null && fee > 0) ? 'yes' : 'no'}${feeText} (unverified)`;
  }

  function platLines(p) {
    if (!p) return { head: 'Plat record not available', lines: [] };
    const name = titleCase(p.name || '');
    const parts = [p.block ? `Block ${p.block}` : '', p.lot ? `Lot ${p.lot}` : '', p.tract ? `Tract ${p.tract}` : ''].filter(Boolean).join(' · ');
    let head = p.label || 'Plat status not determined';
    if (p.status === 'platted' || p.status === 'surveyed') head = `${p.label}${name && !/^Certificate of Survey/i.test(name) ? `: ${name}` : p.record ? `: ${p.record}` : ''}`;
    if (p.kind === 'mining_claim' && p.record) head = `${p.label}: ${p.record}`;
    const lines = [];
    if (parts) lines.push(parts);
    const refs = [p.record && !head.includes(p.record) ? `Record ${p.record}` : '', p.recordingNumber ? `Auditor recording no. ${p.recordingNumber}` : '', p.platBook ? `Plat book ${p.platBook}` : '',
      p.recordedDate ? `recorded ${p.recordedDate}` : '', p.surveyDate ? `surveyed ${p.surveyDate}` : ''].filter(Boolean);
    if (refs.length) lines.push(refs.join(' · '));
    if (p.amended) lines.push(`Amended plat: ${p.amended}`);
    if (p.legalDescription) lines.push(`Legal: ${p.legalDescription}`);
    return { head, lines };
  }

  // Answer + page data -> what the card, details and report show.
  function describe(answer, data = current() || {}) {
    const a = answer && typeof answer === 'object' ? answer : null;
    const p = a?.plat || null;
    const plat = platLines(p);
    const agreements = (Array.isArray(a?.agreements) ? a.agreements : []).map(x => ({
      title: `Recorded development agreement${x.fileNumber ? ` ${x.fileNumber}` : ''}`,
      detail: [x.recordingNumber ? `recording no. ${x.recordingNumber}` : '', x.recordingDate ? `recorded ${x.recordingDate}` : '', x.zoneClass ? `zone ${x.zoneClass}` : '', x.sharePct != null ? `covers about ${x.sharePct}% of the parcel` : ''].filter(Boolean).join(' · ')
    }));
    const ce = a?.conservationEasements || null;
    const easements = (Array.isArray(ce?.items) ? ce.items : []).map(e => ({
      title: e.name || 'Conservation easement',
      detail: [e.holder ? `held by ${e.holder}` : e.holderType ? `holder: ${e.holderType}` : '', e.deedRef ? `recording ref. ${e.deedRef}` : '', e.date ? `as of ${e.date}` : '', e.sharePct != null ? `covers about ${e.sharePct}% of the parcel` : '', e.source || ''].filter(Boolean).join(' · ')
    }));
    const easementLine = easements.length ? `Conservation easement mapped (${easements.length})`
      : ce?.status === 'none' ? 'No conservation easement mapped (PAD-US 4.1; not proof there is none)'
      : ce?.status === 'none_partial' ? 'No conservation easement mapped in the sources that answered'
      : 'Conservation easement check not available';
    const links = [];
    const recorder = a?.recorder && safeUrl(a.recorder.url) ? { label: a.recorder.label, url: safeUrl(a.recorder.url) } : null;
    if (recorder) links.push(recorder);
    for (const l of [...(p?.imageLinks || []), p?.propertyCard].filter(Boolean)) if (safeUrl(l.url)) links.push({ label: l.label, url: safeUrl(l.url) });
    const notes = (Array.isArray(a?.notes) ? a.notes : []).filter(n => typeof n === 'string' && n.trim());
    if (p?.status === 'platted' && !notes.includes(PLATTED_NOTE)) notes.unshift(PLATTED_NOTE);
    const sources = (Array.isArray(a?.sources) ? a.sources : []).filter(s => s?.name);
    const fl = flags(data);
    const metric = !a ? 'Checking…' : p?.status === 'platted' ? 'Platted' : p?.status === 'surveyed' ? 'Surveyed (COS)' : p?.kind === 'mining_claim' ? 'Mining claim' : p?.status === 'unplatted' ? 'Not platted' : 'Review title';
    const count = agreements.length + easements.length + fl.length;
    return {
      status: a?.status || null, available: Boolean(a?.available), metric,
      headline: plat.head, platLines: plat.lines, platted: p?.status === 'platted',
      agreements, easements, easementLine, easementStatus: ce?.status || null, flags: fl, hoa: hoa(data), links, title: a?.title || TITLE_LINE, notes,
      summary: count ? `${count} item${count === 1 ? '' : 's'} to review · title report recommended` : 'Recorder search and title report',
      sources: sources.map(s => ({ name: s.name, ok: s.status !== 'unavailable', skipped: s.status === 'skipped' })),
      asOf: a?.asOf || null
    };
  }

  function ensureStyles() {
    if (document.getElementById('restrictionsStyles')) return;
    const style = document.createElement('style');
    style.id = 'restrictionsStyles';
    style.textContent = '.restrictions-detail ul{margin:6px 0 0;padding-left:18px}.restrictions-detail li{margin:4px 0;line-height:1.4}.restrictions-detail .r-muted{color:var(--muted);font-size:12px}.restrictions-detail a{text-decoration:underline}';
    document.head.appendChild(style);
  }

  function cardEl() {
    const grid = document.querySelector('.zoning-grid');
    if (!grid) return null;
    let card = grid.querySelector('.snapshot-card[data-detail="restrictions"]');
    if (!card) {
      card = document.createElement('article');
      card.className = 'card snapshot-card horizontal';
      card.dataset.detail = 'restrictions';
      const el = (tag, cls, textValue, id) => { const node = document.createElement(tag); if (cls) node.className = cls; if (id) node.id = id; if (textValue) node.textContent = textValue; return node; };
      const content = el('div');
      content.appendChild(el('strong', '', 'Recorded restrictions'));
      content.appendChild(el('div', 'snapshot-value compact', '—', 'restrictionsMetric'));
      content.appendChild(el('span', '', 'Plat, easements and title review', 'restrictionsNote'));
      card.appendChild(el('span', 'snapshot-icon', '📜'));
      card.appendChild(content);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'snapshot-details-btn';
      btn.textContent = 'Details';
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Show recorded restrictions details');
      card.appendChild(btn);
      card.addEventListener('click', event => { if (!event.target.closest('.snapshot-details-btn, a')) btn.click(); });
      grid.appendChild(card);
    }
    return card;
  }

  function renderCard(answer, pending) {
    const card = cardEl();
    if (!card) return;
    const d = describe(answer);
    const metric = document.getElementById('restrictionsMetric'), note = document.getElementById('restrictionsNote');
    if (metric) metric.textContent = pending ? 'Checking…' : answer ? d.metric : 'Not available';
    if (note) note.textContent = pending ? 'Plat, easements and title review' : answer ? `${d.headline}. ${d.summary}` : 'Recorder search and title report recommended';
  }

  const list = items => (items.length ? `<ul>${items.map(x => `<li><strong>${esc(x.title)}</strong>${x.detail ? `<br><span class="r-muted">${esc(x.detail)}</span>` : ''}</li>`).join('')}</ul>` : '');
  function detailHtml(answer, data = current() || {}) {
    const d = describe(answer, data);
    if (!answer) return '<div class="notice">Recorded restrictions are still loading or not available. Search the county recorder and order a preliminary title report to review easements, covenants (CC&Rs) and HOA.</div>';
    const links = d.links.map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a></li>`).join('');
    const failed = d.sources.filter(s => !s.ok).map(s => s.name);
    return `<div class="restrictions-detail">
<div class="result-item"><div class="result-top"><h4>${esc(d.headline)}</h4><span class="badge">Verify</span></div>${d.platLines.map(l => `<p class="r-muted">${esc(l)}</p>`).join('')}</div>
${d.agreements.length ? `<div class="result-item"><h4>Recorded agreements</h4>${list(d.agreements)}</div>` : ''}
<div class="result-item"><h4>${esc(d.easementLine)}</h4>${list(d.easements)}</div>
${d.flags.length ? `<div class="result-item"><h4>Likely easements to check</h4>${list(d.flags)}</div>` : ''}
${d.hoa ? `<div class="notice">${esc(d.hoa)}. Listing claims do not affect the buildability score.</div>` : ''}
<div class="notice"><strong>${esc(d.title)}</strong>${d.notes.length ? `<ul>${d.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>
${links ? `<div class="result-item"><h4>Records</h4><ul>${links}</ul></div>` : ''}
${failed.length ? `<p class="r-muted">Did not answer: ${esc(failed.join(', '))}.</p>` : ''}
<p class="r-muted">Screening information from public GIS records${d.asOf ? ` (${esc(d.asOf)})` : ''}. Verify with the county recorder and a title company.</p>
</div>`;
  }

  function paintDetail() {
    const box = document.getElementById('results');
    if (!box) return;
    ensureStyles();
    const title = document.getElementById('resultsTitle');
    if (title) title.textContent = 'Recorded restrictions';
    box.innerHTML = detailHtml(current()?.recordedRestrictions || null);
  }

  function currentSearch() {
    const d = current();
    const state = document.getElementById('state')?.value || '';
    const county = document.getElementById('county')?.value || '';
    const parcelId = document.getElementById('parcel')?.value?.trim() || document.getElementById('overviewParcelId')?.textContent?.trim() || '';
    if (!state || !county || !parcelId || !d?.parcel) return null;
    const body = { state, county, parcelId };
    const g = d.parcel.geometry;
    try {
      const pt = root.turf?.pointOnFeature ? root.turf.pointOnFeature(d.parcel).geometry.coordinates : null;
      if (pt) { body.lon = pt[0]; body.lat = pt[1]; }
    } catch {}
    if (g && JSON.stringify(g).length < 250000) body.geometry = g;
    const legal = d.zoningPermits?.source?.parcelAttributes?.Legal;
    if (typeof legal === 'string' && legal.trim()) body.legal = legal.trim().slice(0, 250);
    return body;
  }

  async function load() {
    const search = currentSearch();
    if (!search) return;
    const sections = root.AcresXSections;
    // Kootenai reads the parcel's legal description from the zoning answer; wait for it.
    if (/kootenai/i.test(search.county) && sections?.placeholder?.('zoningPermits') === 'pending') { renderCard(null, true); return; }
    // Already asked this search: repaint the answer once it is in (undefined while the request runs).
    if (sections && !sections.claim('restrictions')) { const known = current()?.recordedRestrictions; if (known !== undefined) renderCard(known, false); return; }
    const searchId = sections?.searchId;
    const stale = () => (sections && !sections.isCurrent(searchId));
    const id = ++requestId;
    renderCard(null, true);
    try {
      const response = await fetch('/api/recorded-restrictions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(search) });
      const data = await response.json();
      if (id !== requestId || stale()) return;
      const d = current();
      if (d) d.recordedRestrictions = response.ok ? data : null;
      renderCard(response.ok ? data : null, false);
      if (typeof activeTab !== 'undefined' && activeTab === 'restrictions') paintDetail();
      sections?.settle('restrictions');
    } catch (error) {
      if (id !== requestId || stale()) return;
      console.warn('Recorded restrictions lookup failed', error?.message);
      const d = current();
      if (d) d.recordedRestrictions = null;
      renderCard(null, false);
      sections?.settle('restrictions', 'failed');
    }
  }

  root.AcresXRestrictions = { describe, flags, hoa, safeUrl, detailHtml, renderCard, TITLE_LINE, PLATTED_NOTE };

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      requestAnimationFrame(() => load());
      return result;
    };
  }
  if (typeof renderResults === 'function') {
    const base = renderResults;
    renderResults = function (...args) {
      const result = base.apply(this, args);
      if (typeof activeTab !== 'undefined' && activeTab === 'restrictions') paintDetail();
      return result;
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
