import {
  convergesWith,
  createTracker,
  isGridTime,
  sampleTimes,
  toKeyframe,
  trackPass,
  trackerFromKeyframe,
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

/** Who to track from: a box the user picked, or a keyframe (e.g. marking the player off-screen). */
export type AutoTrackSeed = { box: Rect } | { keyframe: TrackKeyframe };

/**
 * - `pick`: the user chose who to track at `t0`. Everything after it is
 *   retracked; before it, only untracked steps back to the nearest tracked one.
 * - `followUp`: a rerun from an unsure step over steps already tracked, so it
 *   only goes forwards and stops once it agrees with them again.
 */
export type AutoTrackMode = "pick" | "followUp";

export interface AutoTrackResult {
  keyframes: TrackKeyframe[];
  /** The earliest step the run covered. */
  from: number;
}

/**
 * Tracks the player from `seed` at time `t0`. Returns the seed itself as a
 * hand-set keyframe plus auto-flagged keyframes for the other steps covered,
 * leaving out any steps set by hand (which instead re-seed the tracker).
 */
export async function runAutoTrack(
  session: AutoTrackSession,
  seed: AutoTrackSeed,
  t0: number,
  duration: number,
  existing: TrackKeyframe[],
  mode: AutoTrackMode,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<AutoTrackResult> {
  const atSeed = (t: number) => Math.abs(t - t0) < 1e-6;
  const manual = new Map(existing.filter((k) => !k.auto && !atSeed(k.timestamp)).map((k) => [k.timestamp, k]));
  const trackedBefore = existing.filter((k) => k.timestamp < t0 - 1e-6).map((k) => k.timestamp);
  const backwardTo = trackedBefore.length > 0 ? Math.max(...trackedBefore) : 0;

  const forward = sampleTimes(t0, duration);
  const backward = mode === "pick" && t0 > backwardTo ? sampleTimes(t0, backwardTo) : [t0];
  const total = forward.length + backward.length - 2;
  let done = 0;
  const onSample = () => onProgress(total > 0 ? ++done / total : 1);
  const detect = (region: Rect, t: number) => session.detect(region, t);
  const newTracker = () =>
    "box" in seed ? createTracker(seed.box, session.frame) : trackerFromKeyframe(seed.keyframe, session.frame);

  const out: TrackKeyframe[] = [];
  if (isGridTime(t0, duration)) {
    if ("box" in seed) {
      const { auto: _, ...picked } = toKeyframe(t0, newTracker(), false);
      out.push(picked);
    } else {
      out.push({ ...seed.keyframe, timestamp: t0 });
    }
  }

  const until = mode === "followUp" ? convergesWith(existing) : undefined;
  out.push(...(await trackPass(newTracker(), forward, duration, manual, detect, onSample, signal, until)));
  const earlier = await trackPass(newTracker(), backward, duration, manual, detect, onSample, signal);
  // The backward pass ends on the nearest step already tracked, which stays as it is.
  out.push(...earlier.filter((k) => !trackedBefore.some((t) => Math.abs(t - k.timestamp) < 1e-6)));

  return { keyframes: out, from: Math.min(t0, ...out.map((k) => k.timestamp)) };
}
