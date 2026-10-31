import { upstreamFetch } from './upstream.js';

export function json(body, status = 200, cache = 'public, max-age=300, s-maxage=86400') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache
    }
  });
}

// Kept for callers not yet on upstreamJson/arcgisQuery (src/shared/upstream.js). It now goes
// through the shared client: the timeout covers the body too, `cf` edge-cache options are
// dropped, the per-host cap applies and each request is logged. One attempt, no retry; a timeout
// still rejects with an error named 'AbortError'.
export function fetchWithTimeout(input, init = {}, timeoutMs = 20000) {
  return upstreamFetch(input, { ...init, timeoutMs });
}
