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

  // The homesite point: a true interior point of the parcel (owner decision 2026-11-18). turf.centroid
  // is the average of the vertices, which is not the middle of the parcel (on the Yellowstone broker
  // parcel it sat ~10 ft lower and changed which wells counted as comparable). So: the area
  // centroid of the largest polygon when it falls inside the parcel; otherwise (a concave parcel)
  // the midpoint of the widest inside span along the centroid's latitude, which is always interior.
  const polygons = g => (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []);
  function ringArea(ring) { let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return a / 2; }
  // Coordinates are taken relative to the first vertex: with raw lon/lat (-110, 45) the shoelace
  // terms are ~5,000 and cancel to ~1e-8 for a 1e-4° parcel, losing most of the precision.
  function areaCentroid(ring) {
    if (!ring?.length) return null;
    const [ox, oy] = ring[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const x0 = ring[i][0] - ox, y0 = ring[i][1] - oy, x1 = ring[i + 1][0] - ox, y1 = ring[i + 1][1] - oy, f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    return a ? [ox + cx / (3 * a), oy + cy / (3 * a)] : null;
  }
  // x positions where the polygon's rings cross latitude y.
  function crossings(poly, y) {
    const xs = [];
    for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
      if ((y0 > y) !== (y1 > y)) xs.push(x0 + (y - y0) / (y1 - y0) * (x1 - x0));
    }
    return xs.sort((a, b) => a - b);
  }
  const inside = (poly, [x, y]) => crossings(poly, y).filter(cx => cx < x).length % 2 === 1;
  function homesite(parcel) {
    try {
      const poly = polygons(parcel?.geometry || parcel).map(p => p.map(r => r.map(c => [Number(c[0]), Number(c[1])])))
        .sort((a, b) => Math.abs(ringArea(b[0])) - Math.abs(ringArea(a[0])))[0];
      if (!poly) return null;
      const c = areaCentroid(poly[0]);
      if (c && inside(poly, c)) return c;
      const ys = poly[0].map(p => p[1]);
      // The centroid's latitude, nudged off any vertex so no crossing is counted twice.
      let y = c ? c[1] : (Math.min(...ys) + Math.max(...ys)) / 2;
      if (ys.includes(y)) y += (Math.max(...ys) - Math.min(...ys)) * 1e-6;
      const xs = crossings(poly, y);
      let best = null;
      for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
      return best ? [(best[0] + best[1]) / 2, y] : null;
    } catch (_) { return null; }
  }
  root.AcresXWellTerrain = { homesite };
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
