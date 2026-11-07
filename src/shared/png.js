// Minimal PNG decoder for the Worker (no dependency): 8-bit, non-interlaced, colour type 2 (RGB)
// or 6 (RGBA). Enough for terrain tiles (src/services/terrain-tiles.js); anything else throws.
//
// PNG spec (https://www.w3.org/TR/png-3/): an 8-byte signature, then chunks of
// [length u32 BE][type 4 bytes][data][crc u32]. IHDR holds width, height, bit depth, colour type,
// compression, filter and interlace methods. The image data is the concatenation of every IDAT
// chunk, a zlib stream ("deflate" in DecompressionStream terms). Each decompressed scanline
// starts with a filter-type byte (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth) applied per byte, with
// bpp = bytes per pixel as the left-neighbour distance.
//
// Limits, so a hostile or broken file cannot use much memory or time:
//   - the file itself is at most maxInputBytes (default 512 KB; a terrain tile is ~100 KB);
//   - the IHDR size must match opts.width / opts.height when given, and is never over
//     MAX_PNG_DIMENSION a side or MAX_PNG_OUTPUT_BYTES of scanline data, checked before inflating;
//   - inflate is streamed and stopped as soon as its output passes the height * (stride + 1)
//     bytes the IHDR allows (a 400 KB zlib stream can inflate to 400 MB);
//   - the CRCs of IHDR and IDAT chunks are checked.
export const MAX_PNG_INPUT_BYTES = 512 * 1024;
export const MAX_PNG_DIMENSION = 1024;
export const MAX_PNG_OUTPUT_BYTES = 4 * 1024 * 1024 + MAX_PNG_DIMENSION;

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 2: 3, 6: 4 };
// Input is fed to inflate in slices this size, so one write cannot expand to much more than
// ~1 MB (deflate's maximum ratio is about 1032:1) before the output limit is checked.
const INFLATE_SLICE_BYTES = 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// CRC-32 (ISO-HDLC) as PNG uses it, over the chunk type and data.
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// zlib inflate that fails as soon as the output passes `limit` bytes, and cancels the stream.
async function inflateLimited(bytes, limit) {
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let failed = false;
  const writing = (async () => {
    for (let at = 0; at < bytes.length && !failed; at += INFLATE_SLICE_BYTES) {
      await writer.ready;
      await writer.write(bytes.subarray(at, at + INFLATE_SLICE_BYTES));
    }
    if (!failed) await writer.close();
  })();
  writing.catch(() => {});
  const out = new Uint8Array(limit);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > limit) throw new Error('PNG image data inflates past the size its header declares.');
      out.set(value, length);
      length += value.length;
    }
    await writing;
  } catch (error) {
    failed = true;
    try { await reader.cancel(); } catch { /* already closed */ }
    try { await writer.abort(); } catch { /* already closed */ }
    if (/inflates past/.test(error?.message)) throw error;
    throw new Error(`PNG image data could not be inflated (${error?.message || 'invalid zlib stream'}).`);
  }
  return out.subarray(0, length);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Reverses the per-scanline filters into a fresh buffer. Exported for tests.
export function unfilterScanlines(raw, width, height, bpp) {
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) throw new Error('PNG image data is truncated.');
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[row + i - bpp] : 0;
      const b = y > 0 ? out[prev + i] : 0;
      const c = y > 0 && i >= bpp ? out[prev + i - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`PNG filter type ${filter} is not supported.`);
      }
      out[row + i] = v & 0xff;
    }
  }
  return out;
}

// input: Uint8Array or ArrayBuffer of a PNG file.
// opts: { width, height } the caller expects (the file is refused otherwise), maxInputBytes.
// Resolves { width, height, channels (3|4), pixels: Uint8Array, row-major, `channels` bytes per pixel }.
export async function decodePng(input, { width: expectedWidth, height: expectedHeight, maxInputBytes = MAX_PNG_INPUT_BYTES } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > maxInputBytes) throw new Error(`PNG file is larger than ${maxInputBytes} bytes.`);
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) throw new Error('Not a PNG file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let header = null;
  const idat = [];
  let idatLength = 0;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const start = offset + 8;
    if (start + length + 4 > bytes.length) throw new Error('PNG chunk is truncated.');
    if (type === 'IHDR' || type === 'IDAT') {
      if (crc32(bytes.subarray(offset + 4, start + length)) !== view.getUint32(start + length)) throw new Error(`PNG ${type} chunk has a bad CRC.`);
    }
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('PNG IHDR chunk has the wrong length.');
      header = {
        width: view.getUint32(start),
        height: view.getUint32(start + 4),
        bitDepth: bytes[start + 8],
        colorType: bytes[start + 9],
        interlace: bytes[start + 12]
      };
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(start, start + length));
      idatLength += length;
    } else if (type === 'IEND') {
      break;
    }
    offset = start + length + 4;
  }
  if (!header) throw new Error('PNG has no IHDR chunk.');
  const channels = CHANNELS[header.colorType];
  if (header.bitDepth !== 8 || !channels) throw new Error(`PNG colour type ${header.colorType} / bit depth ${header.bitDepth} is not supported.`);
  if (header.interlace !== 0) throw new Error('Interlaced PNG is not supported.');
  if ((expectedWidth !== undefined && header.width !== expectedWidth) || (expectedHeight !== undefined && header.height !== expectedHeight)) {
    throw new Error(`PNG is ${header.width} x ${header.height}, expected ${expectedWidth ?? 'any'} x ${expectedHeight ?? 'any'}.`);
  }
  if (!header.width || !header.height || header.width > MAX_PNG_DIMENSION || header.height > MAX_PNG_DIMENSION) {
    throw new Error(`PNG size ${header.width} x ${header.height} is outside the supported limit.`);
  }
  const rawLength = header.height * (header.width * channels + 1);
  if (rawLength > MAX_PNG_OUTPUT_BYTES) throw new Error('PNG image data is too large.');
  if (!idat.length) throw new Error('PNG has no image data.');
  const joined = new Uint8Array(idatLength);
  let at = 0;
  for (const part of idat) { joined.set(part, at); at += part.length; }
  const raw = await inflateLimited(joined, rawLength);
  const pixels = unfilterScanlines(raw, header.width, header.height, channels);
  return { width: header.width, height: header.height, channels, pixels };
}
