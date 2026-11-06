import {
  createOffscreenVideo,
  playThrough,
  renderRealtime,
  waitForMetadata,
  type CanvasSize,
  type RealtimeRenderResult,
  type RealtimeSource,
} from "../realtimeRender";
import { buildPyramid, estimateMotion, grayFromRgba, NO_MOTION, type Pyramid } from "./motion";
import { correctionAt, planStabilization, type Correction, type MotionSample } from "./trajectory";

/** Motion is measured on frames this size along their long side; plenty for camera shake, and cheap. */
const ANALYSIS_LONG_SIDE = 320;

export type StabilizeStage = "analyzing" | "rendering";

/**
 * Plays the clip through once (muted) and measures camera motion between each
 * pair of consecutive frames. requestVideoFrameCallback is used where available
 * so every sample is keyed to the exact media time of the frame it measured,
 * which the render pass then matches frame for frame.
 */
export async function analyzeMotion(source: RealtimeSource, onProgress: (fraction: number) => void): Promise<MotionSample[]> {
  const videoEl = createOffscreenVideo(source);
  videoEl.muted = true;
  const scale = ANALYSIS_LONG_SIDE / Math.max(source.width, source.height);
  const width = Math.max(32, Math.round(source.width * scale));
  const height = Math.max(32, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not acquire 2d canvas context");

  const samples: MotionSample[] = [];
  let previous: Pyramid | null = null;
  let lastTime = -Infinity;
  function measure(t: number) {
    if (t <= lastTime) return;
    lastTime = t;
    ctx!.drawImage(videoEl, 0, 0, width, height);
    const frame = buildPyramid(grayFromRgba(ctx!.getImageData(0, 0, width, height).data, width, height));
    samples.push({ t, motion: previous ? estimateMotion(previous, frame) : NO_MOTION });
    previous = frame;
  }

  const frameCallbacks = typeof videoEl.requestVideoFrameCallback === "function";
  let handle: number | null = null;
  const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
    measure(metadata.mediaTime);
    handle = videoEl.requestVideoFrameCallback(onFrame);
  };

  try {
    await waitForMetadata(videoEl);
    if (frameCallbacks) handle = videoEl.requestVideoFrameCallback(onFrame);
    await videoEl.play();
    await playThrough(videoEl, source.durationSec, (t) => {
      if (!frameCallbacks) measure(t);
      onProgress(source.durationSec > 0 ? Math.min(1, t / source.durationSec) : 0);
    });
  } finally {
    if (handle !== null) videoEl.cancelVideoFrameCallback(handle);
    videoEl.remove();
  }
  return samples;
}

function drawStabilizedFrame(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  c: Correction,
  zoom: number,
  { width, height }: CanvasSize,
) {
  const k = zoom * Math.exp(c.s);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.scale(k, k);
  ctx.rotate(c.a);
  ctx.translate(c.x * width, c.y * width);
  ctx.drawImage(videoEl, -width / 2, -height / 2, width, height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export interface StabilizeResult extends RealtimeRenderResult {
  zoom: number;
}

/**
 * Two real-time passes: measure the camera's motion, then re-record the clip
 * with each frame counter-moved onto a smoothed path and zoomed just enough to
 * hide the edges. `audioCtx` must come from createAudioContext() inside the
 * user gesture, since the render pass only starts once analysis is done.
 */
export async function stabilizeVideo(
  source: RealtimeSource,
  audioCtx: AudioContext,
  onProgress: (stage: StabilizeStage, fraction: number) => void,
): Promise<StabilizeResult> {
  try {
    const samples = await analyzeMotion(source, (f) => onProgress("analyzing", f));
    const plan = planStabilization(samples, source.width / source.height);
    const result = await renderRealtime(
      source,
      audioCtx,
      (ctx, videoEl, t, size) => drawStabilizedFrame(ctx, videoEl, correctionAt(plan, t), plan.zoom, size),
      (f) => onProgress("rendering", f),
      { perVideoFrame: true },
    );
    return { ...result, zoom: plan.zoom };
  } catch (err) {
    if (audioCtx.state !== "closed") void audioCtx.close();
    throw err;
  }
}
