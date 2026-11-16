// Deep links and the iPhone Home Screen app (owner finding 2026-11-16, real iPhone: Download PDF
// works in a browser tab but does nothing when AcresX is opened from a Home Screen bookmark; iOS
// standalone web apps cannot save or share files).
//
// - isStandalone(): navigator.standalone (iOS) or display-mode standalone / fullscreen /
//   minimal-ui. needsBrowser(): standalone on iPhone/iPad, where files cannot be saved. The report
//   view (property-report-v2.js) then shows "Open in Safari to save PDF" as its primary action,
//   with "Copy link"; Download PDF stays, secondary.
// - Deep links: /?state=MT&county=Yellowstone&parcel=03092732390050000&report=1&ref=Smith
//   On load, a valid link selects the state and county, fills the parcel and submits the search
//   form (the normal search flow). With report=1 it waits for the sections to settle (or 90 s at
//   most) and opens the in-page report with ref as its reference, so the PDF starts building. The
//   report is not saved to the account again (it was saved where it was created). Nothing else
//   runs. Parameters are checked strictly (parse): state WA/ID/MT, a county from that state's list
//   (state-selector.js), a parcel id pattern, report 1/0, ref up to 120 characters with control
//   characters removed (the report escapes it). Any bad or repeated parameter: nothing runs.
// - After every search the address bar shows that search (history.replaceState, no reload, other
//   parameters dropped), so a copied link reproduces it. reportLink(ref) is the link for the
//   report on screen: the search that produced the data now in window.__acresxLast.
// Injected by maybeInjectUiPolish() in src/index.js after state-selector.js and
// property-report-v2.js (which it drives) and before browser-fallback.js. It runs a link on
// DOMContentLoaded, after every injected module has loaded.
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc || root.AcresXDeepLink) return;
  const $ = id => doc.getElementById(id);

  const STATES = ['WA', 'ID', 'MT'];
  const PARCEL = /^[A-Za-z0-9](?:[A-Za-z0-9 .\-]{0,38}[A-Za-z0-9])?$/;
  const REF_MAX = 120;
  const KEYS = ['state', 'county', 'parcel', 'report', 'ref'];
  const WAIT_MS = 90000, POLL_MS = 500;

  const nav = () => { try { return root.navigator || {}; } catch { return {}; } };
  const isIOS = () => { const n = nav(); return /iP(hone|ad|od)/.test(n.userAgent || '') || (n.platform === 'MacIntel' && n.maxTouchPoints > 1); };
  const media = q => { try { return Boolean(typeof root.matchMedia === 'function' && root.matchMedia(q)?.matches); } catch { return false; } };
  function isStandalone() {
    if (nav().standalone === true) return true;
    return ['standalone', 'fullscreen', 'minimal-ui'].some(m => media(`(display-mode: ${m})`));
  }
  const needsBrowser = () => isStandalone() && isIOS();

  const countiesOf = state => { try { return root.AcresXStateSelector?.counties?.(state) || []; } catch { return []; } };
  const cleanRef = s => String(s || '').replace(/[\t\n\r]/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().slice(0, REF_MAX).trim();

  // search string (or URLSearchParams) -> { state, county, parcel, report, ref } or null.
  // options.counties(state) -> the state's county names (defaults to state-selector.js's lists).
  function parse(search, { counties = countiesOf } = {}) {
    let params;
    try { params = search instanceof URLSearchParams ? search : new URLSearchParams(String(search || '')); } catch { return null; }
    for (const k of KEYS) if (params.getAll(k).length > 1) return null;
    const state = String(params.get('state') || '').trim().toUpperCase();
    if (!STATES.includes(state)) return null;
    const wanted = String(params.get('county') || '').trim().replace(/\s+County$/i, '').toLowerCase();
    const county = (counties(state) || []).find(c => String(c).toLowerCase() === wanted);
    if (!wanted || !county) return null;
    const parcel = String(params.get('parcel') || '').trim();
    if (!PARCEL.test(parcel)) return null;
    const r = params.get('report');
    if (r !== null && r !== '1' && r !== '0') return null;
    const rawRef = params.get('ref');
    if (rawRef !== null && rawRef.length > REF_MAX * 4) return null;
    return { state, county, parcel, report: r === '1', ref: cleanRef(rawRef) };
  }

  // { state, county, parcel, report, ref } -> "/?state=..&county=..&parcel=..[&report=1[&ref=..]]"
  function link({ state, county, parcel, report = false, ref = '' } = {}) {
    const p = new URLSearchParams();
    p.set('state', state); p.set('county', county); p.set('parcel', parcel);
    if (report) { p.set('report', '1'); const r = cleanRef(ref); if (r) p.set('ref', r); }
    return `/?${p.toString()}`;
  }
  const origin = () => { try { const o = root.location?.origin; return /^https?:\/\//.test(o || '') ? o : ''; } catch { return ''; } };
  const absolute = path => `${origin()}${path}`;

  // ---- The search that produced the data on screen
  // Each submit records its search and the data object it found in place. The data now in
  // window.__acresxLast came from the latest submit that replaced that object (a failed or
  // unfinished search leaves it in place, so the one before it still owns the data).
  const searches = [];
  function formSearch() {
    const state = $('state')?.value || '';
    const p = new URLSearchParams();
    p.set('state', state); p.set('county', $('county')?.value || ''); p.set('parcel', String($('parcel')?.value || '').trim());
    return parse(p);
  }
  function onSubmit() {
    const s = formSearch();
    if (!s) return;
    searches.push({ search: { state: s.state, county: s.county, parcel: s.parcel }, before: root.__acresxLast });
    if (searches.length > 8) searches.shift();
    reflect(s);
  }
  function currentSearch() {
    const data = root.__acresxLast;
    if (!data?.parcel) return null;
    for (let i = searches.length - 1; i >= 0; i--) if (searches[i].before !== data) return searches[i].search;
    return null;
  }
  // The full https link that reopens the report on screen (null when unknown).
  function reportLink(ref) {
    const s = currentSearch();
    return s && origin() ? absolute(link({ ...s, report: true, ref })) : null;
  }
  // The address bar follows the search (optional: any failure is ignored).
  function reflect(s) {
    try {
      const path = root.location?.pathname || '/';
      if (path !== '/' && path !== '/index.html') return;
      root.history?.replaceState?.(root.history.state ?? null, '', `${link(s)}${root.location.hash || ''}`);
    } catch {}
  }

  // ---- Running a deep link
  function fire(el, type) {
    try { if (typeof el.dispatchEvent === 'function' && typeof root.Event === 'function') el.dispatchEvent(new root.Event(type, { bubbles: true })); } catch {}
  }
  function submit(form) {
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else $('searchBtn')?.click?.();
  }
  // Fills the form and runs the normal search; with report, opens the report once it settles.
  // Returns false (and does nothing) when the page is not the search page or the county is not
  // offered there.
  function run(p, { wait = WAIT_MS } = {}) {
    const stateEl = $('state'), countyEl = $('county'), parcelEl = $('parcel'), form = $('searchForm');
    if (!p || !stateEl || !countyEl || !parcelEl || !form) return false;
    stateEl.value = p.state;
    fire(stateEl, 'change');
    if (stateEl.value !== p.state) return false;
    countyEl.value = p.county;
    if (countyEl.value !== p.county) return false;
    fire(countyEl, 'change');
    parcelEl.value = p.parcel;
    const before = root.__acresxLast;
    submit(form);
    if (p.report) waitThenOpen(p, before, wait);
    return true;
  }
  function waitThenOpen(p, before, wait) {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    let polls = 0;
    const tick = () => {
      polls++;
      // The person moved on (another parcel, or a report of their own): leave it.
      if (String($('parcel')?.value || '').trim() !== p.parcel) return;
      if ($('acresxReportView')?.classList?.contains('open')) return;
      const data = root.__acresxLast;
      const found = data && data !== before && data.parcel;
      const timeUp = elapsed() >= wait || polls * POLL_MS >= wait;
      if (!found) {
        if ($('status')?.classList?.contains('error') && polls > 1) return; // parcel not found
        if (!timeUp) root.setTimeout(tick, POLL_MS);
        return;
      }
      const S = root.AcresXSections;
      const settled = !S || (S.allSettled?.() !== false && S.ready?.('cost') !== false);
      if (!settled && !timeUp) { root.setTimeout(tick, POLL_MS); return; }
      try { root.AcresXReport?.createReport?.(p.ref, { save: false }); } catch (error) { console.warn('Deep link report not opened', error); }
    };
    root.setTimeout(tick, POLL_MS);
  }

  function start() {
    const form = $('searchForm');
    form?.addEventListener?.('submit', onSubmit);
    const p = parse(root.location?.search || '');
    // After the other DOMContentLoaded handlers (progressive-loading.js wraps the renderers there).
    if (p) root.setTimeout(() => run(p), 0);
  }

  root.AcresXDeepLink = { isStandalone, isIOS, needsBrowser, parse, link, reportLink, currentSearch, run, start, REF_MAX };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
