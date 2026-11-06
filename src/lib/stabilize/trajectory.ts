import type { FrameMotion } from "./motion";

/** The camera motion from the previous sample's frame to the frame at media time `t`. */
export interface MotionSample {
  t: number;
  motion: FrameMotion;
}

/**
 * What to apply to the frame at time `t`: shift by (x, y) (fractions of frame
 * width), then rotate by `a` radians and scale by e^`s` about the centre.
 */
export interface Correction {
  t: number;
  x: number;
  y: number;
  a: number;
  s: number;
}

export interface StabilizationPlan {
  /** Fixed zoom applied to every frame so corrections never reveal the frame edge. */
  zoom: number;
  corrections: Correction[];
}

export interface PlanOptions {
  /** Gaussian sigma of the smoothed camera path; larger is steadier but crops more during pans. */
  smoothingSec: number;
  maxZoom: number;
  /** Fraction of frames whose full correction must fit without being scaled back. */
  coverage: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = { smoothingSec: 0.5, maxZoom: 1.2, coverage: 0.95 };

type Component = "x" | "y" | "a" | "s";
const COMPONENTS: Component[] = ["x", "y", "a", "s"];

/**
 * Gaussian smoothing over irregularly spaced samples. Ends are padded by point
 * reflection (mirrored in time and value), which keeps a steady pan steady at
 * the ends instead of bending the path towards the interior average.
 */
export function smoothSeries(times: number[], values: number[], sigma: number): number[] {
  const n = times.length;
  if (n === 0 || sigma <= 0) return [...values];
  const t0 = times[0], v0 = values[0];
  const tn = times[n - 1], vn = values[n - 1];
  const span = tn - t0;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const ti = times[i];
    // Keep the window symmetric even in a clip shorter than it, so linear motion
    // passes through exactly; the tolerance absorbs float error in the times.
    const reach = Math.min(3 * sigma, ti - t0 + span, tn - ti + span) + 1e-9;
    let sumW = 0;
    let sumV = 0;
    const add = (t: number, v: number) => {
      const d = ti - t;
      if (Math.abs(d) > reach) return;
      const w = Math.exp(-(d * d) / (2 * sigma * sigma));
      sumW += w;
      sumV += w * v;
    };
    for (let j = 0; j < n; j++) {
      add(times[j], values[j]);
      if (j > 0) add(2 * t0 - times[j], 2 * v0 - values[j]);
      if (j < n - 1) add(2 * tn - times[j], 2 * vn - values[j]);
    }
    out[i] = sumV / sumW;
  }
  return out;
}

/**
 * The scale a correction needs so the transformed frame still covers the whole
 * output: each output corner, mapped back into the source, must land inside it.
 * Works in width units, so the frame is 1 × 1/aspect.
 */
export function requiredScale(c: Pick<Correction, "x" | "y" | "a">, aspect: number): number {
  const halfW = 0.5;
  const halfH = 0.5 / aspect;
  const cos = Math.cos(c.a);
  const sin = Math.sin(c.a);
  let needed = 1;
  for (const [qx, qy] of [[halfW, halfH], [halfW, -halfH], [-halfW, halfH], [-halfW, -halfH]]) {
    // Corner rotated back by -a; then source point = r / k - t must stay within ±half.
    const rx = cos * qx + sin * qy;
    const ry = -sin * qx + cos * qy;
    const limitX = rx > 0 ? halfW + c.x : halfW - c.x;
    const limitY = ry > 0 ? halfH + c.y : halfH - c.y;
    if (limitX <= 0 || limitY <= 0) return Infinity;
    needed = Math.max(needed, Math.abs(rx) / limitX, Math.abs(ry) / limitY);
  }
  return needed;
}

function zoomNeeded(c: Omit<Correction, "t">, aspect: number): number {
  return requiredScale(c, aspect) / Math.exp(c.s);
}

function scaled(c: Correction, f: number): Correction {
  return { t: c.t, x: c.x * f, y: c.y * f, a: c.a * f, s: c.s * f };
}

/** The largest f in [0, 1] whose scaled-back correction fits within `zoom`. */
function fitFactor(c: Correction, zoom: number, aspect: number): number {
  if (zoomNeeded(c, aspect) <= zoom) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (zoomNeeded(scaled(c, mid), aspect) <= zoom) lo = mid;
    else hi = mid;
  }
  return lo;
}

function movingMin(times: number[], values: number[], reach: number): number[] {
  return values.map((_, i) => {
    let m = values[i];
    for (let j = i - 1; j >= 0 && times[i] - times[j] <= reach; j--) m = Math.min(m, values[j]);
    for (let j = i + 1; j < values.length && times[j] - times[i] <= reach; j++) m = Math.min(m, values[j]);
    return m;
  });
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export function planStabilization(samples: MotionSample[], aspect: number, options: PlanOptions = DEFAULT_PLAN_OPTIONS): StabilizationPlan {
  if (samples.length === 0) return { zoom: 1, corrections: [] };
  const times = samples.map((s) => s.t);

  const path: Record<Component, number[]> = { x: [], y: [], a: [], s: [] };
  let x = 0, y = 0, a = 0, s = 0;
  for (const { motion } of samples) {
    x += motion.dx; y += motion.dy; a += motion.da; s += motion.ds;
    path.x.push(x); path.y.push(y); path.a.push(a); path.s.push(s);
  }

  const smooth = Object.fromEntries(
    COMPONENTS.map((k) => [k, smoothSeries(times, path[k], options.smoothingSec)]),
  ) as Record<Component, number[]>;

  const raw: Correction[] = times.map((t, i) => ({
    t,
    x: smooth.x[i] - path.x[i],
    y: smooth.y[i] - path.y[i],
    a: smooth.a[i] - path.a[i],
    s: smooth.s[i] - path.s[i],
  }));

  const needs = raw.map((c) => zoomNeeded(c, aspect));
  const zoom = Math.min(options.maxZoom, Math.max(1, quantile(needs, options.coverage)));

  // Frames that would need more zoom than allowed get their correction scaled
  // back; the factor is smoothed (after a min-filter, so it eases in before the
  // tight spot rather than after) to avoid a visible jerk where it kicks in.
  const factors = raw.map((c) => fitFactor(c, zoom, aspect));
  const eased = smoothSeries(times, movingMin(times, factors, options.smoothingSec), options.smoothingSec / 2);
  const corrections = raw.map((c, i) => scaled(c, Math.min(factors[i], eased[i])));

  return { zoom, corrections };
}

/** The correction at time `t`, linearly interpolated between samples and held at the ends. */
export function correctionAt(plan: StabilizationPlan, t: number): Correction {
  const cs = plan.corrections;
  if (cs.length === 0) return { t, x: 0, y: 0, a: 0, s: 0 };
  if (t <= cs[0].t) return cs[0];
  if (t >= cs[cs.length - 1].t) return cs[cs.length - 1];
  let lo = 0;
  let hi = cs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cs[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const c0 = cs[lo];
  const c1 = cs[hi];
  const f = (t - c0.t) / (c1.t - c0.t);
  return {
    t,
    x: c0.x + (c1.x - c0.x) * f,
    y: c0.y + (c1.y - c0.y) * f,
    a: c0.a + (c1.a - c0.a) * f,
    s: c0.s + (c1.s - c0.s) * f,
  };
}
