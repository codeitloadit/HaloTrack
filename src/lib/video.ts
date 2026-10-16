const SEEK_EPSILON = 1e-4;
const NUDGE = 0.03;
const SEEK_TIMEOUT_MS = 1000;
const PRIME_TIMEOUT_MS = 400;

function waitForSeeked(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", onSeeked);
      clearTimeout(timer);
      resolve();
    };
    const onSeeked = () => finish();
    // Some mobile browsers have been observed not firing 'seeked' reliably for
    // blob-sourced video; fall back to resolving anyway so the app never hangs.
    const timer = setTimeout(finish, SEEK_TIMEOUT_MS);
    video.addEventListener("seeked", onSeeked);
  });
}

/**
 * Seeks a video element to `t`, resolving once the frame is actually painted.
 *
 * Browsers only repaint on a real currentTime change. If `t` already equals
 * currentTime (e.g. the initial mount at t=0, or re-selecting the same
 * keyframe), assigning the same value is a no-op and nothing renders — most
 * visibly on mobile Safari, where a video that has never played may show no
 * frame at all. To force a repaint in that case we nudge away and back.
 */
export async function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  if (Math.abs(video.currentTime - t) >= SEEK_EPSILON) {
    const done = waitForSeeked(video);
    video.currentTime = t;
    await done;
    return;
  }

  const duration = Number.isFinite(video.duration) ? video.duration : t + NUDGE * 2;
  const nudgeTarget = t + NUDGE <= duration ? t + NUDGE : Math.max(0, t - NUDGE);

  const nudgeDone = waitForSeeked(video);
  video.currentTime = nudgeTarget;
  await nudgeDone;

  const done = waitForSeeked(video);
  video.currentTime = t;
  await done;
}

/**
 * Briefly plays a video muted, then pauses it, to kick it into fetching and
 * decoding. A paused video that has never played can sit at
 * readyState=HAVE_METADATA indefinitely on iOS, never producing a frame.
 */
export function primeVideo(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const wasMuted = video.muted;
    video.muted = true;
    video
      .play()
      .then(() => {
        // Pausing the instant play() resolves can race ahead of the first frame
        // actually being decoded and painted (observed with MediaRecorder's own
        // fragmented-mp4 output, which some players can only play forward through
        // rather than seek around in) — so wait for real playback progress via
        // 'timeupdate' first, with a timeout fallback so this can't hang forever.
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener("timeupdate", onTimeUpdate);
          clearTimeout(fallback);
          video.pause();
          video.muted = wasMuted;
          resolve();
        };
        const onTimeUpdate = () => finish();
        const fallback = setTimeout(finish, PRIME_TIMEOUT_MS);
        video.addEventListener("timeupdate", onTimeUpdate);
      })
      .catch(() => {
        video.muted = wasMuted;
        resolve();
      });
  });
}

/**
 * A video element for reading frames that the user never sees. Kept attached
 * (off-screen) rather than detached — some mobile browsers throttle decoding of
 * media elements that aren't in the document. Rendered at real size rather than
 * shrunk to 1x1px: a visually tiny video element has been observed (on long
 * clips, on iOS) to have its *video* decode deprioritized under memory/power
 * pressure, independently of audio. Positioning it far off-screen avoids that
 * signal while keeping it invisible.
 */
export function createOffscreenVideo(src: string, width: number, height: number, muted: boolean): HTMLVideoElement {
  const video = document.createElement("video");
  video.src = src;
  video.playsInline = true;
  video.muted = muted;
  video.preload = "auto";
  video.style.position = "fixed";
  video.style.left = "-100000px";
  video.style.top = "0";
  video.style.width = `${width}px`;
  video.style.height = `${height}px`;
  video.style.pointerEvents = "none";
  document.body.appendChild(video);
  return video;
}
