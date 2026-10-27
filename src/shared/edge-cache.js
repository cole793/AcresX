// Small helpers for caches.default keyed by rounded parcel geometry (same approach as
// src/services/flood.js). Every helper is a no-op where `caches` does not exist (Node tests,
// some local runs), and cache errors never fail a lookup.

const COORD_DECIMALS = 6;

function roundCoords(value) {
  if (Array.isArray(value)) return value.map(roundCoords);
  return typeof value === 'number' ? Number(value.toFixed(COORD_DECIMALS)) : value;
}

export function edgeCache() {
  try { return typeof caches !== 'undefined' && caches?.default ? caches.default : null; } catch { return null; }
}

// prefix: e.g. 'https://acresx.internal/cache/terrain/v1/'
export async function geometryCacheKey(prefix, geometry) {
  const text = JSON.stringify({ type: geometry?.type, coordinates: roundCoords(geometry?.coordinates) });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request(`${prefix}${hex}`);
}

// Resolves { cache, key } or null when caching is unavailable.
export async function openGeometryCache(prefix, geometry) {
  const cache = edgeCache();
  if (!cache) return null;
  try { return { cache, key: await geometryCacheKey(prefix, geometry) }; } catch { return null; }
}

export async function readCachedJson(slot) {
  if (!slot) return null;
  try {
    const hit = await slot.cache.match(slot.key);
    return hit ? await hit.json() : null;
  } catch { return null; }
}

export async function writeCachedJson(slot, body, ttlSeconds, ctx) {
  if (!slot) return;
  const response = new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ttlSeconds}` }
  });
  const put = Promise.resolve().then(() => slot.cache.put(slot.key, response)).catch(error => console.warn('Edge cache write failed', error?.message));
  if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(put); else await put;
}
