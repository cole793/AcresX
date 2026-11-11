// Recovery for an ArcGIS layer that moved to another id inside its service.
//
// Why: an owner who republishes a hosted service can renumber its layers. The City of Cheney did
// this around 2026-11-10: Cheney__WA___Zoning_Map___2025_WFL1/FeatureServer/3 changed from
// "Zoning_2025" (ZoneCODE, ZONE) to "PUD Overlay" (PUDCODE, ZONE), and the zoning moved to layer 4
// "Zoning 2026". The old query then answers
//   {"error":{"code":400,"message":"Cannot perform query. Invalid query parameters.",
//             "details":["'outFields' parameter is invalid"]}}
// (ArcGIS Online). ArcGIS Enterprise answers a missing field with 400 "Failed to execute query."
// and a missing layer id with 404 "Layer not found"; ArcGIS Online a missing id with 400
// "Invalid URL". All checked live on 2026-11-10.
//
// What it does: when a query fails like that, it reads the service's `?f=json` once (the layer
// ids and names), then the `?f=json` of each layer whose name matches the configured pattern (at
// most MAX_CANDIDATES), and keeps the layers that have every required field. Exactly one match,
// at a different id, is taken: the query is retried once against it, a
// {"evt":"layer-moved",...} line is logged, and the new layer URL is remembered for the rest of
// the isolate's life. No match, several matches, or a failing metadata read: the original error
// is thrown (the caller degrades that one layer as before), the outcome is logged, and the
// service is not asked again for RECHECK_MS. A failing retry throws the retry's error, the same way.
import { arcgisJson } from './upstream.js';

const MAX_CANDIDATES = 4;
const RECHECK_MS = 10 * 60 * 1000;
const META_TIMEOUT_MS = 8000;

const moved = new Map();   // configured layer URL -> layer URL it moved to (per isolate)
const checked = new Map(); // configured layer URL -> time a lookup found no usable move

let log = line => console.log(line);

// Tests only: capture the log lines and clear what this isolate remembered. Returns a restore function.
export function configureLayerMoves({ log: logger } = {}) {
  const previous = log;
  if (logger) log = logger;
  moved.clear();
  checked.clear();
  return () => { log = previous; moved.clear(); checked.clear(); };
}

// ".../FeatureServer/3" -> { service: ".../FeatureServer", id: 3 }; null for anything else.
export function splitLayerUrl(url) {
  const m = /^(.*\/(?:FeatureServer|MapServer))\/(\d+)\/?$/i.exec(String(url || ''));
  return m ? { service: m[1], id: Number(m[2]) } : null;
}

// The layer URL to ask now: where the layer moved to in this isolate, else the configured one.
export function currentLayerUrl(url) {
  return moved.get(url) || url;
}

// An answer that says the layer or its fields are not where the configuration says: an ArcGIS
// {error} (or an HTTP status) 400/404 whose message names bad query parameters, an invalid
// field or URL, or a missing layer. Timeouts, 5xx and other errors are left alone.
const MOVED_MESSAGE = /invalid query parameters|invalid field|field.*(not found|does not exist)|invalid url|layer not found|does not exist|failed to execute query/i;
export function looksLikeMovedLayer(error) {
  if (!error) return false;
  if (error.kind === 'arcgis') return (error.code === 400 || error.code === 404) && MOVED_MESSAGE.test(String(error.message || ''));
  if (error.kind === 'http') return error.status === 400 || error.status === 404;
  return false;
}

// Reads the service metadata and returns { url, id, name } of the one layer that matches, or
// null. Throws when a metadata read fails.
export async function findMovedLayer(layerUrl, { namePattern, fields = [], agency, label = 'arcgis-layer' } = {}) {
  const parts = splitLayerUrl(layerUrl);
  if (!parts || !(namePattern instanceof RegExp)) return null;
  const opts = { agency, label: `${label}-metadata`, retries: 0, timeoutMs: META_TIMEOUT_MS };
  const service = await arcgisJson(parts.service, {}, opts);
  const named = (Array.isArray(service?.layers) ? service.layers : [])
    .filter(l => Number.isInteger(l?.id) && namePattern.test(String(l.name || '')))
    .slice(0, MAX_CANDIDATES);
  const wanted = fields.map(f => String(f).trim().toLowerCase()).filter(Boolean);
  const matches = [];
  for (const layer of named) {
    const info = await arcgisJson(`${parts.service}/${layer.id}`, {}, opts);
    const have = new Set((Array.isArray(info?.fields) ? info.fields : []).map(f => String(f?.name || '').toLowerCase()));
    if (wanted.every(f => have.has(f))) matches.push(layer);
  }
  if (matches.length !== 1 || matches[0].id === parts.id) return null;
  return { url: `${parts.service}/${matches[0].id}`, id: matches[0].id, name: String(matches[0].name || '') };
}

// Runs `run(layerUrl)` against the current layer URL; on a moved-layer error, finds the layer's
// new id and retries once there (see the top of this file). Resolves { layerUrl, value }.
// options: namePattern (RegExp for the layer name), fields (names the layer must have), agency, label.
export async function queryWithLayerRecovery(configuredUrl, run, options = {}) {
  const current = currentLayerUrl(configuredUrl);
  try {
    return { layerUrl: current, value: await run(current) };
  } catch (error) {
    if (!looksLikeMovedLayer(error)) throw error;
    const label = options.label || 'arcgis-layer';
    const last = checked.get(configuredUrl);
    if (last != null && Date.now() - last < RECHECK_MS) throw error;
    let found;
    try {
      found = await findMovedLayer(current, options);
    } catch (metaError) {
      checked.set(configuredUrl, Date.now());
      log(JSON.stringify({ evt: 'layer-move-check-failed', label, layer: current, error: String(error.message || '').slice(0, 200), metadataError: String(metaError?.message || '').slice(0, 200) }));
      throw error;
    }
    if (!found) {
      checked.set(configuredUrl, Date.now());
      log(JSON.stringify({ evt: 'layer-move-not-found', label, layer: current, error: String(error.message || '').slice(0, 200) }));
      throw error;
    }
    log(JSON.stringify({ evt: 'layer-moved', label, from: current, to: found.url, name: found.name, configured: configuredUrl, error: String(error.message || '').slice(0, 200) }));
    let value;
    try {
      value = await run(found.url);
    } catch (retryError) {
      checked.set(configuredUrl, Date.now());
      log(JSON.stringify({ evt: 'layer-move-retry-failed', label, layer: found.url, error: String(retryError?.message || '').slice(0, 200) }));
      throw retryError;
    }
    moved.set(configuredUrl, found.url);
    return { layerUrl: found.url, value };
  }
}
