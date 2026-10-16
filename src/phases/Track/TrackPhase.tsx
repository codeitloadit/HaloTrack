import { useEffect, useRef, useState } from "react";
import GestureSurface from "../../components/GestureSurface";
import IndicatorOverlay from "../../components/IndicatorOverlay";
import KeyframeStrip from "../../components/KeyframeStrip";
import PhaseNav from "../../components/PhaseNav";
import PickOverlay from "../../components/PickOverlay";
import VideoStage from "../../components/VideoStage";
import { IconAutoTrack, IconCheck, IconChevronLeft, IconChevronRight, IconClose, IconOffscreen, IconSkip, IconTrash } from "../../components/icons";
import type { ContentBox } from "../../lib/geometry";
import { useAppDispatch, useAppState } from "../../state/AppStateContext";
import { useAutoTrack, type AutoTrackStatus } from "./useAutoTrack";
import { useDetectorSession } from "./useDetectorSession";
import { useStepGuess } from "./useStepGuess";
import { useTrackController } from "./useTrackController";

/** How long the clear button stays armed waiting for its confirming second tap. */
const CLEAR_ARM_MS = 3000;

const RING_RADIUS = 21;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function AutoTrackButton({ status, onStart, onCancel }: { status: AutoTrackStatus; onStart: () => void; onCancel: () => void }) {
  const active = status.phase === "loading" || status.phase === "picking" || status.phase === "running";
  return (
    <button
      type="button"
      className={`icon-btn auto-track-btn${status.phase === "error" ? " auto-track-error" : ""}`}
      onClick={active ? onCancel : onStart}
      aria-label={active ? "cancel auto-track" : "auto-track"}
    >
      {active ? <IconClose /> : <IconAutoTrack />}
      {status.phase === "loading" && (
        <svg className="auto-track-ring auto-track-spin" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r={RING_RADIUS} strokeDasharray={`${RING_LENGTH * 0.25} ${RING_LENGTH}`} />
        </svg>
      )}
      {status.phase === "running" && (
        <svg className="auto-track-ring" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r={RING_RADIUS} strokeDasharray={`${RING_LENGTH * status.progress} ${RING_LENGTH}`} />
        </svg>
      )}
    </button>
  );
}

export default function TrackPhase() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<ContentBox | null>(null);
  const controller = useTrackController(videoRef);
  const acquireSession = useDetectorSession(state.project);
  const auto = useAutoTrack(controller, acquireSession);
  const guess = useStepGuess(controller, acquireSession, !auto.busy);
  const [clearArmed, setClearArmed] = useState(false);

  useEffect(() => {
    if (!clearArmed) return;
    const timer = setTimeout(() => setClearArmed(false), CLEAR_ARM_MS);
    return () => clearTimeout(timer);
  }, [clearArmed]);

  function clearAll() {
    if (!clearArmed) return setClearArmed(true);
    setClearArmed(false);
    dispatch({ type: "CLEAR_KEYFRAMES" });
    controller.jumpTo(0, []);
  }

  if (!state.project) return null;
  const picking = auto.status.phase === "picking" ? auto.status : null;

  return (
    <div className="phase-container">
      <VideoStage src={state.project.objectUrl} initialTime={controller.cursor} ref={videoRef}>
        {(box) => {
          boxRef.current = box;
          const indicator = (
            <IndicatorOverlay
              headY={controller.indicator.headY}
              feetY={controller.indicator.feetY}
              centerX={controller.indicator.centerX}
              offscreen={controller.offscreen}
              width={box.width}
              height={box.height}
            />
          );
          if (auto.status.phase === "picking") {
            return (
              <>
                {auto.status.followUp && <div className="pick-guess">{indicator}</div>}
                <PickOverlay
                boxes={auto.status.boxes}
                frame={{ w: state.project!.width, h: state.project!.height }}
                width={box.width}
                height={box.height}
                flash={auto.status.flash}
                onPick={auto.pick}
                />
              </>
            );
          }
          if (auto.busy) return null;
          return (
            <GestureSurface
              className="gesture-fill"
              onPinch={(delta) =>
                controller.applyPinch(delta.deltaDy, delta.deltaMidX, delta.deltaMidY, box.width, box.height)
              }
              onPan={(dx, dy) => controller.applyPan(dx, dy, box.width, box.height)}
              onRelease={() => controller.scheduleCommit()}
            >
              {indicator}
            </GestureSurface>
          );
        }}
      </VideoStage>

      <KeyframeStrip
        keyframes={state.keyframes}
        current={controller.cursor}
        duration={controller.duration}
        onSelect={(t) => {
          if (!auto.busy) controller.jumpTo(t);
        }}
      />

      <div className="track-controls">
        <AutoTrackButton status={auto.status} onStart={auto.start} onCancel={auto.cancel} />
        <button
          type="button"
          className="icon-btn"
          onClick={controller.stepPrev}
          disabled={auto.busy || !controller.canStepPrev}
          aria-label="previous frame"
        >
          <IconChevronLeft />
        </button>
        {picking ? (
          <button
            type="button"
            className="icon-btn icon-btn-primary icon-btn-lg"
            onClick={auto.pickOffscreen}
            disabled={!picking.offscreenRef}
            aria-label="player off-screen"
          >
            <IconOffscreen />
          </button>
        ) : (
          <button
            type="button"
            className="icon-btn icon-btn-primary icon-btn-lg"
            onClick={controller.commitNow}
            disabled={auto.busy || guess.guessing}
            aria-label="confirm"
          >
            <IconCheck />
          </button>
        )}
        {picking ? (
          <button
            type="button"
            className="icon-btn"
            onClick={auto.skip}
            disabled={!picking.followUp}
            aria-label="skip to next unsure step"
          >
            <IconSkip />
          </button>
        ) : (
          <button
            type="button"
            className={`icon-btn step-accept-btn${guess.guessing ? " guessing" : ""}`}
            onClick={() => {
              if (!guess.guessing) controller.commitNow();
            }}
            disabled={auto.busy}
            aria-disabled={guess.guessing}
            aria-label="accept and next frame"
          >
            <IconChevronRight />
            {guess.guessing && (
              <svg className="auto-track-ring auto-track-spin" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r={RING_RADIUS} strokeDasharray={`${RING_LENGTH * 0.25} ${RING_LENGTH}`} />
              </svg>
            )}
          </button>
        )}
        <button
          type="button"
          className={`icon-btn track-clear-btn${clearArmed ? " track-clear-armed" : ""}`}
          onClick={clearAll}
          disabled={auto.busy || state.keyframes.length === 0}
          aria-label={clearArmed ? "confirm clear all" : "clear all"}
        >
          <IconTrash />
        </button>
      </div>

      <PhaseNav
        onNext={() => dispatch({ type: "SET_PHASE", phase: "halo" })}
        nextDisabled={auto.busy || state.keyframes.length === 0}
      />
    </div>
  );
}
