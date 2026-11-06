/**
 * Estimates how the camera moved between two consecutive frames: a similarity
 * transform (shift, rotation, zoom) fitted to local block-matching vectors, so
 * a minority of independently moving things (players, a ball) don't drag the
 * estimate along with them.
 */

/** A grayscale frame normalised to zero mean and unit variance, so exposure changes don't read as motion. */
export interface GrayFrame {
  data: Float32Array;
  width: number;
  height: number;
}

/** Full resolution first, then successive halvings. */
export type Pyramid = GrayFrame[];

export interface FrameMotion {
  /** Shift of the frame centre, as a fraction of the frame width (both axes, so it's isotropic). */
  dx: number;
  dy: number;
  /** Rotation in radians. */
  da: number;
  /** Natural log of the zoom factor. */
  ds: number;
}

export const NO_MOTION: FrameMotion = { dx: 0, dy: 0, da: 0, ds: 0 };

const PYRAMID_LEVELS = 3;
const COARSE_RADIUS = 8;
const REFINE_RADIUS = 2;
const BLOCK_SIZE = 16;
const BLOCK_RADIUS = 4;
const BLOCK_SPACING = 32;
/** Blocks flatter than this (in units of the frame's own contrast) can't be matched reliably. */
const MIN_BLOCK_STD = 0.12;
const MIN_INLIERS = 6;
const ROBUST_ITERATIONS = 4;
/** Larger per-frame rotation or zoom than this is a bad fit, not real camera motion. */
const MAX_FRAME_ROTATION = 0.08;
const MAX_FRAME_LOG_SCALE = 0.08;

export function grayFromRgba(rgba: Uint8ClampedArray, width: number, height: number): GrayFrame {
  const n = width * height;
  const data = new Float32Array(n);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    data[i] = v;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  // Floor the spread so a near-black frame doesn't amplify sensor noise into "texture".
  const std = Math.max(Math.sqrt(Math.max(sumSq / n - mean * mean, 0)), 4);
  for (let i = 0; i < n; i++) data[i] = (data[i] - mean) / std;
  return { data, width, height };
}

function halve(frame: GrayFrame): GrayFrame {
  const width = Math.floor(frame.width / 2);
  const height = Math.floor(frame.height / 2);
  const data = new Float32Array(width * height);
  const src = frame.data;
  const w = frame.width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 2 * y * w + 2 * x;
      data[y * width + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) / 4;
    }
  }
  return { data, width, height };
}

export function buildPyramid(frame: GrayFrame): Pyramid {
  const levels = [frame];
  for (let i = 1; i < PYRAMID_LEVELS; i++) levels.push(halve(levels[i - 1]));
  return levels;
}

function sad(prev: GrayFrame, cur: GrayFrame, x0: number, y0: number, bw: number, bh: number, sx: number, sy: number): number {
  const w = prev.width;
  const p = prev.data;
  const c = cur.data;
  let total = 0;
  for (let y = 0; y < bh; y++) {
    const rowP = (y0 + y) * w + x0;
    const rowC = (y0 + y + sy) * w + x0 + sx;
    for (let x = 0; x < bw; x++) total += Math.abs(p[rowP + x] - c[rowC + x]);
  }
  return total;
}

/** Fits a parabola through three costs around a minimum; returns the sub-pixel offset in [-0.5, 0.5]. */
function parabolicOffset(left: number, mid: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
  const denom = left - 2 * mid + right;
  if (denom <= 0) return 0;
  return Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denom));
}

interface ShiftMatch {
  x: number;
  y: number;
  /** The best integer shift sat on the edge of the search window, so the true one may lie outside it. */
  atEdge: boolean;
}

/**
 * Finds where the `bw`×`bh` block of `prev` at (x0, y0) moved to in `cur`,
 * searching integer shifts within `radius` of (cx, cy).
 */
function searchShift(
  prev: GrayFrame,
  cur: GrayFrame,
  x0: number,
  y0: number,
  bw: number,
  bh: number,
  cx: number,
  cy: number,
  radius: number,
): ShiftMatch | null {
  const size = 2 * radius + 1;
  const costs = new Float64Array(size * size).fill(Infinity);
  let best = Infinity;
  let bestI = -1;
  for (let j = 0; j < size; j++) {
    const sy = cy - radius + j;
    if (y0 + sy < 0 || y0 + sy + bh > cur.height) continue;
    for (let i = 0; i < size; i++) {
      const sx = cx - radius + i;
      if (x0 + sx < 0 || x0 + sx + bw > cur.width) continue;
      const cost = sad(prev, cur, x0, y0, bw, bh, sx, sy);
      costs[j * size + i] = cost;
      if (cost < best) {
        best = cost;
        bestI = j * size + i;
      }
    }
  }
  if (bestI < 0) return null;
  const bi = bestI % size;
  const bj = Math.floor(bestI / size);
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= size || j >= size ? Infinity : costs[j * size + i]);
  return {
    x: cx - radius + bi + parabolicOffset(at(bi - 1, bj), best, at(bi + 1, bj)),
    y: cy - radius + bj + parabolicOffset(at(bi, bj - 1), best, at(bi, bj + 1)),
    atEdge: bi === 0 || bj === 0 || bi === size - 1 || bj === size - 1,
  };
}

/** Whole-frame shift at one pyramid level, searching around (cx, cy). */
function globalShift(prev: GrayFrame, cur: GrayFrame, cx: number, cy: number, radius: number): { x: number; y: number } | null {
  const mx = Math.abs(cx) + radius;
  const my = Math.abs(cy) + radius;
  const bw = prev.width - 2 * mx;
  const bh = prev.height - 2 * my;
  if (bw < 4 || bh < 4) return null;
  const match = searchShift(prev, cur, mx, my, bw, bh, cx, cy, radius);
  return match && { x: match.x, y: match.y };
}

function blockStd(frame: GrayFrame, x0: number, y0: number, size: number): number {
  let sum = 0;
  let sumSq = 0;
  for (let y = 0; y < size; y++) {
    const row = (y0 + y) * frame.width + x0;
    for (let x = 0; x < size; x++) {
      const v = frame.data[row + x];
      sum += v;
      sumSq += v * v;
    }
  }
  const n = size * size;
  const mean = sum / n;
  return Math.sqrt(Math.max(sumSq / n - mean * mean, 0));
}

/** A block centre (x, y) and where it was found in the next frame (u, v), relative to the frame centre. */
interface Correspondence {
  x: number;
  y: number;
  u: number;
  v: number;
}

interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/** Least-squares similarity transform u = a·x − b·y + tx, v = b·x + a·y + ty. */
function fitSimilarity(points: Correspondence[]): Similarity {
  const n = points.length;
  let mx = 0, my = 0, mu = 0, mv = 0;
  for (const p of points) {
    mx += p.x; my += p.y; mu += p.u; mv += p.v;
  }
  mx /= n; my /= n; mu /= n; mv /= n;
  let spread = 0, dot = 0, cross = 0;
  for (const p of points) {
    const x = p.x - mx, y = p.y - my, u = p.u - mu, v = p.v - mv;
    spread += x * x + y * y;
    dot += x * u + y * v;
    cross += x * v - y * u;
  }
  if (spread < 1e-6) return { a: 1, b: 0, tx: mu - mx, ty: mv - my };
  const a = dot / spread;
  const b = cross / spread;
  return { a, b, tx: mu - (a * mx - b * my), ty: mv - (b * mx + a * my) };
}

function residual(p: Correspondence, s: Similarity): number {
  return Math.hypot(p.u - (s.a * p.x - s.b * p.y + s.tx), p.v - (s.b * p.x + s.a * p.y + s.ty));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Fits a similarity to the block vectors while discarding outliers. Starts from
 * the median shift rather than a plain least-squares fit, because a large
 * moving subject can outweigh the background in an unweighted first fit.
 */
function robustSimilarity(points: Correspondence[]): Similarity | null {
  const start: Similarity = {
    a: 1,
    b: 0,
    tx: median(points.map((p) => p.u - p.x)),
    ty: median(points.map((p) => p.v - p.y)),
  };
  let model = start;
  let inliers = points;
  for (let i = 0; i < ROBUST_ITERATIONS; i++) {
    const residuals = points.map((p) => residual(p, model));
    const threshold = Math.max(0.5, 2.5 * median(inliers.map((p) => residual(p, model))));
    const next = points.filter((_, k) => residuals[k] < threshold);
    if (next.length < MIN_INLIERS) break;
    inliers = next;
    model = fitSimilarity(inliers);
  }
  return inliers.length >= MIN_INLIERS ? model : null;
}

export function estimateMotion(prev: Pyramid, cur: Pyramid): FrameMotion {
  const levels = prev.length;
  const full = prev[0];

  let shift = globalShift(prev[levels - 1], cur[levels - 1], 0, 0, COARSE_RADIUS) ?? { x: 0, y: 0 };
  for (let level = levels - 2; level >= 0; level--) {
    const refined = globalShift(prev[level], cur[level], Math.round(shift.x * 2), Math.round(shift.y * 2), REFINE_RADIUS);
    shift = refined ?? { x: shift.x * 2, y: shift.y * 2 };
  }

  const cx = Math.round(shift.x);
  const cy = Math.round(shift.y);
  const halfW = full.width / 2;
  const halfH = full.height / 2;
  const points: Correspondence[] = [];
  const pad = BLOCK_RADIUS + 1;
  for (let y0 = pad; y0 + BLOCK_SIZE + pad <= full.height; y0 += BLOCK_SPACING) {
    for (let x0 = pad; x0 + BLOCK_SIZE + pad <= full.width; x0 += BLOCK_SPACING) {
      if (blockStd(full, x0, y0, BLOCK_SIZE) < MIN_BLOCK_STD) continue;
      const match = searchShift(full, cur[0], x0, y0, BLOCK_SIZE, BLOCK_SIZE, cx, cy, BLOCK_RADIUS);
      if (!match || match.atEdge) continue;
      const x = x0 + BLOCK_SIZE / 2 - halfW;
      const y = y0 + BLOCK_SIZE / 2 - halfH;
      points.push({ x, y, u: x + match.x, v: y + match.y });
    }
  }

  const model = points.length >= MIN_INLIERS ? robustSimilarity(points) : null;
  if (model) {
    const da = Math.atan2(model.b, model.a);
    const ds = Math.log(Math.hypot(model.a, model.b));
    if (Math.abs(da) <= MAX_FRAME_ROTATION && Math.abs(ds) <= MAX_FRAME_LOG_SCALE) {
      return { dx: model.tx / full.width, dy: model.ty / full.width, da, ds };
    }
  }
  return { dx: shift.x / full.width, dy: shift.y / full.width, da: 0, ds: 0 };
}
