// Elevation from the AWS Terrain Tiles open dataset ("terrarium" PNG tiles), an independent
// host for the terrain and slope-grid lookups when the USGS services are slow (elevation.js).
//
// Source (checked 2026-11-07):
//   - Registry of Open Data on AWS, https://registry.opendata.aws/terrain-tiles/: "A global
//     dataset providing bare-earth terrain heights, tiled for easy usage and provided on S3."
//     S3 bucket arn:aws:s3:::elevation-tiles-prod (us-east-1). License:
//     https://github.com/tilezen/joerd/blob/master/docs/attribution.md, which asks for
//     "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of
//     the U.S. Geological Survey."
//   - Format (joerd docs/formats.md): "Terrarium format PNG tiles contain raw elevation data in
//     meters, in Web Mercator projection (EPSG:3857) ... To decode:
//     (red * 256 + green + blue / 256) - 32768". Tiles are 256 x 256, 8-bit RGB.
//   - Sources (joerd docs/data-sources.md): in the US, "3DEP (formerly NED and NED Topobathy) ...
//     10 meters outside of Alaska, 3 meter in select land"; zooms 11-15 use "NED/3DEP 1/3 arcsec
//     and 1/9 arcsec". "Version 1.1 was built during 2017Q3 ... Regular updates are not planned."
//     Each tile names its rasters in the x-amz-meta-x-imagery-sources header (e.g.
//     "ned13/USGS_NED_13_n48w117_IMG.tif").
// So the tiles hold a 2017 copy of the same USGS 3DEP 1/3 arc-second data, served from S3, no key.
// They are not the agency's live service, so a USGS answer is preferred whenever one arrives in
// time (elevation.js ranks the sources) and the answer names the source ('terrain-tiles').
//
// Zoom 14 pixels are ~6.5 m at 47° N, finer than the 10 m source raster. One zoom-14 tile
// (~1.7 km wide here) usually covers a whole parcel; larger parcels drop to a lower zoom so the
// lookup never needs more than TERRAIN_TILE_MAX_TILES tiles (subrequests). A parcel too large for
// that even at TERRAIN_TILE_MIN_ZOOM (~13 km tiles) gets no tile answer; USGS still answers it.
// A tile answer larger than TERRAIN_TILE_MAX_BYTES, or not a 256 x 256 PNG, is refused (see
// src/shared/png.js for the decoder's own limits).
import { fetchWithTimeout } from '../shared/http.js';
import { decodePng, MAX_PNG_INPUT_BYTES } from '../shared/png.js';

export const TERRAIN_TILES_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium';
export const TERRAIN_TILE_ZOOM = 14;
export const TERRAIN_TILE_MIN_ZOOM = 11;
export const TERRAIN_TILE_MAX_TILES = 4;
export const TERRAIN_TILE_SIZE = 256;
export const TERRAIN_TILE_TIMEOUT_MS = 8000;
export const TERRAIN_TILE_MAX_BYTES = MAX_PNG_INPUT_BYTES;
// Decoded tiles kept per isolate (each ~192 KB): terrain and slope grid for one parcel share them.
const MEMO_TILES = 16;
const memo = new Map();

// Tests only.
export function clearTerrainTileMemo() { memo.clear(); }

const clampLat = lat => Math.max(-85.05112878, Math.min(85.05112878, lat));

// Global pixel coordinates (pixel centres at .5) at zoom z, Web Mercator.
export function pixelAt(lon, lat, z) {
  const scale = TERRAIN_TILE_SIZE * 2 ** z;
  const phi = clampLat(lat) * Math.PI / 180;
  return {
    x: (lon + 180) / 360 * scale,
    y: (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 * scale
  };
}

const tileKey = (z, x, y) => `${z}/${x}/${y}`;

function tilesFor(points, z) {
  const keys = new Map();
  for (const p of points) {
    const { x, y } = pixelAt(p.lon, p.lat, z);
    const tx = Math.floor(x / TERRAIN_TILE_SIZE);
    const ty = Math.floor(y / TERRAIN_TILE_SIZE);
    keys.set(tileKey(z, tx, ty), { z, x: tx, y: ty });
  }
  return [...keys.values()];
}

// The highest zoom from TERRAIN_TILE_ZOOM down to TERRAIN_TILE_MIN_ZOOM whose tiles covering
// `points` number at most maxTiles, or null when even the lowest zoom needs more.
export function tileZoomFor(points, maxTiles = TERRAIN_TILE_MAX_TILES) {
  for (let z = TERRAIN_TILE_ZOOM; z >= TERRAIN_TILE_MIN_ZOOM; z--) {
    if (tilesFor(points, z).length <= maxTiles) return z;
  }
  return null;
}

export const terrariumMeters = (r, g, b) => (r * 256 + g + b / 256) - 32768;

async function loadTile(tile, { signal, timeoutMs }) {
  const key = tileKey(tile.z, tile.x, tile.y);
  if (memo.has(key)) {
    const hit = memo.get(key);
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  const response = await fetchWithTimeout(`${TERRAIN_TILES_URL}/${key}.png`, {
    signal, label: 'terrain-tiles', agency: 'AWS Terrain Tiles', maxBytes: TERRAIN_TILE_MAX_BYTES
  }, timeoutMs);
  if (!response.ok) throw new Error(`AWS Terrain Tiles returned ${response.status}`);
  let image;
  try {
    image = await decodePng(await response.arrayBuffer(), { width: TERRAIN_TILE_SIZE, height: TERRAIN_TILE_SIZE, maxInputBytes: TERRAIN_TILE_MAX_BYTES });
  } catch (error) {
    throw new Error(`AWS Terrain Tiles returned an unreadable tile (${error?.message || 'decode failed'})`);
  }
  memo.set(key, image);
  while (memo.size > MEMO_TILES) memo.delete(memo.keys().next().value);
  return image;
}

// Elevations in feet for points: { values: (number|null)[], zoom, tiles: number }.
// Bilinear between the four nearest pixel centres; across a tile edge it uses the neighbouring
// tile when that tile is loaded, else the nearest edge pixel. Throws if any tile fails.
export async function terrainTileSamplesFt(points, { signal, timeoutMs = TERRAIN_TILE_TIMEOUT_MS } = {}) {
  if (!points.length) return { values: [], zoom: TERRAIN_TILE_ZOOM, tiles: 0 };
  const z = tileZoomFor(points);
  if (z === null) throw new Error(`AWS Terrain Tiles: the parcel needs more than ${TERRAIN_TILE_MAX_TILES} tiles even at zoom ${TERRAIN_TILE_MIN_ZOOM}`);
  const tiles = tilesFor(points, z);
  if (tiles.length > TERRAIN_TILE_MAX_TILES) throw new Error('AWS Terrain Tiles: too many tiles');
  const images = new Map();
  await Promise.all(tiles.map(async tile => {
    images.set(tileKey(tile.z, tile.x, tile.y), await loadTile(tile, { signal, timeoutMs }));
  }));

  const S = TERRAIN_TILE_SIZE;
  const pixel = (gx, gy, fallbackTile) => {
    let tx = Math.floor(gx / S), ty = Math.floor(gy / S);
    let image = images.get(tileKey(z, tx, ty));
    if (!image) { ({ tx, ty, image } = fallbackTile); }
    const px = Math.max(0, Math.min(S - 1, gx - tx * S));
    const py = Math.max(0, Math.min(S - 1, gy - ty * S));
    const o = (py * S + px) * image.channels;
    if (image.channels === 4 && image.pixels[o + 3] === 0) return null;
    return terrariumMeters(image.pixels[o], image.pixels[o + 1], image.pixels[o + 2]);
  };

  const values = points.map(p => {
    const { x, y } = pixelAt(p.lon, p.lat, z);
    const tx = Math.floor(x / S), ty = Math.floor(y / S);
    const home = { tx, ty, image: images.get(tileKey(z, tx, ty)) };
    const fx = x - 0.5, fy = y - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const dx = fx - x0, dy = fy - y0;
    const v00 = pixel(x0, y0, home), v10 = pixel(x0 + 1, y0, home);
    const v01 = pixel(x0, y0 + 1, home), v11 = pixel(x0 + 1, y0 + 1, home);
    if ([v00, v10, v01, v11].some(v => v === null)) return null;
    const meters = (v00 * (1 - dx) + v10 * dx) * (1 - dy) + (v01 * (1 - dx) + v11 * dx) * dy;
    // Terrarium water/void areas decode to 0 m or below; none of our counties are near sea level.
    return meters > -500 ? meters * 3.280839895 : null;
  });
  return { values, zoom: z, tiles: tiles.length };
}
