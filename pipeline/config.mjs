// Parcel search index ("Explore") batch job: the settings in one place (docs/explore-index.md).
// The design proposed scripts/index/config.mjs; the job lives in pipeline/ (Phase 1 step 2).
// Every run records the values it used (index_runs.min_acres, index_runs.rules_json).

// Inclusion rule cutoff (docs/explore-index.md section 1). One value for every county.
export const INCLUDE_MIN_ACRES = 1;

// Parcels scored at once. Each parcel already runs its layers in parallel (as the browser does),
// and src/shared/upstream.js caps every host at 4 requests in flight for the whole process.
export const DEFAULT_CONCURRENCY = 4;

// A parcel older than this is rescored (refresh order 5).
export const MAX_AGE_DAYS = 90;

// Polite identification for every request the job sends. No person, email or account in it.
// Handlers that set their own User-Agent (FEMA, NWI, utility territory) keep theirs, as in
// production.
export const USER_AGENT = 'AcresX-parcel-index/0.1 (rural land screening batch job)';

// Layer retries: a layer that comes back unavailable or timed out is asked again, after
// LAYER_RETRY_BACKOFF_MS[i], at most LAYER_RETRIES more times (the report's Retry button, done
// for the user). Bulk paging requests retry on their own schedule.
export const LAYER_RETRIES = 1;
export const LAYER_RETRY_BACKOFF_MS = [3000, 10000];
export const PAGE_RETRIES = 3;
export const PAGE_RETRY_BACKOFF_MS = [2000, 6000, 15000];
// HTTP 429 / 503 from any host: wait (Retry-After when given, else this) before the next try.
export const RATE_LIMIT_BACKOFF_MS = 5000;
// Pause between bulk pages (validation/counties/*.json use the same 300 ms).
export const PAGE_DELAY_MS = 300;

// Bounded in-memory Cache API for the run (pipeline/runtime.mjs), standing in for caches.default
// so /api/buildable-area reuses the flood, wetlands and slope answers as it does in production.
export const MEMORY_CACHE_ENTRIES = 4000;

// The outline stored in parcel_shapes: Douglas-Peucker tolerance and decimals (section 5).
export const SHAPE_TOLERANCE_M = 5;
export const SHAPE_DECIMALS = 6;

// Public land: share of the parcel PAD-US Fee land must cover to exclude it on its own.
export const PUBLIC_LAND_MIN_SHARE = 0.5;
// PAD-US Fee owner types that count as public land ("federal, state, tribal, local").
export const PUBLIC_OWNER_TYPES = Object.freeze(['FED', 'STAT', 'TRIB', 'LOC']);
