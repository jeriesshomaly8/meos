/**
 * Generates the PWA icon set into `public/`.
 *
 * Hand-rolled PNG encoder rather than a dependency: we need four flat-colour
 * images with a wordmark drawn from line segments, which is a few dozen lines
 * of zlib and CRC — not worth adding sharp/canvas and a native build step to
 * the install for. Re-run with `npx tsx scripts/generate-icons.mts` after
 * changing the brand colours in `src/app/globals.css`.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Matches --primary / --background in globals.css, converted to sRGB. */
const TERRACOTTA: RGB = [0xc0, 0x5f, 0x3c];
const CREAM: RGB = [0xfa, 0xf7, 0xf2];

type RGB = [number, number, number];

interface Canvas {
  size: number;
  px: Uint8Array; // RGBA
}

function createCanvas(size: number): Canvas {
  return { size, px: new Uint8Array(size * size * 4) };
}

function setPixel(c: Canvas, x: number, y: number, [r, g, b]: RGB, alpha = 1): void {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  const existing = c.px[i + 3]! / 255;
  const out = alpha + existing * (1 - alpha);
  // Straight-alpha "over" composite; enough for two opaque colours.
  c.px[i] = Math.round((r * alpha + c.px[i]! * existing * (1 - alpha)) / (out || 1));
  c.px[i + 1] = Math.round((g * alpha + c.px[i + 1]! * existing * (1 - alpha)) / (out || 1));
  c.px[i + 2] = Math.round((b * alpha + c.px[i + 2]! * existing * (1 - alpha)) / (out || 1));
  c.px[i + 3] = Math.round(out * 255);
}

/** Rounded rectangle, anti-aliased on the corner arcs. */
function fillRoundedRect(c: Canvas, inset: number, radius: number, colour: RGB): void {
  const min = inset;
  const max = c.size - inset;
  for (let y = 0; y < c.size; y++) {
    for (let x = 0; x < c.size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (px < min || px > max || py < min || py > max) continue;
      // Distance into the nearest corner's arc, if any.
      const cx = px < min + radius ? min + radius : px > max - radius ? max - radius : px;
      const cy = py < min + radius ? min + radius : py > max - radius ? max - radius : py;
      const d = Math.hypot(px - cx, py - cy);
      const coverage = d <= radius - 0.5 ? 1 : d >= radius + 0.5 ? 0 : radius + 0.5 - d;
      if (coverage > 0) setPixel(c, x, y, colour, coverage);
    }
  }
}

/** Anti-aliased thick line segment. */
function strokeSegment(
  c: Canvas,
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
  width: number,
  colour: RGB,
): void {
  const half = width / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  const minX = Math.floor(Math.min(x0, x1) - half - 1);
  const maxX = Math.ceil(Math.max(x0, x1) + half + 1);
  const minY = Math.floor(Math.min(y0, y1) - half - 1);
  const maxY = Math.ceil(Math.max(y0, y1) + half + 1);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
      const d = Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
      const coverage = d <= half - 0.5 ? 1 : d >= half + 0.5 ? 0 : half + 0.5 - d;
      if (coverage > 0) setPixel(c, x, y, colour, coverage);
    }
  }
}

/**
 * The MeOS "M" — two uprights and a shallow V, drawn at a fixed proportion of
 * the glyph box so it scales identically at every icon size.
 */
function drawWordmark(c: Canvas, boxInset: number, colour: RGB): void {
  const s = c.size;
  const box = s - boxInset * 2;
  const stroke = box * 0.14;
  const top = boxInset + box * 0.28;
  const bottom = boxInset + box * 0.72;
  const left = boxInset + box * 0.2;
  const right = boxInset + box * 0.8;
  const mid = (left + right) / 2;
  const valley = top + (bottom - top) * 0.55;

  strokeSegment(c, [left, bottom], [left, top], stroke, colour);
  strokeSegment(c, [left, top], [mid, valley], stroke, colour);
  strokeSegment(c, [mid, valley], [right, top], stroke, colour);
  strokeSegment(c, [right, top], [right, bottom], stroke, colour);
}

/* ------------------------------- PNG encoder ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(c: Canvas): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.size, 0);
  ihdr.writeUInt32BE(c.size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10–12: compression, filter, interlace — all 0.

  // Filter type 0 (None) per scanline.
  const stride = c.size * 4;
  const raw = Buffer.alloc((stride + 1) * c.size);
  for (let y = 0; y < c.size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(c.px.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------------- output --------------------------------- */

interface IconSpec {
  file: string;
  size: number;
  /** Maskable icons must keep art inside the inner 80% safe zone. */
  maskable: boolean;
  /** iOS home-screen icons are masked by the OS, so no self-rounding. */
  square: boolean;
}

const ICONS: IconSpec[] = [
  { file: "icon-192.png", size: 192, maskable: false, square: false },
  { file: "icon-512.png", size: 512, maskable: false, square: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true, square: true },
  { file: "apple-icon.png", size: 180, maskable: false, square: true },
];

const outDir = join(process.cwd(), "public");
mkdirSync(outDir, { recursive: true });

for (const spec of ICONS) {
  const c = createCanvas(spec.size);
  if (spec.square) {
    fillRoundedRect(c, 0, 0, TERRACOTTA);
  } else {
    fillRoundedRect(c, spec.size * 0.06, spec.size * 0.22, TERRACOTTA);
  }
  drawWordmark(c, spec.maskable ? spec.size * 0.2 : spec.size * 0.06, CREAM);
  writeFileSync(join(outDir, spec.file), encodePng(c));
  console.log(`wrote public/${spec.file} (${spec.size}×${spec.size})`);
}
