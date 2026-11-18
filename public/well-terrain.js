// Terrain-aware nearby well depth (2026-11-17, broker feedback on Yellowstone 03092732390050000:
// the closest wells sat in a drainage far below the upland parcel and read as "Shallow wells").
//
// Wraps window.findWells (index.html's Washington lookup, as replaced for Idaho and Montana by
// state-selector.js, which is injected just before this file). The wrapped lookup asks
// POST /api/well-depth-terrain (src/services/well-depth-terrain.js) for the terrain-aware
// estimate at a homesite point inside the parcel, in parallel with the nearest-wells lookup, and
// attaches the answer to the returned wells array as `wells.terrain`. Every surface reads it
// through window.AcresXWellDepth (screening-inputs.js); without it (the request failed, timed out
// or the state is not covered) they show the nearest-wells median labelled low confidence.
// The terrain answer is waited for at most WAIT_MS from the start, inside the 15 s wells section
// limit (progressive-loading.js), so it never turns a found well list into a timeout.
(function (root) {
  const WAIT_MS = 12500;
  const base = root.findWells;
  if (typeof base !== 'function' || base.__terrain) return;

  // An interior point: the centroid when it falls inside the parcel, else a point on the surface.
  function homesite(parcel) {
    try {
      const t = root.turf;
      const c = t.centroid(parcel);
      if (typeof t.booleanPointInPolygon === 'function' && !t.booleanPointInPolygon(c, parcel) && typeof t.pointOnFeature === 'function') return t.pointOnFeature(parcel).geometry.coordinates;
      return c.geometry.coordinates;
    } catch (_) { return null; }
  }
  function stateOf(parcel) {
    const p = parcel?.properties || {};
    return String(p._stateCode || root.document?.getElementById('state')?.value || 'WA').toUpperCase();
  }

  async function terrain(parcel, signal) {
    const point = homesite(parcel);
    if (!point) return { available: false, status: 'no_point' };
    const [lon, lat] = point;
    const response = await root.fetch('/api/well-depth-terrain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: stateOf(parcel), lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) }), signal
    });
    const data = await response.json();
    return data && typeof data === 'object' ? data : { available: false, status: 'failed' };
  }

  const wrapped = async function (parcel, signal) {
    const started = Date.now();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const onAbort = () => controller?.abort();
    signal?.addEventListener?.('abort', onAbort);
    const pending = terrain(parcel, controller?.signal)
      .catch(error => ({ available: false, status: error?.name === 'AbortError' ? 'timeout' : 'failed', error: error?.message || String(error) }));
    let wells;
    try {
      wells = await base.apply(this, arguments);
    } catch (error) {
      controller?.abort();
      signal?.removeEventListener?.('abort', onAbort);
      throw error;
    }
    if (!Array.isArray(wells) || wells.lookupFailed) {
      controller?.abort();
      signal?.removeEventListener?.('abort', onAbort);
      return wells;
    }
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ available: false, status: 'timeout' }), Math.max(0, WAIT_MS - (Date.now() - started))); });
    const answer = await Promise.race([pending, timeout]);
    clearTimeout(timer);
    controller?.abort();
    signal?.removeEventListener?.('abort', onAbort);
    wells.terrain = answer;
    return wells;
  };
  wrapped.__terrain = true;
  root.findWells = wrapped;
})(typeof window !== 'undefined' ? window : globalThis);
