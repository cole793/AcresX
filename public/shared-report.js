// The read-only shared report at /r/<token> (public/shared-report.html, served by
// src/services/accounts.js with a strict Content-Security-Policy: scripts from this site only, so
// no inline script or event handler runs).
//
// It loads { snapshot, branding } from /api/shared/<token> and renders it with the printable
// report's own renderer (window.AcresXReport.renderHtml, public/property-report-v2.js), with the
// agent's branding (window.AcresXBranding.parts). Nothing from the server is HTML: the snapshot is
// JSON facts, every value is escaped by the renderer, the few values used as class names are
// checked against their known values here, and the rendered document is parsed with DOMParser
// and stripped of <script> elements and on* attributes before it is shown. The print button and
// the page-fit step that the report normally does inline are attached here instead.
(() => {
  const $ = id => document.getElementById(id);
  const TOKEN = /^\/r\/([A-Za-z0-9_-]{43})\/?$/;

  function message(title, text) {
    const t = $('sharedTitle'), p = $('sharedText');
    if (t) t.textContent = title;
    if (p) p.textContent = text;
  }

  const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  // The values the renderer puts into class attributes come from fixed lists; anything else is
  // replaced (a snapshot is data a browser sent, so it is checked before rendering).
  function cleanModel(snapshot) {
    const m = JSON.parse(JSON.stringify(snapshot || {}));
    m.f = m.f && typeof m.f === 'object' ? m.f : {};
    m.score = m.score && typeof m.score === 'object' ? m.score : {};
    m.data = m.data && typeof m.data === 'object' ? m.data : {};
    m.score.band = oneOf(m.score.band, ['good', 'fair', 'poor', 'na'], 'na');
    m.score.drivers = Array.isArray(m.score.drivers) ? m.score.drivers : [];
    m.f.findings = (Array.isArray(m.f.findings) ? m.f.findings : []).map(x => ({ ...x, level: oneOf(x?.level, ['risk', 'verify', 'good'], 'verify') }));
    for (const k of ['flood', 'wet']) if (m.f[k] && typeof m.f[k] === 'object') m.f[k].cls = oneOf(m.f[k].cls, ['red', 'amber', 'green'], 'amber');
    if (!m.f.acreage || typeof m.f.acreage !== 'object') m.f.acreage = { text: '', official: null, officialText: '', note: '' };
    if (m.f.assess && m.f.assess.acres != null && !Number.isFinite(m.f.assess.acres)) m.f.assess.acres = null;
    return m;
  }

  // The report's page-fit step (property-report-v2.js FIT), run from here: measured at full size
  // in the fixed Letter box (.fit-measure); on screen the pages grow instead of clipping.
  function fit() {
    document.querySelectorAll('.page').forEach(p => {
      const zoom = p.style.zoom;
      p.style.zoom = '';
      p.classList.remove('d1', 'd2', 'd3', 'grow');
      const b = p.querySelector('.page-body');
      if (b) {
        p.classList.add('fit-measure');
        const over = () => b.scrollHeight > b.clientHeight + 1;
        for (const step of ['d1', 'd2', 'd3']) { if (!over()) break; p.classList.add(step); }
        if (over()) p.classList.add('grow');
        p.classList.remove('fit-measure');
      }
      p.style.zoom = zoom;
    });
  }
  // Phones: scale the Letter-size pages to the screen (not when printing).
  function scaleToScreen() {
    const pageWidth = 8.5 * 96 + 24;
    const k = Math.min(1, (window.innerWidth || pageWidth) / pageWidth);
    document.querySelectorAll('.page').forEach(p => { p.style.zoom = k < 1 ? String(k) : ''; });
  }

  function stripActive(doc) {
    doc.querySelectorAll('script, iframe, object, embed, link, meta[http-equiv], base, form').forEach(n => n.remove());
    doc.querySelectorAll('*').forEach(n => {
      for (const a of [...n.attributes]) {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        else if (/^(src|href|xlink:href|action|formaction)$/i.test(a.name) && /^\s*(javascript|vbscript):/i.test(a.value)) n.removeAttribute(a.name);
      }
    });
    return doc;
  }

  function show(html, generated) {
    const doc = stripActive(new DOMParser().parseFromString(html, 'text/html'));
    document.title = doc.title || 'Shared property report · AcresX';
    doc.head.querySelectorAll('style').forEach(st => { const n = document.createElement('style'); n.textContent = st.textContent; document.head.appendChild(n); });
    const extra = document.createElement('style');
    extra.textContent = 'html,body{-webkit-text-size-adjust:100%;text-size-adjust:100%}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.shared-note{color:#fff;font:700 12px/1.4 Arial,Helvetica,sans-serif;text-align:left}@media print{.page{zoom:1!important}}';
    document.head.appendChild(extra);
    document.body.replaceChildren(...[...doc.body.childNodes].map(n => document.importNode(n, true)));
    const bar = document.querySelector('.toolbar');
    if (bar) {
      const note = document.createElement('span');
      note.className = 'shared-note';
      note.textContent = `Shared report · read-only${generated ? ` · generated ${generated}` : ''} · screening information, verify with the responsible agency`;
      bar.prepend(note);
      const printBtn = bar.querySelector('button');
      printBtn?.addEventListener('click', () => window.print());
      // Phones: the system share sheet with this link (only where the browser has one).
      if (printBtn && typeof window.navigator?.share === 'function') {
        const share = document.createElement('button');
        share.type = 'button';
        share.textContent = 'Share';
        share.style.marginLeft = '8px';
        share.addEventListener('click', () => { try { window.navigator.share({ title: document.title, url: window.location.href })?.catch?.(() => {}); } catch {} });
        printBtn.after(share);
      }
    }
    document.querySelectorAll('.map-img').forEach(img => img.addEventListener('error', () => img.closest('.map')?.classList.add('img-error')));
    document.querySelectorAll('.inset img').forEach(img => img.addEventListener('error', () => img.parentElement?.classList.add('img-error')));
    window.addEventListener('load', fit);
    try { document.fonts?.ready?.then(fit); } catch {}
    document.querySelectorAll('.page img').forEach(img => { img.addEventListener('load', fit); img.addEventListener('error', fit); });
    window.addEventListener('beforeprint', () => { document.querySelectorAll('.page').forEach(p => { p.style.zoom = ''; }); fit(); });
    window.addEventListener('afterprint', scaleToScreen);
    window.addEventListener('resize', scaleToScreen);
    fit();
    scaleToScreen();
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(fit);
  }

  async function main() {
    const m = String(window.location?.pathname || '').match(TOKEN);
    if (!m) { message('This link is not valid', 'Check that the whole link was copied, or ask the agent who sent it for a new one.'); return; }
    let res, body;
    try {
      res = await fetch(`/api/shared/${m[1]}`, { credentials: 'omit', cache: 'no-store' });
      body = await res.json();
    } catch { message('The report could not be loaded', 'Check your connection and reload this page.'); return; }
    if (res.status === 404) { message('This link is turned off', 'The agent who shared this report turned the link off, or the link is not valid. Ask them for a new one.'); return; }
    if (!res.ok || !body?.snapshot) { message('The report could not be loaded', 'Try again in a minute.'); return; }
    const R = window.AcresXReport, B = window.AcresXBranding;
    if (!R?.renderHtml) { message('The report could not be shown', 'Reload this page.'); return; }
    let brand = null;
    try { brand = B ? B.parts(B.normalize(body.branding)) : null; } catch { brand = null; }
    const model = cleanModel(body.snapshot);
    const date = Date.parse(model.generatedAt) ? model.generatedAt : (Number.isFinite(body.createdAt) ? new Date(body.createdAt).toISOString() : null);
    let html;
    try { html = R.renderHtml(model, { brand, date }); }
    catch { message('The report could not be shown', 'This report was saved in a format this page cannot display. Ask the agent to share it again.'); return; }
    const generated = date ? new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    show(html, generated);
  }

  window.AcresXSharedReport = { cleanModel, stripActive, fit, main };
  if (!window.__acresxSharedReportTest) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
  }
})();
