import { json } from '../shared/http.js';

// GET /api/listing-search-status -> { configured, providers }
//
// /api/listing-evidence (src/worker.js listingEvidence) answers 503 "Set SERPER_API_KEY or
// GOOGLE_SEARCH_API_KEY plus GOOGLE_SEARCH_ENGINE_ID" when neither web-search provider has its
// secret set. The page asks here first (once per page load) and skips the listing-evidence call
// when no provider is configured, so the browser does not log a failed request on every search.
// Only provider names are returned, never a secret value.
export function listingSearchProviders(env = {}) {
  const set = v => typeof v === 'string' ? v.trim() !== '' : Boolean(v);
  const providers = [];
  if (set(env.SERPER_API_KEY)) providers.push('Serper');
  if (set(env.GOOGLE_SEARCH_API_KEY) && set(env.GOOGLE_SEARCH_ENGINE_ID)) providers.push('Google Custom Search');
  return providers;
}

export function handleListingSearchStatus(env) {
  const providers = listingSearchProviders(env || {});
  return json({ configured: providers.length > 0, providers }, 200, 'no-store');
}
