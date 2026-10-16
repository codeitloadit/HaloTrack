import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pickTarget, type Rect } from "../../lib/autoTrack";
import { openSession, runAutoTrack, type AutoTrackSession } from "../../lib/autoTrackRunner";
import { mergeAutoKeyframes } from "../../lib/keyframes";
import { useAppDispatch, useAppState } from "../../state/AppStateContext";
import type { useTrackController } from "./useTrackController";

export type AutoTrackStatus =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "picking"; boxes: Rect[]; flash: number }
  | { phase: "running"; progress: number }
  | { phase: "error" };

/** Side of the square re-searched around a tap that missed everyone, relative to the frame's short side. */
const TAP_SEARCH_FRACTION = 0.6;

/**
 * Drives one auto-tracking run: load the detector, show who's in the current
 * frame, track whoever gets tapped, then merge the result and jump to the first
 * step worth checking. Cancelling (or the app going to the background) leaves
 * the keyframes untouched.
 */
export function useAutoTrack(controller: ReturnType<typeof useTrackController>) {
  const { project, keyframes } = useAppState();
  const dispatch = useAppDispatch();
  const [status, setStatus] = useState<AutoTrackStatus>({ phase: "idle" });

  const sessionRef = useRef<AutoTrackSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pickTimeRef = useRef(0);
  const pickingBusyRef = useRef(false);
  // Read from async continuations, which would otherwise see the render they started in.
  const keyframesRef = useRef(keyframes);
  const controllerRef = useRef(controller);

  function closeSession() {
    sessionRef.current?.close();
    sessionRef.current = null;
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    // A tap's crop search may still be using the session; it closes it once it sees the abort.
    if (!pickingBusyRef.current) closeSession();
    setStatus({ phase: "idle" });
  }

  async function start() {
    if (!project) return;
    controller.cancelPendingCommit();
    const abort = new AbortController();
    abortRef.current = abort;
    setStatus({ phase: "loading" });
    let session: AutoTrackSession | null = null;
    try {
      session = await openSession(project);
      if (abort.signal.aborted) return session.close();
      const t0 = controllerRef.current.cursor;
      const boxes = (await session.detect(session.wholeFrame, t0)) ?? [];
      if (abort.signal.aborted) return session.close();
      sessionRef.current = session;
      pickTimeRef.current = t0;
      setStatus({ phase: "picking", boxes, flash: 0 });
    } catch (e) {
      console.error("auto-track failed to start", e);
      session?.close();
      if (!abort.signal.aborted) setStatus({ phase: "error" });
    }
  }

  async function pick(x: number, y: number) {
    const session = sessionRef.current;
    const abort = abortRef.current;
    if (status.phase !== "picking" || !session || !abort || !project || pickingBusyRef.current) return;
    const t0 = pickTimeRef.current;
    const tap = { x, y };

    pickingBusyRef.current = true;
    let target: Rect | null = pickTarget(status.boxes, tap, session.frame);
    try {
      if (!target) {
        const side = Math.min(session.frame.w, session.frame.h) * TAP_SEARCH_FRACTION;
        const near = (await session.detect({ x: x - side / 2, y: y - side / 2, w: side, h: side }, t0)) ?? [];
        target = pickTarget(near, tap, session.frame);
      }
    } finally {
      pickingBusyRef.current = false;
    }
    if (abort.signal.aborted) return closeSession();
    if (!target) {
      setStatus((s) => (s.phase === "picking" ? { ...s, flash: s.flash + 1 } : s));
      return;
    }

    // The run now owns the session and closes it itself once it notices an abort,
    // so the detector is never closed underneath an in-flight detection.
    sessionRef.current = null;
    setStatus({ phase: "running", progress: 0 });
    let lastPercent = 0;
    try {
      const result = await runAutoTrack(session, target, t0, project.durationSec, keyframesRef.current, abort.signal, (p) => {
        const percent = Math.floor(p * 100);
        if (percent === lastPercent || abort.signal.aborted) return;
        lastPercent = percent;
        setStatus({ phase: "running", progress: p });
      });
      const merged = mergeAutoKeyframes(keyframesRef.current, result);
      dispatch({ type: "MERGE_AUTO_KEYFRAMES", keyframes: result });
      const firstLow = merged.find((k) => k.auto === "low");
      controllerRef.current.jumpTo(firstLow?.timestamp ?? t0, merged);
      setStatus({ phase: "idle" });
    } catch (e) {
      if (!abort.signal.aborted) {
        console.error("auto-track failed", e);
        setStatus({ phase: "error" });
      }
    } finally {
      session.close();
      if (abortRef.current === abort) abortRef.current = null;
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
      if (document.visibilityState === "hidden" && abortRef.current) cancelRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      abortRef.current?.abort();
      if (!pickingBusyRef.current) sessionRef.current?.close();
    };
  }, []);

  const busy = status.phase === "loading" || status.phase === "picking" || status.phase === "running";
  return { status, busy, start, pick, cancel };
}
