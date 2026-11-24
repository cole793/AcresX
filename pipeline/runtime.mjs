// Runtime for the in-process Worker calls (docs/explore-index.md section 3, "In-process"):
//   - a fetch wrapper: adds the job's polite User-Agent where a handler sets none, waits and
//     retries once on HTTP 429/503 (Retry-After when given), and counts requests per parcel and
//     per host through AsyncLocalStorage (parcels run concurrently in one process);
//   - a bounded in-memory Cache API standing in for caches.default, so /api/buildable-area reuses
//     the flood, wetlands and slope answers of the same parcel as it does in production. In Node
//     `caches` is otherwise undefined and every handler fetches again (src/shared/edge-cache.js).
import { AsyncLocalStorage } from 'node:async_hooks';
import { USER_AGENT, RATE_LIMIT_BACKOFF_MS, MEMORY_CACHE_ENTRIES } from './config.mjs';

export const requestScope = new AsyncLocalStorage();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function hostOf(input) {
  try { return new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url).host; } catch { return 'unknown'; }
}

// A per-parcel counter: { requests, byHost: {host: n}, rateLimited }. Pass it to requestScope.run().
export function newCounter() { return { requests: 0, byHost: {}, rateLimited: 0, errors: 0 }; }

function count(counter, host) {
  if (!counter) return;
  counter.requests++;
  counter.byHost[host] = (counter.byHost[host] || 0) + 1;
}

function withUserAgent(input, init = {}) {
  const base = init.headers ?? (input instanceof Request ? input.headers : undefined);
  const headers = new Headers(base);
  if (!headers.has('User-Agent')) headers.set('User-Agent', USER_AGENT);
  return { ...init, headers };
}

function retryAfterMs(response) {
  const value = response.headers.get('Retry-After');
  if (!value) return RATE_LIMIT_BACKOFF_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(60000, Math.max(0, seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(60000, Math.max(0, date - Date.now())) : RATE_LIMIT_BACKOFF_MS;
}

// Wraps fetchImpl. global: the counter for requests outside any parcel scope (bulk paging).
export function politeFetch(fetchImpl, { global = newCounter(), backoff = retryAfterMs } = {}) {
  const wrapped = async function (input, init) {
    const counter = requestScope.getStore() || global;
    const host = hostOf(input);
    const options = withUserAgent(input, init);
    count(counter, host);
    let response;
    try { response = await fetchImpl(input, options); } catch (error) { counter.errors++; throw error; }
    // A request with a Request body cannot be sent twice; urls with init bodies can.
    const resendable = !(input instanceof Request);
    if ((response.status === 429 || response.status === 503) && resendable && !options.signal?.aborted) {
      counter.rateLimited++;
      await sleep(backoff(response));
      count(counter, host);
      try { response = await fetchImpl(input, options); } catch (error) { counter.errors++; throw error; }
    }
    return response;
  };
  wrapped.counter = global;
  return wrapped;
}

// ---- In-memory Cache API (match / put / delete), least recently used first out.

function keyOf(request) { return typeof request === 'string' ? request : request?.url || String(request); }

function maxAgeSeconds(cacheControl) {
  const cc = String(cacheControl || '').toLowerCase();
  if (/\b(no-store|private|no-cache)\b/.test(cc)) return 0;
  const s = cc.match(/s-maxage=(\d+)/) || cc.match(/max-age=(\d+)/);
  return s ? Number(s[1]) : 0;
}

export class MemoryCache {
  constructor(maxEntries = MEMORY_CACHE_ENTRIES) { this.maxEntries = maxEntries; this.entries = new Map(); this.hits = 0; this.misses = 0; }
  async match(request) {
    const key = keyOf(request);
    const entry = this.entries.get(key);
    if (!entry || entry.expires < Date.now()) { if (entry) this.entries.delete(key); this.misses++; return undefined; }
    this.entries.delete(key); this.entries.set(key, entry);
    this.hits++;
    return new Response(entry.body.slice(0), { status: entry.status, headers: entry.headers });
  }
  async put(request, response) {
    const ttl = maxAgeSeconds(response.headers.get('Cache-Control'));
    if (!(ttl > 0) || response.status !== 200) return;
    const body = await response.arrayBuffer();
    const key = keyOf(request);
    this.entries.delete(key);
    this.entries.set(key, { body, status: response.status, headers: [...response.headers], expires: Date.now() + ttl * 1000 });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }
  async delete(request) { return this.entries.delete(keyOf(request)); }
}

// The handlers log one {"evt":"upstream",...} line per attempt (src/shared/upstream.js) and warn
// on degraded layers. For a batch of thousands of parcels these are summarised per host instead
// of printed: { hosts: { host: { attempts, failed, ms } }, warnings, restore }.
export function quietHandlerLogs({ verbose = false } = {}) {
  const log = console.log, warn = console.warn;
  const hosts = {};
  let warnings = 0;
  console.log = (...args) => {
    const first = args[0];
    if (typeof first === 'string' && first.startsWith('{"evt":"upstream"')) {
      try {
        const e = JSON.parse(first);
        const h = hosts[e.host] ||= { attempts: 0, failed: 0, ms: 0 };
        h.attempts++; if (!e.ok) h.failed++; h.ms += Number(e.ms) || 0;
      } catch { /* not ours */ }
      if (!verbose) return;
    }
    log(...args);
  };
  console.warn = (...args) => { warnings++; if (verbose) warn(...args); };
  return { hosts, get warnings() { return warnings; }, restore() { console.log = log; console.warn = warn; } };
}

// Installs the wrapper and the cache on globalThis; returns { counter, cache, restore }.
export function installRuntime({ fetchImpl = globalThis.fetch, cache = true } = {}) {
  const previousFetch = globalThis.fetch;
  const hadCaches = Object.prototype.hasOwnProperty.call(globalThis, 'caches');
  const previousCaches = globalThis.caches;
  const fetch = politeFetch(fetchImpl);
  globalThis.fetch = fetch;
  const memory = cache ? new MemoryCache() : null;
  if (memory) globalThis.caches = { default: memory, open: async () => memory };
  return {
    counter: fetch.counter, cache: memory,
    restore() {
      globalThis.fetch = previousFetch;
      if (hadCaches) globalThis.caches = previousCaches; else delete globalThis.caches;
    }
  };
}
