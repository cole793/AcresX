// Download PDF for the property report (owner bug 2026-11-16, real iPhone: "Save as PDF / Print
// does nothing"). window.print() is a no-op in many iOS contexts (in-app browsers / WKWebView, some
// Safari states), so the report view and the shared report page (/r/<token>) build a real PDF file
// in the browser instead of relying on the print dialog:
//
// - The two libraries are self-hosted in public/vendor/ (versions, sha256 and licenses in
//   public/vendor/README.md), so the shared page's strict CSP (script-src 'self') needs no change
//   and no CDN is involved. They load lazily, the first time a report view opens (preload()), never
//   on a plain page load, with SRI integrity on the script tags.
// - build(html) renders the report document (renderHtml's, without its toolbar and script) into a
//   hidden offscreen iframe, unzoomed at the Letter width (816 x 1056 CSS px). The iframe is its
//   own document, so the report CSS and the app CSS cannot touch each other. (Rendering from the
//   view's shadow root does not work: html2canvas 1.4.1 flattens a shadow root into the light DOM
//   of its clone, so the :host colour variables are lost and the app CSS leaks in.) The iframe has
//   no src (about:blank, written with document.write, the way html2canvas makes its own clone), so
//   it runs under the page's CSP unchanged on /r/<token>. The stage images load with
//   crossOrigin="anonymous": the Esri export endpoints answer Access-Control-Allow-Origin: *, so
//   the map and inset draw into the canvas. An image that fails (or would not be CORS-readable)
//   gets the report's own placeholder (.img-error: "Aerial imagery could not be loaded") instead of
//   a tainted canvas. It waits for document.fonts.ready and runs the report's page-fit step.
// - Each page -> canvas (html2canvas, scale 2 for crisp text) -> JPEG (0.85 on page 1, the map
//   page; 0.92 on the text pages) -> one jsPDF US Letter portrait page (8.5 x 11 in).
// - controller() runs the button: the PDF is generated in the background as soon as the report is
//   shown ("Preparing PDF…", disabled), then the button says "Download PDF". The tap delivers the
//   file synchronously, with no await between the tap and navigator.share() (iOS drops the user
//   gesture across an await): phones with file sharing get the share sheet (Save to Files, Mail,
//   AirDrop); everything else gets an <a download> click with a blob URL (iOS Safari 13+, Android,
//   desktop). A failed build shows the reason and "Try again".
(() => {
  const VENDOR = [
    { name: 'html2canvas', src: '/vendor/html2canvas-1.4.1.min.js', integrity: 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H', ready: () => typeof window.html2canvas === 'function' },
    { name: 'jspdf', src: '/vendor/jspdf-4.2.1.umd.min.js', integrity: 'sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3', ready: () => typeof window.jspdf?.jsPDF === 'function' }
  ];
  const PAGE_W = 816, PAGE_H = 1056; // a US Letter page in CSS px (96 per inch)
  const SCALE = 2;
  const IMAGE_TIMEOUT = 15000;
  const STAGE_ID = 'acresxPdfStage';
  // The stage shows the pages as printed: no phone zoom, no shadow, no toolbar.
  // html2canvas 1.4.1 cannot paint repeating-linear-gradient (the hatched "removed" and "wetland
  // buffer" swatches in the report), so the stage draws the same stripes as SVG tiles.
  const hatch = (bg, fg, w, slash) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='${bg}'/><path d='${slash ? 'M-2,2L2,-2M0,8L8,0M6,10L10,6' : 'M-2,6L2,10M0,0L8,8M6,-2L10,2'}' stroke='${fg}' stroke-width='${w}'/></svg>`)}")`;
  const STAGE_CSS = 'html,body{margin:0!important;padding:0!important;background:#fff!important}.toolbar{display:none!important}.page{margin:0 0 16px!important;box-shadow:none!important;zoom:1!important}' +
    `.b-bar .c{background:${hatch('#e8a59e', '#c0392b', 3, true)}!important}.map-tag i.c{background:${hatch('#f0c2bd', '#c0392b', 2.2, true)}!important}.map-tag i.b{background:${hatch('#f6dfb0', '#d39a2a', 2.2, false)}!important}`;

  const $doc = () => window.document;
  const ua = () => { try { return window.navigator || {}; } catch { return {}; } };
  const isIOS = () => { const n = ua(); return /iP(hone|ad|od)/.test(n.userAgent || '') || (n.platform === 'MacIntel' && n.maxTouchPoints > 1); };
  const isMobile = () => isIOS() || /Android/i.test(ua().userAgent || '');

  // ---- Libraries (public/vendor), loaded once, on demand
  const loading = {};
  function loadScript(lib) {
    if (lib.ready()) return Promise.resolve();
    if (loading[lib.name]) return loading[lib.name];
    const p = new Promise((resolve, reject) => {
      const s = $doc().createElement('script');
      s.src = lib.src;
      s.integrity = lib.integrity;
      s.setAttribute?.('integrity', lib.integrity);
      s.crossOrigin = 'anonymous';
      s.async = true;
      s.dataset && (s.dataset.acresxVendor = lib.name);
      s.addEventListener('load', () => (lib.ready() ? resolve() : reject(new Error(`${lib.name} did not start`))));
      s.addEventListener('error', () => { s.remove?.(); reject(new Error(`${lib.name} could not be loaded`)); });
      $doc().head.appendChild(s);
    });
    loading[lib.name] = p;
    p.catch(() => { delete loading[lib.name]; }); // a retry loads it again
    return p;
  }
  function loadLibs() {
    return Promise.all(VENDOR.map(loadScript)).then(() => ({ html2canvas: window.html2canvas, jsPDF: window.jspdf.jsPDF }));
  }
  // Called when a report view opens, so the libraries are usually there before the report is.
  function preload() { loadLibs().catch(() => {}); }

  // ---- The offscreen stage
  // html: a renderHtml() document. Scripts, the toolbar and inline event handlers are dropped (the
  // stage attaches its own image handlers) and remote images are requested with CORS.
  function stageDocument(html) {
    let doc = String(html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<div class="toolbar">[\s\S]*?<\/div>/, '')
      .replace(/\son[a-z]+="[^"]*"/gi, '')
      .replace(/<img(?![^>]*\bcrossorigin=)([^>]*\bsrc="https?:\/\/)/gi, '<img crossorigin="anonymous"$1');
    const css = `<style>${STAGE_CSS}</style>`;
    doc = /<\/head>/i.test(doc) ? doc.replace(/<\/head>/i, `${css}</head>`) : css + doc;
    return /^\s*<!doctype/i.test(doc) ? doc : `<!doctype html>${doc}`;
  }
  function makeStage(html) {
    $doc().getElementById?.(STAGE_ID)?.remove?.();
    const frameEl = $doc().createElement('iframe');
    frameEl.id = STAGE_ID;
    frameEl.setAttribute('aria-hidden', 'true');
    frameEl.setAttribute('tabindex', '-1');
    frameEl.setAttribute('title', 'PDF render');
    frameEl.style.cssText = `position:fixed;left:-${PAGE_W * 12}px;top:0;width:${PAGE_W}px;height:${PAGE_H}px;border:0;pointer-events:none`;
    $doc().body.appendChild(frameEl);
    const doc = frameEl.contentDocument || frameEl.contentWindow?.document;
    if (!doc) throw new Error('the page could not be prepared');
    doc.open();
    doc.write(stageDocument(html));
    doc.close();
    return { el: frameEl, doc };
  }
  // The report's own placeholders for a missing image (property-report-v2.js CSS).
  function markImageError(img) {
    const map = img.closest?.('.map');
    if (map && img.classList?.contains('map-img')) map.classList.add('img-error');
    else if (img.closest?.('.inset')) img.parentElement?.classList.add('img-error');
    else if (img.style) img.style.visibility = 'hidden';
  }
  function settleImages(root) {
    const imgs = [...(root.querySelectorAll?.('img') || [])];
    return Promise.all(imgs.map(img => new Promise(resolve => {
      const ok = () => { clearTimeout(timer); resolve(); };
      const fail = () => { clearTimeout(timer); markImageError(img); resolve(); };
      const timer = setTimeout(fail, IMAGE_TIMEOUT);
      if (img.complete) { if (img.naturalWidth) ok(); else fail(); return; }
      img.addEventListener('load', ok, { once: true });
      img.addEventListener('error', fail, { once: true });
    })));
  }
  const frame = () => new Promise(resolve => (typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(() => resolve()) : setTimeout(resolve, 16)));
  // A page image on a Letter sheet: full width, or (a page that grew past Letter) full height.
  function placement(w, h) {
    const W = 8.5, H = 11;
    if (!(w > 0 && h > 0) || h / w <= H / W) return { x: 0, y: 0, w: W, h: w > 0 ? W * h / w : H };
    const pw = H * w / h;
    return { x: (W - pw) / 2, y: 0, w: pw, h: H };
  }

  // html (a renderHtml() document) -> Promise<Blob> (application/pdf), one Letter page per page.
  async function build(html, { title = 'AcresX Property Report', isCurrent = () => true } = {}) {
    const { html2canvas, jsPDF } = await loadLibs();
    if (!isCurrent()) throw cancelled();
    const stage = makeStage(html);
    try {
      await settleImages(stage.doc);
      try { await stage.doc.fonts?.ready; } catch {}
      try { await $doc().fonts?.ready; } catch {}
      const pages = [...(stage.doc.querySelectorAll?.('.page') || [])];
      if (!pages.length) throw new Error('the report has no pages to save');
      try { window.AcresXReport?.fitNodes?.(pages); } catch {}
      await frame();
      if (!isCurrent()) throw cancelled();
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter', compress: true });
      try { pdf.setProperties({ title, creator: 'AcresX' }); } catch {}
      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i], {
          scale: SCALE, useCORS: true, allowTaint: false, backgroundColor: '#ffffff', logging: false,
          imageTimeout: IMAGE_TIMEOUT, windowWidth: PAGE_W, windowHeight: PAGE_H, scrollX: 0, scrollY: 0
        });
        if (!isCurrent()) throw cancelled();
        const image = canvas.toDataURL('image/jpeg', i === 0 ? 0.85 : 0.92);
        if (!/^data:image\/jpeg/.test(image)) throw new Error('the page image could not be made');
        if (i) pdf.addPage('letter', 'portrait');
        const at = placement(canvas.width, canvas.height);
        pdf.addImage(image, 'JPEG', at.x, at.y, at.w, at.h, undefined, 'FAST');
        try { canvas.width = 0; canvas.height = 0; } catch {} // frees the memory at once on iOS
      }
      return pdf.output('blob');
    } finally {
      stage.el.remove?.();
    }
  }
  function cancelled() { const e = new Error('cancelled'); e.cancelled = true; return e; }

  // "Parcel 23123.9051 — AcresX Property Report.pdf" (characters file systems refuse are replaced).
  function fileName(pid) {
    const id = String(pid || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
    return `${id ? `Parcel ${id}` : 'Property'} — AcresX Property Report.pdf`;
  }
  // The parcel id from the report (every page header: "<address> · Parcel <id></span>").
  function parcelIdFrom(html) {
    const m = / · Parcel ([^<]+)<\/span><\/div><\/header>/.exec(String(html));
    const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return m ? unesc(m[1]).trim() : '';
  }

  // ---- The button
  // controller({ button, note }) -> { start(html, { title, pid }), cancel(), tap(), state }
  // button: the Download PDF button; note: an element for the error / sharing messages.
  function controller({ button, note, onChange } = {}) {
    const c = { state: 'idle', file: null, blob: null, url: '', name: '', title: '', error: '', preferDownload: false };
    let seq = 0;
    let htmlKept = '', pidKept = '';
    const say = (text, alert) => {
      if (!note) return;
      note.textContent = text || '';
      note.hidden = !text;
      if (alert) note.setAttribute?.('role', 'alert'); else note.removeAttribute?.('role');
    };
    function render() {
      if (!button) return;
      const label = { preparing: 'Preparing PDF…', ready: 'Download PDF', error: 'Try again' }[c.state] || 'Download PDF';
      button.textContent = label;
      button.disabled = c.state === 'preparing' || c.state === 'idle';
      if (c.state === 'preparing') button.setAttribute?.('aria-busy', 'true'); else button.removeAttribute?.('aria-busy');
      try { onChange?.(c.state); } catch {}
    }
    function release() {
      if (c.url) { try { window.URL.revokeObjectURL(c.url); } catch {} }
      c.url = ''; c.file = null; c.blob = null;
    }
    c.start = (html, { title = '', pid = '' } = {}) => {
      const my = ++seq;
      release();
      htmlKept = html;
      pidKept = pid;
      c.title = title || 'AcresX Property Report';
      c.name = fileName(pid || parcelIdFrom(html));
      c.error = '';
      c.preferDownload = false;
      c.state = 'preparing';
      say('');
      render();
      const isCurrent = () => my === seq;
      const run = (async () => {
        try {
          const blob = await c.build(html, { title: c.title, isCurrent });
          if (!isCurrent()) return;
          c.blob = blob;
          try { c.file = new window.File([blob], c.name, { type: 'application/pdf' }); } catch { c.file = null; }
          c.state = 'ready';
          render();
        } catch (error) {
          if (!isCurrent() || error?.cancelled) return;
          console.warn('Report PDF failed', error);
          c.state = 'error';
          c.error = String(error?.message || error || 'unknown error');
          say(`The PDF could not be made (${c.error}). Check your connection and tap Try again.`, true);
          render();
        }
      })();
      c.done = run;
      return run;
    };
    c.cancel = () => { seq++; release(); htmlKept = ''; pidKept = ''; c.state = 'idle'; say(''); render(); };
    function download() {
      if (!c.url) c.url = window.URL.createObjectURL(c.blob);
      const a = $doc().createElement('a');
      a.href = c.url;
      a.download = c.name;
      a.rel = 'noopener';
      a.style && (a.style.display = 'none');
      $doc().body.appendChild(a);
      a.click();
      setTimeout(() => a.remove?.(), 0);
      return 'download';
    }
    // Straight from the tap: everything here is synchronous until navigator.share() is called.
    c.tap = () => {
      if (c.state === 'error') { c.start(htmlKept, { title: c.title, pid: pidKept }); return 'retry'; }
      if (c.state !== 'ready' || !c.blob) return 'wait';
      const nav = ua();
      let shareable = false;
      if (!c.preferDownload && c.file && isMobile() && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
        try { shareable = !!nav.canShare({ files: [c.file] }); } catch { shareable = false; }
      }
      if (shareable) {
        let p;
        try { p = nav.share({ files: [c.file], title: c.title }); }
        catch (error) { return shareFailed(error); }
        Promise.resolve(p).then(() => say(''), shareFailed);
        return 'share';
      }
      try { return download(); }
      catch (error) { say('The PDF could not be saved from this browser. Open AcresX in Safari or Chrome and try again.', true); return 'failed'; }
    };
    // Closing the share sheet is not an error; a refusal (no gesture, no permission) is: the next
    // tap downloads the file instead.
    function shareFailed(error) {
      if (error?.name === 'AbortError') return 'share';
      c.preferDownload = true;
      say('The share sheet did not open. Tap Download PDF again to save the file.', true);
      return 'share-failed';
    }
    c.build = build;
    render();
    return c;
  }

  window.AcresXReportPdf = { VENDOR, preload, loadLibs, build, stageDocument, placement, fileName, parcelIdFrom, controller, isMobile };
})();
