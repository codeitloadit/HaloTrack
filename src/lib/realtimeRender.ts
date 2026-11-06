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

export function pickSupportedMime(): string {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}

export function hasSupportedExportFormat(): boolean {
  if (typeof MediaRecorder === "undefined") return false;
  return MIME_CANDIDATES.some((m) => MediaRecorder.isTypeSupported(m));
}

export interface RealtimeSource {
  objectUrl: string;
  width: number;
  height: number;
  durationSec: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export type DrawFrame = (ctx: CanvasRenderingContext2D, videoEl: HTMLVideoElement, t: number, canvasSize: CanvasSize) => void;

export interface RenderOptions {
  /**
   * Draw once per decoded video frame, with `t` set to that frame's exact media
   * time, rather than every animation frame with `t` = currentTime. Needed when
   * per-frame data must line up with the exact frame drawn: from an animation
   * frame, the latest reported frame time can lag the frame drawImage paints.
   */
  perVideoFrame?: boolean;
}

export interface RealtimeRenderResult {
  blob: Blob;
  /** The very first rendered frame, as a data URL — used as the result <video>'s
   * poster so something is visible immediately, independent of whether the
   * browser decides to paint a frame of the encoded video on its own (unreliable
   * for MediaRecorder's own fragmented-mp4/webm output on some mobile browsers). */
  posterDataUrl: string | null;
}

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
const STUCK_MS = 600;
const RECOVERY_COOLDOWN_MS = 1200;

/**
 * iOS requires the AudioContext to be created/resumed synchronously within a
 * user gesture's call stack, so callers must create it before any `await` —
 * not after waiting on the video to load, or audio capture silently fails on iOS.
 */
export function createAudioContext(): AudioContext {
  const AudioContextClass =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioContextClass();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

/**
 * Kept attached (off-screen) rather than fully detached — some mobile browsers
 * throttle decoding of media elements that aren't in the document. Rendered at
 * real size rather than shrunk to 1x1px: a visually tiny/zero-size video element
 * has been observed (on long clips, on iOS) to have its *video* decode
 * deprioritized under memory/power pressure independently of audio — showing up
 * as the picture freezing partway through playback while the audio keeps playing.
 * Positioning it far off-screen (rather than shrinking it) avoids that signal
 * while still keeping it invisible to the user.
 */
export function createOffscreenVideo(source: RealtimeSource): HTMLVideoElement {
  const videoEl = document.createElement("video");
  videoEl.src = source.objectUrl;
  videoEl.playsInline = true;
  videoEl.style.position = "fixed";
  videoEl.style.left = "-100000px";
  videoEl.style.top = "0";
  videoEl.style.width = `${source.width}px`;
  videoEl.style.height = `${source.height}px`;
  videoEl.style.pointerEvents = "none";
  document.body.appendChild(videoEl);
  return videoEl;
}

export function waitForMetadata(videoEl: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (videoEl.readyState >= videoEl.HAVE_METADATA) return resolve();
    videoEl.addEventListener("loadedmetadata", () => resolve(), { once: true });
    videoEl.addEventListener("error", () => reject(videoEl.error ?? new Error("Could not load video")), { once: true });
  });
}

/**
 * Resolves once the video has actually decoded and presented a real frame, with
 * that frame's media time when known. readyState alone isn't a reliable signal
 * for this, so requestVideoFrameCallback is preferred — it specifically only
 * fires once a frame has been presented.
 */
function waitForFirstFrame(videoEl: HTMLVideoElement): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof videoEl.requestVideoFrameCallback === "function") {
      videoEl.requestVideoFrameCallback((_now, metadata) => resolve(metadata.mediaTime));
    } else {
      const readyDeadline = performance.now() + 1000;
      (async () => {
        while (videoEl.readyState < videoEl.HAVE_CURRENT_DATA && performance.now() < readyDeadline) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        }
        resolve(null);
      })();
    }
  });
}

/**
 * Calls `onTick` every animation frame while an already-playing video plays
 * through to its end, resolving once it gets there.
 *
 * Defends against a failure mode (reported on longer clips on iOS) where the
 * video decoder silently stalls partway through — currentTime stops advancing
 * while audio keeps playing, since audio playout isn't tied to the same decode
 * pipeline. There's no direct API to ask "is decode stuck", so this detects it
 * indirectly (currentTime hasn't moved in a while despite not being paused/
 * ended) and tries to recover by pausing, nudging forward past wherever it got
 * stuck, and resuming — which has proven effective at "waking up" a stalled
 * decoder elsewhere in this app (see lib/video.ts's seek nudge).
 */
export function playThrough(videoEl: HTMLVideoElement, durationSec: number, onTick: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let lastObservedTime = -1;
    let lastChangeAt = performance.now();
    let lastRecoveryAt = -Infinity;

    const finish = () => {
      if (done) return;
      done = true;
      videoEl.removeEventListener("ended", finish);
      resolve();
    };
    videoEl.addEventListener("ended", finish, { once: true });

    function loop() {
      if (done) return;
      const t = videoEl.currentTime;
      if (Math.abs(t - lastObservedTime) > 0.0005) {
        lastObservedTime = t;
        lastChangeAt = performance.now();
      }

      onTick(t);

      if (videoEl.ended || t >= durationSec - END_EPSILON) {
        finish();
        return;
      }

      const now = performance.now();
      if (!videoEl.paused && now - lastChangeAt > STUCK_MS && now - lastRecoveryAt > RECOVERY_COOLDOWN_MS) {
        lastRecoveryAt = now;
        const resumeAt = Math.min(t + 0.03, durationSec);
        videoEl.pause();
        videoEl.currentTime = resumeAt;
        void videoEl.play();
      }

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  });
}

/**
 * Re-records a video through a canvas by playing the source through in real
 * time (not seeking frame by frame). Audio can only be captured from a
 * MediaStream while it's actually playing — there's no way to "manually push" an
 * audio sample the way `track.requestFrame()` can push a video frame — so
 * real-time playback is required once audio is in scope. This also sidesteps a
 * Safari-specific issue where a canvas stream fed by irregular,
 * synthetically-timed frames (as in a seek-per-frame loop) can produce a file
 * Safari considers malformed (e.g. not recognized by the iOS "Save Video"
 * action), whereas a normal continuous real-time capture does not.
 *
 * `audioCtx` must come from createAudioContext() called inside the user gesture.
 */
export async function renderRealtime(
  source: RealtimeSource,
  audioCtx: AudioContext,
  drawFrame: DrawFrame,
  onProgress: (fraction: number) => void,
  options: RenderOptions = {},
): Promise<RealtimeRenderResult> {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2d canvas context");

  const videoEl = createOffscreenVideo(source);
  // Deliberately not muted: some browsers only feed decoded audio into a
  // MediaElementSource when the element itself is unmuted. Staying silent
  // instead relies on never connecting the audio graph to the speakers (below)
  // rather than on the `muted` property.

  // Tap the decoded audio into a MediaStreamDestination without connecting to
  // audioCtx.destination, so the render runs silently (no audible playback) while
  // still capturing real audio samples regardless of videoEl.muted.
  const sourceNode = audioCtx.createMediaElementSource(videoEl);
  const destNode = audioCtx.createMediaStreamDestination();
  sourceNode.connect(destNode);
  if (audioCtx.state === "suspended") await audioCtx.resume();

  await waitForMetadata(videoEl);

  const canvasSize = { width: canvas.width, height: canvas.height };
  const perVideoFrame = options.perVideoFrame === true && typeof videoEl.requestVideoFrameCallback === "function";

  // Wait until the video has actually decoded and presented a real frame before
  // creating the canvas stream / recorder at all — otherwise the gap between
  // "playback started" and "first frame decoded" (which can be much longer on a
  // real phone than in a desktop/headless test) gets captured as leading
  // blank-canvas frames, showing up as a black flash before the video appears.
  const firstFramePresented = waitForFirstFrame(videoEl);
  await videoEl.play();
  const firstFrameTime = await firstFramePresented;

  drawFrame(ctx, videoEl, (perVideoFrame ? firstFrameTime : null) ?? videoEl.currentTime, canvasSize);
  const posterDataUrl = canvas.toDataURL("image/jpeg", 0.85);

  const canvasStream = canvas.captureStream();
  const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...destNode.stream.getAudioTracks()]);

  // Our own capture pipeline has been confirmed (via on-screen diagnostics) to
  // feed a fresh frame continuously the whole way through, with no stalls, so the
  // freeze is happening downstream in the encoder. A higher explicit bitrate
  // delayed it but didn't fix it — that shape (gets worse the longer the
  // recording runs, regardless of available bitrate) points at an ever-growing
  // internal buffer rather than a bitrate budget: with no timeslice, start()
  // holds the entire encoded stream in memory until stop() is called, which is a
  // known source of exactly this kind of degradation on longer recordings on
  // WebKit. Requesting periodic dataavailable flushes below lets it release that
  // buffer incrementally instead.
  const recorder = new MediaRecorder(combinedStream, {
    mimeType: pickSupportedMime(),
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let frameHandle: number | null = null;
  const onVideoFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
    drawFrame(ctx, videoEl, metadata.mediaTime, canvasSize);
    frameHandle = videoEl.requestVideoFrameCallback(onVideoFrame);
  };

  recorder.start(1000);
  if (perVideoFrame) frameHandle = videoEl.requestVideoFrameCallback(onVideoFrame);
  await playThrough(videoEl, source.durationSec, (t) => {
    if (!perVideoFrame) drawFrame(ctx, videoEl, t, canvasSize);
    onProgress(source.durationSec > 0 ? Math.min(1, t / source.durationSec) : 0);
  });
  if (frameHandle !== null) videoEl.cancelVideoFrameCallback(frameHandle);
  await new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS));

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
