import { groundMask, type GroundSource } from "./groundMask";
import { bracket, interpolateIndicator } from "./keyframes";
import type { HaloConfig, HaloStyle, TrackKeyframe } from "../state/types";

export interface HaloDrawParams {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  color: string;
  /** The second colour, for the gradient (east/west) and comet (second comet) styles. */
  secondColor: string;
  opacity: number;
  style: HaloStyle;
  /** Radians the rainbow or comet is turned from its starting position. */
  rotation: number;
  /** Which way the comet is heading; its tail trails the other way. */
  clockwise: boolean;
  /**
   * Fade out the top-middle of the ring, where the player's legs usually pass
   * in front of it. Not needed when the ring is limited to the ground, which
   * hides it behind the legs exactly.
   */
  topGap: boolean;
  /** Fill the inside of the ring with a fainter version of it. */
  filled: boolean;
  /**
   * Taper the ring much more strongly, thin at the far (top) side and thick at
   * the near (bottom) side, so it reads as lying flat on the ground. Used with
   * ground-only mode, where the ring is seen sitting on the ground.
   */
  depth: boolean;
}

/** Where to read the ground from for `halo`, or null when the ring isn't limited to it. */
export function groundSourceFor(halo: HaloConfig, video: HTMLVideoElement, scale: number): GroundSource | null {
  if (!halo.groundOnly || halo.groundColors.length === 0) return null;
  return { video, scale, colors: halo.groundColors, tolerance: halo.groundTolerance };
}

/**
 * Keeps only what the mask covers of the top-left `dw`×`dh` of `target`, which
 * lines up with the mask's sub-rectangle `sx,sy,sw,sh`. Clears the rest of it.
 */
function applyMask(
  target: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  [sx, sy, sw, sh]: [number, number, number, number],
  dw = target.canvas.width,
  dh = target.canvas.height,
) {
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.shadowColor = "transparent";
  target.shadowBlur = 0;
  target.shadowOffsetX = 0;
  target.globalAlpha = 1;
  target.imageSmoothingEnabled = true;
  target.globalCompositeOperation = "destination-in";
  target.drawImage(mask, sx, sy, sw, sh, 0, 0, dw, dh);
  target.restore();
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
export function drawHalo(ctx: CanvasRenderingContext2D, p: HaloDrawParams, ground: GroundSource | null = null): void {
  if (p.opacity <= 0.001 || p.radiusX <= 0 || p.radiusY <= 0) return;
  const baseWidth = Math.max(4, p.radiusY * 0.35);
  const topWidth = baseWidth * (p.depth ? 0.45 : 0.7);
  const bottomWidth = baseWidth * (p.depth ? 1.25 : 0.8);

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

  lctx.fillStyle = ringStyle(lctx, p);
  lctx.fill(path, "evenodd");
  if (p.topGap) fadeTop(lctx, halfW, halfH, squash);

  const glowBlur = Math.max(10, p.radiusY * 0.8) * GLOW_SPREAD * res;
  const glow = renderGlow(layer, layerW, layerH, glowBlur, p);

  // Added after the glow is taken from the ring, so only the ring glows, and
  // drawn behind the ring so the ring stays crisp on top of it.
  if (p.filled) {
    const fillScratch = getScratch("fill", layerW, layerH, true);
    if (fillScratch) {
      const [fillCanvas, fctx] = fillScratch;
      fctx.setTransform(res, 0, 0, res * squash, halfW * res, halfH * res);
      fctx.fillStyle = ringStyle(fctx, p);
      fctx.beginPath();
      fctx.arc(0, 0, p.radiusX, 0, Math.PI * 2);
      fctx.fill();
      if (p.topGap) fadeTop(fctx, halfW, halfH, squash);
      lctx.save();
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalAlpha = FILL_STRENGTH;
      lctx.globalCompositeOperation = "destination-over";
      lctx.drawImage(fillCanvas, 0, 0);
      lctx.restore();
    }
  }
  const padUser = glow ? glow[1] / res : 0;

  if (ground) {
    // One mask over the whole glow's area, cut to the ring's part of it for the ring.
    const area = { x: p.centerX - halfW - padUser, y: p.centerY - halfH - padUser, w: (halfW + padUser) * 2, h: (halfH + padUser) * 2 };
    const mask = groundMask(ground, area);
    if (mask) {
      const fx = mask.width / area.w;
      const fy = mask.height / area.h;
      applyMask(lctx, mask, [padUser * fx, padUser * fy, halfW * 2 * fx, halfH * 2 * fy]);
      if (glow) {
        const [glowCanvas, pad] = glow;
        const glowCtx = glowCanvas.getContext("2d");
        // The glow is only in the left part of its canvas (see renderGlow).
        if (glowCtx) applyMask(glowCtx, mask, [0, 0, mask.width, mask.height], layerW + pad * 2, layerH + pad * 2);
      }
    }
  }

  if (glow) {
    const [glowCanvas, pad] = glow;
    ctx.save();
    ctx.globalAlpha = p.opacity;
    for (let i = 0; i < GLOW_PASSES; i++) {
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

  ctx.save();
  ctx.globalAlpha = p.opacity;
  ctx.filter = "blur(1.5px)";
  ctx.drawImage(layer, 0, 0, layerW, layerH, p.centerX - halfW, p.centerY - halfH, halfW * 2, halfH * 2);
  ctx.restore();
}

/** How strong the inside of a filled ring is, relative to the ring itself. */
const FILL_STRENGTH = 0.3;

/** The ring's colouring for its style, built for `ctx` (in the ring's circle space). */
function ringStyle(ctx: CanvasRenderingContext2D, p: HaloDrawParams): CanvasGradient | string {
  if (p.style === "rainbow") return rainbowGradient(ctx, p.rotation);
  if (p.style === "comet") return cometGradient(ctx, [p.color, p.secondColor], p.rotation, p.clockwise);
  if (p.style === "gradient") return twoToneGradient(ctx, [p.color, p.secondColor], p.rotation);
  return p.color;
}

/**
 * Fades out everything already drawn on `ctx` around the top-middle of the ring
 * (see TOP_GAP_SIGMA). `ctx` is in the ring's circle space, centred on the ring.
 */
function fadeTop(ctx: CanvasRenderingContext2D, halfW: number, halfH: number, squash: number) {
  if (typeof ctx.createConicGradient !== "function") return;
  const fade = ctx.createConicGradient(0, 0, 0);
  for (let i = 0; i <= FADE_STOPS; i++) {
    const t = i / FADE_STOPS;
    const d = angularDistance(t * Math.PI * 2, TOP_ANGLE);
    const alpha = 1 - Math.exp(-(d * d) / (2 * TOP_GAP_SIGMA ** 2));
    fade.addColorStop(t, `rgba(0,0,0,${alpha.toFixed(4)})`);
  }
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = fade;
  ctx.fillRect(-halfW, -halfH / squash, halfW * 2, (halfH / squash) * 2);
  ctx.globalCompositeOperation = "source-over";
}

// The glow spreads 1.5x the base size and is layered on twice.
const GLOW_SPREAD = 1.5;
const GLOW_PASSES = 2;
const RAINBOW_GLOW_HUES = 6;
const SECTION_STOPS = 120;

interface GlowSection {
  color: string;
  /** How much of the ring at this angle belongs to this section, 0-1. */
  weightAt: (angle: number) => number;
}

/** Parts of the ring that glow in different colours; null if it's all one colour. */
function glowSections(p: HaloDrawParams): GlowSection[] | null {
  if (p.style === "rainbow") {
    const span = (Math.PI * 2) / RAINBOW_GLOW_HUES;
    return Array.from({ length: RAINBOW_GLOW_HUES }, (_, k) => {
      const centre = p.rotation + k * span;
      return {
        color: `hsl(${(k / RAINBOW_GLOW_HUES) * 360}, 100%, 55%)`,
        // A raised-cosine bump centred on this hue's position around the ring,
        // reaching zero at its neighbours' centres, so neighbouring weights
        // always add up to one and the sections blend seamlessly.
        weightAt: (angle) => {
          const d = angularDistance(angle, centre);
          return d < span ? Math.cos((Math.PI * d) / (2 * span)) ** 2 : 0;
        },
      };
    });
  }
  const twoColors = p.secondColor.toLowerCase() !== p.color.toLowerCase();
  if (p.style === "gradient" && twoColors) {
    // The same weights the gradient blends its colours with, which add up to one.
    return [
      { color: p.color, weightAt: (angle) => Math.sin(angle - p.rotation) ** 2 },
      { color: p.secondColor, weightAt: (angle) => Math.cos(angle - p.rotation) ** 2 },
    ];
  }
  if (p.style === "comet" && twoColors) {
    // Each comet's section ends where its tail has faded to nothing, so the
    // hard boundary between the sections never shows.
    return [p.color, p.secondColor].map((color, k) => ({
      color,
      weightAt: (angle) => (cometAt(angle, p.rotation, p.clockwise).comet === k ? 1 : 0),
    }));
  }
  return null;
}

/**
 * Renders the ring's glow into its own canvas (padded so the blur has room to
 * spread), returning it with the padding used, in device pixels.
 *
 * Built from canvas shadows rather than a `filter` blur: WebKit (Safari) accepts
 * a canvas `filter` setting but doesn't actually draw the blur. A shadow can
 * only be one colour though, so a multi-coloured ring is split into sections
 * (see glowSections), each casting a shadow in its own colour, accumulated
 * additively so the sections sum back to one smoothly coloured glow.
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

  const sections = typeof actx.createConicGradient === "function" ? glowSections(p) : null;
  if (!sections) {
    castShadow(ring, p.style === "rainbow" ? "#ff3b30" : p.color);
    return [accCanvas, pad];
  }

  const sectionScratch = getScratch("glow-section", ringW, ringH, true);
  if (!sectionScratch) return null;
  const [sectionCanvas, sctx] = sectionScratch;
  const squash = p.radiusY / p.radiusX;
  actx.globalCompositeOperation = "lighter";
  for (const { color, weightAt } of sections) {
    sctx.globalCompositeOperation = "source-over";
    sctx.clearRect(0, 0, ringW, ringH);
    sctx.drawImage(ring, 0, 0, ringW, ringH, 0, 0, ringW, ringH);
    // The ring was drawn in circle space squashed vertically, so the mask uses
    // the same squash to line its angles up with the ring's.
    sctx.setTransform(1, 0, 0, squash, ringW / 2, ringH / 2);
    const mask = sctx.createConicGradient(0, 0, 0);
    for (let i = 0; i <= SECTION_STOPS; i++) {
      const t = i / SECTION_STOPS;
      mask.addColorStop(t, `rgba(0,0,0,${weightAt(t * Math.PI * 2).toFixed(4)})`);
    }
    sctx.globalCompositeOperation = "destination-in";
    sctx.fillStyle = mask;
    sctx.fillRect(-ringW, -ringH / squash, ringW * 2, (ringH / squash) * 2);
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    castShadow(sectionCanvas, color);
  }
  return [accCanvas, pad];
}

// Two comets on opposite sides, chasing each other. Lengths are fractions of
// the gap between the two heads: each tail runs almost the whole gap, ending
// where the other comet's short leading edge begins.
const COMETS = 2;
const COMET_LEAD = 0.03;
const COMET_TAIL = 1 - COMET_LEAD;
const COMET_FALLOFF = 1.5;
const COMET_STOPS = 360;

/**
 * Which comet owns the ring at `angle`, and how opaque it is there. Each head
 * is fully opaque, with a short soft leading edge in front and a tail fading
 * out behind it. The first starts at the bottom (nearest the viewer), the
 * other directly opposite.
 */
function cometAt(angle: number, rotation: number, clockwise: boolean): { comet: number; alpha: number } {
  const head = Math.PI / 2 + rotation;
  // Fraction of the ring clockwise from the first head.
  const t = ((((angle - head) / (Math.PI * 2)) % 1) + 1) % 1;
  // How far behind the first head this point is, in gaps between heads. Tails
  // trail opposite the direction of travel, so for a clockwise comet a point
  // t of the way clockwise from its head is 1 - t behind it.
  const q = (clockwise ? 1 - t : t) * COMETS;
  let comet = Math.floor(q) % COMETS;
  let behind = q - Math.floor(q);
  if (behind > 1 - COMET_LEAD) {
    // Just ahead of the next head: its leading edge.
    behind -= 1;
    comet = (comet + 1) % COMETS;
  }
  let alpha: number;
  if (behind < 0) alpha = (behind + COMET_LEAD) / COMET_LEAD;
  else if (behind < COMET_TAIL) alpha = (1 - behind / COMET_TAIL) ** COMET_FALLOFF;
  else alpha = 0;
  return { comet, alpha };
}

function cometGradient(
  ctx: CanvasRenderingContext2D,
  colors: [string, string],
  rotation: number,
  clockwise: boolean,
): CanvasGradient | string {
  if (typeof ctx.createConicGradient !== "function") return colors[0];
  const rgb = colors.map(hexToRgb);
  // Start at the first head so both heads fall exactly on a stop.
  const head = Math.PI / 2 + rotation;
  const gradient = ctx.createConicGradient(head, 0, 0);
  for (let i = 0; i <= COMET_STOPS; i++) {
    const t = i / COMET_STOPS;
    const { comet, alpha } = cometAt(head + t * Math.PI * 2, rotation, clockwise);
    const [r, g, b] = rgb[comet];
    gradient.addColorStop(t, `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(4)})`);
  }
  return gradient;
}

const TWO_TONE_STOPS = 72;

/**
 * Colour 1 at north and south (top and bottom of the ring), colour 2 at east
 * and west, blending smoothly in between; turned by `rotation`.
 */
function twoToneGradient(ctx: CanvasRenderingContext2D, colors: [string, string], rotation: number): CanvasGradient | string {
  if (typeof ctx.createConicGradient !== "function") return colors[0];
  const [a, b] = colors.map(hexToRgb);
  const gradient = ctx.createConicGradient(rotation, 0, 0);
  for (let i = 0; i <= TWO_TONE_STOPS; i++) {
    const t = i / TWO_TONE_STOPS;
    // The conic starts at east, where colour 2 is at full strength.
    const w = Math.cos(t * Math.PI * 2) ** 2;
    const mix = (k: number) => Math.round(a[k] * (1 - w) + b[k] * w);
    gradient.addColorStop(t, `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`);
  }
  return gradient;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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
  const onGround = halo.groundOnly && halo.groundColors.length > 0;

  return {
    centerX: (centerX + halo.offsetX * scale) * canvasSize.width,
    centerY: (feetY + halo.offsetY * scale) * canvasSize.height,
    radiusX: halo.horizontalRadius * scale * canvasSize.width,
    radiusY: halo.verticalRadius * scale * canvasSize.height,
    color: halo.color,
    secondColor: halo.secondColor,
    opacity,
    style: halo.style,
    // Tied to video time rather than wall-clock time, so the same frame always
    // gets the same rotation in preview and export.
    rotation: 2 * Math.PI * halo.rotationSpeed * t,
    clockwise: halo.rotationSpeed >= 0,
    topGap: !onGround,
    filled: halo.filled,
    depth: onGround,
  };
}
