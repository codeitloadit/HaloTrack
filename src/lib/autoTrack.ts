import { clampIndicator } from "./geometry";
import { STEP_SECONDS, TRACK_END_EPSILON, type TrackKeyframe } from "../state/types";

/** Detections are sampled twice per tracking step to keep the player's identity stable. */
export const SAMPLE_SECONDS = STEP_SECONDS / 2;

/** A rectangle in video pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Detection extends Rect {
  score: number;
}

export interface FrameSize {
  w: number;
  h: number;
}

type Side = "left" | "right";

/** What the tracker concluded about one sampled frame. */
export type Observation =
  | { kind: "match"; rect: Rect; low: boolean }
  | { kind: "offscreen"; side: Side }
  | { kind: "lost"; rect: Rect };

export interface Tracker {
  frame: FrameSize;
  rect: Rect;
  /** Centre velocity in pixels per second of video time. */
  vx: number;
  vy: number;
  misses: number;
  offscreen: Side | null;
}

// Association gates and weights. Distances are in multiples of the predicted
// box height, so they scale with how large the player appears.
const GATE_DISTANCE = 0.6;
const GATE_RATIO_MIN = 0.67;
const GATE_RATIO_MAX = 1.5;
const RELAXED_DISTANCE = 2;
const RELAXED_RATIO_MIN = 0.6;
const RELAXED_RATIO_MAX = 1.6;
const AMBIGUITY_MARGIN = 0.15;
const LOW_SCORE = 0.4;
const HEIGHT_JUMP = 0.25;
const VELOCITY_SMOOTHING = 0.5;
/** Consecutive missed samples (1s) before searching the whole frame. */
const MISSES_BEFORE_FULL_SEARCH = 4;
const EDGE_MARGIN = 0.03;
const REENTRY_EDGE = 0.05;
const OFFSCREEN_CENTER_X = 0.05;

export function centre(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function iou(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Sample times from `from` towards `to` (either direction), including both ends. */
export function sampleTimes(from: number, to: number): number[] {
  const dir = to >= from ? 1 : -1;
  const times: number[] = [];
  for (let i = 0; ; i++) {
    const t = from + dir * i * SAMPLE_SECONDS;
    if ((dir > 0 && t >= to - TRACK_END_EPSILON) || (dir < 0 && t <= to + TRACK_END_EPSILON)) break;
    times.push(t);
  }
  times.push(to);
  return times;
}

export function isGridTime(t: number, duration: number): boolean {
  if (Math.abs(t - duration) < TRACK_END_EPSILON) return true;
  const steps = t / STEP_SECONDS;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/**
 * The box the user tapped: one containing the tap (padded by 5% of its height,
 * nearest centre wins), otherwise the nearest centre within 0.1 of frame height.
 */
export function pickTarget<T extends Rect>(boxes: T[], tap: { x: number; y: number }, frame: FrameSize): T | null {
  const dist = (b: Rect) => Math.hypot(centre(b).x - tap.x, centre(b).y - tap.y);
  const containing = boxes.filter((b) => {
    const pad = b.h * 0.05;
    return tap.x >= b.x - pad && tap.x <= b.x + b.w + pad && tap.y >= b.y - pad && tap.y <= b.y + b.h + pad;
  });
  const pool = containing.length > 0 ? containing : boxes.filter((b) => dist(b) <= frame.h * 0.1);
  return pool.reduce<T | null>((best, b) => (best === null || dist(b) < dist(best) ? b : best), null);
}

export function createTracker(seed: Rect, frame: FrameSize, offscreen: Side | null = null): Tracker {
  return { frame, rect: seed, vx: 0, vy: 0, misses: 0, offscreen };
}

export function predict(tracker: Tracker, dt: number): Rect {
  const { rect } = tracker;
  return { ...rect, x: rect.x + tracker.vx * dt, y: rect.y + tracker.vy * dt };
}

/**
 * The area to run detection on next: a square around the predicted position
 * three times the player's height (tighter crops help find small players), or
 * the whole frame when the player is off-screen or has been missing a while.
 */
export function searchRegion(tracker: Tracker, dt: number): Rect {
  const { frame } = tracker;
  const full = Math.max(frame.w, frame.h);
  const wholeFrame = { x: (frame.w - full) / 2, y: (frame.h - full) / 2, w: full, h: full };
  if (tracker.offscreen || tracker.misses >= MISSES_BEFORE_FULL_SEARCH) return wholeFrame;
  const p = predict(tracker, dt);
  const side = p.h * 3;
  if (side >= full) return wholeFrame;
  const c = centre(p);
  return { x: c.x - side / 2, y: c.y - side / 2, w: side, h: side };
}

/** Decides what a sampled frame's detections mean for the tracked player. */
export function associate(tracker: Tracker, dets: Detection[], dt: number): Observation {
  const { frame } = tracker;
  const pred = predict(tracker, dt);

  if (tracker.offscreen) {
    // Wait for the player to come back in from the edge they left by.
    const side = tracker.offscreen;
    const reentering = dets.filter((d) => {
      const ratio = d.h / tracker.rect.h;
      const atEdge = side === "left" ? d.x <= frame.w * REENTRY_EDGE : d.x + d.w >= frame.w * (1 - REENTRY_EDGE);
      return atEdge && ratio >= 0.5 && ratio <= 2;
    });
    if (reentering.length === 0) return { kind: "offscreen", side };
    const best = reentering.reduce((a, b) =>
      Math.abs(centre(a).y - centre(pred).y) <= Math.abs(centre(b).y - centre(pred).y) ? a : b,
    );
    return { kind: "match", rect: best, low: true };
  }

  const relaxed = tracker.misses >= MISSES_BEFORE_FULL_SEARCH;
  const maxDist = relaxed ? RELAXED_DISTANCE : GATE_DISTANCE;
  const [minRatio, maxRatio] = relaxed ? [RELAXED_RATIO_MIN, RELAXED_RATIO_MAX] : [GATE_RATIO_MIN, GATE_RATIO_MAX];

  const candidates = dets
    .map((d) => {
      const dist = Math.hypot(centre(d).x - centre(pred).x, centre(d).y - centre(pred).y) / pred.h;
      const ratio = d.h / pred.h;
      return { d, dist, ratio, cost: 1 - iou(d, pred) + 0.5 * dist + 0.5 * Math.abs(Math.log(ratio)) };
    })
    .filter((c) => c.dist < maxDist && c.ratio >= minRatio && c.ratio <= maxRatio)
    .sort((a, b) => a.cost - b.cost);

  if (candidates.length === 0) {
    const nearLeft = tracker.rect.x <= frame.w * EDGE_MARGIN || centre(pred).x < 0;
    const nearRight = tracker.rect.x + tracker.rect.w >= frame.w * (1 - EDGE_MARGIN) || centre(pred).x > frame.w;
    if (nearLeft || nearRight) return { kind: "offscreen", side: nearLeft ? "left" : "right" };
    return { kind: "lost", rect: pred };
  }

  const best = candidates[0];
  const ambiguous = candidates.length > 1 && candidates[1].cost - best.cost < AMBIGUITY_MARGIN;
  const heightJump = Math.abs(best.d.h / tracker.rect.h - 1) > HEIGHT_JUMP;
  const low = ambiguous || best.d.score < LOW_SCORE || heightJump || relaxed;
  return { kind: "match", rect: best.d, low };
}

/** Moves the tracker on by one sample given what was observed. */
export function update(tracker: Tracker, obs: Observation, dt: number): void {
  if (obs.kind === "match") {
    if (dt !== 0 && !tracker.offscreen) {
      const before = centre(tracker.rect);
      const after = centre(obs.rect);
      tracker.vx = VELOCITY_SMOOTHING * tracker.vx + (1 - VELOCITY_SMOOTHING) * ((after.x - before.x) / dt);
      tracker.vy = VELOCITY_SMOOTHING * tracker.vy + (1 - VELOCITY_SMOOTHING) * ((after.y - before.y) / dt);
    } else {
      tracker.vx = 0;
      tracker.vy = 0;
    }
    tracker.rect = obs.rect;
    tracker.misses = 0;
    tracker.offscreen = null;
  } else if (obs.kind === "lost") {
    tracker.rect = obs.rect;
    tracker.vx *= 0.5;
    tracker.vy *= 0.5;
    tracker.misses += 1;
  } else {
    tracker.offscreen = obs.side;
    tracker.vx = 0;
    tracker.vy = 0;
  }
}

/** A keyframe for a tracked frame. Off-screen keeps the last head/feet height. */
export function toKeyframe(t: number, tracker: Tracker, low: boolean): TrackKeyframe {
  const { rect, frame } = tracker;
  const headY = rect.y / frame.h;
  const feetY = (rect.y + rect.h) / frame.h;
  if (tracker.offscreen) {
    const centerX = tracker.offscreen === "left" ? -OFFSCREEN_CENTER_X : 1 + OFFSCREEN_CENTER_X;
    return { timestamp: t, ...clampIndicator({ headY, feetY, centerX }), offscreen: true, auto: low ? "low" : "ok" };
  }
  const centerX = (rect.x + rect.w / 2) / frame.w;
  return { timestamp: t, ...clampIndicator({ headY, feetY, centerX }), offscreen: false, auto: low ? "low" : "ok" };
}

/** Re-seeds the tracker from a keyframe set by hand, keeping the box's width/height ratio. */
export function reseedFromKeyframe(tracker: Tracker, k: TrackKeyframe): void {
  const { frame } = tracker;
  const aspect = tracker.rect.w / tracker.rect.h;
  const h = (k.feetY - k.headY) * frame.h;
  const w = h * aspect;
  tracker.rect = { x: k.centerX * frame.w - w / 2, y: k.headY * frame.h, w, h };
  tracker.vx = 0;
  tracker.vy = 0;
  tracker.misses = 0;
  tracker.offscreen = k.offscreen ? (k.centerX < 0.5 ? "left" : "right") : null;
}

/**
 * Tracks through `times` (in order, starting at the seed's frame), calling
 * `detect` for each sample's search region. Emits a keyframe at each tracking
 * step, skipping steps that already have a keyframe set by hand (which instead
 * re-seed the tracker). A step is low confidence if its own sample, or any
 * sample since the previous step, was uncertain or missed.
 */
export async function trackPass(
  tracker: Tracker,
  times: number[],
  duration: number,
  manual: Map<number, TrackKeyframe>,
  detect: (region: Rect, t: number) => Promise<Detection[] | null>,
  onSample: () => void,
  signal: AbortSignal,
): Promise<TrackKeyframe[]> {
  const out: TrackKeyframe[] = [];
  let lowSinceStep = false;
  for (let i = 1; i < times.length; i++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const t = times[i];
    const dt = t - times[i - 1];
    const anchor = isGridTime(t, duration) ? findAt(manual, t) : undefined;
    if (anchor) {
      reseedFromKeyframe(tracker, anchor);
      lowSinceStep = false;
      onSample();
      continue;
    }
    const dets = await detect(searchRegion(tracker, dt), t);
    const obs: Observation = dets === null ? { kind: "lost", rect: predict(tracker, dt) } : associate(tracker, dets, dt);
    update(tracker, obs, dt);
    lowSinceStep ||= obs.kind === "lost" || (obs.kind === "match" && obs.low);
    if (isGridTime(t, duration)) {
      out.push(toKeyframe(t, tracker, lowSinceStep));
      lowSinceStep = false;
    }
    onSample();
  }
  return out;
}

function findAt(manual: Map<number, TrackKeyframe>, t: number): TrackKeyframe | undefined {
  for (const [time, k] of manual) if (Math.abs(time - t) < 1e-6) return k;
  return undefined;
}
