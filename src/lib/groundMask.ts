export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where to read the ground from, for a halo drawn in some canvas's coordinates. */
export interface GroundSource {
  video: HTMLVideoElement;
  /** Video pixels per unit of the canvas's drawing coordinates. */
  scale: number;
  colors: string[];
  /** How far (in YCbCr units, 0-255) a pixel's colour can be from a ground colour and still count. */
  tolerance: number;
}

export const DEFAULT_GROUND_TOLERANCE = 40;

/**
 * The mask is worked out on a coarse grid (this many cells along its longer side)
 * and scaled up smoothly, which softens its edges and evens out pixel noise.
 */
const MASK_RESOLUTION = 96;
/** Brightness counts for less than hue, so shading and floodlight falloff on the ground still match. */
const LUMA_WEIGHT = 0.4;
/** Below this fraction of the tolerance a pixel is fully ground; it fades out from there to the tolerance. */
const SOFT_START = 0.6;

type Ycc = [number, number, number];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toYcc(r: number, g: number, b: number): Ycc {
  return [0.299 * r + 0.587 * g + 0.114 * b, -0.1687 * r - 0.3313 * g + 0.5 * b, 0.5 * r - 0.4187 * g - 0.0813 * b];
}

function fromYcc([y, cb, cr]: Ycc): string {
  const rgb = [y + 1.402 * cr, y - 0.344136 * cb - 0.714136 * cr, y + 1.772 * cb];
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** How much a pixel looks like ground: 1 close to any ground colour, fading to 0 at the tolerance. */
export function groundAlpha(r: number, g: number, b: number, ground: Ycc[], tolerance: number): number {
  const [y, cb, cr] = toYcc(r, g, b);
  let nearest = Infinity;
  for (const [gy, gcb, gcr] of ground) {
    const d = Math.hypot((y - gy) * LUMA_WEIGHT, cb - gcb, cr - gcr);
    if (d < nearest) nearest = d;
  }
  const start = tolerance * SOFT_START;
  if (nearest <= start) return 1;
  if (nearest >= tolerance) return 0;
  const x = (nearest - start) / (tolerance - start);
  return 1 - x * x * (3 - 2 * x);
}

export function groundKeys(colors: string[]): Ycc[] {
  return colors.map((c) => toYcc(...hexToRgb(c)));
}

const scratch = new Map<string, [HTMLCanvasElement, CanvasRenderingContext2D]>();

function scratchCanvas(name: string, w: number, h: number): CanvasRenderingContext2D | null {
  let entry = scratch.get(name);
  if (!entry) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    entry = [canvas, ctx];
    scratch.set(name, entry);
  }
  const [canvas, ctx] = entry;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/**
 * The video under `rect` (in drawing coordinates), shrunk to the mask grid.
 * Parts of `rect` outside the video are left transparent.
 */
function readVideo(video: HTMLVideoElement, scale: number, rect: Rect, name: string): CanvasRenderingContext2D | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || rect.w <= 0 || rect.h <= 0) return null;
  const k = Math.min(1, MASK_RESOLUTION / (Math.max(rect.w, rect.h) * scale));
  const mw = Math.max(1, Math.ceil(rect.w * scale * k));
  const mh = Math.max(1, Math.ceil(rect.h * scale * k));
  const ctx = scratchCanvas(name, mw, mh);
  if (!ctx) return null;

  const sx = rect.x * scale;
  const sy = rect.y * scale;
  const sw = rect.w * scale;
  const sh = rect.h * scale;
  // Crop to the video first: browsers disagree on drawImage source rectangles
  // that extend past the image.
  const x0 = Math.max(0, sx);
  const y0 = Math.max(0, sy);
  const x1 = Math.min(vw, sx + sw);
  const y1 = Math.min(vh, sy + sh);
  if (x1 > x0 && y1 > y0) {
    ctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, ((x0 - sx) / sw) * mw, ((y0 - sy) / sh) * mh, ((x1 - x0) / sw) * mw, ((y1 - y0) / sh) * mh);
  }
  return ctx;
}

/** A mask covering `rect` (in drawing coordinates): opaque where the video shows ground. */
export function groundMask(source: GroundSource, rect: Rect): HTMLCanvasElement | null {
  const ctx = readVideo(source.video, source.scale, rect, "ground-mask");
  if (!ctx) return null;
  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  const keys = groundKeys(source.colors);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] === 0 ? 0 : groundAlpha(px[i], px[i + 1], px[i + 2], keys, source.tolerance);
    px[i] = 0;
    px[i + 1] = 0;
    px[i + 2] = 0;
    px[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(image, 0, 0);
  return ctx.canvas;
}

/**
 * A starting guess at the ground colour: the median colour of a band around
 * the ring (an ellipse centred at `cx`,`cy` in drawing coordinates), leaving out
 * its middle, where the player's feet are.
 */
export function suggestGroundColor(video: HTMLVideoElement, scale: number, cx: number, cy: number, rx: number, ry: number): string | null {
  const rect = { x: cx - rx * 1.3, y: cy - ry * 1.3, w: rx * 2.6, h: ry * 2.6 };
  const ctx = readVideo(video, scale, rect, "ground-suggest");
  if (!ctx) return null;
  const { width, height } = ctx.canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
  const samples: Ycc[] = [];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const dx = ((i + 0.5) / width - 0.5) * 2.6;
      const dy = ((j + 0.5) / height - 0.5) * 2.6;
      const r = Math.hypot(dx, dy);
      const o = (j * width + i) * 4;
      if (r >= 0.75 && r <= 1.3 && px[o + 3] > 0) samples.push(toYcc(px[o], px[o + 1], px[o + 2]));
    }
  }
  if (samples.length === 0) return null;
  const median = (k: number) => {
    const values = samples.map((s) => s[k]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  return fromYcc([median(0), median(1), median(2)]);
}
