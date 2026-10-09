import { deriveHaloParams, drawHalo } from "./halo";
import type { HaloConfig, Project, TrackKeyframe } from "../state/types";

export interface CanvasSize {
  width: number;
  height: number;
}

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
  drawHalo(ctx, derived);
}

// mp4 first: it's the only container Photos (and most non-browser consumers) can
// import, and it's also the only container Safari's MediaRecorder actually supports
// (it has never supported webm encoding). The mp4 candidates must pin explicit
// H.264/AAC codecs — a bare "video/mp4" lets some browsers (observed on Chrome)
// silently encode VP9/Opus inside an mp4 container, which is a non-standard
// combination most players (including Photos) can't decode despite the container
// claiming to be mp4. Requiring the codec string avoids that trap, and falling
// back to webm here doesn't change behavior on Chrome/Firefox either way, since
// they fall straight through to it when the mp4+h264 combination isn't supported.
const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function pickSupportedMime(): string {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}

export function hasSupportedExportFormat(): boolean {
  if (typeof MediaRecorder === "undefined") return false;
  return MIME_CANDIDATES.some((m) => MediaRecorder.isTypeSupported(m));
}

/**
 * Exports by playing the source video through in real time (not seeking frame by
 * frame). Audio can only be captured from a MediaStream while it's actually
 * playing — there's no way to "manually push" an audio sample the way
 * `track.requestFrame()` can push a video frame — so real-time playback is required
 * once audio is in scope. This also sidesteps a Safari-specific issue where a canvas
 * stream fed by irregular, synthetically-timed frames (as in a seek-per-frame loop)
 * can produce a file Safari considers malformed (e.g. not recognized by the iOS
 * "Save Video" action), whereas a normal continuous real-time capture does not.
 */
export interface ExportResult {
  blob: Blob;
  /** A still frame captured from partway through the recording, as a data URL —
   * used as the result <video>'s poster so something is visible immediately,
   * independent of whether the browser decides to paint a frame of the encoded
   * video on its own (unreliable for MediaRecorder's own fragmented-mp4/webm
   * output on some mobile browsers). */
  posterDataUrl: string | null;
}

export async function exportVideo(
  project: Project,
  keyframes: TrackKeyframe[],
  halo: HaloConfig | null,
  onProgress: (fraction: number) => void,
): Promise<ExportResult> {
  const canvas = document.createElement("canvas");
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2d canvas context");

  const videoEl = document.createElement("video");
  videoEl.src = project.objectUrl;
  videoEl.playsInline = true;
  // Deliberately not muted: some browsers only feed decoded audio into a
  // MediaElementSource when the element itself is unmuted. Staying silent during
  // export instead relies on never connecting the audio graph to the speakers
  // (see below) rather than on the `muted` property.
  // Kept attached (off-screen) rather than fully detached — some mobile browsers
  // throttle decoding of media elements that aren't in the document.
  videoEl.style.position = "fixed";
  videoEl.style.width = "1px";
  videoEl.style.height = "1px";
  videoEl.style.opacity = "0";
  videoEl.style.pointerEvents = "none";
  document.body.appendChild(videoEl);

  // iOS requires the AudioContext to be created/resumed synchronously within the
  // user gesture's call stack (this function is invoked directly from the Export
  // button's onClick) — so this must happen before any `await`, not after waiting
  // on the video to load, or audio capture silently fails on iOS.
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioContextClass();
  // Tap the decoded audio into a MediaStreamDestination without connecting to
  // audioCtx.destination, so the export runs silently (no audible playback) while
  // still capturing real audio samples regardless of videoEl.muted.
  const sourceNode = audioCtx.createMediaElementSource(videoEl);
  const destNode = audioCtx.createMediaStreamDestination();
  sourceNode.connect(destNode);
  if (audioCtx.state === "suspended") await audioCtx.resume();

  await new Promise<void>((resolve) => {
    videoEl.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });

  const canvasSize = { width: canvas.width, height: canvas.height };
  const canvasStream = canvas.captureStream();
  const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...destNode.stream.getAudioTracks()]);

  const recorder = new MediaRecorder(combinedStream, { mimeType: pickSupportedMime() });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let posterDataUrl: string | null = null;
  let rafHandle: number | null = null;
  function drawLoop() {
    renderFrame(ctx!, videoEl, videoEl.currentTime, keyframes, halo, canvasSize);
    onProgress(project.durationSec > 0 ? Math.min(1, videoEl.currentTime / project.durationSec) : 0);
    // Grab a poster frame partway through rather than at t=0, so it's a
    // representative frame even if the very start is off-screen/faded.
    if (!posterDataUrl && project.durationSec > 0 && videoEl.currentTime >= project.durationSec / 2) {
      posterDataUrl = canvas.toDataURL("image/jpeg", 0.85);
    }
    if (!videoEl.ended) rafHandle = requestAnimationFrame(drawLoop);
  }

  const finished = new Promise<void>((resolve) => {
    videoEl.addEventListener("ended", () => resolve(), { once: true });
  });

  recorder.start();
  rafHandle = requestAnimationFrame(drawLoop);
  await videoEl.play();
  await finished;
  if (rafHandle !== null) cancelAnimationFrame(rafHandle);
  if (!posterDataUrl) {
    // Fallback for a very short clip where currentTime never reached the
    // halfway mark before 'ended' fired — whatever's on the canvas now still
    // beats no poster at all.
    posterDataUrl = canvas.toDataURL("image/jpeg", 0.85);
  }

  const stopped = new Promise<void>((resolve) => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
  });
  recorder.stop();
  await stopped;
  onProgress(1);

  sourceNode.disconnect();
  await audioCtx.close();
  videoEl.remove();

  return { blob: new Blob(chunks, { type: recorder.mimeType }), posterDataUrl };
}
