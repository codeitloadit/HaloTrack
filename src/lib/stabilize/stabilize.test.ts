import { describe, expect, it } from "vitest";
import { buildPyramid, estimateMotion, grayFromRgba, NO_MOTION, type Pyramid } from "./motion";
import { correctionAt, planStabilization, requiredScale, smoothSeries, type MotionSample } from "./trajectory";

const W = 320;
const H = 180;

// A deterministic, non-periodic texture: a sum of sinusoids at assorted angles
// and wavelengths, standing in for turf, crowd and court markings.
function makeScene(seed: number): (x: number, y: number) => number {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const waves = Array.from({ length: 24 }, () => {
    const angle = rand() * Math.PI;
    const k = (2 * Math.PI) / (6 + rand() * 40);
    return { kx: Math.cos(angle) * k, ky: Math.sin(angle) * k, phase: rand() * 2 * Math.PI, amp: 0.5 + rand() };
  });
  return (x, y) => waves.reduce((sum, w) => sum + w.amp * Math.sin(w.kx * x + w.ky * y + w.phase), 0);
}

interface Transform {
  tx?: number;
  ty?: number;
  angle?: number;
  scale?: number;
}

/**
 * Renders the scene as seen after the camera moved by `t`: a scene point p (relative
 * to the frame centre) appears at scale·R(angle)·p + (tx, ty) in the new frame.
 * `overlay` lets a test paint an independently moving object on top.
 */
function render(scene: (x: number, y: number) => number, t: Transform = {}, overlay?: (x: number, y: number) => number | null): Pyramid {
  const { tx = 0, ty = 0, angle = 0, scale = 1 } = t;
  const cos = Math.cos(-angle) / scale;
  const sin = Math.sin(-angle) / scale;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const qx = x - W / 2 - tx;
      const qy = y - H / 2 - ty;
      const px = cos * qx - sin * qy;
      const py = sin * qx + cos * qy;
      const value = overlay?.(x, y) ?? scene(px, py);
      const v = 128 + value * 18;
      const i = (y * W + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return buildPyramid(grayFromRgba(rgba, W, H));
}

describe("estimateMotion", () => {
  const scene = makeScene(7);
  const still = render(scene);

  it("measures a sub-pixel shift", () => {
    const m = estimateMotion(still, render(scene, { tx: 3.3, ty: -2.7 }));
    expect(m.dx * W).toBeCloseTo(3.3, 0);
    expect(Math.abs(m.dx * W - 3.3)).toBeLessThan(0.2);
    expect(Math.abs(m.dy * W + 2.7)).toBeLessThan(0.2);
    expect(Math.abs(m.da)).toBeLessThan(0.002);
  });

  it("follows a fast pan that a single search window couldn't reach", () => {
    const m = estimateMotion(still, render(scene, { tx: -22, ty: 9 }));
    expect(Math.abs(m.dx * W + 22)).toBeLessThan(0.3);
    expect(Math.abs(m.dy * W - 9)).toBeLessThan(0.3);
  });

  it("measures rotation and zoom", () => {
    const angle = (0.6 * Math.PI) / 180;
    const m = estimateMotion(still, render(scene, { angle, scale: 1.012, tx: 1.5 }));
    expect(Math.abs(m.da - angle)).toBeLessThan(0.0015);
    expect(Math.abs(m.ds - Math.log(1.012))).toBeLessThan(0.002);
    expect(Math.abs(m.dx * W - 1.5)).toBeLessThan(0.3);
  });

  it("ignores a player moving independently of the camera", () => {
    const player = makeScene(99);
    const box = (ox: number) => (x: number, y: number) =>
      x >= 100 + ox && x < 170 + ox && y >= 40 && y < 150 ? player(x - ox, y) * 1.5 : null;
    const before = render(scene, {}, box(0));
    const after = render(scene, { tx: 2, ty: 1 }, box(12));
    const m = estimateMotion(before, after);
    expect(Math.abs(m.dx * W - 2)).toBeLessThan(0.3);
    expect(Math.abs(m.dy * W - 1)).toBeLessThan(0.3);
  });

  it("reports no motion between identical frames, even featureless ones", () => {
    expect(estimateMotion(still, still).dx).toBeCloseTo(0, 4);
    const flat = render(() => 0);
    const m = estimateMotion(flat, flat);
    expect(Number.isFinite(m.dx) && Number.isFinite(m.dy)).toBe(true);
  });
});

describe("smoothSeries", () => {
  it("leaves a straight line straight, including at the ends", () => {
    const times = Array.from({ length: 60 }, (_, i) => i / 30);
    const values = times.map((t) => 0.3 * t + 0.1);
    smoothSeries(times, values, 0.5).forEach((v, i) => expect(v).toBeCloseTo(values[i], 6));
  });
});

describe("requiredScale", () => {
  it("needs no zoom for no correction", () => {
    expect(requiredScale({ x: 0, y: 0, a: 0 }, 16 / 9)).toBeCloseTo(1, 9);
  });

  it("needs enough zoom to hide a shifted edge", () => {
    expect(requiredScale({ x: 0.05, y: 0, a: 0 }, 16 / 9)).toBeCloseTo(0.5 / 0.45, 6);
  });

  it("needs more zoom to hide rotated corners", () => {
    expect(requiredScale({ x: 0, y: 0, a: 0.02 }, 16 / 9)).toBeGreaterThan(1.02);
  });
});

function samplesFrom(motions: Array<Partial<typeof NO_MOTION>>, fps = 30): MotionSample[] {
  return motions.map((m, i) => ({ t: i / fps, motion: { ...NO_MOTION, ...m } }));
}

describe("planStabilization", () => {
  it("leaves a steady pan alone", () => {
    const plan = planStabilization(samplesFrom(Array.from({ length: 90 }, () => ({ dx: 0.004 }))), 16 / 9);
    expect(plan.zoom).toBeLessThan(1.01);
    for (const c of plan.corrections) expect(Math.abs(c.x)).toBeLessThan(1e-5);
  });

  it("cancels handheld jitter", () => {
    let seed = 3;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
    const motions = Array.from({ length: 150 }, () => ({ dx: rand() * 0.01, dy: rand() * 0.01, da: rand() * 0.004 }));
    const samples = samplesFrom(motions);
    const plan = planStabilization(samples, 16 / 9);

    // Frame-to-frame motion of the corrected path vs the original.
    let path = 0;
    let before = 0;
    let after = 0;
    let previous = 0;
    samples.forEach((s, i) => {
      path += s.motion.dx;
      const corrected = path + plan.corrections[i].x;
      before += s.motion.dx ** 2;
      if (i > 0) after += (corrected - previous) ** 2;
      previous = corrected;
    });
    expect(after).toBeLessThan(before * 0.1);
  });

  it("never needs more zoom than it allows", () => {
    const motions = Array.from({ length: 120 }, (_, i) => ({ dx: i === 60 ? 0.2 : 0 }));
    const plan = planStabilization(samplesFrom(motions), 16 / 9);
    expect(plan.zoom).toBeLessThanOrEqual(1.2);
    for (const c of plan.corrections) {
      expect(requiredScale(c, 16 / 9) / Math.exp(c.s)).toBeLessThanOrEqual(plan.zoom + 1e-6);
    }
  });
});

describe("correctionAt", () => {
  it("interpolates between samples and holds at the ends", () => {
    const plan = {
      zoom: 1,
      corrections: [
        { t: 0, x: 0, y: 0, a: 0, s: 0 },
        { t: 1, x: 1, y: 2, a: 0, s: 0 },
      ],
    };
    expect(correctionAt(plan, 0.25).x).toBeCloseTo(0.25);
    expect(correctionAt(plan, 0.25).y).toBeCloseTo(0.5);
    expect(correctionAt(plan, -1).x).toBe(0);
    expect(correctionAt(plan, 5).x).toBe(1);
  });
});
