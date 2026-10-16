import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { guessStep, type AutoTrackSession, type FrameDetections } from "../../lib/autoTrackRunner";
import { useAppState } from "../../state/AppStateContext";
import { STEP_SECONDS, type TrackKeyframe } from "../../state/types";
import type { useTrackController } from "./useTrackController";

const EPSILON = 1e-6;

function stepBefore(keyframes: TrackKeyframe[], t: number): TrackKeyframe | undefined {
  const k = [...keyframes].reverse().find((x) => x.timestamp < t - EPSILON);
  return k && t - k.timestamp <= STEP_SECONDS + EPSILON ? k : undefined;
}

/**
 * On arriving at an untracked step right after a tracked one, moves the
 * indicator to where the detector thinks the player went, for the user to
 * accept or adjust. Moving the indicator by hand first wins over the guess.
 */
export function useStepGuess(
  controller: ReturnType<typeof useTrackController>,
  acquireSession: () => Promise<AutoTrackSession>,
  enabled: boolean,
) {
  const { project, keyframes } = useAppState();
  // Which request the last guess finished for (whether or not it found the player).
  const [settled, setSettled] = useState<string | null>(null);
  const lastFrameRef = useRef<FrameDetections | null>(null);
  const controllerRef = useRef(controller);
  useLayoutEffect(() => {
    controllerRef.current = controller;
  });

  const t = controller.cursor;
  const tracked = keyframes.some((k) => Math.abs(k.timestamp - t) < EPSILON);
  const prev = stepBefore(keyframes, t);
  const beforePrev = prev && stepBefore(keyframes, prev.timestamp);
  const wanted = enabled && !!project && !tracked && !controller.touched && prev !== undefined;
  const request = prev ? `${t}|${prev.headY}|${prev.feetY}|${prev.centerX}` : null;

  // Opening the detector takes a moment, so start on it before the first guess is needed.
  useEffect(() => {
    if (enabled) acquireSession().catch(() => {});
  }, [enabled, acquireSession]);

  useEffect(() => {
    if (!wanted || !project || !prev) return;
    const abort = new AbortController();
    (async () => {
      try {
        const session = await acquireSession();
        if (abort.signal.aborted) return;
        const guess = await guessStep(session, prev, beforePrev, t, project.durationSec, lastFrameRef.current, abort.signal);
        lastFrameRef.current = guess.lastFrame;
        if (!abort.signal.aborted && guess.keyframe) controllerRef.current.showGuess(guess.keyframe);
      } catch (e) {
        if (!abort.signal.aborted) console.error("step guess failed", e);
      } finally {
        if (!abort.signal.aborted) setSettled(request);
      }
    })();
    return () => abort.abort();
  }, [wanted, t, prev, beforePrev, project, acquireSession, request]);

  return { guessing: wanted && settled !== request };
}
