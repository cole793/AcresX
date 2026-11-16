// Accounts in the browser (gap #14): email sign-in, and Saved Properties, Reports and report
// branding kept in the AcresX account when signed in, so they follow a realtor across devices.
//
// When the server says accounts are not available (GET /api/me -> enabled: false: the email
// secret or the database tables are not set up yet, or this is a preview), this script adds
// nothing to the page and everything keeps working from this browser's localStorage, exactly as
// before. Signed out: localStorage. Signed in: the account (an in-memory copy loaded at start,
// written through to /api/*), used by public/property-actions.js and public/report-branding.js
// through storeFor() and brandingStore(). This browser's own data is never deleted: signing out
// shows it again.
//
// First sign-in on a browser that has saved properties, reports or branding: an offer to add
// them to the account (POST /api/account/import; the account wins on a clash).
// Reports generated while signed in are saved to the account (property-report-v2.js calls
// reportGenerated()), and can be shared read-only with a /r/<token> link (copy, turn off).
(() => {
  const SAVED_KEY = 'acresx.savedProperties.v2';
  const REPORTS_KEY = 'acresx.reports.v1';
  const BRAND_KEY = 'acresx.reportBranding.v1';
  const importFlag = id => `acresx.accounts.importOffered.${id}`;
  const $ = id => document.getElementById(id);
  const state = { enabled: false, signedIn: false, ready: false, user: null, saved: [], reports: [], branding: null };

  // ---- Small helpers

  const clone = v => JSON.parse(JSON.stringify(v));
  function local(key, fallback) {
    try { const raw = window.localStorage?.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  }
  function localSet(key, value) { try { window.localStorage?.setItem(key, value); } catch {} }
  function el(tag, props = {}, kids = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k === 'onclick') node.addEventListener('click', v);
      else if (k in node && k !== 'id' && typeof v !== 'string') node[k] = v;
      else node.setAttribute(k, v);
    }
    kids.filter(Boolean).forEach(kid => node.appendChild(kid));
    return node;
  }
  function toast(message) {
    let t = $('accountsToast');
    if (!t) { t = el('div', { id: 'accountsToast', role: 'status' }); document.body.appendChild(t); }
    t.textContent = message; t.classList.add('show');
    clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const init = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    try {
      const res = await fetch(path, init);
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      return { ok: Boolean(res.ok), status: res.status, data: data || {} };
    } catch { return { ok: false, status: 0, data: {} }; }
  }

  // ---- Account data (in-memory copy of what the server holds)

  const reportItem = r => ({ ...(r.summary || {}), id: r.id, name: r.summary?.name || r.title, generatedAt: r.summary?.generatedAt || new Date(r.createdAt).toISOString(), accountReport: true, hasSnapshot: Boolean(r.hasSnapshot), activeShares: r.activeShares || 0 });

  async function loadAccount() {
    const [saved, reports, branding] = await Promise.all([api('/api/saved-properties'), api('/api/reports'), api('/api/branding')]);
    if (!saved.ok || !reports.ok || !branding.ok) return false;
    state.saved = Array.isArray(saved.data.items) ? saved.data.items : [];
    state.reports = (Array.isArray(reports.data.reports) ? reports.data.reports : []).map(reportItem);
    state.branding = branding.data.branding || null;
    state.ready = true;
    return true;
  }
  const failed = what => toast(`Could not save ${what} to your account. Check your connection and try again.`);

  function syncSaved(items) {
    const before = new Map(state.saved.map(x => [x.key, JSON.stringify(x)]));
    const after = new Map(items.map(x => [x.key, x]));
    state.saved = clone(items);
    const jobs = [];
    for (const key of before.keys()) if (!after.has(key)) jobs.push(api(`/api/saved-properties/${encodeURIComponent(key)}`, { method: 'DELETE' }));
    for (const [key, item] of after) if (before.get(key) !== JSON.stringify(item)) jobs.push(api(`/api/saved-properties/${encodeURIComponent(key)}`, { method: 'PUT', body: { data: item } }));
    return Promise.all(jobs).then(rs => { if (rs.some(r => !r.ok)) failed('this change'); return rs; });
  }
  function syncReports(items) {
    const keep = new Set(items.map(x => x.id));
    const removed = state.reports.filter(r => !keep.has(r.id));
    state.reports = state.reports.filter(r => keep.has(r.id));
    return Promise.all(removed.map(r => api(`/api/reports/${encodeURIComponent(r.id)}`, { method: 'DELETE' }))).then(rs => { if (rs.some(r => !r.ok)) failed('this change'); return rs; });
  }

  // property-actions.js: the store for a key while signed in, or null (use localStorage).
  function storeFor(key) {
    if (!state.signedIn || !state.ready) return null;
    if (key === SAVED_KEY) return { account: true, read: () => clone(state.saved), write: syncSaved };
    if (key === REPORTS_KEY) return { account: true, read: () => clone(state.reports), write: syncReports };
    return null;
  }
  // report-branding.js: the branding store while signed in, or null (use localStorage).
  function brandingStore() {
    if (!state.signedIn || !state.ready) return null;
    return {
      account: true,
      get: () => (state.branding ? clone(state.branding) : null),
      set(record) { state.branding = clone(record); return api('/api/branding', { method: 'PUT', body: { branding: record } }).then(r => { if (!r.ok) failed('your branding'); return r; }); },
      remove() { state.branding = null; return api('/api/branding', { method: 'DELETE' }).then(r => { if (!r.ok) failed('your branding'); return r; }); }
    };
  }

  // property-report-v2.js, after a report opened: save it to the account when signed in.
  async function reportGenerated(model, snapshotOf) {
    if (!state.signedIn || !state.ready || typeof snapshotOf !== 'function') return null;
    const f = model.f || {};
    const summary = {
      name: model.name, state: f.stateCode, county: f.county, parcelId: f.pid, address: f.address || 'No situs address',
      acreage: f.acreage?.text || '', score: model.score?.value || '', generatedAt: model.generatedAt || new Date().toISOString()
    };
    const snap = snapshotOf(model);
    let r = await api('/api/reports', { method: 'POST', body: { title: model.name, summary, snapshot: snap } });
    if (r.status === 413 && snap.data?.buildableArea) {
      // A very detailed parcel: keep the buildable numbers, drop the shaded outlines.
      snap.data.buildableArea = { ...snap.data.buildableArea, geometry: null, removedGeometry: null, bufferGeometry: null };
      r = await api('/api/reports', { method: 'POST', body: { title: model.name, summary, snapshot: snap } });
    }
    if (!r.ok) { toast(r.data.error || 'The report opened, but it could not be saved to your account.'); return null; }
    state.reports.unshift({ ...summary, id: r.data.id, accountReport: true, hasSnapshot: true, activeShares: 0 });
    toast('Report saved to your account.');
    window.AcresXLibrary?.refresh?.();
    return r.data.id;
  }

  // ---- Reports page: view, share link (copy, turn off)

  // Opens in the report's in-page view (property-report-v2.js), not a popup: in-app browsers on
  // phones return null from window.open, so the view opens at once in the tap and fills in when
  // the saved report arrives.
  async function viewReport(item) {
    const R = window.AcresXReport;
    if (!R?.renderHtml || !R?.openReport || !R?.showLoading) { toast('That report could not be opened.'); return; }
    const ticket = R.showLoading('Loading report…');
    const r = await api(`/api/reports/${encodeURIComponent(item.id)}`);
    if (!r.ok || !r.data.snapshot) { R.closeReport?.(ticket); toast('That report could not be opened.'); return; }
    try {
      const html = R.renderHtml(r.data.snapshot, { date: r.data.snapshot.generatedAt });
      R.openReport(html, { ticket });
    } catch { R.closeReport?.(ticket); toast('That report could not be opened.'); }
  }

  function sharePanel(card, item) {
    let panel = card.querySelector('.share-panel');
    if (panel) { panel.remove(); return; }
    panel = el('div', { class: 'share-panel' });
    const note = el('p', { class: 'share-note', text: 'Anyone with the link can view this report (read-only, with your branding). Your account email is never shown.' });
    const status = el('p', { class: 'share-status', role: 'status' });
    const input = el('input', { class: 'share-url', type: 'text', readonly: 'readonly', 'aria-label': 'Share link' });
    const copy = el('button', { type: 'button', class: 'primary share-copy', text: 'Copy link' });
    const create = el('button', { type: 'button', class: 'ghost share-create', text: 'Create link' });
    const revoke = el('button', { type: 'button', class: 'ghost share-revoke', text: 'Turn off all links' });
    const row = el('div', { class: 'share-row' }, [input, copy]);
    row.hidden = true;
    const actions = el('div', { class: 'share-actions' }, [create, revoke]);
    revoke.hidden = !item.activeShares;
    panel.append(note, row, actions, status);
    card.appendChild(panel);
    create.addEventListener('click', async () => {
      create.disabled = true; status.textContent = 'Creating link…';
      const r = await api(`/api/reports/${encodeURIComponent(item.id)}/share`, { method: 'POST' });
      create.disabled = false;
      if (!r.ok) { status.textContent = r.data.error || 'Could not create a link. Try again.'; return; }
      input.value = r.data.url || `${location.origin}${r.data.path}`;
      row.hidden = false; revoke.hidden = false; create.textContent = 'Create another link';
      item.activeShares = (item.activeShares || 0) + 1;
      const saved = state.reports.find(x => x.id === item.id); if (saved) saved.activeShares = item.activeShares;
      status.textContent = 'Link ready. Copy it and send it to your client.';
    });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(input.value); status.textContent = 'Copied.'; }
      catch { try { input.select(); document.execCommand?.('copy'); status.textContent = 'Copied.'; } catch { status.textContent = 'Select the link and copy it.'; } }
    });
    revoke.addEventListener('click', async () => {
      revoke.disabled = true;
      const r = await api(`/api/reports/${encodeURIComponent(item.id)}/share`, { method: 'DELETE' });
      revoke.disabled = false;
      if (!r.ok) { status.textContent = r.data.error || 'Could not turn the links off. Try again.'; return; }
      item.activeShares = 0;
      const saved = state.reports.find(x => x.id === item.id); if (saved) saved.activeShares = 0;
      input.value = ''; row.hidden = true; revoke.hidden = true; create.textContent = 'Create link';
      status.textContent = 'All links for this report are turned off. Anyone who opens them now sees "link turned off".';
    });
  }

  // property-actions.js renderLibrary('reports'): extra buttons on account reports.
  function decorateReportCard(card, item) {
    if (!item?.accountReport) return;
    const actions = card.querySelector('.library-actions');
    if (!actions) return;
    if (item.hasSnapshot) {
      actions.prepend(el('button', { type: 'button', class: 'ghost share-item', text: item.activeShares ? `Share link (${item.activeShares} on)` : 'Share link', onclick: () => sharePanel(card, item) }));
      actions.prepend(el('button', { type: 'button', class: 'ghost view-item', text: 'View report', onclick: () => viewReport(item) }));
    }
  }

  // ---- Sign in / out

  function closeModal() { $('accountsModal')?.remove(); }
  function modal(title, body) {
    closeModal();
    const box = el('div', { class: 'accounts-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'accountsDialogTitle' }, [
      el('div', { class: 'accounts-kicker', text: 'AcresX account' }), el('h2', { id: 'accountsDialogTitle', text: title }), ...body
    ]);
    const wrap = el('div', { id: 'accountsModal' }, [box]);
    wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    document.body.appendChild(wrap);
    return box;
  }

  function openSignIn() {
    const input = el('input', { id: 'accountsEmail', type: 'email', autocomplete: 'email', inputmode: 'email', maxlength: '254', placeholder: 'name@example.com' });
    const send = el('button', { id: 'accountsSendLink', type: 'submit', class: 'primary', text: 'Email me a sign-in link' });
    const cancel = el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: closeModal });
    const msg = el('p', { id: 'accountsMessage', class: 'accounts-msg', role: 'status' });
    const form = el('form', { id: 'accountsForm', novalidate: 'novalidate' }, [
      el('label', { for: 'accountsEmail', text: 'Email' }), input, msg, el('div', { class: 'accounts-actions' }, [cancel, send])
    ]);
    modal('Sign in', [el('p', { class: 'accounts-lead', text: 'Sign in to keep saved properties, reports and your report branding on every device. No password: we email you a link.' }), form]);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = String(input.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'Enter an email address like name@example.com.'; return; }
      send.disabled = true; msg.textContent = 'Sending…';
      const r = await api('/api/auth/request-link', { method: 'POST', body: { email } });
      send.disabled = false;
      if (!r.ok) { msg.textContent = r.data.error || 'Could not send the link. Try again in a minute.'; return; }
      modal('Check your email', [
        el('p', { id: 'accountsCheckEmail', class: 'accounts-lead', text: `${r.data.message || 'A sign-in link is on its way.'} Open it on this device to sign in here.` }),
        el('div', { class: 'accounts-actions' }, [el('button', { type: 'button', class: 'primary', text: 'Done', onclick: closeModal })])
      ]);
    });
    setTimeout(() => input.focus?.(), 50);
  }

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' });
    state.signedIn = false; state.ready = false; state.user = null;
    try { window.location.reload(); } catch { renderTopbar(); }
  }

  function openAccountMenu() {
    modal('Your account', [
      el('p', { class: 'accounts-lead', text: `Signed in as ${state.user?.email || ''}. Saved properties, reports and branding are kept in your account.` }),
      el('p', { class: 'accounts-small', text: 'Signing out shows what is saved in this browser again; nothing in this browser is deleted.' }),
      el('div', { class: 'accounts-actions' }, [
        el('button', { type: 'button', class: 'ghost', text: 'Close', onclick: closeModal }),
        el('button', { id: 'accountsSignOut', type: 'button', class: 'primary', text: 'Sign out', onclick: signOut })
      ])
    ]);
  }

  function renderTopbar() {
    const bar = document.querySelector('.top-actions');
    if (!bar || !state.enabled) return;
    $('accountsButton')?.remove();
    const button = state.signedIn
      ? el('button', { id: 'accountsButton', type: 'button', class: 'ghost accounts-btn signed-in', title: state.user?.email || '', 'aria-label': `Account: ${state.user?.email || ''}`, onclick: openAccountMenu }, [el('span', { class: 'accounts-email', text: state.user?.email || 'Account' })])
      : el('button', { id: 'accountsButton', type: 'button', class: 'ghost accounts-btn', text: 'Sign in', onclick: openSignIn });
    bar.appendChild(button);
  }

  // ---- Import this browser's work (first sign-in on a browser)

  function localWork() {
    const saved = local(SAVED_KEY, []);
    const reports = local(REPORTS_KEY, []);
    const branding = local(BRAND_KEY, null);
    return {
      savedProperties: Array.isArray(saved) ? saved : [],
      reports: Array.isArray(reports) ? reports : [],
      branding: branding && typeof branding === 'object' && branding.name ? branding : null
    };
  }
  async function importLocal(work) {
    const r = await api('/api/account/import', { method: 'POST', body: work });
    if (!r.ok) { toast(r.data.error || 'Could not add this browser’s work to your account. Try again later.'); return false; }
    await loadAccount();
    toast('Added to your account.');
    window.AcresXLibrary?.refresh?.();
    return true;
  }
  function offerImport() {
    if (!state.signedIn || !state.user?.id) return false;
    const flag = importFlag(state.user.id);
    if (local(flag, false)) return false;
    const work = localWork();
    const parts = [];
    if (work.savedProperties.length) parts.push(`${work.savedProperties.length} saved ${work.savedProperties.length === 1 ? 'property' : 'properties'}`);
    if (work.reports.length) parts.push(`${work.reports.length} ${work.reports.length === 1 ? 'report' : 'reports'}`);
    if (work.branding) parts.push('your report branding');
    if (!parts.length) { localSet(flag, 'true'); return false; }
    const done = () => { localSet(flag, 'true'); closeModal(); };
    modal('Add this browser’s work to your account?', [
      el('p', { class: 'accounts-lead', text: `This browser has ${parts.join(', ')}. Add ${parts.length === 1 && !work.branding ? 'it' : 'them'} to your account so they show up on every device?` }),
      el('p', { class: 'accounts-small', text: 'Nothing is removed from this browser. Where your account already has the same property or branding, the account’s copy is kept.' }),
      el('div', { class: 'accounts-actions' }, [
        el('button', { id: 'accountsImportSkip', type: 'button', class: 'ghost', text: 'Not now', onclick: done }),
        el('button', { id: 'accountsImport', type: 'button', class: 'primary', text: 'Add to my account', onclick: async () => { done(); await importLocal(work); } })
      ])
    ]);
    return true;
  }

  // ---- Start

  function readUrlFlags() {
    let params;
    try { params = new URLSearchParams(window.location?.search || ''); } catch { return {}; }
    const out = { signedIn: params.get('signedIn') === '1', signin: params.get('signin') || '' };
    if (out.signedIn || out.signin) {
      params.delete('signedIn'); params.delete('signin');
      const q = params.toString();
      try { window.history?.replaceState?.(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash || ''}`); } catch {}
    }
    return out;
  }
  const SIGNIN_PROBLEMS = {
    expired: 'That sign-in link has expired or was already used. Request a new one.',
    invalid: 'That sign-in link is not valid. Request a new one.',
    unavailable: 'Sign-in is not available right now.'
  };

  async function init() {
    const me = await api('/api/me');
    if (!me.ok || !me.data.enabled) return state; // accounts not set up: change nothing
    state.enabled = true;
    addStyles();
    const flags = readUrlFlags();
    if (me.data.signedIn) {
      state.signedIn = true; state.user = me.data.user || null;
      if (!(await loadAccount())) toast('Could not load your account. Showing what is saved in this browser.');
    }
    renderTopbar();
    if (flags.signin && SIGNIN_PROBLEMS[flags.signin]) toast(SIGNIN_PROBLEMS[flags.signin]);
    else if (flags.signedIn && state.signedIn) toast(`Signed in as ${state.user?.email || 'your account'}.`);
    if (state.ready) { offerImport(); window.AcresXLibrary?.refresh?.(); }
    return state;
  }

  function addStyles() {
    if ($('accountsStyles')) return;
    const style = el('style', { id: 'accountsStyles' });
    style.textContent = `
.accounts-btn{max-width:220px;min-height:40px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.accounts-btn .accounts-email{display:block;overflow:hidden;text-overflow:ellipsis}
#accountsModal{position:fixed;inset:0;background:rgba(13,30,20,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:99998}
.accounts-dialog{width:min(460px,100%);background:#fff;border-radius:18px;padding:24px;box-shadow:0 30px 80px #0004;box-sizing:border-box}
.accounts-kicker{font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#2d7950}.accounts-dialog h2{font:800 22px Manrope,Arial,sans-serif;margin:5px 0 8px}
.accounts-lead{color:#3f5047;font-size:14px;line-height:1.5;margin:0 0 14px}.accounts-small{color:#66736b;font-size:12px;line-height:1.45;margin:0 0 14px}
#accountsForm label{display:block;font-size:12px;font-weight:800;margin-bottom:6px}#accountsEmail{width:100%;box-sizing:border-box;border:1px solid #cfdad2;border-radius:11px;padding:12px;min-height:44px;font:inherit;font-size:16px}
.accounts-msg{min-height:18px;font-size:13px;color:#a3322a;margin:8px 0 0}.accounts-msg:empty{display:none}
.accounts-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px;flex-wrap:wrap}.accounts-actions button{min-height:44px}
#accountsToast{position:fixed;left:50%;bottom:84px;transform:translate(-50%,8px);background:#174f34;color:#fff;padding:12px 16px;border-radius:10px;font-weight:700;box-shadow:0 10px 30px #0003;opacity:0;pointer-events:none;transition:.2s;z-index:99999;max-width:calc(100vw - 32px)}#accountsToast.show{opacity:1;transform:translate(-50%,0)}
.share-panel{flex-basis:100%;width:100%;margin-top:12px;padding:12px;border:1px solid #dce4de;border-radius:12px;background:#f7faf8;box-sizing:border-box}
.share-note,.share-status{font-size:12px;color:#4a5a50;margin:0 0 8px;line-height:1.45}.share-status:empty{display:none}
.share-row{display:flex;gap:8px;margin-bottom:8px}.share-url{flex:1;min-width:0;border:1px solid #cfdad2;border-radius:10px;padding:10px;font-size:14px;min-height:44px;box-sizing:border-box}
.share-actions{display:flex;gap:8px;flex-wrap:wrap}.share-actions button,.share-row button{min-height:44px}
.library-card:has(.share-panel){flex-wrap:wrap}
@media(max-width:700px){.accounts-btn{max-width:96px;padding:9px 10px;font-size:12px}.accounts-dialog{padding:18px;border-radius:14px}.accounts-actions button{flex:1 1 auto}.share-row{flex-direction:column}}
`;
    document.head.appendChild(style);
  }

  window.AcresXAccounts = { state, storeFor, brandingStore, reportGenerated, decorateReportCard, offerImport, importLocal, localWork, init, openSignIn, signOut };
  window.AcresXAccounts.ready = document.readyState === 'loading'
    ? new Promise(resolve => document.addEventListener('DOMContentLoaded', () => resolve(init())))
    : init();
})();
