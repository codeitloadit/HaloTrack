import { useRef, useState } from "react";
import type { RefObject } from "react";
import { clamp } from "../../lib/geometry";
import { seekTo } from "../../lib/video";
import { useAppDispatch, useAppState } from "../../state/AppStateContext";
import { MIN_INDICATOR_HEIGHT, STEP_SECONDS, TRACK_END_EPSILON, type TrackKeyframe } from "../../state/types";

const COMMIT_DEBOUNCE_MS = 400;

export interface IndicatorState {
  headY: number;
  feetY: number;
  centerX: number;
}

function defaultIndicator(): IndicatorState {
  return { headY: 0.2, feetY: 0.8, centerX: 0.5 };
}

function isOffscreen(centerX: number): boolean {
  return centerX < 0 || centerX > 1;
}

export function useTrackController(videoRef: RefObject<HTMLVideoElement | null>) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { project, keyframes, trackCursor } = state;

  const [indicator, setIndicator] = useState<IndicatorState>(() => {
    const existing = keyframes.find((k) => Math.abs(k.timestamp - trackCursor) < 1e-6);
    if (existing) return { headY: existing.headY, feetY: existing.feetY, centerX: existing.centerX };
    const prior = [...keyframes].reverse().find((k) => k.timestamp < trackCursor);
    return prior ? { headY: prior.headY, feetY: prior.feetY, centerX: prior.centerX } : defaultIndicator();
  });

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [complete, setComplete] = useState(false);

  function seekAndLoad(timestamp: number) {
    if (videoRef.current) void seekTo(videoRef.current, timestamp);
    const existing = keyframes.find((k) => Math.abs(k.timestamp - timestamp) < 1e-6);
    if (existing) {
      setIndicator({ headY: existing.headY, feetY: existing.feetY, centerX: existing.centerX });
      return;
    }
    const prior = [...keyframes].reverse().find((k) => k.timestamp < timestamp);
    setIndicator(prior ? { headY: prior.headY, feetY: prior.feetY, centerX: prior.centerX } : defaultIndicator());
  }

  // No mount-time seek here: VideoStage seeks to this same `trackCursor` itself via
  // its `initialTime` prop, as part of its own first-frame-decode sequence — seeking
  // again here concurrently would race with that.

  function clampIndicator(next: IndicatorState): IndicatorState {
    let headY = clamp(next.headY, -0.5, 1.5);
    let feetY = clamp(next.feetY, -0.5, 1.5);
    const centerX = clamp(next.centerX, -0.5, 1.5);
    if (feetY - headY < MIN_INDICATOR_HEIGHT) {
      const mid = (headY + feetY) / 2;
      headY = mid - MIN_INDICATOR_HEIGHT / 2;
      feetY = mid + MIN_INDICATOR_HEIGHT / 2;
    }
    return { headY, feetY, centerX };
  }

  function applyPinch(deltaDy: number, deltaMidX: number, deltaMidY: number, boxWidth: number, boxHeight: number) {
    setIndicator((prev) => {
      const heightDeltaNorm = deltaDy / boxHeight;
      const panXNorm = deltaMidX / boxWidth;
      const panYNorm = deltaMidY / boxHeight;
      return clampIndicator({
        headY: prev.headY - heightDeltaNorm / 2 + panYNorm,
        feetY: prev.feetY + heightDeltaNorm / 2 + panYNorm,
        centerX: prev.centerX + panXNorm,
      });
    });
    resetDebounce();
  }

  function applyPan(dx: number, dy: number, boxWidth: number, boxHeight: number) {
    setIndicator((prev) =>
      clampIndicator({
        headY: prev.headY + dy / boxHeight,
        feetY: prev.feetY + dy / boxHeight,
        centerX: prev.centerX + dx / boxWidth,
      }),
    );
    resetDebounce();
  }

  function resetDebounce() {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  }

  function scheduleCommit() {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => commit(), COMMIT_DEBOUNCE_MS);
  }

  function commit() {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    const keyframe: TrackKeyframe = {
      timestamp: trackCursor,
      headY: indicator.headY,
      feetY: indicator.feetY,
      centerX: indicator.centerX,
      offscreen: isOffscreen(indicator.centerX),
    };
    dispatch({ type: "UPSERT_KEYFRAME", keyframe });

    if (!project) return;
    if (trackCursor >= project.durationSec - TRACK_END_EPSILON) {
      setComplete(true);
      return;
    }
    const nextCursor = Math.min(trackCursor + STEP_SECONDS, project.durationSec);
    dispatch({ type: "SET_TRACK_CURSOR", timestamp: nextCursor });
    if (videoRef.current) void seekTo(videoRef.current, nextCursor);
    // Seed the next frame's indicator from the keyframe just committed, not from
    // `keyframes` — that's a stale closure over the pre-dispatch state, so right
    // after the very first commit it would still be empty and fall through to the
    // hardcoded default instead of carrying the position/size forward.
    const existingAtNext = keyframes.find((k) => Math.abs(k.timestamp - nextCursor) < 1e-6);
    setIndicator(
      existingAtNext
        ? { headY: existingAtNext.headY, feetY: existingAtNext.feetY, centerX: existingAtNext.centerX }
        : { headY: keyframe.headY, feetY: keyframe.feetY, centerX: keyframe.centerX },
    );
  }

  function jumpTo(timestamp: number) {
    resetDebounce();
    dispatch({ type: "SET_TRACK_CURSOR", timestamp });
    seekAndLoad(timestamp);
    setComplete(false);
  }

  function stepBy(deltaSeconds: number) {
    if (!project) return;
    jumpTo(clamp(trackCursor + deltaSeconds, 0, project.durationSec));
  }

  const duration = project?.durationSec ?? 0;

  return {
    indicator,
    offscreen: isOffscreen(indicator.centerX),
    cursor: trackCursor,
    duration,
    complete,
    applyPinch,
    applyPan,
    scheduleCommit,
    commitNow: commit,
    jumpTo,
    stepPrev: () => stepBy(-STEP_SECONDS),
    stepNext: () => stepBy(STEP_SECONDS),
    canStepPrev: trackCursor > 0,
    canStepNext: trackCursor < duration - TRACK_END_EPSILON,
  };
}
