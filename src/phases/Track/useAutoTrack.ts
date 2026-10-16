import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pickTarget, type Rect } from "../../lib/autoTrack";
import { openSession, runAutoTrack, type AutoTrackSeed, type AutoTrackSession } from "../../lib/autoTrackRunner";
import { mergeAutoKeyframes } from "../../lib/keyframes";
import { useAppDispatch, useAppState } from "../../state/AppStateContext";
import type { TrackKeyframe } from "../../state/types";
import type { useTrackController } from "./useTrackController";

export type AutoTrackStatus =
  | { phase: "idle" }
  | { phase: "loading" }
  | {
      phase: "picking";
      t0: number;
      boxes: Rect[];
      flash: number;
      /** Picking at an unsure step after a run: only the steps from here on get retracked. */
      followUp: boolean;
      /** A nearby keyframe to size and side an off-screen pick by; null when there's none. */
      offscreenRef: TrackKeyframe | null;
    }
  | { phase: "running"; progress: number }
  | { phase: "error" };

/** Side of the square re-searched around a tap that missed everyone, relative to the frame's short side. */
const TAP_SEARCH_FRACTION = 0.6;
const OFFSCREEN_CENTER_X = 0.05;

interface Chain {
  abort: AbortController;
  session: AutoTrackSession | null;
  /** Whether a detection or run is in flight; the session mustn't be closed under it. */
  busy: boolean;
}

function nearestKeyframe(keyframes: TrackKeyframe[], t: number): TrackKeyframe | null {
  return keyframes
    .filter((k) => Math.abs(k.timestamp - t) > 1e-6)
    .reduce<TrackKeyframe | null>(
      (best, k) => (best === null || Math.abs(k.timestamp - t) < Math.abs(best.timestamp - t) ? k : best),
      null,
    );
}

function nextLowAfter(keyframes: TrackKeyframe[], t: number): TrackKeyframe | undefined {
  return keyframes.find((k) => k.auto === "low" && k.timestamp > t + 1e-6);
}

/**
 * Drives auto-tracking: load the detector, show who's in the current frame and
 * track whoever gets tapped. After each run it moves to the next unsure step
 * and asks again, retracking only from there on, until none are left. Every
 * pick becomes a hand-set keyframe. Cancelling (or the app going to the
 * background) keeps whatever earlier runs already produced.
 */
export function useAutoTrack(controller: ReturnType<typeof useTrackController>) {
  const { project, keyframes } = useAppState();
  const dispatch = useAppDispatch();
  const [status, setStatus] = useState<AutoTrackStatus>({ phase: "idle" });

  const chainRef = useRef<Chain | null>(null);
  // Read from async continuations, which would otherwise see the render they started in.
  const keyframesRef = useRef(keyframes);
  const controllerRef = useRef(controller);

  function closeChain(chain: Chain) {
    chain.session?.close();
    chain.session = null;
  }

  async function inFlight<T>(chain: Chain, work: () => Promise<T>): Promise<T> {
    chain.busy = true;
    try {
      return await work();
    } finally {
      chain.busy = false;
      if (chain.abort.signal.aborted) closeChain(chain);
    }
  }

  function finish(chain: Chain) {
    if (chainRef.current === chain) chainRef.current = null;
    closeChain(chain);
    setStatus({ phase: "idle" });
  }

  function fail(chain: Chain, e: unknown) {
    if (chain.abort.signal.aborted) return;
    console.error("auto-track failed", e);
    if (chainRef.current === chain) chainRef.current = null;
    closeChain(chain);
    setStatus({ phase: "error" });
  }

  function cancel() {
    const chain = chainRef.current;
    chainRef.current = null;
    if (chain) {
      chain.abort.abort();
      if (!chain.busy) closeChain(chain);
    }
    setStatus({ phase: "idle" });
  }

  async function showPicking(chain: Chain, t0: number, followUp: boolean) {
    const session = chain.session!;
    const boxes = (await inFlight(chain, () => session.detect(session.wholeFrame, t0))) ?? [];
    if (chain.abort.signal.aborted) return;
    const offscreenRef = nearestKeyframe(keyframesRef.current, t0);
    setStatus({ phase: "picking", t0, boxes, flash: 0, followUp, offscreenRef });
  }

  async function start() {
    if (!project || chainRef.current) return;
    controller.cancelPendingCommit();
    const chain: Chain = { abort: new AbortController(), session: null, busy: false };
    chainRef.current = chain;
    setStatus({ phase: "loading" });
    try {
      await inFlight(chain, async () => {
        chain.session = await openSession(project);
      });
      if (chain.abort.signal.aborted) return;
      await showPicking(chain, controllerRef.current.cursor, false);
    } catch (e) {
      fail(chain, e);
    }
  }

  async function run(chain: Chain, seed: AutoTrackSeed, t0: number, followUp: boolean) {
    if (!project) return;
    setStatus({ phase: "running", progress: 0 });
    let lastPercent = 0;
    const session = chain.session!;
    const result = await inFlight(chain, () =>
      runAutoTrack(session, seed, t0, project.durationSec, keyframesRef.current, followUp, chain.abort.signal, (p) => {
        const percent = Math.floor(p * 100);
        if (percent === lastPercent || chain.abort.signal.aborted) return;
        lastPercent = percent;
        setStatus({ phase: "running", progress: p });
      }),
    );
    const merged = mergeAutoKeyframes(keyframesRef.current, result);
    dispatch({ type: "MERGE_AUTO_KEYFRAMES", keyframes: result });
    // A first run also tracks backwards, so its unsure steps can come before the pick.
    const next = followUp ? nextLowAfter(merged, t0) : merged.find((k) => k.auto === "low");
    await moveOn(chain, next, merged, t0);
  }

  async function moveOn(chain: Chain, next: TrackKeyframe | undefined, source: TrackKeyframe[], from: number) {
    if (!next) {
      controllerRef.current.jumpTo(from, source);
      finish(chain);
      return;
    }
    controllerRef.current.jumpTo(next.timestamp, source);
    await showPicking(chain, next.timestamp, true);
  }

  async function pick(x: number, y: number) {
    const chain = chainRef.current;
    if (status.phase !== "picking" || !chain?.session || chain.busy) return;
    const session = chain.session;
    const { t0, followUp } = status;
    const tap = { x, y };
    try {
      let target: Rect | null = pickTarget(status.boxes, tap, session.frame);
      if (!target) {
        const side = Math.min(session.frame.w, session.frame.h) * TAP_SEARCH_FRACTION;
        const region = { x: x - side / 2, y: y - side / 2, w: side, h: side };
        const near = (await inFlight(chain, () => session.detect(region, t0))) ?? [];
        if (chain.abort.signal.aborted) return;
        target = pickTarget(near, tap, session.frame);
      }
      if (!target) {
        setStatus((s) => (s.phase === "picking" ? { ...s, flash: s.flash + 1 } : s));
        return;
      }
      await run(chain, { box: target }, t0, followUp);
    } catch (e) {
      fail(chain, e);
    }
  }

  /** The player isn't in this frame: track on from here, waiting for them to come back in. */
  async function pickOffscreen() {
    const chain = chainRef.current;
    if (status.phase !== "picking" || !status.offscreenRef || !chain?.session || chain.busy) return;
    const { t0, followUp, offscreenRef: ref } = status;
    const keyframe: TrackKeyframe = {
      timestamp: t0,
      headY: ref.headY,
      feetY: ref.feetY,
      centerX: ref.centerX < 0.5 ? -OFFSCREEN_CENTER_X : 1 + OFFSCREEN_CENTER_X,
      offscreen: true,
    };
    try {
      await run(chain, { keyframe }, t0, followUp);
    } catch (e) {
      fail(chain, e);
    }
  }

  /** Leaves this unsure step as it is and moves on to the next one. */
  async function skip() {
    const chain = chainRef.current;
    if (status.phase !== "picking" || !status.followUp || !chain?.session || chain.busy) return;
    try {
      await moveOn(chain, nextLowAfter(keyframesRef.current, status.t0), keyframesRef.current, status.t0);
    } catch (e) {
      fail(chain, e);
    }
  }

  const cancelRef = useRef(cancel);
  useLayoutEffect(() => {
    keyframesRef.current = keyframes;
    controllerRef.current = controller;
    cancelRef.current = cancel;
  });

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && chainRef.current) cancelRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      const chain = chainRef.current;
      chainRef.current = null;
      if (chain) {
        chain.abort.abort();
        if (!chain.busy) closeChain(chain);
      }
    };
  }, []);

  const busy = status.phase === "loading" || status.phase === "picking" || status.phase === "running";
  return { status, busy, start, pick, pickOffscreen, skip, cancel };
}
