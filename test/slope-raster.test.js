// Offline tests for the per-pixel slope raster (src/services/slope-raster.js) and where it feeds:
// the buildable-area steep-slope removal (src/services/buildable-area.js), the terrain average
// grade (src/services/land-analysis.js) and POST /api/slope-raster.
//
// Synthetic DEMs (a plane, a ridge, a draw) test the Horn math, the clip, the class areas and the
// mask. The recorded fixture is Yellowstone County MT 03092732390050000 (53 ac; broker feedback
// 2026-11-17: the east/south part drops into a draw), its outline from /api/parcel-search and the
// two zoom-14 terrarium tiles that cover it (terrarium/14/3251/5848.png and 14/3252/5848.png,
// recorded 2026-11-17, x-amz-meta-x-imagery-sources: ned13/imgn46w109_13.tif). No live calls.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import {
  computeSlopeRaster, hornSlopePct, clipMask, runRects, chooseZoom, rasterWindow, lonToX, latToY, xToLon, yToLat, pixelMeters,
  slopeRaster, clearSlopeRasterMemo, boundsRing, homesiteCandidates, SLOPE_CLASSES, STEEP_REMOVED_PCT, RASTER_MAX_TILES, RASTER_MAX_PIXELS
} from '../src/services/slope-raster.js';
import { clearTerrainTileMemo, TERRAIN_TILES_URL } from '../src/services/terrain-tiles.js';
import { buildableFromLayers } from '../src/services/buildable-area.js';
import { ringsFromGeometry } from '../src/shared/polygon-coverage.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { makeLazyContext, readPublic } from './ui-harness.js';
import { ELEVATION_IMAGE_SERVICE, configureElevation } from '../src/services/elevation.js';
import { TERRAIN_CACHE_PREFIX, POINT_ONLY_TTL_SECONDS, TILE_ANSWER_TTL_SECONDS } from '../src/services/land-analysis.js';

const fixture = name => new URL(`fixtures/${name}`, import.meta.url);
const YS = JSON.parse(readFileSync(fixture('slope-raster-yellowstone-03092732390050000.json'), 'utf8')).geometry;
const YS_TILES = { '14/3251/5848': readFileSync(fixture('terrarium-14-3251-5848.png')), '14/3252/5848': readFileSync(fixture('terrarium-14-3252-5848.png')) };
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} vs ${expected}`);
const realFetch = globalThis.fetch, realWarn = console.warn, realLog = console.log;
let calls, restoreUpstream;

beforeEach(() => {
  calls = []; delete globalThis.caches; clearTerrainTileMemo(); clearSlopeRasterMemo();
  console.warn = () => {}; console.log = () => {};
  restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} });
});
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; console.log = realLog; restoreUpstream(); });

// fetch: terrarium tiles from `tiles` (by "z/x/y"), everything else from `other` (default 502).
function stubTiles(tiles = YS_TILES, other = () => new Response('down', { status: 502 })) {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    if (url.startsWith(TERRAIN_TILES_URL)) {
      const key = url.slice(TERRAIN_TILES_URL.length + 1).replace(/\.png$/, '');
      return tiles[key] ? new Response(tiles[key], { status: 200, headers: { 'Content-Type': 'image/png' } }) : new Response('missing', { status: 404 });
    }
    return other(url, init);
  };
}

// ---- Synthetic DEMs: a 60 x 60 window at zoom 14 near 45.7 N

const Z = 14, LAT0 = 45.7, LON0 = -108.54;
const W = 60, H = 60;
const win = { z: Z, x0: Math.floor(lonToX(LON0, Z)), y0: Math.floor(latToY(LAT0, Z)), width: W, height: H };
const rowM = r => pixelMeters(yToLat(win.y0 + r + 0.5, Z), Z);
// dem from f(r, c, pxM) in metres.
const demOf = f => { const d = new Float32Array(W * H); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) d[r * W + c] = f(r, c, rowM(r)); return d; };
// The parcel: pixel columns/rows [c0, c1) x [r0, r1) as a lon/lat box.
const pixelBox = (c0, r0, c1, r1) => [[
  [xToLon(win.x0 + c0, Z), yToLat(win.y0 + r1, Z)], [xToLon(win.x0 + c1, Z), yToLat(win.y0 + r1, Z)],
  [xToLon(win.x0 + c1, Z), yToLat(win.y0 + r0, Z)], [xToLon(win.x0 + c0, Z), yToLat(win.y0 + r0, Z)],
  [xToLon(win.x0 + c0, Z), yToLat(win.y0 + r1, Z)]
]];
const interior = pixelBox(1, 1, W - 1, H - 1);
const cls = (r, key) => r.classes.find(c => c.key === key);

test('Horn slope: a 10% plane rising east is 10% everywhere (ground spacing from latitude)', () => {
  const slope = hornSlopePct(demOf((r, c, m) => 0.10 * c * m), win);
  for (const i of [W + 1, 30 * W + 30, (H - 2) * W + W - 2]) near(slope[i], 10, 0.01, `pixel ${i}`);
  assert.ok(Number.isNaN(slope[0]), 'the margin has no slope');
  // The same elevations read with the equator's pixel size would be ~30% too steep: spacing matters.
  near(pixelMeters(45.7, 14), 6.67, 0.02, 'z14 pixel at 45.7 N');
  near(pixelMeters(0, 14), 9.55, 0.02, 'z14 pixel at the equator');
});

test('plane: mean, p90 and max are the plane grade; one class; no steep mask', () => {
  for (const [grade, key] of [[5, '0-8'], [12, '8-15'], [20, '15-25'], [27, '25-30']]) {
    const r = computeSlopeRaster(demOf((row, c, m) => grade / 100 * c * m), win, interior);
    assert.equal(r.available, true);
    near(r.meanPct, grade, 0.1, `${grade}% mean`);
    near(r.p90Pct, grade, 0.1, `${grade}% p90`);
    near(cls(r, key).pct, 100, 0.01, `${grade}% all in ${key}`);
    assert.equal(r.steepMask.length, 0);
  }
  // Diagonal plane: 30% east and 40% north -> 50% (Horn magnitude).
  const diag = computeSlopeRaster(demOf((r, c, m) => 0.3 * c * m - 0.4 * r * m), win, interior);
  near(diag.meanPct, 50, 0.3, 'diagonal 3-4-5 plane');
});

test('ridge: 40% side slopes are steep on both sides of a flat-reading crest', () => {
  const r = computeSlopeRaster(demOf((row, c, m) => 500 - 0.4 * Math.abs(c - 30) * m), win, interior);
  // 58 interior columns; the crest column reads 0% (Horn cancels), the rest 40%.
  near(cls(r, '30+').pct, 57 / 58 * 100, 0.2, 'steep share');
  near(cls(r, '0-8').pct, 1 / 58 * 100, 0.2, 'crest share');
  near(r.p90Pct, 40, 0.1, 'p90');
  // Mask: the two flanks, each one rectangle (the window margin has no slope).
  assert.equal(r.steepMask.length, 2);
  const [[w0, , e0], [w1, , e1]] = r.steepMask.sort((a, b) => a[0] - b[0]);
  near(e0, xToLon(win.x0 + 30, Z), 1e-6, 'west flank ends at the crest');
  near(w1, xToLon(win.x0 + 31, Z), 1e-6, 'east flank starts after the crest');
  assert.ok(w0 < e0 && w1 < e1);
});

test('draw: a 50% V-shaped draw in flat ground: class areas, acres and the mask subtracted by buildable-area', () => {
  // Flat except columns 40-50: a V (50% side slopes) centred on column 45.
  const dem = demOf((r, c, m) => (c >= 40 && c <= 50 ? 100 - 0.5 * (5 - Math.abs(c - 45)) * m : 100));
  const r = computeSlopeRaster(dem, win, interior);
  // Horn smooths the break: columns 39..51 read sloped. The steep ones are 40..50 except the
  // bottom (45: 0%) and the shoulders (39/51, 40/50 read 1/4 and 3/4 of the side slope).
  const steepCols = cls(r, '30+').pct / 100 * 58;
  assert.ok(steepCols >= 7 && steepCols <= 9, `${steepCols} steep columns`);
  near(cls(r, '30+').acres + cls(r, '25-30').acres + cls(r, '15-25').acres + cls(r, '8-15').acres + cls(r, '0-8').acres, r.measuredAcres, 0.05, 'class acres add up');
  // 13 sloped columns of 58 at up to 50%: a low mean, a steep p90 only when over 10% is sloped.
  assert.ok(r.meanPct > 3 && r.meanPct < 12, `mean ${r.meanPct}`);
  near(r.p90Pct, 50, 0.5, 'p90: the steepest 10% are the draw sides');

  const geometry = { type: 'Polygon', coordinates: interior };
  const b = buildableFromLayers(geometry, [
    { key: 'flood', label: 'Flood', status: 'none', rings: [] },
    { key: 'slope', label: `Slopes over ${STEEP_REMOVED_PCT}%`, status: 'counted', source: 'test', rings: r.steepMask.map(boundsRing), slopeClasses: r.classes }
  ]);
  const removed = b.removed.find(x => x.key === 'slope');
  near(removed.acres, cls(r, '30+').acres, 0.03, 'removed acres = the >30% class');
  near(b.buildableAcres + removed.acres, b.parcelAcres, 0.02, 'buildable + removed = parcel');
  assert.equal(b.slopeClasses.length, SLOPE_CLASSES.length);
  near(b.slopeClasses.reduce((a, c) => a + c.acres, 0), b.parcelAcres, 0.05, 'slope class acres scaled to the parcel');
  assert.ok(b.removedGeometry && b.geometry);
});

test('clip: a triangle parcel counts about half of the box; tiny parcels use the centre 3 x 3', () => {
  const [sw, se, ne] = interior[0];
  const tri = [[sw, se, ne, sw]];
  const { count } = clipMask(tri, win);
  near(count / (58 * 58), 0.5, 0.03, 'triangle share');
  const tiny = computeSlopeRaster(demOf((r, c, m) => 0.1 * c * m), win, pixelBox(30.2, 30.2, 30.6, 30.6));
  assert.equal(tiny.clipped, 'centre-3x3');
  assert.equal(tiny.pixels, 9);
  near(tiny.meanPct, 10, 0.01, 'tiny parcel slope');
});

test('voids: a parcel mostly over missing elevation is unavailable, not guessed', () => {
  const dem = demOf((r, c, m) => (c < 40 ? NaN : 0.1 * c * m));
  const r = computeSlopeRaster(dem, win, interior);
  assert.equal(r.available, false);
  assert.match(r.error, /too few/);
});

test('runRects merges identical runs down rows; isolated steep pixels are left out of the mask', () => {
  const grid = [
    0, 1, 1, 0,
    0, 1, 1, 0,
    1, 0, 0, 0
  ];
  const rects = runRects(4, 3, i => grid[i] === 1);
  assert.deepEqual(rects.sort((a, b) => a.r0 - b.r0), [{ c0: 1, c1: 2, r0: 0, r1: 1 }, { c0: 0, c1: 0, r0: 2, r1: 2 }]);
  // A one-pixel elevation spike makes its 8 neighbours steep under Horn (a 3 x 3 block), so it is
  // kept: only a lone steep reading with no steep neighbour is dropped as noise.
  const spike = computeSlopeRaster(demOf((r, c) => (r === 30 && c === 30 ? 20 : 0)), win, interior);
  assert.ok(spike.steepMask.length > 0, 'a real spike is a 3 x 3 block, not a speckle');
});

test('zoom choice: z14 for a parcel, lower zooms for larger ones, never more than 16 tiles', () => {
  const square = d => ({ minLon: -108.6, maxLon: -108.6 + d, minLat: 45.7, maxLat: 45.7 + d * 0.7 });
  assert.equal(chooseZoom(square(0.005)).z, 14);
  for (const d of [0.005, 0.03, 0.08]) {
    const w = chooseZoom(square(d));
    assert.ok(w && w.tiles.length <= RASTER_MAX_TILES, `${d}°: ${w?.tiles.length} tiles at z${w?.z}`);
  }
  assert.equal(chooseZoom(square(0.15)), null, 'a ~34,000 ac box is over the pixel cap even at z12 (the slope grid answers it)');
  assert.equal(chooseZoom(square(1)), null, 'a 1° parcel needs too many tiles even at z12');
  // CPU cap: a ~1,500 ac box fits 16 tiles at z14 but not RASTER_MAX_PIXELS, so it drops to z13.
  const big = chooseZoom({ minLon: -108.56, maxLon: -108.5, minLat: 45.69, maxLat: 45.732 });
  assert.equal(big.z, 13);
  assert.ok(big.width * big.height <= RASTER_MAX_PIXELS);
  const w = rasterWindow(square(0.005), 14);
  assert.ok(w.width > 2 && w.height > 2, 'the window has the 1-pixel Horn margin');
});

// ---- Recorded: Yellowstone 03092732390050000

test('Yellowstone 03092732390050000 (recorded tiles): the draw shows as steep ground', async () => {
  stubTiles();
  const r = await slopeRaster(YS);
  assert.equal(r.available, true);
  assert.equal(r.zoom, 14);
  assert.equal(r.tiles, 2);
  near(r.measuredAcres, 53.3, 0.3, 'parcel pixels area');
  near(r.meanPct, 7.4, 0.2, 'mean (was 2.6% from the 9-point average)');
  near(r.p90Pct, 20.8, 0.3, 'steepest 10%');
  near(cls(r, '30+').acres, 2.2, 0.15, 'over 30%');
  near(cls(r, '25-30').acres, 1.5, 0.15, '25-30%');
  near(cls(r, '15-25').acres, 5.0, 0.2, '15-25%');
  // The steep pixels are in the east/south part of the parcel.
  const xs = ringsFromGeometry(YS).flat();
  const midLon = (Math.min(...xs.map(p => p[0])) + Math.max(...xs.map(p => p[0]))) / 2;
  const midLat = (Math.min(...xs.map(p => p[1])) + Math.max(...xs.map(p => p[1]))) / 2;
  const se = r.steepMask.filter(([w, s, e, n]) => (w + e) / 2 > midLon || (s + n) / 2 < midLat).length;
  assert.ok(se / r.steepMask.length > 0.8, `${se} of ${r.steepMask.length} steep rectangles east or south of the middle`);
  assert.ok(r.displayRects.length > 0 && r.displayRects.every(d => SLOPE_CLASSES.some(c => c.key === d.cls)));
  assert.ok(r.computeMs < 500, `computed in ${r.computeMs} ms`);
  // Memoized per isolate: the second call makes no request.
  const before = calls.length;
  assert.equal((await slopeRaster(YS)).meanPct, r.meanPct);
  assert.equal(calls.length, before);
});

test('Yellowstone: /api/buildable-area removes the >30% ground; 15-30% is a note, not subtracted', async () => {
  stubTiles();
  const res = await worker.fetch(new Request('https://acresx.test/api/buildable-area', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'MT', county: 'Yellowstone', geometry: YS }) }), {}, {});
  const body = await res.json();
  const slope = body.removed.find(r => r.key === 'slope');
  assert.ok(slope, 'steep slope removed');
  near(slope.acres, 2.1, 0.3, 'removed steep acres');
  assert.match(body.layers.find(l => l.key === 'slope').source, /per-pixel slope/);
  assert.ok(body.notes.some(n => /15–30% slope: it may limit building/.test(n)), body.notes.join(' | '));
  assert.ok(body.slopeClasses.find(c => c.key === '15-25').acres > 4);
  assert.ok(body.buildableAcres < body.parcelAcres - 1.8, `${body.buildableAcres} of ${body.parcelAcres}`);
});

test('Yellowstone: /api/land-analysis average grade is the raster mean, with the steepest 10% and classes', async () => {
  const restore = configureElevation({ budgetMs: 800, identifyAfterMs: 100, epqsAfterMs: 200, tilesAfterMs: 100, retryMinMs: 50, minStageMs: 50, backoffMs: 0 });
  try {
    stubTiles();
    const res = await worker.fetch(new Request('https://acresx.test/api/land-analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geometry: YS }) }), {}, {});
    const { terrain } = await res.json();
    assert.equal(terrain.available, true);
    assert.equal(terrain.gradeMethod, 'raster');
    near(terrain.gradePct, 7.4, 0.2, 'average grade');
    near(terrain.p90GradePct, 20.8, 0.3, 'steepest 10%');
    assert.ok(terrain.pointGradePct < 4, `9-point grade ${terrain.pointGradePct}`);
    assert.equal(terrain.slopeClasses.length, 5);
    near(terrain.reliefFt, 144, 3, 'relief inside the parcel');
    assert.ok(terrain.homesiteSlopePct < 3 && Array.isArray(terrain.homesite.bounds), `homesite ${terrain.homesiteSlopePct}`);
  } finally { restore(); }
});

test('POST /api/slope-raster answers the raster; bad input is a JSON 400', async () => {
  stubTiles();
  const ok = await worker.fetch(new Request('https://acresx.test/api/slope-raster', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geometry: YS }) }), {}, {});
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.available, true);
  assert.ok(Array.isArray(body.displayRects) && Array.isArray(body.classes));
  const bad = await worker.fetch(new Request('https://acresx.test/api/slope-raster', { method: 'POST', body: '{}' }), {}, {});
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).available, false);
});

// ---- Fallback

test('tiles down: slopeRaster answers unavailable (never throws), is not memoized, and buildable-area falls back to the slope grid', async () => {
  // USGS getSamples answers a steep plane (40% east); the tiles fail.
  const xs = ringsFromGeometry(YS).flat();
  const lon0 = Math.min(...xs.map(p => p[0]));
  const ftPerDegLon = 364000 * Math.cos(45.7 * Math.PI / 180);
  stubTiles({}, (url, init) => {
    if (url.startsWith(`${ELEVATION_IMAGE_SERVICE}/getSamples`)) {
      const pts = JSON.parse(new URLSearchParams(String(init.body)).get('geometry')).points;
      return new Response(JSON.stringify({ samples: pts.map(([x], i) => ({ locationId: i, value: String((1000 + (x - lon0) * ftPerDegLon * 0.4) / 3.280839895) })) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('down', { status: 502 });
  });
  const r = await slopeRaster(YS);
  assert.equal(r.available, false);
  assert.match(r.error, /404|Terrain Tiles/);
  const res = await worker.fetch(new Request('https://acresx.test/api/buildable-area', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'MT', county: 'Yellowstone', geometry: YS }) }), {}, {});
  const body = await res.json();
  const layer = body.layers.find(l => l.key === 'slope');
  assert.equal(layer.status, 'counted', 'the 40% plane is steep on the grid');
  assert.match(layer.source, /parcel grid/);
  assert.match(layer.note, /detailed slope map was unavailable/);
  assert.equal(body.slopeClasses, null);
  // The failure was not memoized: tiles back, raster answers.
  stubTiles();
  assert.equal((await slopeRaster(YS)).available, true);
});

test('terrain cache: a point-only answer (no raster) is kept 10 minutes; the raster answer gets the normal TTL', async () => {
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); }
  } };
  const xs = ringsFromGeometry(YS).flat();
  const lon0 = Math.min(...xs.map(p => p[0]));
  const usgs = (url, init) => {
    if (url.startsWith(`${ELEVATION_IMAGE_SERVICE}/getSamples`)) {
      const pts = JSON.parse(new URLSearchParams(String(init.body)).get('geometry')).points;
      return new Response(JSON.stringify({ samples: pts.map(([x], i) => ({ locationId: i, value: String(1000 + (x - lon0) * 1000) })) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('down', { status: 502 });
  };
  const land = () => worker.fetch(new Request('https://acresx.test/api/land-analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geometry: YS }) }), {}, {}).then(r => r.json());
  const terrainEntry = () => [...store.entries()].find(([k]) => k.startsWith(TERRAIN_CACHE_PREFIX))?.[1];
  const restore = configureElevation({ budgetMs: 800, identifyAfterMs: 100, epqsAfterMs: 200, tilesAfterMs: 100, retryMinMs: 50, minStageMs: 50, backoffMs: 0 });
  try {
    // Tiles down: the getSamples 9-point answer, cached briefly.
    stubTiles({}, usgs);
    const first = (await land()).terrain;
    assert.equal(first.available, true);
    assert.equal(first.gradeMethod, undefined, 'no raster');
    assert.equal(terrainEntry().headers.get('Cache-Control'), `public, max-age=${POINT_ONLY_TTL_SECONDS}`);
    // Once that entry expires, tiles back: the raster answer replaces it with the normal TTL
    // (getSamples points: 30 days).
    store.clear();
    stubTiles(YS_TILES, usgs);
    const second = (await land()).terrain;
    assert.equal(second.gradeMethod, 'raster');
    near(second.gradePct, 7.4, 0.2, 'raster grade');
    const ttl = Number(/max-age=(\d+)/.exec(terrainEntry().headers.get('Cache-Control'))[1]);
    assert.ok(ttl >= TILE_ANSWER_TTL_SECONDS, `raster answer TTL ${ttl}`);
  } finally { restore(); }
});

// ---- Homesite / drainfield area (owner decision 2026-11-18)

// A 25% plane rising east with a flat 16 x 16 pixel bench (about 1.1 ac at 6.7 m) in its middle.
const bench = (r, c) => r >= 22 && r < 38 && c >= 22 && c < 38;
const benchDem = () => demOf((r, c, m) => (bench(r, c) ? 0.25 * 22 * m : 0.25 * c * m));

test('homesite: the gentlest ~1 ac square of a steep parcel is the flat bench', () => {
  const r = computeSlopeRaster(benchDem(), win, interior);
  near(r.meanPct, 25, 4, 'the parcel is steep on average');
  const [best, ...rest] = r.homesites;
  assert.equal(best.slopePct, 0, 'the bench interior is flat');
  near(best.acres, 1, 0.15, 'about one acre');
  const [w, s, e, n] = best.bounds;
  const c0 = lonToX(w, Z) - win.x0, c1 = lonToX(e, Z) - win.x0, r0 = latToY(n, Z) - win.y0, r1 = latToY(s, Z) - win.y0;
  assert.ok(c0 >= 22 && c1 <= 38 && r0 >= 22 && r1 <= 38, `inside the bench: cols ${c0}-${c1}, rows ${r0}-${r1}`);
  assert.ok(rest.length > 0 && rest.every(h => h.slopePct >= best.slopePct), 'other candidates are steeper');
  // Candidates are spread out: none is offset from the best by less than half a square both ways.
  const halfLon = (e - w) / 2 - 1e-9, halfLat = (n - s) / 2 - 1e-9;
  for (const h of rest) assert.ok(Math.abs(h.bounds[0] - w) >= halfLon || Math.abs(h.bounds[1] - s) >= halfLat, 'spread from the best');
});

test('homesite: a parcel smaller than an acre is its own candidate; all-steep parcels have none', () => {
  const small = computeSlopeRaster(demOf((r, c, m) => 0.05 * c * m), win, pixelBox(20, 20, 26, 26));
  assert.equal(small.homesites.length, 1);
  assert.equal(small.homesites[0].wholeParcel, true);
  near(small.homesites[0].slopePct, 5, 0.1, 'its slope');
  const cliff = computeSlopeRaster(demOf((r, c, m) => 0.5 * c * m), win, interior);
  assert.deepEqual(cliff.homesites, [], 'nothing under 30%');
});

test('homesite: the flattest acre is in a flood zone, a slightly steeper acre is clear: buildable-area takes the clear one', () => {
  // 25% plane with two benches: A (cols 4-20) flat, B (cols 38-54) a 3% plane; both rows 22-38.
  const dem = demOf((r, c, m) => {
    if (r >= 22 && r < 38 && c >= 4 && c < 20) return 0.25 * 4 * m;
    if (r >= 22 && r < 38 && c >= 38 && c < 54) return 0.25 * 38 * m + 0.03 * (c - 38) * m;
    return 0.25 * c * m;
  });
  const r = computeSlopeRaster(dem, win, interior);
  assert.equal(r.homesites[0].slopePct, 0, 'the flattest candidate is bench A');
  const geometry = { type: 'Polygon', coordinates: interior };
  const slope = { key: 'slope', label: 'Slopes over 30%', status: 'none', rings: [], slopeClasses: r.classes, homesites: r.homesites };
  // A flood zone over bench A and its surroundings (columns 0-30).
  const flood = { key: 'flood', label: 'Flood', status: 'counted', rings: [pixelBox(0, 0, 30, H)] };
  const b = buildableFromLayers(geometry, [flood, slope]);
  assert.equal(b.homesiteStatus, 'found');
  near(b.homesite.slopePct, 3, 0.3, 'bench B slope');
  const c = lonToX(b.homesite.bounds[0], Z) - win.x0;
  assert.ok(c >= 37, `homesite starts at column ${c}, east of the flood zone`);
  // The whole parcel flooded: no site clear of mapped constraints.
  const none = buildableFromLayers(geometry, [{ ...flood, rings: [pixelBox(0, 0, W, H)] }, slope]);
  assert.equal(none.homesite, null);
  assert.equal(none.homesiteStatus, 'none_clear');
});

test('septic: graded on the homesite slope, not the parcel average; re-graded when the buildable homesite arrives; parcel average without a raster', () => {
  const h = makeLazyContext();
  h.run(readPublic('screening-inputs.js'));
  const SX = h.context.AcresXSeptic;
  const soil = () => ({ available: true, drainage: 'Well drained', hydrologicGroup: 'B', feasibility: 'favorable', mapUnit: 'Test loam, 15 to 35 percent slopes' });
  // A steep parcel (25% average) with a flat acre: not limited.
  const land = { soil: soil(), terrain: { available: true, gradePct: 25, homesiteSlopePct: 2.1 } };
  SX.apply(land);
  assert.equal(land.soil.feasibility, 'favorable');
  assert.equal(land.soil.septic.slopeSource, 'homesite');
  assert.match(land.soil.septic.context, /^Drainfield-area slope 2\.1% \(gentlest ~1 ac\); parcel average 25\.0%/);
  assert.equal(SX.score(land), 92);
  // The buildable homesite (outside flood/wetlands) is steeper: re-graded on it.
  h.context.last = { land, buildableArea: { homesite: { slopePct: 18.4, bounds: [0, 0, 1, 1] } } };
  assert.equal(SX.score(land), 38);
  assert.equal(land.soil.feasibility, 'limited');
  assert.match(land.soil.septic.limits.join(' '), /drainfield-area slope 18\.4% \(over 15%\)/);
  // No ~1 acre site clear of mapped constraints: the parcel average, not the in-flood terrain homesite.
  h.context.last = { land, buildableArea: { homesite: null, homesiteStatus: 'none_clear' } };
  assert.equal(SX.score(land), 38, 'graded on the 25% parcel average');
  assert.match(land.soil.septic.context, /no ~1 acre site clear of mapped constraints/);
  assert.equal(land.soil.septic.slopeSource, 'measured');
  // No raster: the parcel average, as before.
  h.context.last = null;
  const old = { soil: soil(), terrain: { available: true, gradePct: 25 } };
  SX.apply(old);
  assert.equal(old.soil.feasibility, 'limited');
  assert.equal(old.soil.septic.slopeSource, 'measured');
});

test('Yellowstone (recorded tiles): a near-flat homesite acre in the west, reported by land-analysis and buildable-area', async () => {
  stubTiles();
  const r = await slopeRaster(YS);
  assert.ok(r.homesites.length >= 3);
  assert.ok(r.homesites[0].slopePct < 3, `homesite slope ${r.homesites[0].slopePct}`);
  const res = await worker.fetch(new Request('https://acresx.test/api/buildable-area', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'MT', county: 'Yellowstone', geometry: YS }) }), {}, {});
  const body = await res.json();
  assert.equal(body.homesite.slopePct, r.homesites[0].slopePct);
  assert.match(body.homesite.basis, /Gentlest ~1 acre/);
});
