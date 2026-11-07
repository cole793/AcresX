// Offline tests for the AWS Terrain Tiles elevation source (src/services/terrain-tiles.js), its PNG
// decoder (src/shared/png.js) and how elevation.js combines it with the USGS sources behind
// /api/land-analysis and /api/slope-grid. The tile fixture is a real terrarium tile
// (terrarium/14/2878/5726.png, recorded 2026-11-07, x-amz-meta-x-imagery-sources:
// ned13/USGS_NED_13_n48w117_IMG.tif) covering the parcel of the recorded 3DEP getSamples fixture
// (2026-10-27). No live calls.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import worker from '../src/index.js';
import { decodePng, unfilterScanlines } from '../src/shared/png.js';
import {
  TERRAIN_TILES_URL, TERRAIN_TILE_MAX_TILES, terrainTileSamplesFt, terrariumMeters, tileZoomFor, pixelAt, clearTerrainTileMemo
} from '../src/services/terrain-tiles.js';
import { ELEVATION_IMAGE_SERVICE, EPQS_URL, configureElevation, elevationSamplesFt, ELEVATION_TIMING } from '../src/services/elevation.js';
import {
  TCC_SERVICE, TERRAIN_CACHE_PREFIX, TILE_ANSWER_TTL_SECONDS, TILE_ELEVATION_LABEL, USGS_ELEVATION_LABEL
} from '../src/services/land-analysis.js';
import { SLOPE_CACHE_PREFIX } from '../src/services/slope-grid.js';

const fixtureUrl = name => new URL(`fixtures/${name}`, import.meta.url);
const TILE_PNG = readFileSync(fixtureUrl('terrarium-14-2878-5726.png'));
const TILE_PATH = '/14/2878/5726.png';
const recorded = JSON.parse(readFileSync(fixtureUrl('elevation-getsamples.json'), 'utf8'));
const geometry = recorded.geometry;
const FEET = 3.280839895;

const SOIL_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
const soilBody = { Table: [['mukey', 'muname', 'compname', 'comppct_r', 'drainagecl', 'hydgrp', 'slope_r'], ['1', 'Test loam', 'Test', '85', 'Well drained', 'B', '12']] };
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const pngResponse = () => new Response(TILE_PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
const kind = url => {
  if (url.startsWith(TERRAIN_TILES_URL)) return 'tiles';
  if (url.startsWith(`${ELEVATION_IMAGE_SERVICE}/getSamples`)) return '3dep';
  if (url.startsWith(`${ELEVATION_IMAGE_SERVICE}/identify`)) return 'identify';
  if (url.startsWith(EPQS_URL)) return 'epqs';
  if (url.startsWith(`${TCC_SERVICE}/getSamples`)) return 'tcc';
  if (url.startsWith(SOIL_URL)) return 'soil';
  return 'other';
};
const pointsOf = body => JSON.parse(new URLSearchParams(String(body)).get('geometry')).points;
function recordedSamples(service, body) {
  const entry = recorded.getSamples[`${service}:${pointsOf(body).length}`];
  assert.ok(entry, `no recorded ${service} getSamples`);
  return structuredClone(entry.response);
}
const down = () => new Response('<html>502 Bad Gateway</html>', { status: 502 });
const hang = () => new Promise(() => {});
const later = (ms, answer) => call => new Promise(resolve => setTimeout(() => resolve(answer(call)), ms));
const usgsPlane = url => {
  const u = new URL(url);
  const p = u.searchParams.get('geometry') ? JSON.parse(u.searchParams.get('geometry')) : { x: Number(u.searchParams.get('x')), y: Number(u.searchParams.get('y')) };
  return 2500 + (p.x + 116.76) * 20000 + (p.y - 47.5446) * 30000;
};

// Default: every source answers from its recording; the tile server only has the fixture tile.
function stubFetch(handlers = {}) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const k = kind(url);
    const call = { url, kind: k, body: init.body == null ? null : String(init.body), signal: init.signal };
    calls.push(call);
    if (handlers[k]) return handlers[k](call);
    if (k === 'tiles') return url.endsWith(TILE_PATH) ? pngResponse() : new Response('<Error>NoSuchKey</Error>', { status: 404 });
    if (k === '3dep' || k === 'tcc') return jsonResponse(recordedSamples(k, call.body));
    if (k === 'soil') return jsonResponse(soilBody);
    if (k === 'identify') return jsonResponse({ value: String(usgsPlane(url) / FEET) });
    if (k === 'epqs') return jsonResponse({ value: usgsPlane(url) });
    throw new Error(`unexpected upstream call: ${url}`);
  };
}
const count = k => calls.filter(c => c.kind === k).length;

function fakeCache() {
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); }
  } };
  return store;
}

beforeEach(() => { calls = []; delete globalThis.caches; clearTerrainTileMemo(); });
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

async function post(route, body = { geometry }) {
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  const response = await worker.fetch(new Request(`https://acresx.test${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }), {}, ctx);
  await Promise.all(pending);
  return { response, body: await response.json() };
}
const landAnalysis = () => post('/api/land-analysis');
const slopeGrid = () => post('/api/slope-grid');
const FAST = { budgetMs: 800, identifyAfterMs: 100, epqsAfterMs: 200, tilesAfterMs: 100, retryMinMs: 50, minStageMs: 50, backoffMs: 0 };
const withTiming = async (overrides, fn) => { const restore = configureElevation(overrides); try { return await fn(); } finally { restore(); } };

// --- PNG decoder -----------------------------------------------------------------------------

// Builds a PNG with the given filter type on every scanline (test-side encoder, node:zlib).
function crc32(bytes) {
  let c = ~0;
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(width, height, channels, pixels, filters) {
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const f = filters[y % filters.length];
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const x = pixels[y * stride + i];
      const a = i >= channels ? pixels[y * stride + i - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const z = deflateSync(raw);
  // Two IDAT chunks, to check they are joined.
  const half = Math.floor(z.length / 2);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z.subarray(0, half)), chunk('IDAT', z.subarray(half)), chunk('IEND', Buffer.alloc(0))]);
}
const noise = (n, seed = 7) => { let s = seed; return Uint8Array.from({ length: n }, () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s >> 16 & 0xff; }); };

test('png: the recorded terrarium tile decodes to the same pixels as an independent decoder', async () => {
  const image = await decodePng(TILE_PNG);
  assert.equal(image.width, 256);
  assert.equal(image.height, 256);
  assert.equal(image.channels, 3);
  // SHA-256 of the RGB bytes from Pillow 12.3 (Image.open(...).tobytes()), 2026-11-07.
  assert.equal(createHash('sha256').update(image.pixels).digest('hex'), 'ad1c6234a50f84cfca1e448ac874993e8025d0b6e7dc3c4f4dc1dfade90b9f62');
  const px = (x, y) => [...image.pixels.subarray((y * 256 + x) * 3, (y * 256 + x) * 3 + 3)];
  // Pixel values from Pillow, and the terrarium decode from the joerd formats.md formula.
  const known = [[0, 0, [131, 2, 162], 770.6328125], [255, 0, [131, 77, 70], 845.2734375], [0, 255, [131, 16, 198], 784.7734375],
    [255, 255, [131, 13, 88], 781.34375], [128, 128, [131, 15, 124], 783.484375], [17, 203, [130, 149, 79], 661.30859375]];
  for (const [x, y, rgb, meters] of known) {
    assert.deepEqual(px(x, y), rgb, `pixel ${x},${y}`);
    assert.equal(terrariumMeters(...rgb), meters);
  }
});

test('png: terrarium decode matches the formats.md worked example', () => {
  // "with a starting value of 2523.266 ... rgb(137, 219, 68) ... Decoded, this gives us 2523.265625"
  assert.equal(terrariumMeters(137, 219, 68), 2523.265625);
});

test('png: filter types 0-4 decode exactly, RGB and RGBA, across split IDAT chunks', async () => {
  for (const channels of [3, 4]) {
    for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
      const width = 13, height = 11;
      const pixels = noise(width * height * channels, filters.length * 31 + channels);
      const image = await decodePng(encodePng(width, height, channels, pixels, filters));
      assert.equal(image.channels, channels);
      assert.deepEqual([...image.pixels], [...pixels], `channels ${channels}, filters ${filters}`);
    }
  }
});

test('png: unsupported or broken files are refused with a clear error', async () => {
  await assert.rejects(decodePng(Buffer.from('<Error>NoSuchKey</Error>')), /Not a PNG/);
  const good = encodePng(4, 4, 3, noise(48), [0]);
  const palette = Buffer.from(good); palette[8 + 8 + 9] = 3; // IHDR colour type -> palette
  await assert.rejects(decodePng(palette), /colour type 3/);
  await assert.rejects(decodePng(good.subarray(0, 40)), /truncated|no image data|IHDR/);
  assert.throws(() => unfilterScanlines(Uint8Array.from([5, 1, 2, 3]), 1, 1, 3), /filter type 5/);
});

// --- tile sampling ---------------------------------------------------------------------------

test('tiles: one zoom-14 tile covers the parcel; values agree with recorded 3DEP getSamples', async () => {
  stubFetch();
  for (const key of ['3dep:9', '3dep:25']) {
    const entry = recorded.getSamples[key];
    const points = JSON.parse(entry.request.geometry).points.map(([lon, lat]) => ({ lon, lat }));
    const usgsFt = points.map((_, i) => Number(entry.response.samples.find(s => s.locationId === i).value) * FEET);
    const { values, zoom, tiles } = await terrainTileSamplesFt(points);
    assert.equal(zoom, 14);
    assert.equal(tiles, 1);
    const diffs = values.map((v, i) => Math.abs(v - usgsFt[i]));
    // This parcel is steep (270 ft of relief, 18 % average grade). The tile copy is the 2017 10 m
    // NED raster; live 3DEP differs from it by up to ~18 ft per point here, 9-10 ft RMS.
    assert.ok(Math.max(...diffs) < 20, `max difference ${Math.max(...diffs).toFixed(1)} ft`);
    const rms = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
    assert.ok(rms < 12, `rms ${rms.toFixed(1)} ft`);
  }
  assert.equal(count('tiles'), 1, 'the second lookup reuses the decoded tile');
});

test('tiles: a large parcel drops zoom so it never needs more than the tile cap', () => {
  const square = d => [{ lon: -117.5, lat: 48 }, { lon: -117.5 + d, lat: 48 }, { lon: -117.5, lat: 48 + d }, { lon: -117.5 + d, lat: 48 + d }];
  for (const d of [0.001, 0.01, 0.05, 0.2]) {
    const points = square(d);
    const z = tileZoomFor(points);
    const keys = new Set(points.map(p => { const q = pixelAt(p.lon, p.lat, z); return `${Math.floor(q.x / 256)}/${Math.floor(q.y / 256)}`; }));
    assert.ok(keys.size <= TERRAIN_TILE_MAX_TILES, `${d}° square: ${keys.size} tiles at z${z}`);
  }
  assert.equal(tileZoomFor(square(0.001)), 14);
});

// --- combined with USGS ----------------------------------------------------------------------

test('USGS slow, tiles answer: terrain and a full slope grid from the tiles, no per-point hedges', async () => {
  await withTiming(FAST, async () => {
    stubFetch({ '3dep': hang, identify: hang, epqs: hang });
    const started = Date.now();
    const { body } = await landAnalysis();
    assert.ok(Date.now() - started < FAST.budgetMs, `took ${Date.now() - started} ms`);
    assert.equal(body.terrain.available, true);
    assert.deepEqual(body.terrain.elevationSources, ['terrain-tiles']);
    assert.equal(body.terrain.source, TILE_ELEVATION_LABEL);
    assert.equal(body.terrain.sampleCount, 9);
    assert.ok(Math.abs(body.terrain.gradePct - 18.18) < 3, `tile grade ${body.terrain.gradePct} vs USGS 18.18`);
    assert.equal(count('identify') + count('epqs'), 0, 'tiles answered before any hedge started');
    assert.ok(calls.find(c => c.kind === '3dep').signal.aborted, 'the slow getSamples was cancelled');

    calls = [];
    const slope = (await slopeGrid()).body;
    assert.equal(slope.available, true);
    assert.deepEqual(slope.elevationSources, ['terrain-tiles']);
    assert.equal(slope.resolution, '4 x 4 parcel grid');
    assert.equal(slope.sampleCount, 25);
    assert.equal(slope.partial, false);
    assert.equal(slope.cells.length, 16);
    assert.equal(count('identify') + count('epqs'), 0);
  });
});

test('USGS fast: getSamples is preferred even when the tiles answered first', async () => {
  await withTiming(FAST, async () => {
    stubFetch({ '3dep': later(50, call => jsonResponse(recordedSamples('3dep', call.body))) });
    const { body } = await landAnalysis();
    assert.deepEqual(body.terrain.elevationSources, ['getSamples']);
    assert.equal(body.terrain.source, USGS_ELEVATION_LABEL);
    assert.ok(Math.abs(body.terrain.gradePct - 18.180578852890957) < 1e-9, 'the recorded USGS numbers');
  });
});

test('tiles down, USGS answers: unchanged USGS answers, the tile error only logged', async () => {
  for (const tiles of [down, () => { throw new Error('network down'); }, () => new Response('not a png', { status: 200 })]) {
    calls = [];
    stubFetch({ tiles });
    const { body } = await landAnalysis();
    assert.deepEqual(body.terrain.elevationSources, ['getSamples']);
    assert.equal(body.terrain.source, USGS_ELEVATION_LABEL);
    const slope = (await slopeGrid()).body;
    assert.deepEqual(slope.elevationSources, ['getSamples']);
    assert.equal(slope.partial, false);
  }
  // getSamples down too: the USGS per-point hedges still answer.
  await withTiming(FAST, async () => {
    stubFetch({ tiles: down, '3dep': down });
    const { body } = await landAnalysis();
    assert.deepEqual(body.terrain.elevationSources, ['identify']);
  });
});

test('both down: honest messages naming the backup, other layers unaffected, in finite time', async () => {
  await withTiming(FAST, async () => {
    stubFetch({ tiles: down, '3dep': down, identify: down, epqs: down });
    const { body } = await landAnalysis();
    assert.equal(body.terrain.available, false);
    assert.equal(body.terrain.error, 'USGS elevation was unavailable for 9 of 9 terrain points. The AWS Terrain Tiles backup was unavailable too.');
    assert.equal(body.soil.available, true);
    assert.equal(body.landCover.available, true);
    const slope = await slopeGrid();
    assert.equal(slope.body.available, false);
    assert.match(slope.body.error, /Not enough elevation samples/);
    assert.deepEqual(slope.body.elevationSources, []);
    assert.equal(slope.response.headers.get('Cache-Control'), 'no-store');

    stubFetch({ tiles: hang, '3dep': hang, identify: hang, epqs: hang });
    const started = Date.now();
    const hung = (await landAnalysis()).body;
    assert.equal(hung.terrain.available, false);
    assert.ok(Date.now() - started < FAST.budgetMs + 500, `took ${Date.now() - started} ms`);
  });
});

test('every USGS source fails fast: the lookup waits for a slower tile answer', async () => {
  await withTiming({ ...FAST, tilesAfterMs: 5000, identifyAfterMs: 5000, epqsAfterMs: 5000 }, async () => {
    stubFetch({ '3dep': down, identify: down, epqs: down, tiles: later(150, () => pngResponse()) });
    const result = await elevationSamplesFt([{ lon: -116.759, lat: 47.545 }]);
    assert.deepEqual(result.sources, ['terrain-tiles']);
    assert.equal(result.tiles, true);
  });
});

test('mixed sources: a partial USGS answer is never combined with tile values', async () => {
  await withTiming(FAST, async () => {
    // getSamples answers 8 of 9 points (one NoData would be resolved, so drop it as a failure:
    // getSamples down) and identify answers only the centre point before the tiles are accepted.
    const entry = recorded.getSamples['3dep:9'];
    const points = JSON.parse(entry.request.geometry).points.map(([lon, lat]) => ({ lon, lat }));
    stubFetch({ '3dep': down, identify: call => (JSON.parse(new URL(call.url).searchParams.get('geometry')).x === points[0].lon ? jsonResponse({ value: '800' }) : hang()), epqs: hang });
    const result = await elevationSamplesFt(points);
    assert.equal(result.tiles, true);
    assert.deepEqual(result.from, points.map(() => 'terrain-tiles'), 'every value from the tiles');
    assert.deepEqual(result.sources, ['terrain-tiles']);
    assert.notEqual(result.values[0], 800 * FEET, 'the identify value is not mixed in');

    // A tile answer missing a point (outside the tiles) is not used at all.
    calls = [];
    stubFetch({ '3dep': down, identify: down, epqs: down, tiles: call => (call.url.endsWith(TILE_PATH) ? pngResponse() : down()) });
    const far = await elevationSamplesFt([points[0], { lon: -100, lat: 40 }]);
    assert.equal(far.tiles, false);
    assert.deepEqual(far.values, [null, null]);
    assert.ok(far.errors['terrain-tiles']);
  });
});

test('cache rule: tile answers are kept one day, USGS answers 30 days, partial answers never', async () => {
  const store = fakeCache();
  await withTiming(FAST, async () => {
    stubFetch({ '3dep': hang, identify: hang, epqs: hang });
    await landAnalysis();
    await slopeGrid();
  });
  const entries = [...store.entries()];
  const terrain = entries.find(([k]) => k.startsWith(TERRAIN_CACHE_PREFIX));
  const slope = entries.find(([k]) => k.startsWith(SLOPE_CACHE_PREFIX));
  assert.ok(terrain && slope, 'tile answers are cached');
  for (const [, res] of [terrain, slope]) assert.equal(res.headers.get('Cache-Control'), `public, max-age=${TILE_ANSWER_TTL_SECONDS}`);
  assert.equal(TILE_ANSWER_TTL_SECONDS, 86400);
  assert.deepEqual((await terrain[1].clone().json()).elevationSources, ['terrain-tiles']);

  // A cache hit answers without any elevation request.
  calls = [];
  stubFetch();
  const land = (await landAnalysis()).body;
  assert.deepEqual(land.terrain.elevationSources, ['terrain-tiles']);
  assert.equal(count('3dep') + count('tiles'), 0);

  // A USGS answer is stored for 30 days.
  const usgsStore = fakeCache();
  calls = [];
  stubFetch();
  await landAnalysis();
  await slopeGrid();
  for (const [k, res] of usgsStore.entries()) {
    if (k.startsWith(TERRAIN_CACHE_PREFIX) || k.startsWith(SLOPE_CACHE_PREFIX)) assert.equal(res.headers.get('Cache-Control'), `public, max-age=${30 * 24 * 60 * 60}`);
  }

  // A coarse (partial) USGS fallback grid is not stored, tiles down.
  const partialStore = fakeCache();
  await withTiming(FAST, async () => {
    stubFetch({ tiles: down, '3dep': down, identify: down });
    const body = (await slopeGrid()).body;
    assert.equal(body.partial, true);
  });
  assert.ok(![...partialStore.keys()].some(k => k.startsWith(SLOPE_CACHE_PREFIX)));
});

test('request budget: the tile source adds at most the tile cap per lookup', async () => {
  await withTiming(FAST, async () => {
    stubFetch({ tiles: down, '3dep': down, identify: down, epqs: down });
    await slopeGrid();
    assert.equal(count('tiles'), 1, 'one tile covers this parcel');
    assert.ok(calls.length <= 2 + 9 + 9 + TERRAIN_TILE_MAX_TILES, `${calls.length} requests`);
  });
  assert.ok(2 + 9 + 9 + TERRAIN_TILE_MAX_TILES < 50, 'per-route subrequest budget');
});

test('defaults: tiles on, accepted once USGS is as late as the identify hedge', () => {
  assert.equal(ELEVATION_TIMING.tiles, true);
  assert.equal(ELEVATION_TIMING.tilesAfterMs, ELEVATION_TIMING.identifyAfterMs);
  assert.ok(ELEVATION_TIMING.budgetMs <= 17000, 'still inside the browser 20 s land-analysis limit');
});
