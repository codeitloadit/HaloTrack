import { STEP_SECONDS, TRACK_END_EPSILON, type TrackKeyframe } from "../state/types";

export interface Bracket {
  k0: TrackKeyframe;
  k1: TrackKeyframe;
  frac: number;
}

export function bracket(keyframes: TrackKeyframe[], t: number): Bracket {
  if (keyframes.length === 0) {
    throw new Error("bracket() requires at least one keyframe");
  }
  if (keyframes.length === 1) {
    return { k0: keyframes[0], k1: keyframes[0], frac: 0 };
  }
  if (t <= keyframes[0].timestamp) {
    return { k0: keyframes[0], k1: keyframes[0], frac: 0 };
  }
  const last = keyframes[keyframes.length - 1];
  if (t >= last.timestamp) {
    return { k0: last, k1: last, frac: 0 };
  }
  for (let i = 0; i < keyframes.length - 1; i++) {
    const k0 = keyframes[i];
    const k1 = keyframes[i + 1];
    if (t >= k0.timestamp && t <= k1.timestamp) {
      const span = k1.timestamp - k0.timestamp;
      const frac = span === 0 ? 0 : (t - k0.timestamp) / span;
      return { k0, k1, frac };
    }
  }
  return { k0: last, k1: last, frac: 0 };
}

function lerp(a: number, b: number, frac: number): number {
  return a + (b - a) * frac;
}

export interface InterpolatedIndicator {
  headY: number;
  feetY: number;
  centerX: number;
}

export function interpolateIndicator(keyframes: TrackKeyframe[], t: number): InterpolatedIndicator {
  const { k0, k1, frac } = bracket(keyframes, t);
  return {
    headY: lerp(k0.headY, k1.headY, frac),
    feetY: lerp(k0.feetY, k1.feetY, frac),
    centerX: lerp(k0.centerX, k1.centerX, frac),
  };
}

export function findNearestKeyframe(keyframes: TrackKeyframe[], t: number): TrackKeyframe | null {
  if (keyframes.length === 0) return null;
  let nearest = keyframes[0];
  let bestDist = Math.abs(nearest.timestamp - t);
  for (const k of keyframes) {
    const dist = Math.abs(k.timestamp - t);
    if (dist < bestDist) {
      nearest = k;
      bestDist = dist;
    }
  }
  return nearest;
}

const SAME_TIME_EPSILON = 1e-6;

/**
 * Merges an auto-tracking run into existing keyframes: fills empty steps and
 * replaces earlier auto keyframes, but never overwrites a keyframe set by hand.
 * The run's own hand-set keyframe (the player the user just picked) is the
 * exception, and replaces whatever was there.
 */
export function mergeAutoKeyframes(existing: TrackKeyframe[], incoming: TrackKeyframe[]): TrackKeyframe[] {
  const result = [...existing];
  for (const k of incoming) {
    const i = result.findIndex((e) => Math.abs(e.timestamp - k.timestamp) < SAME_TIME_EPSILON);
    if (i === -1) result.push(k);
    else if (result[i].auto || !k.auto) result[i] = k;
  }
  return result.sort((a, b) => a.timestamp - b.timestamp);
}

/** The tracking steps, matching those the Track phase creates by hand. */
export function gridTimes(duration: number): number[] {
  const times: number[] = [];
  for (let i = 0; i * STEP_SECONDS < duration - TRACK_END_EPSILON; i++) times.push(i * STEP_SECONDS);
  times.push(duration);
  return times;
}
