import { deriveHaloParams, drawHalo, groundSourceFor } from "./halo";
import { createAudioContext, renderRealtime, type CanvasSize, type RealtimeRenderResult } from "./realtimeRender";
import type { HaloConfig, Project, TrackKeyframe } from "../state/types";

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  t: number,
  keyframes: TrackKeyframe[],
  halo: HaloConfig | null,
  canvasSize: CanvasSize,
): void {
  ctx.drawImage(videoEl, 0, 0, canvasSize.width, canvasSize.height);
  if (!halo || keyframes.length === 0) return;
  const derived = deriveHaloParams(t, keyframes, halo, canvasSize);
  const scale = videoEl.videoWidth ? videoEl.videoWidth / canvasSize.width : 1;
  drawHalo(ctx, derived, groundSourceFor(halo, videoEl, scale));
}

export type ExportResult = RealtimeRenderResult;

export function exportVideo(
  project: Project,
  keyframes: TrackKeyframe[],
  halo: HaloConfig | null,
  onProgress: (fraction: number) => void,
): Promise<ExportResult> {
  const audioCtx = createAudioContext();
  return renderRealtime(
    project,
    audioCtx,
    (ctx, videoEl, t, canvasSize) => renderFrame(ctx, videoEl, t, keyframes, halo, canvasSize),
    onProgress,
  );
}
