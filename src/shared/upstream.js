// One shared way to call government map servers and other upstream data sources.
//
//   upstreamJson(url, opts)            -> parsed JSON (one retry by default)
//   arcgisQuery(layerUrl, params, opts) -> features[] from <layerUrl>/query (ArcGIS-aware)
//   arcgisJson(url, params, opts)       -> whole ArcGIS JSON answer (metadata, identify, ...)
//   upstreamFetch(url, opts)            -> buffered Response, one attempt (shared/http.js
//                                          fetchWithTimeout is built on it)
//   cachedJson(prefix, key, ttl, produce, { isValid }) -> Cache API wrapper, validated answers only
//
// Rules every request follows:
// - The timeout starts when the request is sent and covers the headers AND the body. (The old
//   fetchWithTimeout cleared its timer when headers arrived, so a slow body was unbounded.) The
//   wait for a host slot before that has its own budget, queueTimeoutMs (default: timeoutMs), so
//   a request queued behind slow ones still gets its full timeout once sent, and a slot that
//   never frees still fails in finite time (kind 'timeout', never sent).
// - No `cf` edge caching. ArcGIS servers send errors as HTTP 200 bodies, and `cf.cacheEverything`
//   kept those errors as successes for up to 24 h. Any `cf` passed in is dropped. Validated answers
//   can be cached with cachedJson() (Cache API, src/shared/edge-cache.js).
// - At most UPSTREAM_DEFAULTS.maxPerHost requests in flight to one host at a time, so a lookup
//   cannot burst a county server (Kootenai sent 7 assessor queries at once). Workers has no
//   request-scoped storage without the nodejs_als flag, so the cap is per isolate: it covers every
//   request the isolate is serving, which is never looser than per request. Waiters poll (no
//   promise is resolved from another request's context) and a slot left by a cancelled request
//   expires at its deadline.
// - One structured log line per attempt, read in Cloudflare Workers Logs (observability is on):
//   {"evt":"upstream","host","label","status","ms","ok","attempt","err"}. The line never holds
//   the URL query, request body or headers (they can carry API keys).
// - upstreamJson retries once (default) after a short backoff on a timeout, network error, HTTP
//   5xx, invalid JSON, or an ArcGIS {error} whose code is not 4xx. An ArcGIS {error} in an HTTP
//   200 body is an error. A GET whose URL would pass maxGetUrlLength is sent as a form-encoded POST
//   (every ArcGIS REST endpoint accepts both).
//
// Error messages (UpstreamError.message), chosen to match what the callers said before:
//   http    `${agency} returned ${status}`
//   arcgis  the server's error.message, else opts.arcgisMessage (string, or fn(message, error))
//           else `${agency} query failed`
//   json    `${agency} returned invalid JSON`
//   timeout `${agency} timed out after ${s}s`
//   network the original error message
// `agency` defaults to the host. UpstreamError also has kind, status, code, host, label, attempt,
// retryable and (for http errors) body: the parsed JSON or text of the error answer.
//
// src/shared/arcgis.js arcgisQuery(base, params, { agency, timeoutMs }) is a thin wrapper over
// arcgisQuery here (same features[] result; it adds a 1,800-char GET limit and 12 s + 8 s
// timeouts); errors from an ArcGIS {error} body have kind 'arcgis' and arcgisError: true.

import { openValueCache, readCachedJson, writeCachedJson } from './edge-cache.js';

export const UPSTREAM_DEFAULTS = Object.freeze({
  timeoutMs: 15000,
  retries: 1,
  backoffMs: 300,
  maxPerHost: 4,
  maxGetUrlLength: 3500
});

// Under `node --test` (NODE_TEST_CONTEXT is set) log lines are off unless ACRESX_UPSTREAM_LOG=1;
// tests that check them pass their own `log` to configureUpstream(). Workers has no `process`.
const quietTests = (() => {
  try { return Boolean(globalThis.process?.env?.NODE_TEST_CONTEXT) && !globalThis.process?.env?.ACRESX_UPSTREAM_LOG; } catch { return false; }
})();
let settings = { ...UPSTREAM_DEFAULTS, pollMs: 10, log: quietTests ? () => {} : line => console.log(line) };

// Tests only: override defaults (e.g. backoffMs: 0, log: collector). Returns a restore function.
export function configureUpstream(overrides = {}) {
  const previous = settings;
  settings = { ...settings, ...overrides };
  return () => { settings = previous; };
}

export class UpstreamError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'UpstreamError';
    Object.assign(this, fields);
    if (fields.kind === 'arcgis') this.arcgisError = true;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return 'invalid-url'; }
}

// Path only (never the query), trimmed: a readable default label for log lines.
function pathLabel(url) {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    return path.length > 80 ? `…${path.slice(-79)}` : path || '/';
  } catch { return 'invalid-url'; }
}

// ---- Per-host in-flight cap (per isolate, see above).

const hosts = new Map();

function hostState(host) {
  let state = hosts.get(host);
  if (!state) { state = { active: new Set(), queue: [] }; hosts.set(host, state); }
  return state;
}

function prune(state, now) {
  for (const slot of state.active) if (slot.expiresAt <= now) state.active.delete(slot);
  state.queue = state.queue.filter(ticket => ticket.expiresAt > now);
}

// Resolves a release function once fewer than `cap` requests to `host` are in flight. FIFO among
// waiters. Rejects when `signal` aborts (timeout or caller cancel).
// The ticket expires at `expiresAt` (the end of the queue budget); a slot taken expires
// slotMs + 1 s after it was taken (the request's own timeout plus slack).
async function acquireSlot(host, cap, expiresAt, slotMs, signal) {
  const state = hostState(host);
  const ticket = { expiresAt };
  const leave = () => { const index = state.queue.indexOf(ticket); if (index >= 0) state.queue.splice(index, 1); };
  // An abort (timeout or caller cancel) leaves the queue at once and wakes the poll, so a ticket
  // never lingers until a poll that may not come (e.g. a timer dropped by the runtime).
  let wake = null;
  const onAbort = () => { leave(); if (wake) wake(); };
  state.queue.push(ticket);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason ?? new Error('aborted');
      prune(state, Date.now());
      if (!state.queue.includes(ticket)) state.queue.push(ticket);
      const position = state.queue.indexOf(ticket);
      if (state.active.size + position < cap) {
        const slot = { expiresAt: Date.now() + slotMs + 1000 };
        state.active.add(slot);
        return () => state.active.delete(slot);
      }
      await new Promise(resolve => {
        const timer = setTimeout(resolve, settings.pollMs);
        wake = () => { clearTimeout(timer); resolve(); };
      });
      wake = null;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    leave();
  }
}

// Test/diagnostic helper: tickets currently waiting for a slot for `host`.
export function queued(host) {
  return hosts.get(host)?.queue.length ?? 0;
}

// Test/diagnostic helper: requests currently holding a slot for `host`.
export function inFlight(host) {
  const state = hosts.get(host);
  if (!state) return 0;
  prune(state, Date.now());
  return state.active.size;
}

// ---- One attempt: slot + fetch + full body, all inside the timeout.

function rejectOnAbort(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason ?? new Error('aborted'));
    else signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
  });
}

// Runs fn as a promise (a synchronous throw becomes a rejection). The promise may lose a race
// against the abort signal and reject later, so it is marked handled.
function quiet(fn) {
  const promise = (async () => fn())();
  promise.catch(() => {});
  return promise;
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

// Returns { status, statusText, headers, buffer } or throws UpstreamError (timeout | network | cancelled).
async function attemptOnce(url, init, { host, label, agency, timeoutMs, queueTimeoutMs = timeoutMs, signal, maxPerHost, attempt }) {
  const controller = new AbortController();
  let timedOut = false, queuedOut = false;
  // First the queue budget (waiting for a host slot), then, once a slot is held, the request timeout.
  let timer = setTimeout(() => { queuedOut = true; controller.abort(new Error('queue timeout')); }, queueTimeoutMs);
  const onCancel = () => controller.abort(new Error('cancelled'));
  if (signal) { if (signal.aborted) onCancel(); else signal.addEventListener('abort', onCancel, { once: true }); }
  const aborted = rejectOnAbort(controller.signal);
  aborted.catch(() => {});
  let release = null;
  try {
    release = await Promise.race([quiet(() => acquireSlot(host, maxPerHost, Date.now() + queueTimeoutMs, timeoutMs, controller.signal)), aborted]);
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; controller.abort(new Error('timeout')); }, timeoutMs);
    const { cf, ...rest } = init || {};
    const response = await Promise.race([quiet(() => fetch(url, { ...rest, signal: controller.signal })), aborted]);
    const buffer = await Promise.race([quiet(() => response.arrayBuffer()), aborted]);
    return { status: response.status, statusText: response.statusText, headers: response.headers, buffer };
  } catch (error) {
    const fields = { host, label, attempt, cause: error };
    if (queuedOut) throw new UpstreamError(`${agency} timed out after ${Math.round(queueTimeoutMs / 100) / 10}s waiting for a free connection`, { ...fields, kind: 'timeout', queued: true, retryable: true });
    if (timedOut) throw new UpstreamError(`${agency} timed out after ${Math.round(timeoutMs / 100) / 10}s`, { ...fields, kind: 'timeout', retryable: true });
    if (signal?.aborted) throw new UpstreamError(`${agency} request cancelled`, { ...fields, kind: 'cancelled', retryable: false });
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new UpstreamError(`${agency} timed out`, { ...fields, kind: 'timeout', retryable: true });
    throw new UpstreamError(error?.message || 'network error', { ...fields, kind: 'network', retryable: true });
  } finally {
    clearTimeout(timer);
    if (release) release();
    if (signal) signal.removeEventListener('abort', onCancel);
  }
}

function logAttempt({ host, label, status = null, started, ok, attempt, err = null }) {
  try {
    settings.log(JSON.stringify({ evt: 'upstream', host, label, status, ms: Date.now() - started, ok, attempt, err: err ? String(err).slice(0, 200) : null }));
  } catch { /* logging never fails a lookup */ }
}

// ---- Requests

// GET with params appended; a GET longer than maxGetUrlLength becomes a form POST.
export function buildUpstreamRequest(url, { method = 'GET', params, body, headers = {}, maxGetUrlLength = settings.maxGetUrlLength } = {}) {
  const target = new URL(String(url));
  if (params) for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
  const verb = String(method).toUpperCase();
  if (verb === 'GET' && body == null) {
    if (target.href.length <= maxGetUrlLength || !target.search) return { url: target.href, init: { method: 'GET', headers } };
    const form = target.search.slice(1);
    target.search = '';
    return { url: target.href, init: { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form } };
  }
  if (body == null && target.search) {
    // POST with params: send them as the form body.
    const form = target.search.slice(1);
    target.search = '';
    return { url: target.href, init: { method: verb, headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: form } };
  }
  return { url: target.href, init: { method: verb, headers, ...(body == null ? {} : { body }) } };
}

function decode(buffer) {
  return new TextDecoder().decode(buffer);
}

function parseMaybeJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}

function shouldRetry(error, retryOn) {
  if (error.kind === 'cancelled') return false;
  if (typeof retryOn === 'function') return Boolean(retryOn(error));
  if (Array.isArray(retryOn)) {
    return retryOn.some(rule => rule === error.kind || (rule === '5xx' && error.kind === 'http' && error.status >= 500));
  }
  return Boolean(error.retryable);
}

function interpret(raw, { agency, arcgis, arcgisMessage, validate, fields }) {
  const text = decode(raw.buffer);
  if (raw.status < 200 || raw.status > 299) {
    throw new UpstreamError(`${agency} returned ${raw.status}`, { ...fields, kind: 'http', status: raw.status, retryable: raw.status >= 500, body: parseMaybeJson(text) });
  }
  let data;
  try { data = JSON.parse(text); } catch {
    throw new UpstreamError(`${agency} returned invalid JSON`, { ...fields, kind: 'json', status: raw.status, retryable: true });
  }
  if (arcgis && data && typeof data === 'object' && data.error) {
    const code = Number(data.error.code);
    const upstream = data.error.message || '';
    const message = typeof arcgisMessage === 'function'
      ? arcgisMessage(upstream, data.error)
      : upstream || arcgisMessage || `${agency} query failed`;
    throw new UpstreamError(message, { ...fields, kind: 'arcgis', status: raw.status, code: Number.isFinite(code) ? code : null, retryable: !(code >= 400 && code < 500) });
  }
  if (validate) {
    try { validate(data); } catch (error) {
      throw new UpstreamError(error?.message || `${agency} answer failed validation`, { ...fields, kind: 'invalid', status: raw.status, retryable: false });
    }
  }
  return data;
}

// Fetches JSON with the shared rules. Options:
//   method, params (object; appended to the URL, or the form body for POST), body (raw), headers,
//   timeoutMs (from send), queueTimeoutMs (host-slot wait; default timeoutMs), retries (default 1), retryTimeoutMs (later attempts; default timeoutMs), backoffMs,
//   retryOn (fn(error) -> bool, or kinds like ['timeout', 'network', '5xx', 'json', 'arcgis']),
//   label (log name), agency (error-message prefix), signal (caller cancel), arcgis (treat
//   {error} bodies as errors), arcgisMessage, validate (fn(data) throws to reject), maxPerHost,
//   maxGetUrlLength, meta (an object that receives { status, attempts } on success).
export async function upstreamJson(url, opts = {}) {
  const {
    timeoutMs = settings.timeoutMs, retries = settings.retries, retryTimeoutMs = timeoutMs, backoffMs = settings.backoffMs,
    retryOn, signal, arcgis = false, arcgisMessage, validate, maxPerHost = settings.maxPerHost, queueTimeoutMs
  } = opts;
  const request = buildUpstreamRequest(url, opts);
  const host = hostOf(request.url);
  const label = opts.label || pathLabel(request.url);
  const agency = opts.agency || host;
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const fields = { host, label, attempt };
    let status = null;
    try {
      const raw = await attemptOnce(request.url, request.init, { host, label, agency, timeoutMs: attempt === 1 ? timeoutMs : retryTimeoutMs, queueTimeoutMs, signal, maxPerHost, attempt });
      status = raw.status;
      const data = interpret(raw, { agency, arcgis, arcgisMessage, validate, fields });
      logAttempt({ host, label, status, started, ok: true, attempt });
      if (opts.meta && typeof opts.meta === 'object') Object.assign(opts.meta, { status, attempts: attempt });
      return data;
    } catch (error) {
      const failure = error instanceof UpstreamError ? error : new UpstreamError(error?.message || 'request failed', { ...fields, kind: 'network', retryable: true, cause: error });
      failure.attempt = attempt;
      logAttempt({ host, label, status: failure.status ?? status, started, ok: false, attempt, err: `${failure.kind}: ${failure.message}` });
      if (attempt > retries || !shouldRetry(failure, retryOn) || signal?.aborted) throw failure;
      await sleep(backoffMs * attempt);
      if (signal?.aborted) throw failure;
    }
  }
}

// ArcGIS REST query: <layerUrl>/query with f=json (unless params.f says otherwise). Returns the
// features array, like src/shared/arcgis.js arcgisQuery() in PR #21.
export async function arcgisQuery(layerUrl, params = {}, opts = {}) {
  const data = await arcgisJson(`${String(layerUrl).replace(/\/+$/, '')}/query`, params, opts);
  return data?.features || [];
}

// Any ArcGIS REST endpoint (layer metadata, identify, getSamples, ...): the whole JSON answer,
// with an {error} body treated as an error.
export function arcgisJson(url, params = {}, opts = {}) {
  return upstreamJson(url, { ...opts, params: { f: 'json', ...params }, arcgis: true });
}

// One attempt, buffered: resolves a Response whose body has been fully read inside the timeout,
// for callers that work with Response objects (shared/http.js fetchWithTimeout, src/worker.js).
// Non-2xx answers resolve normally; a timeout rejects with an UpstreamError named 'AbortError'
// (what callers of the old fetchWithTimeout check for); a network error rejects with the
// original error.
export async function upstreamFetch(input, opts = {}) {
  const { timeoutMs = settings.timeoutMs, queueTimeoutMs, signal, maxPerHost = settings.maxPerHost, cf, label: labelOpt, agency: agencyOpt, ...init } = opts;
  const url = String(input instanceof Request ? input.url : input);
  const host = hostOf(url);
  const label = labelOpt || pathLabel(url);
  const agency = agencyOpt || host;
  const started = Date.now();
  try {
    const raw = await attemptOnce(input instanceof Request ? input : url, init, { host, label, agency, timeoutMs, queueTimeoutMs, signal, maxPerHost, attempt: 1 });
    logAttempt({ host, label, status: raw.status, started, ok: raw.status >= 200 && raw.status <= 299, attempt: 1, err: raw.status >= 200 && raw.status <= 299 ? null : `http: ${raw.status}` });
    const headers = new Headers(raw.headers);
    headers.delete('Content-Encoding');
    headers.delete('Content-Length');
    return new Response(NULL_BODY_STATUS.has(raw.status) ? null : raw.buffer, { status: raw.status, statusText: raw.statusText, headers });
  } catch (error) {
    logAttempt({ host, label, started, ok: false, attempt: 1, err: `${error.kind || 'network'}: ${error.message}` });
    if (error.kind === 'timeout' || error.kind === 'cancelled') { error.name = 'AbortError'; throw error; }
    throw error.cause || error;
  }
}

// ---- Cache API wrapper for validated answers only.

// Returns the cached answer for (prefix, key) if there is one; otherwise runs produce() and stores
// its result only when isValid(result) is true. A cache failure never fails the lookup, and
// nothing is cached where `caches` does not exist (Node tests). isValid is required: an
// unvalidated answer must never be stored.
export async function cachedJson(prefix, key, ttlSeconds, produce, { isValid, ctx } = {}) {
  if (typeof isValid !== 'function') throw new Error('cachedJson needs an isValid(result) check.');
  const slot = await openValueCache(prefix, key);
  const hit = await readCachedJson(slot);
  if (hit && typeof hit === 'object' && 'value' in hit) return hit.value;
  const value = await produce();
  let valid = false;
  try { valid = Boolean(isValid(value)); } catch { valid = false; }
  if (valid) await writeCachedJson(slot, { value }, ttlSeconds, ctx);
  return value;
}
