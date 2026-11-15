// Report branding (Settings page). A realtor adds their name, brokerage, contact details and a logo;
// the printable report (property-report-v2.js) then says "Prepared by <name>, <brokerage>" on page 1
// and carries the agent's contact line in every footer, with AcresX kept as "Powered by AcresX".
//
// Signed in (public/accounts.js): branding is kept in the AcresX account (brandingStore()), so it
// follows the realtor to every device. Signed out, or accounts not set up: branding lives in this
// browser's localStorage only. Every
// storage access is wrapped in try/catch; when storage is blocked or full, branding is kept in
// memory for this page load and the page says so.
//
// Safety: text fields are cleaned (control and bidi-override characters removed, length capped)
// and always HTML-escaped where they are rendered. The website must be http(s). Logos must be PNG
// or JPG (SVG is refused: it can carry scripts); they are decoded and re-encoded through a canvas,
// scaled to fit 600x200, and the stored data URL is capped at 200 KB. What comes back from
// storage is validated again before use.
(() => {
  const KEY = 'acresx.reportBranding.v1';
  const MAX_LOGO_CHARS = 200 * 1024; // the stored data URL, not the input file
  const MAX_INPUT_BYTES = 5 * 1024 * 1024;
  const LOGO_BOX = { w: 600, h: 200 };
  const LIMITS = { name: 80, brokerage: 100, phone: 30, email: 120, website: 200, license: 40 };
  const FIELDS = Object.keys(LIMITS);
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---- Cleaning and validation

  // eslint-disable-next-line no-control-regex
  const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
  function cleanText(value, max) {
    return String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  const EMAIL = /^[^\s@<>()[\]\\,;:"']+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
  const PHONE = /^\+?[0-9().\-\s]+(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i;
  function validEmail(v) { return v.length <= LIMITS.email && EMAIL.test(v) && /\.[A-Za-z]{2,}$/.test(v); }
  function validPhone(v) { const d = v.replace(/(?:x|ext\.?)\s*\d+$/i, '').replace(/\D/g, ''); return PHONE.test(v) && d.length >= 7 && d.length <= 15; }
  // "example.com" -> "https://example.com"; anything but http(s) is refused.
  function normalizeWebsite(v) {
    if (!v) return '';
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
    let u;
    try { u = new URL(withScheme); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
    const out = u.href.replace(/\/$/, '');
    return out.length <= LIMITS.website ? out : null;
  }
  const displayWebsite = v => String(v || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  function validLogo(v) {
    return typeof v === 'string' && v.length <= MAX_LOGO_CHARS && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(v);
  }

  // Raw form or stored values -> { branding, errors }. Branding needs at least the agent's name.
  function validate(input = {}) {
    const b = {}, errors = {};
    for (const k of FIELDS) b[k] = cleanText(input[k], LIMITS[k]);
    if (b.email && !validEmail(b.email)) errors.email = 'Enter an email like name@example.com.';
    if (b.phone && !validPhone(b.phone)) errors.phone = 'Enter a phone number with 7 to 15 digits, like (509) 555-0100.';
    if (b.website) {
      const w = normalizeWebsite(b.website);
      if (w === null) errors.website = 'Enter a web address starting with http:// or https://, like https://example.com.';
      else b.website = w;
    }
    b.logo = input.logo ? (validLogo(input.logo) ? input.logo : '') : '';
    if (input.logo && !b.logo) errors.logo = 'The logo could not be used. Upload a PNG or JPG.';
    const anything = FIELDS.some(k => k !== 'name' && b[k]) || b.logo;
    if (!b.name && anything) errors.name = 'Add your name so the report can say who prepared it.';
    return { branding: b, errors, ok: !Object.keys(errors).length };
  }
  // Stored values: invalid fields are dropped instead of blocking the rest.
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const { branding, errors } = validate(raw);
    for (const k of Object.keys(errors)) if (k !== 'name') branding[k] = '';
    return branding.name ? branding : null;
  }

  // ---- Storage (per browser; works without it)

  // When a write to storage fails (blocked, full), the branding for this page load is kept here and
  // wins over whatever storage holds: undefined = no override; null = cleared; object = branding.
  let override;
  function store() { try { return window.localStorage || null; } catch { return null; } }
  function account() { try { return window.AcresXAccounts?.brandingStore?.() || null; } catch { return null; } }
  function load() {
    const a = account();
    if (a) return normalize(a.get());
    if (override !== undefined) return override ? normalize(override) : null;
    let raw = null;
    try { const s = store(); raw = s ? s.getItem(KEY) : null; } catch { raw = null; }
    if (!raw) return null;
    try { return normalize(JSON.parse(raw)); } catch { return null; }
  }
  function save(input) {
    const result = validate(input);
    if (!result.ok) return { ...result, stored: false };
    if (!result.branding.name) return { ...clear(), branding: null };
    const record = { ...result.branding, updatedAt: new Date().toISOString() };
    const a = account();
    if (a) { a.set(record); return { ok: true, errors: {}, branding: normalize(record), stored: true, account: true }; }
    let stored = false;
    try { const s = store(); if (s) { s.setItem(KEY, JSON.stringify(record)); stored = true; } } catch { stored = false; }
    override = stored ? undefined : record;
    return { ok: true, errors: {}, branding: normalize(record), stored };
  }
  function clear() {
    const a = account();
    if (a) { a.remove(); return { ok: true, errors: {}, branding: null, stored: true, account: true }; }
    let stored = false;
    try { const s = store(); if (s) { s.removeItem(KEY); stored = true; } } catch { stored = false; }
    override = stored ? undefined : null;
    return { ok: true, errors: {}, branding: null, stored };
  }
  function storageAvailable() {
    if (account()) return true;
    try { const s = store(); if (!s) return false; const k = `${KEY}.probe`; s.setItem(k, '1'); s.removeItem(k); return true; } catch { return false; }
  }

  // What the report prints. Plain text; the caller escapes it.
  function parts(b) {
    if (!b || !b.name) return null;
    const license = b.license ? `License #${b.license.replace(/^(?:license|lic\.?)?\s*#?\s*/i, '')}` : '';
    return {
      name: b.name, brokerage: b.brokerage,
      preparedBy: [b.name, b.brokerage].filter(Boolean).join(', '),
      contact: [b.phone, b.email, displayWebsite(b.website), license].filter(Boolean),
      footerContact: [b.phone, b.email, displayWebsite(b.website)].filter(Boolean),
      logo: validLogo(b.logo) ? b.logo : ''
    };
  }

  // ---- Logo: PNG/JPG only, re-encoded through a canvas, fit to 600x200, <= 200 KB

  function fitWithin(w, h, maxW = LOGO_BOX.w, maxH = LOGO_BOX.h) {
    if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
    const k = Math.min(1, maxW / w, maxH / h);
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  // file: { type, size, name }; head: the first bytes (Uint8Array) when known.
  function checkLogoFile(file, head) {
    const type = String(file?.type || '').toLowerCase(), name = String(file?.name || '').toLowerCase();
    if (type === 'image/svg+xml' || /\.svgz?$/.test(name)) return 'SVG logos are not accepted (they can contain scripts). Export the logo as PNG or JPG and upload that.';
    if (type !== 'image/png' && type !== 'image/jpeg') return 'Upload the logo as a PNG or JPG image.';
    if (!(file.size > 0)) return 'That file is empty.';
    if (file.size > MAX_INPUT_BYTES) return 'That image is larger than 5 MB. Upload a smaller PNG or JPG.';
    if (head && head.length >= 3) {
      const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
      const jpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      if (!png && !jpg) return 'That file is not a PNG or JPG image.';
    }
    return '';
  }
  // render(w, h, opaque) -> a canvas-like object with toDataURL(type, quality). PNG first; then
  // JPEG on white at falling quality; then smaller sizes, until the data URL is <= 200 KB.
  function encodeLogo(srcW, srcH, render) {
    let { w, h } = fitWithin(srcW, srcH);
    if (!w) return { ok: false, error: 'The image could not be read.' };
    for (let step = 0; step < 6; step++) {
      const png = render(w, h, false).toDataURL('image/png');
      if (validLogo(png)) return { ok: true, dataUrl: png, width: w, height: h };
      const jpgCanvas = render(w, h, true);
      for (const q of [0.92, 0.85, 0.75, 0.6]) {
        const jpg = jpgCanvas.toDataURL('image/jpeg', q);
        if (validLogo(jpg)) return { ok: true, dataUrl: jpg, width: w, height: h };
      }
      w = Math.max(1, Math.round(w * 0.75)); h = Math.max(1, Math.round(h * 0.75));
    }
    return { ok: false, error: 'The logo could not be reduced below 200 KB. Try a simpler or smaller image.' };
  }
  async function processLogo(file) {
    let head = null;
    try { head = new Uint8Array(await file.slice(0, 8).arrayBuffer()); } catch {}
    const problem = checkLogoFile(file, head);
    if (problem) return { ok: false, error: problem };
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('decode')); i.src = url; });
      const render = (w, h, opaque) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (opaque) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        return c;
      };
      return encodeLogo(img.naturalWidth, img.naturalHeight, render);
    } catch { return { ok: false, error: 'The image could not be read. Upload a PNG or JPG.' }; }
    finally { URL.revokeObjectURL(url); }
  }

  // ---- Settings page (in the library view of property-actions.js)

  // The report header, as it will print (same parts the report uses).
  function previewHtml(b) {
    const p = parts(b);
    if (!p) return `<div class="bp-head"><img class="bp-acresx" src="/assets/acresx-logo.png" alt="AcresX"><div class="bp-right"><div class="bp-eyebrow">Property report</div><span>Generated today</span></div></div><p class="bp-empty">No branding yet. Reports show the AcresX header until you add your name.</p>`;
    return `<div class="bp-head"><div class="bp-agent">${p.logo ? `<img class="bp-logo" src="${esc(p.logo)}" alt="">` : ''}<div><div class="bp-prepared">Prepared by <strong>${esc(p.name)}</strong>${p.brokerage ? `, ${esc(p.brokerage)}` : ''}</div>${p.contact.length ? `<div class="bp-contact">${p.contact.map(esc).join(' · ')}</div>` : ''}</div></div><div class="bp-right"><div class="bp-eyebrow">Property report</div><span>Generated today</span><span class="bp-powered">Powered by AcresX</span></div></div><div class="bp-foot"><span>Prepared by ${esc(p.preparedBy)}${p.footerContact.length ? ` · ${p.footerContact.map(esc).join(' · ')}` : ''}</span><span>Powered by AcresX · Page 1 of 3</span></div>`;
  }

  const FORM_FIELDS = [
    ['name', 'Your name', 'text', 'name', 'Jane Example', true],
    ['brokerage', 'Brokerage', 'text', 'organization', 'Example Realty'],
    ['phone', 'Phone', 'tel', 'tel', '(509) 555-0100'],
    ['email', 'Email', 'email', 'email', 'jane@example.com'],
    ['website', 'Website', 'url', 'url', 'https://example.com'],
    ['license', 'License # (optional)', 'text', 'off', '']
  ];
  let draftLogo = null; // null: keep the saved logo; '': removed; a data URL: newly uploaded

  function setActive() {
    document.querySelectorAll('.sidebar .nav button').forEach(b => b.classList.toggle('active', (b.textContent || '').includes('Settings')));
  }
  function goDashboard() {
    const btn = [...document.querySelectorAll('.sidebar .nav button')].find(b => (b.textContent || '').includes('Property Dashboard'));
    if (btn) btn.click();
  }
  function libraryView() {
    let view = $('propertyLibraryView');
    if (view) return view;
    const main = document.querySelector('.workspace main');
    if (!main) return null;
    view = document.createElement('section'); view.id = 'propertyLibraryView'; view.className = 'property-library'; main.prepend(view);
    return view;
  }

  function formValues() {
    const out = {};
    for (const [k] of FORM_FIELDS) out[k] = $(`branding_${k}`)?.value || '';
    out.logo = draftLogo !== null ? draftLogo : (load()?.logo || '');
    return out;
  }
  function showErrors(errors) {
    for (const [k] of FORM_FIELDS) {
      const el = $(`branding_${k}_err`), input = $(`branding_${k}`);
      if (el) el.textContent = errors[k] || '';
      if (input) { input.classList.toggle('invalid', Boolean(errors[k])); if (errors[k]) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    }
    const le = $('branding_logo_err'); if (le) le.textContent = errors.logo || '';
  }
  function status(message, kind = '') {
    const el = $('brandingStatus'); if (!el) return;
    el.textContent = message; el.className = `branding-status ${kind}`;
  }
  function refreshPreview() {
    const v = validate(formValues());
    const prev = $('brandingPreview');
    if (prev) prev.innerHTML = previewHtml(v.branding);
    const thumb = $('brandingLogoThumb'), remove = $('brandingLogoRemove');
    const logo = v.branding.logo;
    if (thumb) { thumb.innerHTML = logo ? `<img src="${esc(logo)}" alt="Your logo">` : '<span>No logo</span>'; }
    if (remove) remove.hidden = !logo;
  }

  function renderSettings() {
    const view = libraryView(); if (!view) return;
    ['status', 'emptyState', 'dashboard'].map(id => $(id)).filter(Boolean).forEach(n => { n.style.display = 'none'; });
    const card = document.querySelector('.search-card'); if (card) card.style.display = 'none';
    view.style.display = 'block';
    setActive();
    draftLogo = null;
    const saved = load() || {};
    const canStore = storageAvailable();
    const inAccount = Boolean(account());
    const field = ([k, label, type, auto, ph, req]) => `<div class="branding-field${k === 'name' || k === 'brokerage' ? ' wide' : ''}"><label for="branding_${k}">${esc(label)}${req ? ' <em>required for branding</em>' : ''}</label><input id="branding_${k}" name="${k}" type="${type}" maxlength="${LIMITS[k]}" autocomplete="${auto}"${ph ? ` placeholder="${esc(ph)}"` : ''} value="${esc(saved[k] || '')}"${type === 'tel' ? ' inputmode="tel"' : ''}><div class="branding-err" id="branding_${k}_err" aria-live="polite"></div></div>`;
    view.innerHTML = `<div class="library-head"><div><div class="eyebrow">Settings</div><h2>Report branding</h2><p>Put your name, brokerage and logo on the property reports you hand to clients.</p></div><button type="button" class="ghost" id="libraryBack">Back to Dashboard</button></div>
<div class="branding-layout">
<form id="brandingForm" class="branding-card" novalidate>
${inAccount ? '<p class="branding-note"><strong>Saved to your AcresX account.</strong> Reports you make on any device where you sign in carry this branding, and so do the read-only report links you share.</p>' : '<p class="branding-note"><strong>Saved in this browser only.</strong> Nothing is uploaded to AcresX. Other browsers and devices won\'t see it, and clearing this browser\'s site data removes it.</p>'}
${canStore ? '' : '<p class="branding-note warn">This browser is blocking site storage, so branding will apply to reports only until you reload or close this page.</p>'}
<div class="branding-grid">${FORM_FIELDS.map(field).join('')}</div>
<div class="branding-field wide"><span class="branding-label">Logo (optional)</span><div class="branding-logo-row"><div class="branding-thumb" id="brandingLogoThumb"></div><div class="branding-logo-actions"><label class="ghost branding-file" for="brandingLogoFile">Upload PNG or JPG</label><input id="brandingLogoFile" type="file" accept="image/png,image/jpeg"><button type="button" class="ghost" id="brandingLogoRemove">Remove logo</button></div></div><div class="branding-hint">Scaled to fit 600 × 200 px and stored under 200 KB. SVG files are not accepted.</div><div class="branding-err" id="branding_logo_err" aria-live="polite"></div></div>
<div class="branding-actions"><button type="submit" class="primary" id="brandingSave">Save branding</button><button type="button" class="ghost" id="brandingClear">Clear branding</button></div>
<div id="brandingStatus" class="branding-status" role="status" aria-live="polite"></div>
</form>
<aside class="branding-card branding-preview-card"><h3>Report header preview</h3><p class="branding-hint">Page 1 of the printed report. Every page footer carries your contact line. Reports keep the AcresX screening disclaimer.</p><div id="brandingPreview" class="branding-preview"></div></aside>
</div>`;
    $('libraryBack').onclick = goDashboard;
    const form = $('brandingForm');
    form.addEventListener('input', refreshPreview);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const r = save(formValues());
      showErrors(r.errors);
      if (!r.ok) { status('Check the highlighted fields.', 'error'); return; }
      draftLogo = null;
      if (!r.branding) status(r.stored ? 'Branding cleared. Reports use the AcresX header.' : 'Branding cleared for this page.', 'ok');
      else if (r.account) status('Saved to your account. Your next report will carry this branding.', 'ok');
      else status(r.stored ? 'Saved in this browser. Your next report will carry this branding.' : 'Applied for this page only: this browser would not save it.', r.stored ? 'ok' : 'warn');
      for (const [k] of FORM_FIELDS) { const input = $(`branding_${k}`); if (input && r.branding) input.value = r.branding[k] || ''; }
      refreshPreview();
    });
    $('brandingClear').onclick = () => {
      const r = clear(); draftLogo = null;
      for (const [k] of FORM_FIELDS) { const input = $(`branding_${k}`); if (input) input.value = ''; }
      showErrors({}); refreshPreview();
      status(r.stored ? 'Branding cleared. Reports use the AcresX header.' : 'Branding cleared for this page.', 'ok');
    };
    $('brandingLogoRemove').onclick = () => { draftLogo = ''; showErrors({}); refreshPreview(); status('Logo removed. Save to keep this change.'); };
    $('brandingLogoFile').addEventListener('change', async e => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      status('Processing logo…');
      const r = await processLogo(file);
      const le = $('branding_logo_err');
      if (!r.ok) { if (le) le.textContent = r.error; status(''); return; }
      if (le) le.textContent = '';
      draftLogo = r.dataUrl; refreshPreview();
      status(`Logo ready (${r.width} × ${r.height} px, ${Math.round(r.dataUrl.length / 1024)} KB). Save to keep it.`);
    });
    refreshPreview();
  }

  function addStyles() {
    if ($('reportBrandingStyles')) return;
    const style = document.createElement('style');
    style.id = 'reportBrandingStyles';
    style.textContent = `
.branding-layout{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px;align-items:start}
.branding-card{background:#fff;border:1px solid #dce4de;border-radius:16px;padding:22px;box-shadow:0 8px 28px rgba(28,55,38,.05);min-width:0}
.branding-card h3{font:800 16px Manrope,Arial,sans-serif;margin:0 0 4px}
.branding-note{margin:0 0 16px;padding:10px 12px;border-radius:10px;background:#eef6f0;color:#2b4a37;font-size:13px;line-height:1.45}.branding-note.warn{background:#fff4de;color:#7a5410}
.branding-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}
.branding-field{min-width:0}.branding-field.wide{grid-column:1/-1}
.branding-field label,.branding-label{display:block;font-size:12px;font-weight:800;margin-bottom:6px;color:#25352b}.branding-field label em{font-style:normal;font-weight:600;color:#7a877f;margin-left:4px}
.branding-field input[type=text],.branding-field input[type=tel],.branding-field input[type=email],.branding-field input[type=url]{width:100%;box-sizing:border-box;border:1px solid #cfdad2;border-radius:11px;padding:11px 12px;min-height:44px;font:inherit;font-size:15px;outline:none;background:#fff;color:#17231c}
.branding-field input:focus{border-color:#2d7950;box-shadow:0 0 0 3px rgba(45,121,80,.12)}.branding-field input.invalid{border-color:#b8463f}
.branding-err{color:#a3322a;font-size:12px;margin-top:4px;min-height:0}.branding-err:empty{display:none}
.branding-hint{font-size:12px;color:#66736b;margin-top:6px;line-height:1.4}.branding-grid+.branding-field{margin-top:12px}
.branding-logo-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.branding-thumb{width:180px;height:60px;border:1px dashed #cbd7ce;border-radius:10px;display:grid;place-items:center;background:#fafcfa;overflow:hidden;color:#8a968f;font-size:12px}.branding-thumb img{display:block;width:auto;height:auto;max-width:calc(100% - 8px);max-height:52px;object-fit:contain}
.branding-logo-actions{display:flex;gap:8px;flex-wrap:wrap}.branding-file{display:inline-flex;align-items:center;justify-content:center;min-height:44px;line-height:1.2;margin:0!important;font-weight:700!important;box-sizing:border-box;cursor:pointer}.branding-logo-actions .ghost{font-size:14px}
#brandingLogoFile{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.branding-logo-actions button,.branding-actions button{min-height:44px}
.branding-actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}
.branding-status{margin-top:10px;font-size:13px;font-weight:700;color:#2d4a38}.branding-status:empty{display:none}.branding-status.error{color:#a3322a}.branding-status.warn{color:#7a5410}.branding-status.ok{color:#1f7a45}
.branding-preview{margin-top:12px;border:1px solid #dce4de;border-radius:10px;padding:14px;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#17231c}
.bp-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;border-bottom:2px solid #174f34;padding-bottom:8px}
.bp-agent{display:flex;align-items:center;gap:10px;min-width:0}.bp-logo{max-height:40px;max-width:130px;object-fit:contain;flex:none}
.bp-prepared{font-size:13px;line-height:1.25;overflow-wrap:anywhere}.bp-contact{font-size:11px;color:#5a6a60;margin-top:2px;overflow-wrap:anywhere}
.bp-right{text-align:right;font-size:11px;color:#5a6a60;display:flex;flex-direction:column;align-items:flex-end;flex:none}.bp-eyebrow{font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#174f34}.bp-powered{font-size:9.5px;margin-top:2px}
.bp-acresx{height:28px}.bp-empty{font-size:12px;color:#66736b;margin:10px 0 0}
.bp-foot{display:flex;justify-content:space-between;gap:10px;border-top:1px solid #dbe4de;margin-top:14px;padding-top:6px;font-size:9.5px;color:#5a6a60}.bp-foot span:first-child{min-width:0;overflow-wrap:anywhere}.bp-foot span:last-child{flex:none}
@media(max-width:1050px){.branding-layout{grid-template-columns:1fr}}
@media(max-width:700px){
  .sidebar .nav{grid-template-columns:repeat(4,1fr)!important}.sidebar .nav button:last-child{display:flex!important}
  .branding-card{padding:16px;border-radius:14px}
  .branding-grid{grid-template-columns:1fr}
  .branding-field input[type=text],.branding-field input[type=tel],.branding-field input[type=email],.branding-field input[type=url]{font-size:16px}
  .branding-actions button,.branding-logo-actions .ghost{flex:1 1 auto;justify-content:center}
  .branding-thumb{width:100%}
  .bp-head{flex-direction:column;align-items:flex-start}.bp-right{align-items:flex-start;text-align:left}
  .bp-foot{flex-direction:column;gap:2px}
}`;
    document.head.appendChild(style);
  }

  function init() {
    addStyles();
    document.querySelectorAll('.sidebar .nav button').forEach(btn => {
      if (!(btn.textContent || '').includes('Settings')) return;
      btn.disabled = false;
      btn.onclick = renderSettings;
    });
  }

  window.AcresXBranding = {
    KEY, MAX_LOGO_CHARS, LIMITS, load, save, clear, validate, normalize, parts, storageAvailable,
    fitWithin, checkLogoFile, encodeLogo, validLogo, processLogo, previewHtml, renderSettings, normalizeWebsite
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
