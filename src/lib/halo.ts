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
  /** 0 = no glow, 0.5 = default, 1 = maximum. */
  glow: number;
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

const scratch = new Map<string, HTMLCanvasElement>();

/**
 * A reusable offscreen canvas per purpose. Grown as needed and never shrunk,
 * unless `exact`, which sizes it exactly: a canvas used to cast a shadow must be
 * drawn whole, because WebKit drops the shadow when drawImage crops its source.
 */
function getScratch(
  name: string,
  width: number,
  height: number,
  exact = false,
): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  let canvas = scratch.get(name);
  if (!canvas) {
    canvas = document.createElement("canvas");
    scratch.set(name, canvas);
  }
  if (exact ? canvas.width !== width : canvas.width < width) canvas.width = width;
  if (exact ? canvas.height !== height : canvas.height < height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.clearRect(0, 0, width, height);
  return [canvas, ctx];
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
  const ringScratch = getScratch("ring", layerW, layerH, true);
  if (!ringScratch) return;
  const [layer, lctx] = ringScratch;

  const squash = p.radiusY / p.radiusX;
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

  // The glow setting scales how far the glow spreads (0.5x-1.5x of the base size)
  // and how strongly it's layered on (0-2x); the default 0.5 is 1x of each.
  const glowBlur = Math.max(10, p.radiusY * 0.8) * (0.5 + p.glow) * res;
  const glowStrength = p.glow * 2;

  if (glowStrength > 0) {
    const glow = renderGlow(layer, layerW, layerH, glowBlur, p);
    if (glow) {
      const [glowCanvas, pad] = glow;
      const padUser = pad / res;
      ctx.save();
      for (let remaining = glowStrength; remaining > 0; remaining -= 1) {
        ctx.globalAlpha = p.opacity * Math.min(1, remaining);
        ctx.drawImage(
          glowCanvas,
          0,
          0,
          layerW + pad * 2,
          layerH + pad * 2,
          p.centerX - halfW - padUser,
          p.centerY - halfH - padUser,
          (halfW + padUser) * 2,
          (halfH + padUser) * 2,
        );
      }
      ctx.restore();
    }
  }

  ctx.save();
  ctx.globalAlpha = p.opacity;
  ctx.filter = "blur(1.5px)";
  ctx.drawImage(layer, 0, 0, layerW, layerH, p.centerX - halfW, p.centerY - halfH, halfW * 2, halfH * 2);
  ctx.restore();
}

const GLOW_HUES = 6;

/**
 * Renders the ring's glow into its own canvas (padded so the blur has room to
 * spread), returning it with the padding used, in device pixels.
 *
 * Built from canvas shadows rather than a `filter` blur: WebKit (Safari) accepts
 * a canvas `filter` setting but doesn't actually draw the blur. A shadow can
 * only be one colour though, so for a rainbow ring the ring is split into
 * overlapping hue sections that blend smoothly into each other (their weights
 * always add up to one), each casting a shadow in its own hue, accumulated
 * additively so the sections sum back to a smoothly coloured glow.
 */
function renderGlow(
  ring: HTMLCanvasElement,
  ringW: number,
  ringH: number,
  blur: number,
  p: HaloDrawParams,
): [HTMLCanvasElement, number] | null {
  const pad = Math.ceil(blur * 1.5);
  const accW = ringW + pad * 2;
  const accH = ringH + pad * 2;
  // Twice as wide: the right half is a scratch strip for the shadow-casting
  // copies of the ring (see castShadow); only the left half is used.
  const acc = getScratch("glow", accW * 2, accH);
  if (!acc) return null;
  const [accCanvas, actx] = acc;

  // Shadow-only pass: draw the source into the right-hand strip and offset its
  // shadow back into the left half, so the left half receives only the blurred
  // shadow.
  const offset = accW;
  actx.shadowBlur = blur;
  actx.shadowOffsetX = -offset;
  const castShadow = (source: HTMLCanvasElement, color: string) => {
    actx.shadowColor = color;
    actx.drawImage(source, pad + offset, pad);
  };

  const rainbow = p.rainbow && typeof actx.createConicGradient === "function";
  if (!rainbow) {
    castShadow(ring, p.rainbow ? "#ff3b30" : p.color);
    return [accCanvas, pad];
  }

  const section = getScratch("glow-section", ringW, ringH, true);
  if (!section) return null;
  const [sectionCanvas, sctx] = section;
  const span = (Math.PI * 2) / GLOW_HUES;
  actx.globalCompositeOperation = "lighter";
  for (let k = 0; k < GLOW_HUES; k++) {
    sctx.globalCompositeOperation = "source-over";
    sctx.clearRect(0, 0, ringW, ringH);
    sctx.drawImage(ring, 0, 0, ringW, ringH, 0, 0, ringW, ringH);
    // A raised-cosine bump centred on this hue's position around the ring,
    // reaching zero at its neighbours' centres. The ring was drawn in circle
    // space squashed vertically, so the gradient uses the same squash to line
    // its angles up with the ring's.
    const centre = p.rotation + k * span;
    const squash = p.radiusY / p.radiusX;
    sctx.setTransform(1, 0, 0, squash, ringW / 2, ringH / 2);
    const weight = sctx.createConicGradient(centre - span, 0, 0);
    const STEPS = 16;
    for (let i = 0; i <= STEPS; i++) {
      const d = (i / STEPS) * 2 * span - span;
      weight.addColorStop(((i / STEPS) * 2 * span) / (Math.PI * 2), `rgba(0,0,0,${Math.cos((Math.PI * d) / (2 * span)) ** 2})`);
    }
    weight.addColorStop(Math.min(1, (2 * span) / (Math.PI * 2) + 0.001), "rgba(0,0,0,0)");
    sctx.globalCompositeOperation = "destination-in";
    sctx.fillStyle = weight;
    sctx.fillRect(-ringW, -ringH / squash, ringW * 2, (ringH / squash) * 2);
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    castShadow(sectionCanvas, `hsl(${(k / GLOW_HUES) * 360}, 100%, 55%)`);
  }
  return [accCanvas, pad];
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
    glow: halo.glow,
  };
}
