import { bracket, interpolateIndicator } from "./keyframes";
import type { HaloConfig, TrackKeyframe } from "../state/types";

export interface HaloDrawParams {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  color: string;
  opacity: number;
  rainbow: boolean;
  /** Radians the rainbow gradient is turned from its starting position. */
  rotation: number;
}

const RING_POINTS = 360;
const FADE_STOPS = 72;
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

let layer: HTMLCanvasElement | null = null;

function getLayer(width: number, height: number): CanvasRenderingContext2D | null {
  layer ??= document.createElement("canvas");
  if (layer.width < width) layer.width = width;
  if (layer.height < height) layer.height = height;
  return layer.getContext("2d");
}

/**
 * Draws the ring as one filled shape on an offscreen layer, then composites that
 * layer onto `ctx` once with the glow and overall opacity. Drawing it as many
 * separately-stroked segments instead left visible joints wherever their
 * translucent ends overlapped.
 *
 * The ring is built in "circle space" (y divided by ry/rx) and drawn under a
 * vertical squash back to the ellipse, so conic gradients — the top fade here,
 * and any future colour gradient or rotation — sweep around the ring's
 * perspective angle rather than being stretched by the flattened ellipse.
 */
export function drawHalo(ctx: CanvasRenderingContext2D, p: HaloDrawParams): void {
  if (p.opacity <= 0.001 || p.radiusX <= 0 || p.radiusY <= 0) return;
  const baseWidth = Math.max(4, p.radiusY * 0.35);
  const topWidth = baseWidth * 0.7;
  const bottomWidth = baseWidth * 0.8;

  // Render the layer at the destination's device resolution so it stays sharp
  // on high-DPI canvases.
  const m = ctx.getTransform();
  const res = Math.max(1, Math.hypot(m.a, m.b));
  const margin = bottomWidth + 4;
  const halfW = p.radiusX + margin;
  const halfH = p.radiusY + margin;
  const layerW = Math.ceil(halfW * 2 * res);
  const layerH = Math.ceil(halfH * 2 * res);
  const lctx = getLayer(layerW, layerH);
  if (!lctx) return;

  const squash = p.radiusY / p.radiusX;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = "source-over";
  lctx.clearRect(0, 0, layerW, layerH);
  lctx.setTransform(res, 0, 0, res * squash, halfW * res, halfH * res);

  const path = new Path2D();
  const inner: [number, number][] = [];
  for (let i = 0; i <= RING_POINTS; i++) {
    const theta = (i / RING_POINTS) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    // 0 at the top, 1 at the bottom — tapers the far (top) side thinner than the
    // near (bottom) side for a sense of depth.
    const width = topWidth + (bottomWidth - topWidth) * ((sin + 1) / 2);
    // Offset along the ellipse's on-screen normal so the width is in screen
    // pixels, then convert y back into circle space.
    const nx = cos / p.radiusX;
    const ny = sin / p.radiusY;
    const nLen = Math.hypot(nx, ny);
    const ox = (nx / nLen) * (width / 2);
    const oy = (ny / nLen) * (width / 2);
    const x = p.radiusX * cos;
    const y = p.radiusY * sin;
    if (i === 0) path.moveTo(x + ox, (y + oy) / squash);
    else path.lineTo(x + ox, (y + oy) / squash);
    inner.push([x - ox, (y - oy) / squash]);
  }
  path.closePath();
  for (let i = inner.length - 1; i >= 0; i--) {
    const [x, y] = inner[i];
    if (i === inner.length - 1) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();

  lctx.fillStyle = p.rainbow ? rainbowGradient(lctx, p.rotation) : p.color;
  lctx.fill(path, "evenodd");

  if (typeof lctx.createConicGradient === "function") {
    const fade = lctx.createConicGradient(0, 0, 0);
    for (let i = 0; i <= FADE_STOPS; i++) {
      const t = i / FADE_STOPS;
      const d = angularDistance(t * Math.PI * 2, TOP_ANGLE);
      const alpha = 1 - Math.exp(-(d * d) / (2 * TOP_GAP_SIGMA ** 2));
      fade.addColorStop(t, `rgba(0,0,0,${alpha.toFixed(4)})`);
    }
    lctx.globalCompositeOperation = "destination-in";
    lctx.fillStyle = fade;
    lctx.fill(path, "evenodd");
    lctx.globalCompositeOperation = "source-over";
  }

  const glow = Math.max(10, p.radiusY * 0.8);
  // Older Safari (before 18) has no canvas filter support.
  const supportsFilter = typeof (ctx as { filter?: unknown }).filter === "string";

  // A shadow can only glow in a single colour, so a rainbow ring gets its glow
  // from a blurred copy of itself instead. Drawn in device pixels (transform
  // reset) so the blur radius means the same thing on every canvas.
  if (p.rainbow && supportsFilter) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = p.opacity;
    // A shadow's blur standard deviation is half its shadowBlur; match that.
    ctx.filter = `blur(${(glow / 2) * res}px)`;
    ctx.drawImage(
      layer!,
      0,
      0,
      layerW,
      layerH,
      m.a * (p.centerX - halfW) + m.e,
      m.d * (p.centerY - halfH) + m.f,
      m.a * halfW * 2,
      m.d * halfH * 2,
    );
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = p.opacity;
  ctx.filter = "blur(1.5px)";
  if (!p.rainbow) {
    ctx.shadowColor = p.color;
  } else if (!supportsFilter) {
    ctx.shadowColor = "rgba(255, 255, 255, 0.6)";
  }
  // Shadows ignore the current transform, so scale the glow to device pixels.
  ctx.shadowBlur = glow * res;
  ctx.drawImage(layer!, 0, 0, layerW, layerH, p.centerX - halfW, p.centerY - halfH, halfW * 2, halfH * 2);
  ctx.restore();
}

function rainbowGradient(ctx: CanvasRenderingContext2D, rotation: number): CanvasGradient | string {
  if (typeof ctx.createConicGradient !== "function") return "#ff3b30";
  const gradient = ctx.createConicGradient(rotation, 0, 0);
  const STOPS = 12;
  for (let i = 0; i <= STOPS; i++) {
    gradient.addColorStop(i / STOPS, `hsl(${(i / STOPS) * 360}, 100%, 55%)`);
  }
  return gradient;
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

export function deriveHaloParams(
  t: number,
  keyframes: TrackKeyframe[],
  halo: HaloConfig,
  canvasSize: { width: number; height: number },
): HaloDrawParams {
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
    rainbow: halo.rainbow,
    // Tied to video time rather than wall-clock time, so the same frame always
    // gets the same rotation in preview and export.
    rotation: 2 * Math.PI * halo.rotationSpeed * t,
  };
}
