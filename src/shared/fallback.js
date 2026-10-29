// Browser fallback hints (owner decision 2026-10-29, "option A").
//
// Some government GIS servers block or time out Cloudflare's egress while answering normal
// browsers (map.kcgov.us, gis.idwr.idaho.gov and others on 2026-10-28; hazards.fema.gov answers
// the Worker with 403). The Worker always asks first. When an eligible layer's upstream call fails
// with a network error, a timeout, or HTTP (or ArcGIS error code) 403, 429 or 5xx, its API answer
// keeps its usual shape and status and gains one field:
//
//   fallback: { mode: 'browser', kind, input }
//
// public/browser-fallback.js (window.AcresXFallback) sees it and runs the same, hard-coded query
// for `kind` from the user's browser, against a fixed host allowlist (never a URL from this
// answer), with the same field lists and never owner or mailing fields. `input` is only the
// minimum that query needs (parcel number, point, parcel outline).
//
// Errors are classified from src/shared/upstream.js UpstreamError fields (kind, status, code).

export const FALLBACK_KINDS = Object.freeze({
  kootenaiParcel: 'kootenai-parcel',
  kootenaiZoning: 'kootenai-zoning',
  idahoWells: 'idaho-wells',
  kootenaiAssessor: 'kootenai-assessor',
  femaFlood: 'fema-flood'
});

const eligibleStatus = status => status === 403 || status === 429 || (status >= 500 && status <= 599);

// True for the failures a browser might get past: network error, timeout, or a 403/429/5xx
// (HTTP status, or the code of an ArcGIS {error} body). Not for a cancelled request, invalid
// JSON, a 4xx query error or a validation failure.
export function isFallbackEligible(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.kind === 'timeout' || error.kind === 'network') return true;
  if (error.kind === 'http') return eligibleStatus(Number(error.status));
  if (error.kind === 'arcgis') return eligibleStatus(Number(error.code));
  return false;
}

export function fallbackHint(kind, input) {
  return { mode: 'browser', kind, input };
}

// A GeoJSON Polygon/MultiPolygon to pass on as `input.geometry`, or undefined.
export function hintGeometry(geometry) {
  const g = geometry?.type === 'Feature' ? geometry.geometry : geometry;
  return g && (g.type === 'Polygon' || g.type === 'MultiPolygon') && Array.isArray(g.coordinates)
    ? { type: g.type, coordinates: g.coordinates }
    : undefined;
}
