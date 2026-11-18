// Per-pixel slope raster for a parcel, from the AWS Terrain Tiles (terrarium PNG, a 2017 copy of
// USGS 3DEP 1/3 arc-second elevation; source notes in terrain-tiles.js).
//
// Why: the 5 x 5 slope grid (slope-grid.js) and the 9-point terrain average (land-analysis.js)
// sample a parcel too coarsely to see a bank or a draw. Broker feedback 2026-11-17 on Yellowstone
// 03092732390050000 (53 ac): "About 52.9 of 53.1 acres buildable", average grade 2.6%, while the
// east/south part drops into a wooded draw.
//
// Method:
//   1. Zoom: the highest of RASTER_ZOOMS (14, 13, 12) whose tiles covering the parcel's bounding
//      box plus a one-pixel margin number at most RASTER_MAX_TILES, in a window of at most
//      RASTER_MAX_PIXELS pixels (z14 up to about 400 x 400 px, ~2.7 km square at 45.7 N). Pixel size is
//      40,075,016.686 m x cos(lat) / (256 x 2^z): z14 ~6.7 m, z13 ~13.3 m, z12 ~26.7 m at 45.7 N.
//      The source raster is ~10 m, so z14 adds no detail beyond it, only finer clipping.
//   2. Elevation per pixel: terrarium decode, (R x 256 + G + B / 256) - 32768 m. Voids
//      (alpha 0, or <= -500 m) are NaN.
//   3. Slope: Horn (1981) 3 x 3 kernel, as GDAL gdaldem and ArcGIS Slope use it:
//        dz/dx = ((c + 2f + i) - (a + 2d + g)) / (8 dx),  dz/dy = ((g + 2h + i) - (a + 2b + c)) / (8 dy)
//      with dx = dy = the ground size of a pixel at that row's latitude (Web Mercator is conformal,
//      so the pixel is square on the ground). Percent slope = 100 x sqrt(dzdx^2 + dzdy^2). A pixel
//      with any void neighbour has no slope.
//   4. Clip: a pixel is in the parcel when its centre is (even-odd rule on the parcel rings). A
//      parcel smaller than a few pixels uses the 3 x 3 pixels around its centre instead.
//   5. Outputs (all over the clipped pixels, each weighted by its ground area):
//      meanPct, p90Pct ("steepest 10% of the parcel is at least this steep"), maxPct, classes
//      (SLOPE_CLASSES: share and acres), minFt / maxFt / reliefFt, and the steep mask: pixels over
//      STEEP_REMOVED_PCT as lon/lat rectangles (runs along a row, merged down identical rows) for
//      buildable-area.js to subtract. The mask covers every pixel of the box (not only clipped
//      ones); area-mask.js clips it to the parcel outline. Isolated single steep pixels (no steep
//      neighbour among the 8 around it) are left out of the mask as DEM noise; the class shares
//      are the raw counts.
//   6. displayRects: per class rectangles of the clipped pixels for the dashboard map's Slope
//      layer (public/slope-map.js), coarsened 2 x 2 (mean slope) until at most DISPLAY_MAX_RECTS.
//
// Thresholds (county rules researched 2026-11-17; summarised in buildable-area.js):
//   removed       > 30%: Spokane County / Spokane Valley critical areas: geologically hazardous
//                 areas are slopes of 30% or greater. Kept as the one documented rule.
//   shown only    15-30%: "may limit building" (septic drainfields, driveways, foundations);
//                 Yellowstone County subdivision rules send lot areas over 25% to a geotechnical
//                 analysis, Missoula/Carbon County presume over 25% unsuitable unless shown
//                 otherwise. Not subtracted.
//
// Results are edge-cached per rounded parcel geometry for 30 days (the tiles are a static 2017
// dataset), and in-flight / recent results are kept per isolate, so /api/land-analysis,
// /api/buildable-area and /api/slope-raster for one parcel compute it once.
//
// CPU (measured 2026-11-17, Node 22, live tiles): the 53 ac Yellowstone parcel at z14 (2 tiles,
// 4,800 parcel pixels) 13 ms; a 0.03 x 0.021 degree box (~370 ac, z14, 6 tiles, 122,500 pixels)
// 137 ms; a 0.06 x 0.042 degree box (~1,500 ac) took 485 ms at z14 (490,000 pixels), so the
// pixel cap moves it to z13 (~120,000 pixels). Never throws from slopeRaster(): failures
// come back as { available: false, error }.
import { loadTile, terrariumMeters, TERRAIN_TILE_SIZE, TERRAIN_TILE_TIMEOUT_MS } from './terrain-tiles.js';
import { ringsFromGeometry, SQM_PER_ACRE } from '../shared/polygon-coverage.js';
import { openGeometryCache, readCachedJson, writeCachedJson } from '../shared/edge-cache.js';
import { json } from '../shared/http.js';

export const SLOPE_RASTER_CACHE_PREFIX = 'https://acresx.internal/cache/slope-raster/v2/';
export const SLOPE_RASTER_TTL_SECONDS = 30 * 24 * 60 * 60;
export const RASTER_ZOOMS = Object.freeze([14, 13, 12]);
export const RASTER_MAX_TILES = 16;
export const RASTER_MAX_PIXELS = 160000;
export const RASTER_TILE_CONCURRENCY = 8;
export const STEEP_REMOVED_PCT = 30;
export const MAY_LIMIT_PCT = 15;
// Homesite / drainfield area (owner decision 2026-11-18): the gentlest ~1 acre square.
export const HOMESITE_SQM = 4046.8564224;
export const HOMESITE_CANDIDATES = 6;
export const MASK_MAX_RECTS = 2500;
export const DISPLAY_MAX_RECTS = 3000;
export const RASTER_SOURCE = 'USGS 3DEP elevation (AWS Terrain Tiles copy), per-pixel slope';
export const SLOPE_CLASSES = Object.freeze([
  { key: '0-8', label: '0–8%', min: 0, max: 8 },
  { key: '8-15', label: '8–15%', min: 8, max: 15 },
  { key: '15-25', label: '15–25%', min: 15, max: 25 },
  { key: '25-30', label: '25–30%', min: 25, max: 30 },
  { key: '30+', label: 'Over 30%', min: 30, max: Infinity }
]);

const S = TERRAIN_TILE_SIZE;
const EQUATOR_M = 40075016.686;
const FT_PER_M = 3.280839895;
const DEG = Math.PI / 180;
const round1 = n => Math.round(n * 10) / 10;
const round2 = n => Math.round(n * 100) / 100;
const r6 = n => Math.round(n * 1e6) / 1e6;

export const classOf = pct => SLOPE_CLASSES.findIndex(c => pct < c.max);

// Global pixel coordinate (not centre-shifted) <-> lon/lat at zoom z, Web Mercator.
export const lonToX = (lon, z) => (lon + 180) / 360 * S * 2 ** z;
export const xToLon = (x, z) => x / (S * 2 ** z) * 360 - 180;
export function latToY(lat, z) {
  const phi = Math.max(-85.05112878, Math.min(85.05112878, lat)) * DEG;
  return (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 * S * 2 ** z;
}
export const yToLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (S * 2 ** z)))) / DEG;
// Ground size of one pixel (m) at latitude lat, zoom z.
export const pixelMeters = (lat, z) => EQUATOR_M * Math.cos(lat * DEG) / (S * 2 ** z);

function boundsOf(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minLon: minX, maxLon: maxX, minLat: minY, maxLat: maxY };
}

// The DEM window (global pixel rows/cols, inclusive) for a parcel at zoom z, with a 1-pixel margin
// for the Horn kernel, and the tiles that cover it.
export function rasterWindow(bounds, z) {
  const x0 = Math.floor(lonToX(bounds.minLon, z)) - 1;
  const x1 = Math.floor(lonToX(bounds.maxLon, z)) + 1;
  const y0 = Math.floor(latToY(bounds.maxLat, z)) - 1;
  const y1 = Math.floor(latToY(bounds.minLat, z)) + 1;
  const tiles = [];
  for (let ty = Math.floor(y0 / S); ty <= Math.floor(y1 / S); ty++) {
    for (let tx = Math.floor(x0 / S); tx <= Math.floor(x1 / S); tx++) tiles.push({ z, x: tx, y: ty });
  }
  return { z, x0, y0, width: x1 - x0 + 1, height: y1 - y0 + 1, tiles };
}

// The highest zoom whose window needs at most maxTiles tiles and maxPixels pixels (CPU: the
// raster costs ~1 ms per 1,000 pixels in Node, so a big parcel drops a zoom instead).
export function chooseZoom(bounds, maxTiles = RASTER_MAX_TILES, maxPixels = RASTER_MAX_PIXELS) {
  for (const z of RASTER_ZOOMS) {
    const w = rasterWindow(bounds, z);
    if (w.tiles.length <= maxTiles && w.width * w.height <= maxPixels) return w;
  }
  return null;
}

// Elevation grid (metres, NaN = void) for a window from decoded tiles: images.get('z/x/y').
export function assembleDem(win, images) {
  const { z, x0, y0, width, height } = win;
  const dem = new Float32Array(width * height).fill(NaN);
  for (let r = 0; r < height; r++) {
    const gy = y0 + r, ty = Math.floor(gy / S), py = gy - ty * S;
    for (let c = 0; c < width; c++) {
      const gx = x0 + c, tx = Math.floor(gx / S);
      const image = images.get(`${z}/${tx}/${ty}`);
      if (!image) continue;
      const o = (py * S + (gx - tx * S)) * image.channels;
      if (image.channels === 4 && image.pixels[o + 3] === 0) continue;
      const m = terrariumMeters(image.pixels[o], image.pixels[o + 1], image.pixels[o + 2]);
      if (m > -500) dem[r * width + c] = m;
    }
  }
  return dem;
}

// Horn slope (percent) for every pixel of the window; NaN on the margin and next to voids.
export function hornSlopePct(dem, win) {
  const { z, y0, width, height } = win;
  const out = new Float32Array(width * height).fill(NaN);
  for (let r = 1; r < height - 1; r++) {
    const d = pixelMeters(yToLat(y0 + r + 0.5, z), z);
    const k = 1 / (8 * d);
    const up = (r - 1) * width, mid = r * width, dn = (r + 1) * width;
    for (let c = 1; c < width - 1; c++) {
      const a = dem[up + c - 1], b = dem[up + c], cc = dem[up + c + 1];
      const dd = dem[mid + c - 1], f = dem[mid + c + 1];
      const g = dem[dn + c - 1], h = dem[dn + c], i = dem[dn + c + 1];
      // Rows run north to south, so +y in the image is south: dz/dy here is dz/d(south); the sign
      // does not matter for the magnitude.
      const dzdx = ((cc + 2 * f + i) - (a + 2 * dd + g)) * k;
      const dzdy = ((g + 2 * h + i) - (a + 2 * b + cc)) * k;
      const s = Math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100;
      if (Number.isFinite(s)) out[mid + c] = s;
    }
  }
  return out;
}

// Longitude crossings of the parcel rings at latitude lat, sorted (even-odd pairs).
function crossingsAt(rings, lat) {
  const xs = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      if ((y1 > lat) === (y2 > lat)) continue;
      xs.push(x1 + (lat - y1) * (x2 - x1) / (y2 - y1));
    }
  }
  return xs.sort((p, q) => p - q);
}

// 1 where the pixel centre is inside the parcel.
export function clipMask(rings, win) {
  const { z, x0, y0, width, height } = win;
  const inside = new Uint8Array(width * height);
  let count = 0;
  for (let r = 0; r < height; r++) {
    const xs = crossingsAt(rings, yToLat(y0 + r + 0.5, z));
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Pixel c's centre is at global x0 + c + 0.5.
      const c0 = Math.max(0, Math.ceil(lonToX(xs[k], z) - 0.5 - x0));
      const c1 = Math.min(width - 1, Math.floor(lonToX(xs[k + 1], z) - 0.5 - x0));
      for (let c = c0; c <= c1; c++) { if (!inside[r * width + c]) count++; inside[r * width + c] = 1; }
    }
  }
  return { inside, count };
}

// Rectangles of the pixels where pick(index) is true: runs along each row, merged down rows with
// the identical run. Returns [{ c0, c1, r0, r1 }] in window pixel indices (inclusive).
export function runRects(width, height, pick) {
  const done = [];
  let open = new Map();
  for (let r = 0; r < height; r++) {
    const next = new Map();
    let c = 0;
    while (c < width) {
      if (!pick(r * width + c)) { c++; continue; }
      const c0 = c;
      while (c < width && pick(r * width + c)) c++;
      const key = `${c0}:${c - 1}`;
      const rect = open.get(key);
      if (rect) { rect.r1 = r; open.delete(key); next.set(key, rect); }
      else next.set(key, { c0, c1: c - 1, r0: r, r1: r });
    }
    for (const rect of open.values()) done.push(rect);
    open = next;
  }
  for (const rect of open.values()) done.push(rect);
  return done;
}

const rectBounds = (rect, win, scale = 1) => {
  const { z, x0, y0 } = win;
  return [
    r6(xToLon(x0 + rect.c0 * scale, z)), r6(yToLat(y0 + (rect.r1 + 1) * scale, z)),
    r6(xToLon(x0 + (rect.c1 + 1) * scale, z)), r6(yToLat(y0 + rect.r0 * scale, z))
  ];
};
// [w, s, e, n] -> GeoJSON polygon rings.
export const boundsRing = ([w, s, e, n]) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];

// Pure part: DEM window + parcel rings -> stats, mask and display rectangles.
export function computeSlopeRaster(dem, win, rings, { steepPct = STEEP_REMOVED_PCT } = {}) {
  const { width, height, z, y0 } = win;
  const slope = hornSlopePct(dem, win);
  let { inside, count } = clipMask(rings, win);
  let clipped = 'pixel-centres';
  if (count < 4) {
    // A parcel smaller than a few pixels: the 3 x 3 pixels around its centre.
    const b = boundsOf(rings);
    const cc = Math.floor(lonToX((b.minLon + b.maxLon) / 2, z)) - win.x0;
    const cr = Math.floor(latToY((b.minLat + b.maxLat) / 2, z)) - y0;
    inside = new Uint8Array(width * height);
    count = 0;
    for (let r = cr - 1; r <= cr + 1; r++) for (let c = cc - 1; c <= cc + 1; c++) {
      if (r >= 0 && r < height && c >= 0 && c < width) { inside[r * width + c] = 1; count++; }
    }
    clipped = 'centre-3x3';
  }

  const classSqM = SLOPE_CLASSES.map(() => 0);
  const values = [];
  let sqm = 0, sum = 0, max = 0, minM = Infinity, maxM = -Infinity, measured = 0;
  for (let r = 0; r < height; r++) {
    const px = pixelMeters(yToLat(y0 + r + 0.5, z), z);
    const area = px * px;
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      if (!inside[i]) continue;
      const e = dem[i];
      if (Number.isFinite(e)) { if (e < minM) minM = e; if (e > maxM) maxM = e; }
      const s = slope[i];
      if (!Number.isFinite(s)) continue;
      measured++;
      sqm += area; sum += s * area;
      if (s > max) max = s;
      classSqM[classOf(s)] += area;
      values.push(s);
    }
  }
  if (measured < Math.max(4, Math.ceil(count * 0.8))) {
    return { available: false, error: `Elevation tiles covered ${measured} of ${count} parcel pixels, too few for a slope raster.`, zoom: z, pixels: count, measuredPixels: measured };
  }
  values.sort((a, b) => a - b);
  const p90 = values[Math.min(values.length - 1, Math.floor(values.length * 0.9))];
  const pxM = pixelMeters(yToLat(y0 + height / 2, z), z);

  // Steep mask over the whole window (area-mask.js clips to the parcel), minus isolated pixels.
  const steep = new Uint8Array(width * height);
  for (let i = 0; i < steep.length; i++) if (slope[i] > steepPct) steep[i] = 1;
  const keep = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const i = r * width + c;
    if (!steep[i]) continue;
    let n = 0;
    for (let dr = -1; dr <= 1 && !n; dr++) for (let dc = -1; dc <= 1; dc++) {
      if ((dr || dc) && r + dr >= 0 && r + dr < height && c + dc >= 0 && c + dc < width && steep[(r + dr) * width + c + dc]) { n = 1; break; }
    }
    keep[i] = n;
  }
  let maskRects = runRects(width, height, i => keep[i] === 1);
  const maskTruncated = maskRects.length > MASK_MAX_RECTS;
  if (maskTruncated) maskRects = maskRects.sort((a, b) => (b.c1 - b.c0 + 1) * (b.r1 - b.r0 + 1) - (a.c1 - a.c0 + 1) * (a.r1 - a.r0 + 1)).slice(0, MASK_MAX_RECTS);

  return {
    available: true,
    zoom: z,
    pixelM: round1(pxM),
    pixels: count,
    measuredPixels: measured,
    clipped,
    measuredAcres: round2(sqm / SQM_PER_ACRE),
    meanPct: round1(sum / sqm),
    p90Pct: round1(p90),
    maxPct: round1(max),
    minFt: Number.isFinite(minM) ? round1(minM * FT_PER_M) : null,
    maxFt: Number.isFinite(maxM) ? round1(maxM * FT_PER_M) : null,
    reliefFt: Number.isFinite(minM) ? round1((maxM - minM) * FT_PER_M) : null,
    // share: of the measured parcel pixels; acres: share x measured area (buildable-area.js
    // rescales to its own parcel acres).
    classes: SLOPE_CLASSES.map((cls, k) => ({ key: cls.key, label: cls.label, share: Math.round(classSqM[k] / sqm * 10000) / 10000, pct: round1(classSqM[k] / sqm * 100), acres: round2(classSqM[k] / SQM_PER_ACRE) })),
    steepPct,
    steepMask: maskRects.map(rect => rectBounds(rect, win)),
    steepMaskTruncated: maskTruncated,
    homesites: homesiteCandidates(slope, inside, count, win, steepPct, pxM),
    displayRects: displayRects(slope, inside, win)
  };
}

// Gentlest homesite areas (owner decision 2026-11-18: septic uses the slope of the best homesite
// area, not the parcel average). Squares of k x k pixels, k = ceil(sqrt(1 acre) / pixel size),
// wholly inside the parcel, every pixel measured and none over steepPct; ranked by mean slope
// (summed-area tables), up to HOMESITE_CANDIDATES that do not overlap, gentlest first. A parcel
// with fewer than k x k pixels: one candidate, its non-steep pixels. buildable-area.js picks the
// first candidate clear of flood zones and wetlands; land-analysis.js reports the first.
// [{ slopePct, acres, center: [lon, lat], bounds: [w, s, e, n] }].
export function homesiteCandidates(slope, inside, count, win, steepPct = STEEP_REMOVED_PCT, pxM = pixelMeters(yToLat(win.y0 + win.height / 2, win.z), win.z)) {
  const { width, height } = win;
  const ok = i => inside[i] && Number.isFinite(slope[i]) && slope[i] <= steepPct;
  const k = Math.max(1, Math.ceil(Math.sqrt(HOMESITE_SQM) / pxM));
  const acresOf = n => round2(n * pxM * pxM / SQM_PER_ACRE);
  if (count < k * k) {
    let sum = 0, n = 0, c0 = Infinity, c1 = -1, r0 = Infinity, r1 = -1;
    for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
      const i = r * width + c;
      if (!ok(i)) continue;
      sum += slope[i]; n++;
      if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r;
    }
    if (!n) return [];
    const b = rectBounds({ c0, c1, r0, r1 }, win);
    return [{ slopePct: round1(sum / n), acres: acresOf(n), center: [r6((b[0] + b[2]) / 2), r6((b[1] + b[3]) / 2)], bounds: b, wholeParcel: true }];
  }
  // Summed-area tables of valid pixels and their slopes, (width + 1) x (height + 1).
  const W1 = width + 1;
  const cnt = new Float64Array(W1 * (height + 1)), sum = new Float64Array(W1 * (height + 1));
  for (let r = 0; r < height; r++) {
    let rc = 0, rs = 0;
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      if (ok(i)) { rc++; rs += slope[i]; }
      cnt[(r + 1) * W1 + c + 1] = cnt[r * W1 + c + 1] + rc;
      sum[(r + 1) * W1 + c + 1] = sum[r * W1 + c + 1] + rs;
    }
  }
  const box = (t, r, c) => t[(r + k) * W1 + c + k] - t[r * W1 + c + k] - t[(r + k) * W1 + c] + t[r * W1 + c];
  const pw = width - k + 1, ph = height - k + 1;
  if (pw < 1 || ph < 1) return [];
  const means = new Float32Array(pw * ph).fill(Infinity);
  const order = [];
  for (let r = 0; r < ph; r++) for (let c = 0; c < pw; c++) {
    if (box(cnt, r, c) !== k * k) continue;
    means[r * pw + c] = box(sum, r, c) / (k * k);
    order.push(r * pw + c);
  }
  order.sort((a, b) => means[a] - means[b]);
  const blocked = new Uint8Array(pw * ph);
  const out = [];
  for (const j of order) {
    if (blocked[j]) continue;
    const r = Math.floor(j / pw), c = j % pw;
    const b = rectBounds({ c0: c, c1: c + k - 1, r0: r, r1: r + k - 1 }, win);
    out.push({ slopePct: round1(means[j]), acres: acresOf(k * k), center: [r6((b[0] + b[2]) / 2), r6((b[1] + b[3]) / 2)], bounds: b });
    if (out.length >= HOMESITE_CANDIDATES) break;
    for (let rr = Math.max(0, r - k + 1); rr < Math.min(ph, r + k); rr++) for (let cc = Math.max(0, c - k + 1); cc < Math.min(pw, c + k); cc++) blocked[rr * pw + cc] = 1;
  }
  return out;
}

// Per-class rectangles of the clipped pixels for the map; coarsened 2 x 2 (mean slope) while over
// DISPLAY_MAX_RECTS. [{ cls: key, b: [w, s, e, n] }].
function displayRects(slope, inside, win) {
  let { width, height } = win;
  let cls = new Int8Array(width * height).fill(-1);
  for (let i = 0; i < cls.length; i++) if (inside[i] && Number.isFinite(slope[i])) cls[i] = classOf(slope[i]);
  let values = slope, mask = inside, scale = 1;
  for (;;) {
    const rects = [];
    for (let k = 0; k < SLOPE_CLASSES.length; k++) {
      for (const rect of runRects(width, height, i => cls[i] === k)) rects.push({ cls: SLOPE_CLASSES[k].key, b: rectBounds(rect, win, scale) });
    }
    if (rects.length <= DISPLAY_MAX_RECTS || width < 4 || height < 4) return rects;
    const w2 = Math.ceil(width / 2), h2 = Math.ceil(height / 2);
    const v2 = new Float32Array(w2 * h2).fill(NaN), m2 = new Uint8Array(w2 * h2), c2 = new Int8Array(w2 * h2).fill(-1);
    for (let r = 0; r < h2; r++) for (let c = 0; c < w2; c++) {
      let s = 0, n = 0, any = 0;
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) {
        const rr = r * 2 + dr, cc = c * 2 + dc;
        if (rr >= height || cc >= width) continue;
        const i = rr * width + cc;
        if (mask[i]) any = 1;
        if (mask[i] && Number.isFinite(values[i])) { s += values[i]; n++; }
      }
      const j = r * w2 + c;
      m2[j] = any;
      if (n) { v2[j] = s / n; c2[j] = classOf(s / n); }
    }
    values = v2; mask = m2; cls = c2; width = w2; height = h2; scale *= 2;
  }
}

async function loadImages(win, { signal, timeoutMs }) {
  const images = new Map();
  await Promise.all(win.tiles.map(async tile => {
    images.set(`${tile.z}/${tile.x}/${tile.y}`, await loadTile(tile, { signal, timeoutMs, maxPerHost: RASTER_TILE_CONCURRENCY }));
  }));
  return images;
}

async function computeFor(geometry, opts) {
  const rings = ringsFromGeometry(geometry);
  if (!rings) return { available: false, error: 'Parcel geometry is invalid.' };
  const bounds = boundsOf(rings);
  const win = chooseZoom(bounds);
  if (!win) return { available: false, error: `The parcel needs more than ${RASTER_MAX_TILES} terrain tiles even at zoom ${RASTER_ZOOMS.at(-1)}.` };
  const images = await loadImages(win, opts);
  const started = Date.now();
  const result = computeSlopeRaster(assembleDem(win, images), win, rings);
  return { ...result, source: RASTER_SOURCE, tiles: win.tiles.length, computeMs: Date.now() - started };
}

// Recent / in-flight answers per isolate, keyed by the edge-cache key (rounded geometry hash).
const MEMO_MAX = 8;
const memo = new Map();
export function clearSlopeRasterMemo() { memo.clear(); }

const memoKey = geometry => JSON.stringify({ t: geometry?.type, c: geometry?.coordinates });

// { available: true, meanPct, p90Pct, classes, steepMask, displayRects, ... } or
// { available: false, error }. Never throws.
export async function slopeRaster(geometry, { ctx, signal, timeoutMs = TERRAIN_TILE_TIMEOUT_MS } = {}) {
  const key = memoKey(geometry);
  if (memo.has(key)) return memo.get(key);
  const job = (async () => {
    const slot = await openGeometryCache(SLOPE_RASTER_CACHE_PREFIX, geometry);
    const hit = await readCachedJson(slot);
    if (hit?.available === true) return { ...hit, cached: true };
    try {
      const result = await computeFor(geometry, { signal, timeoutMs });
      if (result.available) await writeCachedJson(slot, result, SLOPE_RASTER_TTL_SECONDS, ctx);
      return result;
    } catch (error) {
      console.warn('Slope raster failed', error?.message);
      return { available: false, error: error?.message || 'Terrain tiles unavailable' };
    }
  })();
  memo.set(key, job);
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  const result = await job;
  // Failures are not kept, so the next lookup tries again.
  if (!result.available) memo.delete(key);
  return result;
}

// The terrain fields land-analysis.js merges from a raster answer (additive except gradePct,
// maxGradePct and the elevation range, which the raster measures over the whole parcel).
export function terrainFromRaster(raster) {
  return {
    gradePct: raster.meanPct,
    maxGradePct: raster.maxPct,
    p90GradePct: raster.p90Pct,
    slopeClasses: raster.classes,
    gradeMethod: 'raster',
    // Gentlest ~1 ac inside the parcel and under 30% (flood zones and wetlands are checked later
    // by buildable-area.js); the septic slope input (public/screening-inputs.js AcresXSeptic).
    homesiteSlopePct: raster.homesites?.[0]?.slopePct ?? null,
    homesite: raster.homesites?.[0] || null,
    gradeResolution: `${raster.pixelM} m pixels (zoom ${raster.zoom}), ${raster.measuredPixels} parcel pixels`,
    ...(raster.reliefFt != null ? { minFt: raster.minFt, maxFt: raster.maxFt, reliefFt: raster.reliefFt } : {})
  };
}

// POST /api/slope-raster { geometry } (new route): the raster for the dashboard map's Slope layer.
// 200 { available: true, meanPct, p90Pct, maxPct, classes, displayRects, steepMask, ... } or
// 200 { available: false, error } (the map then falls back to /api/slope-grid).
export async function handleSlopeRaster(request, env, ctx) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const geometry = body?.geometry;
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return json({ available: false, error: 'Parcel polygon geometry is required.' }, 400, 'no-store');
  const result = await slopeRaster(geometry, { ctx });
  return json(result, 200, result.available ? 'public, max-age=3600, s-maxage=2592000' : 'no-store');
}
