import { useEffect, useState, type RefObject } from "react";
import { seekTo } from "../lib/video";

const STALL_TIMEOUT_MS = 4000;
const KICKSTART_TIMEOUT_MS = 400;

const MEDIA_ERROR_MESSAGES: Record<number, string> = {
  1: "MEDIA_ERR_ABORTED",
  2: "MEDIA_ERR_NETWORK",
  3: "MEDIA_ERR_DECODE (unsupported codec/container)",
  4: "MEDIA_ERR_SRC_NOT_SUPPORTED (format not supported)",
};

function kickstartBuffering(video: HTMLVideoElement): Promise<void> {
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
        const fallback = setTimeout(finish, KICKSTART_TIMEOUT_MS);
        video.addEventListener("timeupdate", onTimeUpdate);
      })
      .catch(() => {
        video.muted = wasMuted;
        resolve();
      });
  });
}

/**
 * Forces a <video> to actually decode and paint its first frame, and surfaces a
 * diagnostic message if it can't.
 *
 * A freshly-loaded, paused <video> often shows nothing at all on mobile browsers —
 * even once metadata (or more) has loaded — because nothing has prompted the
 * decoder to produce a frame. Two nudges are applied in sequence, since different
 * browsers/files have been observed needing different ones, and running both
 * concurrently risks one interrupting the other mid-flight (seeking while a
 * fragmented/streamed file is still trying to play forward for the first time can
 * disrupt that sequential decode):
 *  1. a muted play()-then-pause(), which reliably kicks a video stuck at
 *     readyState=HAVE_METADATA / networkState=NETWORK_IDLE (parsed the header,
 *     never requested the actual media data) into actually fetching + decoding —
 *     tried first since it's the stronger, more broadly effective signal
 *  2. if that still didn't produce a frame, a tiny forced seek (nudge away and
 *     back), which forces a repaint for a file that already has data buffered but
 *     just never painted anything while paused
 * Both temporarily mute the element regardless of its real muted setting, so this
 * is silent and safe even for a video whose audio the user wants to hear later.
 */
export function useForceVideoFirstFrame(
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | null,
  initialTime?: number,
) {
  const [diagnostic, setDiagnostic] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let cancelled = false;

    async function run() {
      if (video!.readyState < video!.HAVE_METADATA) {
        await new Promise<void>((resolve) => {
          video!.addEventListener("loadedmetadata", () => resolve(), { once: true });
        });
      }
      if (cancelled) return;

      // Seek to the intended starting frame before kickstarting playback, so the
      // brief forced play happens at (and barely moves from) the right spot instead
      // of visibly playing forward from t=0 first and then jumping — which reads as
      // an unwanted autoplay flash.
      if (initialTime !== undefined && Math.abs(video!.currentTime - initialTime) > 1e-3) {
        video!.currentTime = initialTime;
      }

      await kickstartBuffering(video!);
      if (cancelled) return;

      if (video!.readyState < video!.HAVE_CURRENT_DATA) {
        await seekTo(video!, video!.currentTime);
      }
      if (!cancelled && video!.readyState >= video!.HAVE_CURRENT_DATA) {
        setDiagnostic(null);
      }
    }
    void run();

    function handleError() {
      const err = video!.error;
      setDiagnostic(
        err ? `Video error: ${MEDIA_ERROR_MESSAGES[err.code] ?? err.code} — ${err.message || "no message"}` : "Video error (unknown)",
      );
    }
    video.addEventListener("error", handleError);

    const stallTimer = setTimeout(() => {
      if (video!.readyState < video!.HAVE_CURRENT_DATA && !video!.error) {
        setDiagnostic(
          `Video stalled — readyState=${video!.readyState}, networkState=${video!.networkState}, duration=${video!.duration}`,
        );
      }
    }, STALL_TIMEOUT_MS);

    return () => {
      cancelled = true;
      video.removeEventListener("error", handleError);
      clearTimeout(stallTimer);
    };
    // initialTime is intentionally not a dependency — it's only meant to seed where
    // this one-time mount sequence starts, not to re-run the sequence on every
    // change (callers already handle later seeks themselves).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, src]);

  return diagnostic;
}
