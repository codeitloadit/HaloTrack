const SEEK_EPSILON = 1e-4;
const NUDGE = 0.03;
const SEEK_TIMEOUT_MS = 1000;

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
