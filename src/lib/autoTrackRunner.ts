import {
  associate,
  centre,
  convergesWith,
  createTracker,
  isGridTime,
  sampleTimes,
  searchRegion,
  toKeyframe,
  trackPass,
  trackerFromKeyframe,
  type Detection,
  type FrameSize,
  type Rect,
} from "./autoTrack";
import { clampIndicator } from "./geometry";
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

  // Every caller shares the one video, so detections (and closing) take turns.
  let queue: Promise<unknown> = Promise.resolve();
  function inTurn<T>(work: () => Promise<T> | T): Promise<T> {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }

  let closed = false;
  async function detect(region: Rect, t: number): Promise<Detection[] | null> {
    if (closed || !(await readFrame(t))) return null;
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
  }

  return {
    frame,
    wholeFrame: { x: (frame.w - full) / 2, y: (frame.h - full) / 2, w: full, h: full },
    detect: (region, t) => inTurn(() => detect(region, t)),
    close() {
      void inTurn(() => {
        closed = true;
        det.close();
        video.removeAttribute("src");
        video.load();
        video.remove();
      });
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

/** The detections from the last frame a guess looked at, reusable by the next guess. */
export interface FrameDetections {
  t: number;
  detections: Detection[];
}

export interface StepGuess {
  keyframe: TrackKeyframe | null;
  lastFrame: FrameDetections | null;
}

/**
 * Guesses where the indicator goes at step `t`, given the user's keyframe for
 * the step before it (and the one before that, for the player's speed).
 * Follows the player across the frames in between, then places the indicator
 * relative to the player's box the same way the user placed it on `prev`, so
 * the guess keeps their style (how far above the head, below the feet).
 */
export async function guessStep(
  session: AutoTrackSession,
  prev: TrackKeyframe,
  beforePrev: TrackKeyframe | undefined,
  t: number,
  duration: number,
  prevFrame: FrameDetections | null,
  signal: AbortSignal,
): Promise<StepGuess> {
  const { frame } = session;
  const tracker = trackerFromKeyframe(prev, frame);
  let style: { head: number; feet: number; x: number } | null = null;

  if (!prev.offscreen) {
    const atPrev =
      prevFrame && Math.abs(prevFrame.t - prev.timestamp) < 1e-6
        ? prevFrame.detections
        : await session.detect(searchRegion(tracker, 0), prev.timestamp);
    const obs = atPrev ? associate(tracker, atPrev, 0) : null;
    if (obs?.kind === "match") {
      const box = obs.rect;
      style = {
        head: (prev.headY * frame.h - box.y) / box.h,
        feet: (prev.feetY * frame.h - (box.y + box.h)) / box.h,
        x: (prev.centerX * frame.w - centre(box).x) / box.h,
      };
      tracker.rect = box;
    }
    if (beforePrev && !beforePrev.offscreen) {
      const dt = prev.timestamp - beforePrev.timestamp;
      tracker.vx = ((prev.centerX - beforePrev.centerX) * frame.w) / dt;
      tracker.vy = (((prev.headY + prev.feetY) / 2 - (beforePrev.headY + beforePrev.feetY) / 2) * frame.h) / dt;
    }
  }

  let lastFrame: FrameDetections | null = null;
  const detect = async (region: Rect, at: number) => {
    const detections = await session.detect(region, at);
    lastFrame = detections ? { t: at, detections } : null;
    return detections;
  };
  const out = await trackPass(tracker, sampleTimes(prev.timestamp, t), duration, new Map(), detect, () => {}, signal);
  const guess = out[out.length - 1];
  if (!guess || guess.offscreen || !style) return { keyframe: guess ?? null, lastFrame };

  const r = tracker.rect;
  const placed = clampIndicator({
    headY: (r.y + style.head * r.h) / frame.h,
    feetY: (r.y + r.h + style.feet * r.h) / frame.h,
    centerX: (centre(r).x + style.x * r.h) / frame.w,
  });
  return { keyframe: { ...guess, ...placed }, lastFrame };
}
