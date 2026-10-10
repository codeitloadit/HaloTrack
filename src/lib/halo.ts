import { bracket, interpolateIndicator } from "./keyframes";
import type { HaloConfig, TrackKeyframe } from "../state/types";

export interface HaloDrawParams {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  color: string;
  opacity: number;
}

const RING_SEGMENTS = 64;
const TOP_ANGLE = -Math.PI / 2;
// How wide (in radians) the transparent gap at the top-middle is, and how softly
// it fades back to full opacity — a player's legs usually pass through this part
// of the ring, so keeping it fully opaque looks wrong draped over them.
const TOP_GAP_SIGMA = 0.55;

function angularDistance(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

export function drawHalo(ctx: CanvasRenderingContext2D, p: HaloDrawParams): void {
  if (p.opacity <= 0.001 || p.radiusX <= 0 || p.radiusY <= 0) return;
  const baseWidth = Math.max(4, p.radiusY * 0.35);
  const topWidth = baseWidth * 0.7;
  const bottomWidth = baseWidth * 0.8;

  ctx.save();
  ctx.filter = "blur(2px)";
  ctx.strokeStyle = p.color;
  ctx.shadowColor = p.color;
  ctx.shadowBlur = Math.max(10, p.radiusY * 0.8);
  ctx.lineCap = "round";

  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a0 = (i / RING_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
    const mid = (a0 + a1) / 2;

    // 0 at the top, 1 at the bottom — gives the ring depth by tapering the far
    // (top) side thinner than the near (bottom) side.
    const verticalFactor = (Math.sin(mid) + 1) / 2;
    const width = topWidth + (bottomWidth - topWidth) * verticalFactor;

    const topFade = 1 - Math.exp(-(angularDistance(mid, TOP_ANGLE) ** 2) / (2 * TOP_GAP_SIGMA ** 2));

    ctx.globalAlpha = p.opacity * topFade;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(p.centerX, p.centerY, p.radiusX, p.radiusY, 0, a0, a1);
    ctx.stroke();
  }

  ctx.restore();
}

export function indicatorHeight(headY: number, feetY: number): number {
  return feetY - headY;
}

export function scaleFactorAt(keyframes: TrackKeyframe[], t: number, referenceIndicatorHeight: number): number {
  if (referenceIndicatorHeight <= 0) return 1;
  const { headY, feetY } = interpolateIndicator(keyframes, t);
  return indicatorHeight(headY, feetY) / referenceIndicatorHeight;
}

export function haloOpacityAt(keyframes: TrackKeyframe[], t: number, baseOpacity: number): number {
  const { k0, k1, frac } = bracket(keyframes, t);
  const v0 = k0.offscreen ? 0 : 1;
  const v1 = k1.offscreen ? 0 : 1;
  const visibility = v0 * (1 - frac) + v1 * frac;
  return baseOpacity * visibility;
}

export interface DerivedHaloParams {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  color: string;
  opacity: number;
}

export function deriveHaloParams(
  t: number,
  keyframes: TrackKeyframe[],
  halo: HaloConfig,
  canvasSize: { width: number; height: number },
): DerivedHaloParams {
  const referenceIndicator = interpolateIndicator(keyframes, halo.referenceTimestamp);
  const referenceHeight = indicatorHeight(referenceIndicator.headY, referenceIndicator.feetY);
  const scale = scaleFactorAt(keyframes, t, referenceHeight);
  const { feetY, centerX } = interpolateIndicator(keyframes, t);
  const opacity = haloOpacityAt(keyframes, t, halo.opacity);

  return {
    centerX: (centerX + halo.offsetX * scale) * canvasSize.width,
    centerY: (feetY + halo.offsetY * scale) * canvasSize.height,
    radiusX: halo.horizontalRadius * scale * canvasSize.width,
    radiusY: halo.verticalRadius * scale * canvasSize.height,
    color: halo.color,
    opacity,
  };
}
