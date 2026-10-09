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

export function drawHalo(ctx: CanvasRenderingContext2D, p: HaloDrawParams): void {
  if (p.opacity <= 0.001 || p.radiusX <= 0 || p.radiusY <= 0) return;
  ctx.save();
  ctx.globalAlpha = p.opacity;
  ctx.filter = "blur(6px)";
  ctx.strokeStyle = p.color;
  ctx.lineWidth = Math.max(4, p.radiusY * 0.35);
  ctx.beginPath();
  ctx.ellipse(p.centerX, p.centerY, p.radiusX, p.radiusY, 0, 0, Math.PI * 2);
  ctx.stroke();
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
