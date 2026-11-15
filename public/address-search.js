// Address search, map-click search and "Parcel not found" help for the search form.
//
// - One input, "Parcel number or address". Text that looks like a parcel number goes through the
//   existing parcel search untouched. Text that looks like a street address gets suggestions
//   while typing (250 ms debounce, 4+ characters) from /api/address-search action 'suggest' (the
//   county's address locator; Kootenai runs from the browser, public/browser-fallback.js kind
//   'kootenai-address'). Picking one (or pressing Enter) runs 'resolve': the address point ->
//   the parcel under it on the county parcel layer (or a situs match). One sure parcel fills the
//   input with its parcel number and submits the form, so the normal parcel search runs.
//   Several -> a choice list. None -> the Census geocoder: an approximate map point, and the user
//   confirms the parcel on the map. A Census point never selects a parcel by itself.
// - "Pick on map": a small map under the form; a click runs 'point' (point-in-parcel) for the
//   chosen county and a popup shows the parcel number and address with "Analyze this parcel".
// - Parcel not found: the format of the county's parcel numbers, the same number checked in the
//   state's other supported counties ("Did you mean <county>?") and a way to search by address.
// Results are screening info: notes say to verify with the county.
// Injected by maybeInjectUiPolish() in src/index.js after state-selector.js (it wraps the
// findParcel that file installs) and before browser-fallback.js (which wraps fetch; this file
// calls the global fetch at request time, so the wrapper applies).
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc || root.AcresXAddress) return;
  const $ = id => doc.getElementById(id);
  const form = $('searchForm'), input = $('parcel'), countyEl = $('county');
  if (!form || !input || !countyEl) return;

  const PLACEHOLDER = 'Parcel number or address';
  const DEBOUNCE_MS = 250, MIN_CHARS = 4;
  const STATE_NAMES = { WA: 'Washington', ID: 'Idaho', MT: 'Montana' };
  const APPROXIMATE = 'Approximate location — confirm the parcel';
  // Where the map picker opens: the county (supported counties and a few others), else the state.
  const VIEWS = {
    'WA:Spokane': [47.62, -117.40, 10], 'WA:Stevens': [48.40, -117.85, 9], 'ID:Kootenai': [47.67, -116.70, 10],
    'MT:Yellowstone': [45.90, -108.30, 9], 'MT:Gallatin': [45.55, -111.15, 9], 'MT:Flathead': [48.30, -114.30, 9],
    WA: [47.40, -120.70, 7], ID: [45.50, -114.50, 6], MT: [47.00, -109.60, 6]
  };
  const PICK_MIN_ZOOM = 13;

  const state = () => ($('state')?.value || 'WA');
  const county = () => String(countyEl.value || '').trim();
  const needsCounty = () => !$('state') || !$('state').value || ((state() === 'MT' || state() === 'ID') && !county());

  // "3572 S Moose Canyon Rd", "moose canyon": an address. "27081.9058", "50N04W323200",
  // "0L8210010030", "03 0823 0341 0010000", "RPA 1234 0010": a parcel number (no word of 2+ letters
  // after a space, or mostly digits without a leading house number).
  function looksLikeAddress(text) {
    const t = String(text || '').trim();
    if (t.length < MIN_CHARS || !/\s/.test(t)) return false;
    const tokens = t.split(/\s+/);
    const houseNumber = /^\d+[A-Za-z]?$/.test(tokens[0]);
    // Mostly digits and no leading house number: a spaced parcel number ("RPA 1234 0010", "SW 1234 5678").
    const digits = (t.match(/\d/g) || []).length, letters = (t.match(/[A-Za-z]/g) || []).length;
    if (!houseNumber && digits > letters) return false;
    const rest = houseNumber ? tokens.slice(1) : tokens;
    return rest.some(tok => /[A-Za-z]{2,}/.test(tok));
  }

  async function api(body, signal) {
    const response = await root.fetch('/api/address-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    let data = null;
    try { data = await response.json(); } catch { /* below */ }
    if (!data?.available) throw Object.assign(new Error(data?.error || `Address search returned ${response.status}`), { data });
    return data;
  }

  // ---- DOM

  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  const list = el('ul', 'ax-addr-list');
  list.id = 'axAddrList';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  // In <body> with fixed positioning: the search card clips its children (overflow: hidden).
  (doc.body || form).appendChild(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'axAddrList');
  input.setAttribute('aria-expanded', 'false');

  const tools = el('div', 'ax-addr-tools');
  const pickBtn = el('button', 'ax-addr-btn', 'Pick on map');
  pickBtn.type = 'button';
  pickBtn.id = 'axPickOnMap';
  const note = el('span', 'ax-addr-note');
  note.id = 'axAddrNote';
  note.setAttribute('aria-live', 'polite');
  tools.append(pickBtn, note);
  form.insertAdjacentElement('afterend', tools);
  const helper = form.parentNode?.querySelector?.('.helper');
  if (helper) helper.textContent = 'Enter a parcel number or a street address, or pick a spot on the map. Spaces, dashes and periods in parcel numbers are ignored.';

  function setPlaceholder() { if (!input.disabled) input.placeholder = PLACEHOLDER; }
  setPlaceholder();
  $('state')?.addEventListener('change', setPlaceholder);
  root.addEventListener?.('acresx:coverage', setPlaceholder);

  function setNote(text, kind = '') { note.textContent = text || ''; note.className = `ax-addr-note${kind ? ` ax-addr-note-${kind}` : ''}`; }

  // ---- Suggestion / choice list

  let items = [], active = -1;
  function placeList() {
    const r = input.getBoundingClientRect?.();
    if (r) {
      list.style.left = `${Math.max(8, r.left)}px`;
      list.style.top = `${r.bottom + 6}px`;
      list.style.width = `${Math.max(r.width, Math.min(260, (root.innerWidth || 390) - 16))}px`;
    }
  }
  function closeList() { list.hidden = true; list.innerHTML = ''; items = []; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute?.('aria-activedescendant'); }
  function openList(entries, heading) {
    list.innerHTML = '';
    items = entries;
    active = -1;
    if (heading) { const h = el('li', 'ax-addr-info', heading); h.setAttribute('role', 'presentation'); list.appendChild(h); }
    entries.forEach((entry, i) => {
      const li = el('li', entry.info ? 'ax-addr-info' : 'ax-addr-item');
      li.id = `axAddrOpt${i}`;
      li.setAttribute('role', entry.info ? 'presentation' : 'option');
      li.appendChild(el('span', '', entry.label));
      if (entry.detail) li.appendChild(el('small', '', entry.detail));
      if (!entry.info) {
        li.addEventListener('mousedown', e => e.preventDefault()); // keep focus in the input
        li.addEventListener('click', () => choose(i));
      }
      list.appendChild(li);
    });
    placeList();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function highlight(i) {
    const options = items.map((it, n) => (it.info ? -1 : n)).filter(n => n >= 0);
    if (!options.length) return;
    active = options[(options.indexOf(active) + i + options.length) % options.length] ?? options[0];
    items.forEach((_, n) => $(`axAddrOpt${n}`)?.setAttribute('aria-selected', String(n === active)));
    input.setAttribute('aria-activedescendant', `axAddrOpt${active}`);
    $(`axAddrOpt${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }
  function choose(i) {
    const entry = items[i];
    if (!entry || entry.info) return;
    closeList();
    entry.pick();
  }

  // ---- Suggest

  let timer = null, controller = null, seq = 0;
  function cancelSuggest() { clearTimeout(timer); timer = null; if (controller) controller.abort(); controller = null; seq++; }
  async function suggest(text) {
    const mine = ++seq;
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    let data;
    try { data = await api({ action: 'suggest', state: state(), county: county(), text }, controller?.signal); }
    catch (error) {
      if (mine !== seq || error?.name === 'AbortError') return;
      openList([{ info: true, label: 'Address suggestions are unavailable right now.', detail: 'Press Enter to search this address, or use Pick on map.' }]);
      return;
    }
    if (mine !== seq || input.value.trim() !== text) return;
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    if (!suggestions.length) { openList([{ info: true, label: 'No address suggestions.', detail: 'Press Enter to search this address, or use Pick on map.' }]); return; }
    openList(suggestions.map(s => ({
      label: s.text,
      detail: s.parcelId ? `Parcel ${s.parcelId}` : '',
      pick: () => {
        input.value = s.text;
        if (s.parcelId) applyParcel({ parcelId: s.parcelId, address: s.text, county: county(), state: state() }, { matched: s.text, agency: data.source?.agency });
        else resolve(s.text, s.magicKey || '');
      }
    })), data.source?.agency ? `Addresses from ${data.source.agency}` : '');
  }

  input.addEventListener('input', () => {
    cancelSuggest();
    setNote('');
    const text = input.value.trim();
    if (text.length < MIN_CHARS || !looksLikeAddress(text) || needsCounty()) { closeList(); return; }
    timer = setTimeout(() => suggest(text), DEBOUNCE_MS);
  });
  input.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(-1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeList(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (doc.activeElement !== input) closeList(); }, 150));
  root.addEventListener?.('resize', () => { if (!list.hidden) placeList(); });
  root.addEventListener?.('scroll', () => { if (!list.hidden) placeList(); }, true);

  // ---- Address -> parcel

  let bypass = false;
  function submitParcelSearch() {
    bypass = true;
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else $('searchBtn')?.click?.();
  }

  // Fills the form with the parcel (switching the county when the parcel layer says it is in
  // another one, e.g. a statewide Montana match) and runs the normal parcel search.
  function applyParcel(parcel, { matched = '', agency = '', approximate = false } = {}) {
    closeList();
    cancelSuggest();
    const found = String(parcel.county || '').trim();
    let moved = '';
    if (found && found.toLowerCase() !== county().toLowerCase() && [...(countyEl.options || [])].some(o => o.value === found)) {
      countyEl.value = found;
      moved = ` in ${found} County`;
      countyEl.dispatchEvent?.(new Event('change', { bubbles: true }));
    }
    input.value = parcel.parcelId;
    const where = [parcel.address, parcel.city].filter(Boolean).join(', ');
    setNote(`${matched ? `${matched} → ` : ''}parcel ${parcel.parcelId}${moved}${where && where !== matched ? ` (${where})` : ''}${agency ? `, from ${agency}` : ''}${approximate ? ', confirmed on the map' : ''}. Verify with the county assessor.`, 'ok');
    submitParcelSearch();
  }

  function parcelEntries(parcels, opts) {
    return parcels.map(p => ({ label: `Parcel ${p.parcelId}`, detail: [p.address, p.city, p.county && p.county !== county() ? `${p.county} County` : ''].filter(Boolean).join(', ') || 'No site address on record', pick: () => applyParcel(p, opts) }));
  }

  let resolving = 0;
  async function resolve(text, magicKey) {
    const mine = ++resolving;
    closeList();
    setNote('Finding that address…');
    let data;
    try { data = await api({ action: 'resolve', state: state(), county: county(), text, magicKey }); }
    catch (error) {
      if (mine !== resolving) return;
      setNote(`Address search is unavailable (${error.message}). Enter the parcel number, or use Pick on map.`, 'warn');
      return;
    }
    if (mine !== resolving) return;
    const parcels = Array.isArray(data.parcels) ? data.parcels : [];
    const opts = { matched: data.matchedAddress || text, agency: data.source?.agency };
    if (parcels.length === 1 && data.exact && data.method !== 'address-near') { applyParcel(parcels[0], opts); return; }
    if (parcels.length) {
      setNote('');
      const why = data.method === 'address-near' ? 'The address point is between parcels. Choose one:' : data.interpolated ? 'Estimated address location. Choose the parcel:' : 'More than one parcel matches. Choose one:';
      openList(parcelEntries(parcels, opts), why);
      input.focus?.();
      return;
    }
    if (data.point) { setNote(''); openPicker({ center: data.point, zoom: 17 }); lookupPoint(data.point, { approximate: true }); return; }
    setNote('No county address match. Trying the Census geocoder (approximate)…');
    let census;
    try { census = await api({ action: 'census', state: state(), county: county(), text }); }
    catch (error) {
      if (mine !== resolving) return;
      setNote(`Address not found (${error.message}). Check the spelling, enter the parcel number, or use Pick on map.`, 'warn');
      return;
    }
    if (mine !== resolving) return;
    if (!census.point) { setNote('Address not found. Check the spelling, enter the parcel number, or use Pick on map.', 'warn'); return; }
    setNote(`${census.label || APPROXIMATE}: ${census.matchedAddress || text}. Click the right parcel on the map.`, 'warn');
    openPicker({ center: census.point, zoom: 17 });
    lookupPoint(census.point, { approximate: true });
  }

  // Address-like text submitted with Enter or the button: resolve it instead of the parcel search.
  // Window capture runs before the form's own submit listeners (loading modal, search).
  root.addEventListener('submit', e => {
    if (e.target !== form) return;
    if (bypass) { bypass = false; clearHelp(); return; }
    clearHelp();
    const text = input.value.trim();
    if (!looksLikeAddress(text)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (needsCounty()) { ($('state')?.value ? countyEl : $('state') || countyEl).focus?.(); setNote('Select a state and county first.', 'warn'); return; }
    if (active >= 0 && !list.hidden) { choose(active); return; }
    cancelSuggest();
    resolve(text, '');
  }, true);

  // ---- Map picker

  let picker = null, pickerMap = null, marker = null, pointSeq = 0;
  function ensurePicker() {
    if (picker) return picker;
    picker = el('section', 'ax-addr-picker');
    picker.id = 'axAddrPicker';
    const head = el('div', 'ax-addr-picker-head');
    const title = el('span', '', 'Zoom in and click a parcel to load it.');
    title.id = 'axAddrPickerTitle';
    const close = el('button', 'ax-addr-close', 'Close map');
    close.type = 'button';
    close.addEventListener('click', closePicker);
    head.append(title, close);
    const mapEl = el('div', 'ax-addr-map');
    mapEl.id = 'axAddrMap';
    picker.append(head, mapEl);
    tools.insertAdjacentElement('afterend', picker);
    return picker;
  }
  function viewFor() { return VIEWS[`${state()}:${county()}`] || VIEWS[state()] || VIEWS.WA; }
  function openPicker({ center, zoom } = {}) {
    if (needsCounty()) { setNote('Select a state and county first.', 'warn'); return; }
    ensurePicker();
    picker.hidden = false;
    pickBtn.setAttribute('aria-expanded', 'true');
    const L = root.L;
    if (!L) { $('axAddrPickerTitle').textContent = 'The map could not load.'; return; }
    const [lat, lon, z] = center ? [center.lat, center.lon, zoom || 16] : viewFor();
    if (!pickerMap) {
      pickerMap = L.map('axAddrMap', { zoomControl: true }).setView([lat, lon], z);
      const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(pickerMap);
      const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' });
      L.control.layers({ Street: street, Satellite: satellite }, {}, { position: 'topright' }).addTo(pickerMap);
      pickerMap.on('click', e => {
        if (pickerMap.getZoom() < PICK_MIN_ZOOM) { pickerMap.setView(e.latlng, Math.max(PICK_MIN_ZOOM + 2, pickerMap.getZoom() + 3)); $('axAddrPickerTitle').textContent = 'Zoomed in. Click the parcel to load it.'; return; }
        lookupPoint({ lat: e.latlng.lat, lon: e.latlng.lng }, {});
      });
    } else {
      pickerMap.setView([lat, lon], z);
    }
    setTimeout(() => pickerMap?.invalidateSize?.(), 50);
    $('axAddrPickerTitle').textContent = center ? 'Click the right parcel if the marker is not on it.' : 'Zoom in and click a parcel to load it.';
    try { picker.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); } catch { /* ignore */ }
  }
  function closePicker() { if (picker) picker.hidden = true; pickBtn.setAttribute('aria-expanded', 'false'); }
  pickBtn.addEventListener('click', () => { if (picker && !picker.hidden) closePicker(); else openPicker(); });

  function popupContent(title, parcels, opts, extra = '') {
    const box = el('div', 'ax-addr-pop');
    box.appendChild(el('strong', '', title));
    if (extra) box.appendChild(el('div', 'ax-addr-pop-note', extra));
    for (const p of parcels) {
      const row = el('div', 'ax-addr-pop-row');
      row.appendChild(el('div', 'ax-addr-pop-id', `Parcel ${p.parcelId}`));
      row.appendChild(el('div', 'ax-addr-pop-addr', [p.address, p.city, p.county && p.county !== county() ? `${p.county} County` : ''].filter(Boolean).join(', ') || 'No site address on record'));
      const go = el('button', 'ax-addr-pop-go', 'Analyze this parcel');
      go.type = 'button';
      go.addEventListener('click', () => { pickerMap?.closePopup?.(); closePicker(); applyParcel(p, opts); });
      row.appendChild(go);
      box.appendChild(row);
    }
    return box;
  }

  async function lookupPoint(point, { approximate = false } = {}) {
    const L = root.L;
    if (!pickerMap || !L) return;
    const mine = ++pointSeq;
    if (marker) marker.remove();
    marker = L.marker([point.lat, point.lon]).addTo(pickerMap);
    marker.bindPopup(popupContent(approximate ? APPROXIMATE : 'Looking up the parcel…', [], {}), { maxWidth: 280 }).openPopup();
    let data;
    try { data = await api({ action: 'point', state: state(), county: county(), lat: point.lat, lon: point.lon }); }
    catch (error) {
      if (mine !== pointSeq) return;
      marker.setPopupContent(popupContent('Parcel lookup unavailable', [], {}, `${error.message}. Enter the parcel number instead.`));
      return;
    }
    if (mine !== pointSeq) return;
    const parcels = Array.isArray(data.parcels) ? data.parcels : [];
    const opts = { matched: '', agency: data.source?.agency, approximate };
    const title = approximate ? APPROXIMATE : !parcels.length ? 'No parcel here' : data.near ? 'No parcel exactly here. Nearby:' : 'Parcel at this spot';
    const extra = !parcels.length ? 'Try another spot, or zoom in further.' : approximate ? 'This point is an estimate. Confirm the parcel below, or click the right one on the map.' : 'Verify with the county assessor.';
    marker.setPopupContent(popupContent(title, parcels, opts, extra));
    marker.openPopup();
  }

  // ---- Parcel not found help

  let help = null, helpSeq = 0;
  function clearHelp() { helpSeq++; if (help) { help.remove(); help = null; } }
  function helpButton(label, onClick) { const b = el('button', 'ax-help-btn', label); b.type = 'button'; b.addEventListener('click', onClick); return b; }
  async function showNotFound(countyName, parcelId) {
    clearHelp();
    const mine = helpSeq;
    const st = state();
    help = el('div', 'ax-parcel-help');
    help.id = 'axParcelHelp';
    const format = el('p', '', `Check the parcel number format for ${countyName ? `${countyName} County` : 'the county'}.`);
    const others = el('p', 'ax-help-muted', `Checking other supported ${STATE_NAMES[st] || ''} counties…`);
    const actions = el('div', 'ax-help-actions');
    actions.append(
      helpButton('Search by address', () => { clearHelp(); input.value = ''; input.placeholder = 'Enter a street address, e.g. 123 Main St'; input.focus?.(); }),
      helpButton('Pick on map', () => { clearHelp(); openPicker(); })
    );
    help.append(format, others, actions);
    ($('status') || tools).insertAdjacentElement('afterend', help);
    let data = null;
    try { data = await api({ action: 'other-counties', state: st, county: countyName, parcelId }); } catch { data = null; }
    if (mine !== helpSeq || !help) return;
    if (data?.example) format.textContent = `Check the parcel number format: ${countyName} County parcel numbers look like ${data.example}.`;
    else format.textContent = `Check the parcel number: use the number shown by the ${countyName ? `${countyName} County ` : ''}assessor.`;
    const matches = Array.isArray(data?.matches) ? data.matches : [];
    if (!data) { others.textContent = 'Other counties could not be checked right now.'; return; }
    if (!matches.length) { others.textContent = data.checked?.length ? `Not found in the other supported ${STATE_NAMES[st] || ''} counties either.` : ''; return; }
    others.textContent = '';
    for (const m of matches) {
      const row = el('div', 'ax-help-match');
      row.appendChild(el('span', '', `Did you mean ${m.county} County? Parcel ${m.parcelId}${m.address ? `, ${m.address}` : ''}`));
      row.appendChild(helpButton(`Search ${m.county} County`, () => applyParcel({ parcelId: m.parcelId, address: m.address, city: m.city, county: m.county, state: st }, {})));
      others.appendChild(row);
    }
  }

  const priorFind = root.findParcel;
  if (typeof priorFind === 'function') {
    root.findParcel = async function (countyName, parcelInput, ...rest) {
      try { return await priorFind.call(this, countyName, parcelInput, ...rest); }
      catch (error) {
        // Only for the search form's own lookup (saved properties call findParcel too).
        if (/parcel not found/i.test(String(error?.message || '')) && String(parcelInput ?? '').trim() === input.value.trim() && String(countyName ?? '') === county()) {
          setTimeout(() => showNotFound(String(countyName || ''), String(parcelInput).trim()), 0);
        }
        throw error;
      }
    };
  }

  // ---- Styles (search form, suggestions, picker and not-found help only)

  if (!$('axAddressStyles')) {
    const style = el('style');
    style.id = 'axAddressStyles';
    style.textContent = `
      .ax-addr-list{position:fixed;z-index:1300;margin:0;padding:6px;list-style:none;background:#fff;color:var(--ink,#17231c);border-radius:12px;box-shadow:0 14px 34px rgba(0,0,0,.24);max-height:320px;overflow:auto;box-sizing:border-box;max-width:calc(100vw - 32px)}
      .ax-addr-list[hidden]{display:none}
      .ax-addr-item{display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:44px;padding:9px 12px;border-radius:9px;cursor:pointer;font-size:14px;line-height:1.3}
      .ax-addr-item small,.ax-addr-info small{display:block;color:var(--muted,#66736b);font-size:12px}
      .ax-addr-item:hover,.ax-addr-item[aria-selected="true"]{background:var(--pale,#e7f0ea)}
      .ax-addr-info{padding:8px 12px;font-size:12px;color:var(--muted,#66736b)}
      .ax-addr-tools{position:relative;z-index:1;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-top:10px}
      .ax-addr-btn{border:1px solid rgba(255,255,255,.55);background:rgba(255,255,255,.12);color:#fff;border-radius:10px;padding:9px 14px;min-height:40px;font-weight:700;font-size:13px}
      .ax-addr-btn:hover{background:rgba(255,255,255,.22)}
      .ax-addr-note{flex:1 1 260px;font-size:13px;line-height:1.35;color:#e4efe8}
      .ax-addr-note-warn{color:#ffe2a8}
      .ax-addr-picker{position:relative;z-index:1;margin-top:12px;background:#fff;color:var(--ink,#17231c);border-radius:14px;overflow:hidden}
      .ax-addr-picker[hidden]{display:none}
      .ax-addr-picker-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;font-size:13px}
      .ax-addr-close{border:1px solid var(--line,#dce4de);background:#fff;border-radius:8px;padding:7px 10px;min-height:36px;font-weight:700;font-size:12px}
      .ax-addr-map{height:340px}
      .ax-addr-pop{font:13px/1.35 "DM Sans",system-ui,sans-serif;min-width:200px}
      .ax-addr-pop-note{color:#66736b;font-size:12px;margin:4px 0}
      .ax-addr-pop-row{border-top:1px solid #dce4de;padding:6px 0}
      .ax-addr-pop-id{font-weight:800}
      .ax-addr-pop-go{margin-top:6px;border:0;background:#1d5d3a;color:#fff;border-radius:8px;padding:8px 10px;min-height:36px;font-weight:700;font-size:12px}
      .ax-parcel-help{margin-top:10px;padding:12px 14px;border-radius:12px;background:#fff;border:1px solid var(--line,#dce4de);font-size:13px}
      .ax-parcel-help p{margin:0 0 8px}
      .ax-help-muted{color:var(--muted,#66736b)}
      .ax-help-match{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:4px 0}
      .ax-help-actions{display:flex;flex-wrap:wrap;gap:8px}
      .ax-help-btn{border:1px solid var(--line,#dce4de);background:var(--pale,#e7f0ea);color:var(--green,#1d5d3a);border-radius:9px;padding:8px 12px;min-height:38px;font-weight:700;font-size:12px}
      @media(max-width:700px){.ax-addr-map{height:300px}.ax-addr-list{max-height:260px}.ax-addr-btn{flex:1 1 auto}}
    `;
    doc.head.appendChild(style);
  }

  root.AcresXAddress = Object.freeze({ looksLikeAddress, resolve, suggest, openPicker, lookupPoint, showNotFound, applyParcel });
})(typeof window !== 'undefined' ? window : globalThis);
