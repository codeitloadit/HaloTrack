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
  /** The very first rendered frame (video + halo), as a data URL — used as the
   * result <video>'s poster so something is visible immediately, independent of
   * whether the browser decides to paint a frame of the encoded video on its own
   * (unreliable for MediaRecorder's own fragmented-mp4/webm output on some mobile
   * browsers). */
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

  // Wait until the video has actually decoded and presented a real frame before
  // creating the canvas stream / recorder at all — otherwise the gap between
  // "playback started" and "first frame decoded" (which can be much longer on a
  // real phone than in a desktop/headless test) gets captured as leading
  // blank-canvas frames, showing up as a black flash before the video appears.
  // readyState alone isn't a reliable signal for this, so requestVideoFrameCallback
  // is preferred — it specifically only fires once a frame has been presented.
  const firstFramePresented = new Promise<void>((resolve) => {
    if (typeof videoEl.requestVideoFrameCallback === "function") {
      videoEl.requestVideoFrameCallback(() => resolve());
    } else {
      const readyDeadline = performance.now() + 1000;
      (async () => {
        while (videoEl.readyState < videoEl.HAVE_CURRENT_DATA && performance.now() < readyDeadline) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        }
        resolve();
      })();
    }
  });
  await videoEl.play();
  await firstFramePresented;

  renderFrame(ctx, videoEl, videoEl.currentTime, keyframes, halo, canvasSize);
  const posterDataUrl = canvas.toDataURL("image/jpeg", 0.85);

  const canvasStream = canvas.captureStream();
  const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...destNode.stream.getAudioTracks()]);

  const recorder = new MediaRecorder(combinedStream, { mimeType: pickSupportedMime() });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const END_EPSILON = 0.05;
  // Gap observed between "currentTime reaches the end" and the encoder pipeline
  // actually having flushed enough data to produce a valid video track — calling
  // recorder.stop() before this grace period elapses has been observed to
  // silently produce an output with no video track at all (a sliver of audio
  // still comes through, but no video frames), even though waiting for the
  // native 'ended' event instead — which does eventually produce a correct
  // recording — confirms the data genuinely isn't ready any earlier. 'ended'
  // itself is unusable as the primary signal here since it's been observed to
  // take upwards of 30+ seconds (likely related to audio being routed through
  // the Web Audio graph below rather than a real output), so a short fixed delay
  // after currentTime reaches the end is used instead.
  const STOP_GRACE_MS = 600;

  let rafHandle: number | null = null;
  let resolveFinished: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  function finish() {
    if (!resolveFinished) return;
    const resolve = resolveFinished;
    resolveFinished = null;
    setTimeout(resolve, STOP_GRACE_MS);
  }
  videoEl.addEventListener("ended", finish, { once: true });

  function drawLoop() {
    renderFrame(ctx!, videoEl, videoEl.currentTime, keyframes, halo, canvasSize);
    onProgress(project.durationSec > 0 ? Math.min(1, videoEl.currentTime / project.durationSec) : 0);
    if (videoEl.ended || videoEl.currentTime >= project.durationSec - END_EPSILON) {
      finish();
      return;
    }
    rafHandle = requestAnimationFrame(drawLoop);
  }

  recorder.start();
  rafHandle = requestAnimationFrame(drawLoop);
  await finished;
  if (rafHandle !== null) cancelAnimationFrame(rafHandle);

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
