import {
  createTracker,
  isGridTime,
  sampleTimes,
  toKeyframe,
  trackPass,
  type Detection,
  type FrameSize,
  type Rect,
} from "./autoTrack";
import { loadPersonDetector, type PersonDetector } from "./personDetector";
import { createOffscreenVideo, primeVideo, seekToFrame } from "./video";
import type { Project, TrackKeyframe } from "../state/types";

/** The detector's input size; it resizes everything to this anyway. */
const DETECT_SIZE = 448;

/**
 * Frame access plus the loaded detector for one auto-tracking run. Holds an
 * off-screen copy of the video so seeking doesn't disturb the visible one.
 */
export interface AutoTrackSession {
  frame: FrameSize;
  /** Detects people in `region` (video pixels) of the frame at `t`; null if the frame couldn't be read. */
  detect(region: Rect, t: number): Promise<Detection[] | null>;
  /** The whole frame, letterboxed to a square so the detector doesn't stretch it. */
  wholeFrame: Rect;
  close(): void;
}

export async function openSession(project: Project): Promise<AutoTrackSession> {
  const frame = { w: project.width, h: project.height };
  const video = createOffscreenVideo(project.objectUrl, project.width, project.height, true);
  let detector: PersonDetector | null = null;
  try {
    if (video.readyState < video.HAVE_METADATA) {
      await new Promise((resolve) => video.addEventListener("loadedmetadata", resolve, { once: true }));
    }
    await primeVideo(video);
    detector = await loadPersonDetector();
  } catch (e) {
    video.remove();
    throw e;
  }
  const det = detector;

  const canvas = document.createElement("canvas");
  canvas.width = DETECT_SIZE;
  canvas.height = DETECT_SIZE;
  const ctx = canvas.getContext("2d")!;
  const full = Math.max(frame.w, frame.h);

  async function readFrame(t: number): Promise<boolean> {
    // Stay just short of the very end, where some browsers have no frame to show.
    const target = Math.min(t, Math.max(0, video.duration - 0.04));
    return (await seekToFrame(video, target)) || seekToFrame(video, target);
  }

  return {
    frame,
    wholeFrame: { x: (frame.w - full) / 2, y: (frame.h - full) / 2, w: full, h: full },
    async detect(region, t) {
      if (!(await readFrame(t))) return null;
      const scale = DETECT_SIZE / region.w;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, DETECT_SIZE, DETECT_SIZE);
      // Draw only the part of the region inside the frame: browsers disagree on
      // what drawImage does with a source rectangle that extends past the image.
      const sx = Math.max(0, region.x);
      const sy = Math.max(0, region.y);
      const sw = Math.min(frame.w, region.x + region.w) - sx;
      const sh = Math.min(frame.h, region.y + region.h) - sy;
      if (sw <= 0 || sh <= 0) return [];
      ctx.drawImage(video, sx, sy, sw, sh, (sx - region.x) * scale, (sy - region.y) * scale, sw * scale, sh * scale);
      return det.detect(canvas).map((b) => ({
        x: region.x + b.x / scale,
        y: region.y + b.y / scale,
        w: b.w / scale,
        h: b.h / scale,
        score: b.score,
      }));
    },
    close() {
      det.close();
      video.removeAttribute("src");
      video.load();
      video.remove();
    },
  };
}

/**
 * Tracks the player picked at `seed` (time `t0`) forwards to the end of the
 * video and backwards to the start, returning auto-flagged keyframes for every
 * tracking step that doesn't already have one set by hand.
 */
export async function runAutoTrack(
  session: AutoTrackSession,
  seed: Rect,
  t0: number,
  duration: number,
  existing: TrackKeyframe[],
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<TrackKeyframe[]> {
  const manual = new Map(existing.filter((k) => !k.auto).map((k) => [k.timestamp, k]));
  const forward = sampleTimes(t0, duration);
  const backward = t0 > 0 ? sampleTimes(t0, 0) : [t0];
  const total = forward.length + backward.length - 2;
  let done = 0;
  const onSample = () => onProgress(total > 0 ? ++done / total : 1);
  const detect = (region: Rect, t: number) => session.detect(region, t);

  const out: TrackKeyframe[] = [];
  const seedTracker = createTracker(seed, session.frame);
  const seedIsManual = [...manual.keys()].some((t) => Math.abs(t - t0) < 1e-6);
  if (isGridTime(t0, duration) && !seedIsManual) out.push(toKeyframe(t0, seedTracker, false));

  out.push(...(await trackPass(createTracker(seed, session.frame), forward, duration, manual, detect, onSample, signal)));
  out.push(...(await trackPass(createTracker(seed, session.frame), backward, duration, manual, detect, onSample, signal)));

  return out;
}
