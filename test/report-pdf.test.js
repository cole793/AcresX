// Offline tests for Download PDF (public/report-pdf.js with the report view in
// public/property-report-v2.js; owner bug 2026-11-16, real iPhone: "Save as PDF / Print does
// nothing"). html2canvas and jsPDF are stubs; the offscreen iframe is a fake document that reports
// one .page per <section class="page"> written into it. Runs in the fake DOM from test/ui-harness.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { El, makeClock, makeContext, readPublic } from './ui-harness.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
const MODULES = ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'report-pdf.js', 'property-report-v2.js'];
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64)';
const FILE_NAME = 'Parcel 23123.9051 — AcresX Property Report.pdf';
const vendorFile = name => readFileSync(new URL(`../public/vendor/${name}`, import.meta.url));

function setup({ ua = DESKTOP, share, canShare = () => true, libs = true, failCanvas = false } = {}) {
  const clock = makeClock();
  const log = { printed: [], shared: [], canvases: [], pdfs: [], stages: [], anchors: [], urls: [], revoked: [] };
  class FakeURL extends URL {
    static createObjectURL(blob) { log.urls.push(blob); return `blob:acresx/${log.urls.length}`; }
    static revokeObjectURL(u) { log.revoked.push(u); }
  }
  const navigator = { userAgent: ua };
  if (share) { navigator.share = arg => { log.shared.push(arg); return share(arg); }; navigator.canShare = canShare; }
  const h = makeContext({
    clock,
    body: [['div', { class: 'workspace' }, '', [['header', { class: 'topbar' }, '', [['div', { class: 'top-actions' }, '', [['button', { class: 'ghost' }, 'Save property'], ['button', { id: 'generateReportBtn', class: 'primary' }, 'Generate report']]]]], ['main', {}, '']]]],
    extra: {
      navigator, File, Blob, URL: FakeURL,
      prompt: () => { throw new Error('window.prompt must not be used'); },
      open: () => { throw new Error('window.open must not be used for the report'); },
      addEventListener() {}, innerWidth: 390,
      turf: { area: () => 20.63 * 4046.8564224, centroid: () => ({ geometry: { coordinates: [-117.4, 47.5] } }) }
    }
  });
  const { ctx, document } = h;
  ctx.print = () => log.printed.push(document.title);
  document.documentElement = new El('html', document);
  document.title = 'AcresX | Washington Land Intelligence';
  ctx.__acresxLast = fixture();
  // The offscreen iframe: a document that records what is written and has one .page per section.
  const createElement = document.createElement;
  document.createElement = tag => {
    const el = createElement(tag);
    if (tag === 'iframe') {
      const stage = { html: '', removed: false };
      log.stages.push(stage);
      const pages = [];
      el.contentDocument = {
        open() {}, close() {},
        write(html) { stage.html += html; const n = (html.match(/<section class="page /g) || []).length; for (let i = 0; i < n; i++) { const p = new El('section', document); p.className = `page p${i + 1}`; pages.push(p); } },
        querySelectorAll: sel => (sel === '.page' ? pages : []),
        fonts: { ready: Promise.resolve() }
      };
      const remove = el.remove.bind(el);
      el.remove = () => { stage.removed = true; remove(); };
    }
    if (tag === 'a') { log.anchors.push(el); el.click = () => { el.clicked = true; }; }
    return el;
  };
  if (libs) {
    let fail = failCanvas;
    ctx.html2canvas = async (page, opts) => {
      if (fail) throw new Error('canvas blocked');
      const canvas = { width: 816 * opts.scale, height: 1056 * opts.scale, toDataURL: (type, q) => { log.canvases.push({ page: page.className, opts, type, q }); return `data:image/jpeg;base64,${Buffer.from(page.className).toString('base64')}`; } };
      return canvas;
    };
    ctx.setCanvasFailure = v => { fail = v; };
    ctx.jspdf = {
      jsPDF: class {
        constructor(opts) { this.opts = opts; this.pages = 1; this.images = []; log.pdfs.push(this); }
        setProperties(p) { this.props = p; }
        addPage(...a) { this.pages++; this.addPageArgs = a; }
        addImage(data, fmt, x, y, w, hh, alias, compression) { this.images.push({ data, fmt, x, y, w, h: hh, compression }); }
        output(type) { assert.equal(type, 'blob'); return new Blob(['%PDF-1.3 stub'], { type: 'application/pdf' }); }
      }
    };
  }
  for (const f of MODULES) h.run(readPublic(f), f);
  const $ = id => document.getElementById(id);
  const open = async () => { $('generateReportBtn').click(); $('acresxReportCreate').click(); };
  const settle = () => clock.advance(16000);
  return { h, ctx, $, log, clock, open, settle, P: ctx.AcresXReportPdf };
}

test('vendor libraries: self-hosted, pinned, MIT, and the SRI hashes in report-pdf.js match the files', () => {
  const src = readPublic('report-pdf.js');
  const readme = readPublic('vendor/README.md');
  for (const [file, license] of [['html2canvas-1.4.1.min.js', /Released under MIT License/], ['jspdf-4.2.1.umd.min.js', /jsPDF - PDF Document creation from JavaScript\s*\*\s*Version 4\.2\.1/]]) {
    const bytes = vendorFile(file);
    const sha384 = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert.ok(src.includes(`src: '/vendor/${file}', integrity: '${sha384}'`), `${file}: report-pdf.js pins it with its sha384`);
    assert.ok(readme.includes(sha256) && readme.includes(sha384), `${file}: README records sha256 and sha384`);
    assert.match(bytes.subarray(0, 2000).toString('utf8'), license, `${file}: license header kept`);
  }
  assert.match(vendorFile('LICENSE-html2canvas.txt').toString(), /Permission is hereby granted, free of charge/);
  assert.match(vendorFile('LICENSE-jspdf.txt').toString(), /Permission is hereby granted, free of charge/);
  assert.doesNotMatch(src, /https?:\/\/(cdnjs|cdn\.jsdelivr|unpkg)/, 'no CDN: the /r/<token> CSP allows scripts from this site only');
});

test('wiring: report-pdf.js is injected before the report view and loaded by the shared page; no inline script', () => {
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /'report-branding','report-pdf','property-report-v2'/);
  const shared = readPublic('shared-report.html');
  assert.match(shared, /<script src="\/property-report-v2\.js"><\/script>\n<script src="\/report-pdf\.js"><\/script>\n<script src="\/shared-report\.js"><\/script>/);
});

test('the libraries load lazily: not with the page, but when the report view opens, with SRI integrity', () => {
  const s = setup({ libs: false });
  const vendorScripts = () => s.h.document.head.children.filter(n => n.tagName === 'SCRIPT' || n.tagName === 'script').filter(n => /\/vendor\//.test(n.src));
  assert.equal(vendorScripts().length, 0, 'nothing loads on a plain page load');
  s.$('generateReportBtn').click();
  const scripts = vendorScripts();
  assert.deepEqual(scripts.map(n => n.src), ['/vendor/html2canvas-1.4.1.min.js', '/vendor/jspdf-4.2.1.umd.min.js']);
  for (const n of scripts) assert.match(n.integrity, /^sha384-[A-Za-z0-9+/]{64}$/);
  s.$('acresxReportCreate').click();
  assert.equal(vendorScripts().length, 2, 'not requested twice');
});

test('Download PDF: generated in the background as soon as the report is shown, then enabled; Letter pages from the report', async () => {
  const s = setup();
  await s.open();
  const btn = s.$('acresxReportPdf');
  assert.equal(btn.textContent, 'Preparing PDF…');
  assert.equal(btn.disabled, true);
  assert.equal(btn.getAttribute('aria-busy'), 'true');
  btn.click(); // a tap while preparing does nothing
  assert.equal(s.log.anchors.length, 0);
  await s.settle();
  assert.equal(btn.textContent, 'Download PDF');
  assert.equal(btn.disabled, false);
  // The stage is the report document, without anything active, images requested with CORS.
  assert.equal(s.log.stages.length, 1);
  const stage = s.log.stages[0];
  assert.equal(stage.removed, true, 'the offscreen iframe is removed after rendering');
  assert.equal((stage.html.match(/<section class="page /g) || []).length, 4);
  assert.doesNotMatch(stage.html, /<script|onerror=|onclick=|class="toolbar"/);
  assert.match(stage.html, /<img crossorigin="anonymous" class="map-img" src="https:\/\/server\.arcgisonline\.com\//);
  assert.match(stage.html, /<div class="inset"><img crossorigin="anonymous" src="https:\/\/server\.arcgisonline\.com\//);
  assert.match(stage.html, /\.page\{margin:0 0 16px!important;box-shadow:none!important;zoom:1!important\}/);
  assert.match(stage.html, /<style>\.page\{width:8\.5in;height:11in;|\.page\{width:8\.5in;height:11in;/, 'the report CSS, unchanged');
  // Canvas and PDF settings.
  assert.equal(s.log.canvases.length, 4);
  for (const c of s.log.canvases) { assert.equal(c.opts.scale, 2); assert.equal(c.opts.useCORS, true); assert.equal(c.opts.allowTaint, false); assert.equal(c.type, 'image/jpeg'); }
  assert.deepEqual(s.log.canvases.map(c => c.q), [0.85, 0.92, 0.92, 0.92], 'page 1 (map) at 0.85, text pages at 0.92');
  const [pdf] = s.log.pdfs;
  assert.deepEqual(JSON.parse(JSON.stringify(pdf.opts)), { orientation: 'portrait', unit: 'in', format: 'letter', compress: true });
  assert.equal(pdf.pages, 4);
  assert.deepEqual(pdf.addPageArgs, ['letter', 'portrait']);
  assert.deepEqual(pdf.images.map(i => [i.fmt, i.x, i.y, i.w, i.h]), Array(4).fill(['JPEG', 0, 0, 8.5, 11]));
  assert.equal(pdf.props.title, 'Parcel 23123.9051 — AcresX Property Report');
});

test('desktop: the tap downloads the file with an <a download> named after the parcel; Print stays as the secondary button', async () => {
  const s = setup();
  await s.open();
  await s.settle();
  assert.equal(s.$('acresxReportPrint').hidden, false);
  s.$('acresxReportPdf').click();
  assert.equal(s.log.anchors.length, 1, 'clicked inside the tap');
  const a = s.log.anchors[0];
  assert.equal(a.clicked, true);
  assert.equal(a.download, FILE_NAME);
  assert.equal(a.href, 'blob:acresx/1');
  assert.equal(s.log.urls[0].type, 'application/pdf');
  assert.equal(s.log.printed.length, 0, 'Download PDF never calls window.print');
  s.$('acresxReportClose').click();
  assert.deepEqual(s.log.revoked, ['blob:acresx/1'], 'the blob URL is released on Close');
});

test('iPhone with file sharing: navigator.share({ files, title }) runs inside the tap, nothing awaited first; no print button', async () => {
  let resolveShare;
  const s = setup({ ua: IPHONE, share: () => new Promise(r => { resolveShare = r; }) });
  s.ctx.print = () => { throw new Error('window.print must not be needed on a phone'); };
  await s.open();
  assert.equal(s.$('acresxReportPrint').hidden, true);
  await s.settle();
  s.$('acresxReportPdf').click();
  // Checked synchronously, right after the click returns: no microtask or timer ran in between.
  assert.equal(s.log.shared.length, 1);
  const { files, title } = s.log.shared[0];
  assert.equal(files.length, 1);
  assert.equal(files[0].name, FILE_NAME);
  assert.equal(files[0].type, 'application/pdf');
  assert.equal(title, 'Parcel 23123.9051 — AcresX Property Report');
  assert.equal(s.log.anchors.length, 0, 'no download when the share sheet opens');
  resolveShare();
  await s.clock.flush();
  assert.equal(s.$('acresxReportPdfNote').hidden, true);
});

test('share sheet: closing it is not an error; a refusal says so and the next tap downloads instead', async () => {
  const abort = setup({ ua: IPHONE, share: () => Promise.reject(Object.assign(new Error('closed'), { name: 'AbortError' })) });
  await abort.open(); await abort.settle();
  abort.$('acresxReportPdf').click();
  await abort.clock.flush();
  assert.equal(abort.$('acresxReportPdfNote').hidden, true);

  const s = setup({ ua: IPHONE, share: () => Promise.reject(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' })) });
  await s.open(); await s.settle();
  s.$('acresxReportPdf').click();
  await s.clock.flush();
  assert.equal(s.$('acresxReportPdfNote').hidden, false);
  assert.match(s.$('acresxReportPdfNote').textContent, /share sheet did not open\. Tap Download PDF again/);
  s.$('acresxReportPdf').click();
  assert.equal(s.log.shared.length, 1, 'not shared again');
  assert.equal(s.log.anchors.length, 1);
  assert.equal(s.log.anchors[0].download, FILE_NAME);
});

test('a phone that cannot share files (canShare false, or no share API) downloads in the tap', async () => {
  for (const opts of [{ ua: IPHONE, share: () => Promise.resolve(), canShare: () => false }, { ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile' }]) {
    const s = setup(opts);
    await s.open(); await s.settle();
    s.$('acresxReportPdf').click();
    assert.equal(s.log.shared.length, 0);
    assert.equal(s.log.anchors.length, 1);
    assert.equal(s.log.anchors[0].clicked, true);
  }
  // Desktop browsers with navigator.share still download (a file save is what a desktop expects).
  const d = setup({ share: () => Promise.resolve() });
  await d.open(); await d.settle();
  d.$('acresxReportPdf').click();
  assert.equal(d.log.shared.length, 0);
  assert.equal(d.log.anchors.length, 1);
});

test('a failed PDF shows the reason and Try again; the retry builds it again', async () => {
  const s = setup({ failCanvas: true });
  await s.open();
  await s.settle();
  const btn = s.$('acresxReportPdf'), note = s.$('acresxReportPdfNote');
  assert.equal(btn.textContent, 'Try again');
  assert.equal(btn.disabled, false);
  assert.equal(note.hidden, false);
  assert.equal(note.getAttribute('role'), 'alert');
  assert.match(note.textContent, /The PDF could not be made \(canvas blocked\)\. Check your connection and tap Try again\./);
  assert.equal(s.log.stages.at(-1).removed, true, 'the stage is cleaned up after a failure too');
  s.ctx.setCanvasFailure(false);
  btn.click();
  assert.equal(btn.textContent, 'Preparing PDF…');
  assert.equal(note.hidden, true);
  await s.settle();
  assert.equal(btn.textContent, 'Download PDF');
  btn.click();
  assert.equal(s.log.anchors.at(-1).download, FILE_NAME, 'the retry keeps the file name');
});

test('Close while the PDF is being made cancels it; a new report starts a new PDF', async () => {
  const s = setup();
  await s.open();
  s.$('acresxReportClose').click();
  await s.settle();
  assert.equal(s.log.pdfs.length, 0, 'the closed report is not turned into a PDF');
  await s.open();
  await s.settle();
  assert.equal(s.$('acresxReportPdf').textContent, 'Download PDF');
  assert.equal(s.log.pdfs.length, 1);
});

test('file names: parcel id from the report, characters file systems refuse are replaced', () => {
  const s = setup();
  const { P } = s;
  assert.equal(P.fileName('23123.9051'), FILE_NAME);
  assert.equal(P.fileName('03092732390050000'), 'Parcel 03092732390050000 — AcresX Property Report.pdf');
  assert.equal(P.fileName('12/34:56'), 'Parcel 12-34-56 — AcresX Property Report.pdf');
  assert.equal(P.fileName(''), 'Property — AcresX Property Report.pdf');
  const html = s.ctx.AcresXReport.renderHtml(s.ctx.AcresXReport.buildModel('Smith', fixture()));
  assert.equal(P.parcelIdFrom(html), '23123.9051');
  assert.deepEqual(JSON.parse(JSON.stringify(P.placement(1632, 2112))), { x: 0, y: 0, w: 8.5, h: 11 });
  const tall = P.placement(1632, 2600);
  assert.equal(tall.h, 11, 'a page taller than Letter is scaled to fit, not cut');
  assert.ok(tall.w < 8.5 && tall.x > 0);
});

test('shared page (/r/<token>): Download PDF from the sanitized document, Print hidden on phones, CSP unchanged', () => {
  const src = readPublic('shared-report.js');
  assert.match(src, /const pdfHtml = `<!doctype html>\$\{doc\.documentElement\.outerHTML\}`;/, 'built from the stripActive()ed document');
  assert.ok(src.indexOf('const doc = stripActive(') < src.indexOf('const pdfHtml'), 'after sanitizing');
  assert.match(src, /printBtn\.hidden = isPhone\(\) \|\| typeof window\.print !== 'function';/);
  assert.match(src, /pdfBtn\.addEventListener\('click', \(\) => \{ pdf\.tap\(\); \}\);/, 'the tap goes straight to the controller');
  const accounts = readFileSync(new URL('../src/services/accounts.js', import.meta.url), 'utf8');
  assert.match(accounts, /"script-src 'self'", "style-src 'self' 'unsafe-inline'",\n\s*"img-src 'self' data: https:\/\/server\.arcgisonline\.com", "connect-src 'self'"/);
});

test('stage hardening: the render iframe is sandboxed (no scripts) and every inline handler form is stripped', async () => {
  const s = setup();
  const frames = [];
  const make = s.h.document.createElement;
  s.h.document.createElement = tag => { const el = make(tag); if (tag === 'iframe') frames.push(el); return el; };
  await s.open();
  await s.settle();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].getAttribute('sandbox'), 'allow-same-origin', 'scripts blocked; this page can still write and read it');
  const doc = s.P.stageDocument(`<html><head></head><body><img src="https://server.arcgisonline.com/x" onerror="a()"><img src='/a.png' onload='b()'><div onclick=c() class="k">on=text stays</div><svg><g ONMOUSEOVER = "d()" onfocus=e></g></svg><script>f()</script><p>Based on="x" in text</p></body></html>`);
  assert.doesNotMatch(doc, /<[^>]*\son[a-z]+\s*=[^>]*>/i, "no handler attribute left in any tag");
  assert.doesNotMatch(doc.split("<body>")[1], /a\(\)|b\(\)|c\(\)|d\(\)|onfocus|f\(\)/);
  assert.match(doc, /<img crossorigin="anonymous" src="https:\/\/server\.arcgisonline\.com\/x">/);
  assert.match(doc, /<img src='\/a\.png'>/);
  assert.match(doc, /<div class="k">on=text stays<\/div>/, 'text content is left alone');
  assert.match(doc, /<p>Based on="x" in text<\/p>/);
  assert.match(doc, /<g><\/g>/);
});
