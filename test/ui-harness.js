// A small fake DOM, a manual clock and a stubbed fetch for running public/*.js scripts in a
// node:vm context, offline. Only what the page scripts under test touch: elements with ids,
// classes, data attributes and text; simple selectors (tag, #id, .class, [attr], [attr="v"],
// compound and descendant); innerHTML is stored as text, not parsed. Unsupported selectors
// (pseudo-classes, child combinators) match nothing instead of throwing.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export const readPublic = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

function camel(attr) { return attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

export class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase(); this.ownerDocument = doc;
    this.children = []; this.parentNode = null; this.id = ''; this.className = '';
    this.dataset = {}; this.attrs = {}; this.style = { removeProperty() {} };
    this._text = ''; this._html = ''; this.listeners = {}; this.value = ''; this.disabled = false;
  }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    return {
      add: (...c) => { el.className = [...new Set([...list(), ...c])].join(' '); },
      remove: (...c) => { el.className = list().filter(x => !c.includes(x)).join(' '); },
      contains: c => list().includes(c),
      toggle(c, force) { const on = force === undefined ? !list().includes(c) : Boolean(force); if (on) this.add(c); else this.remove(c); return on; }
    };
  }
  setAttribute(name, value) {
    if (name === 'id') this.id = String(value);
    else if (name === 'class') this.className = String(value);
    else if (name.startsWith('data-')) this.dataset[camel(name)] = String(value);
    else this.attrs[name] = String(value);
  }
  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name.startsWith('data-')) return this.dataset[camel(name)] ?? null;
    return this.attrs[name] ?? null;
  }
  get attributes() { return []; }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  append(...nodes) { nodes.forEach(n => this.appendChild(n)); }
  prepend(node) { this.insertBefore(node, this.children[0] || null); }
  insertBefore(child, ref) {
    if (!ref || !this.children.includes(ref)) return this.appendChild(child);
    child.remove(); child.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, child); return child;
  }
  insertAdjacentElement(where, el) {
    const p = this.parentNode;
    if (where === 'afterend' && p) { const i = p.children.indexOf(this); el.remove(); el.parentNode = p; p.children.splice(i + 1, 0, el); }
    else if (where === 'beforebegin' && p) p.insertBefore(el, this);
    else this.appendChild(el);
    return el;
  }
  get nextSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  get nextElementSibling() { return this.nextSibling; }
  get previousElementSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) - 1] || null : null; }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; } }
  replaceWith(other) { const p = this.parentNode; if (!p) return; p.insertBefore(other, this); this.remove(); }
  set innerHTML(html) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._html = String(html); this._text = String(html).replace(/<[^>]*>/g, ''); }
  get innerHTML() { return this._html; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._html = ''; this._text = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  focus() {} select() {} scrollIntoView() {}
  get offsetHeight() { return 1; }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  matchesCompound(sel) {
    if (/[:>~+]/.test(sel)) return false;
    const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
    let m, consumed = 0;
    while ((m = re.exec(sel))) {
      consumed += m[0].length;
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
      if (m[2] && this.id !== m[2]) return false;
      if (m[3] && !this.classList.contains(m[3])) return false;
      if (m[4]) { const v = this.getAttribute(m[4]); if (v == null || (m[5] !== undefined && v !== m[5])) return false; }
    }
    return consumed === sel.length && consumed > 0;
  }
  matches(selector) {
    return selector.split(',').some(s => {
      const parts = s.trim().split(/\s+/);
      if (!this.matchesCompound(parts.at(-1))) return false;
      let node = this.parentNode;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (node && !(node.matchesCompound && node.matchesCompound(parts[i]))) node = node.parentNode;
        if (!node) return false;
        node = node.parentNode;
      }
      return true;
    });
  }
  closest(sel) { let n = this; while (n && n.matches) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
  querySelector(sel) { for (const e of this.walk()) if (e.matches(sel)) return e; return null; }
  querySelectorAll(sel) { return [...this.walk()].filter(e => e.matches(sel)); }
}

// Build elements from a compact spec: [tag, {id, class, data-*...}, text, children[]].
export function build(doc, spec) {
  const [tag, attrs = {}, text = '', kids = []] = spec;
  const el = new El(tag, doc);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text) el.textContent = text;
  kids.forEach(k => el.appendChild(build(doc, k)));
  return el;
}

// A manual clock: setTimeout callbacks run when advance() passes their time.
export function makeClock() {
  let now = 0, seq = 0;
  const timers = new Map();
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise(r => setImmediate(r)); };
  return {
    get now() { return now; },
    setTimeout(fn, ms = 0, ...args) { const id = ++seq; timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return 0; },
    clearInterval() {},
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn(...due[1].args);
        await flush();
      }
      now = end;
      await flush();
    },
    flush
  };
}

// fetch stub: routes[path] = { delay, body, status } or a function(body) returning one.
// Every call is recorded; an aborted signal rejects like the browser does.
export function makeFetch(clock, routes) {
  const calls = [];
  const fetch = (url, init = {}) => {
    const path = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, body, signal: init.signal, at: clock.now });
    const route = typeof routes[path] === 'function' ? routes[path](body) : routes[path];
    if (!route) return Promise.reject(new Error(`no stub for ${path}`));
    return new Promise((resolve, reject) => {
      const id = clock.setTimeout(() => resolve({ ok: (route.status || 200) < 400, status: route.status || 200, json: async () => route.body }), route.delay || 0);
      init.signal?.addEventListener?.('abort', () => { clock.clearTimeout(id); const e = new Error('The operation was aborted.'); e.name = 'AbortError'; reject(e); });
    });
  };
  return { fetch, calls };
}

// A vm context with window === the global, the fake DOM and the clock.
export function makeContext({ body = [], clock, fetch, extra = {} }) {
  const head = new El('head');
  const bodyEl = new El('body');
  const document = {
    head, body: bodyEl, readyState: 'complete', listeners: {},
    createElement: tag => new El(tag, document),
    getElementById: id => { for (const e of [...head.walk(), ...bodyEl.walk()]) if (e.id === id) return e; return null; },
    querySelector: sel => bodyEl.querySelector(sel) || head.querySelector(sel),
    querySelectorAll: sel => bodyEl.querySelectorAll(sel),
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener() {}
  };
  body.forEach(spec => bodyEl.appendChild(build(document, spec)));
  const ctx = {
    document, console, Promise, JSON, Math, Number, String, Array, Object, Set, Map, Error, Date, RegExp, Intl,
    AbortController, URL,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    requestAnimationFrame: fn => clock.setTimeout(fn, 16),
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ display: 'block' }),
    fetch,
    alert() {},
    location: { pathname: '/', search: '', hash: '', assign() {} },
    scrollTo() {},
    ...extra
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return { ctx, document, run: (code, name) => vm.runInContext(code, ctx, { filename: name }) };
}
