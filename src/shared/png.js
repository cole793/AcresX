// Minimal PNG decoder for the Worker (no dependency): 8-bit, non-interlaced, colour type 2 (RGB)
// or 6 (RGBA). Enough for terrain tiles (src/services/terrain-tiles.js); anything else throws.
//
// PNG spec (https://www.w3.org/TR/png-3/): an 8-byte signature, then chunks of
// [length u32 BE][type 4 bytes][data][crc u32]. IHDR holds width, height, bit depth, colour type,
// compression, filter and interlace methods. The image data is the concatenation of every IDAT
// chunk, a zlib stream ("deflate" in DecompressionStream terms). Each decompressed scanline
// starts with a filter-type byte (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth) applied per byte, with
// bpp = bytes per pixel as the left-neighbour distance. CRCs are not checked: the tiles come over
// TLS and a corrupt stream fails in inflate or in the length checks below.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 2: 3, 6: 4 };

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Reverses the per-scanline filters in place of a fresh buffer. Exported for tests.
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

// bytes: Uint8Array or ArrayBuffer of a PNG file.
// Resolves { width, height, channels (3|4), pixels: Uint8Array, row-major, `channels` bytes per pixel }.
export async function decodePng(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
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
    if (type === 'IHDR') {
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
  if (!idat.length) throw new Error('PNG has no image data.');
  const joined = new Uint8Array(idatLength);
  let at = 0;
  for (const part of idat) { joined.set(part, at); at += part.length; }
  const raw = await inflate(joined);
  const pixels = unfilterScanlines(raw, header.width, header.height, channels);
  return { width: header.width, height: header.height, channels, pixels };
}
