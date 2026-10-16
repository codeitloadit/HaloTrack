import { useEffect, useRef, useState } from "react";
import GestureSurface from "../../components/GestureSurface";
import HaloOverlay from "../../components/HaloOverlay";
import IndicatorOverlay from "../../components/IndicatorOverlay";
import KeyframeStrip from "../../components/KeyframeStrip";
import PhaseNav from "../../components/PhaseNav";
import VideoStage from "../../components/VideoStage";
import { IconCheck, IconChevronLeft, IconChevronRight, IconTrash } from "../../components/icons";
import { deriveHaloParams } from "../../lib/halo";
import { useAppDispatch, useAppState } from "../../state/AppStateContext";
import { useTrackController } from "./useTrackController";

/** How long the clear button stays armed waiting for its confirming second tap. */
const CLEAR_ARM_MS = 3000;

export default function TrackPhase() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controller = useTrackController(videoRef);
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
  const { halo } = state;

  return (
    <div className="phase-container">
      <VideoStage src={state.project.objectUrl} initialTime={controller.cursor} ref={videoRef}>
        {(box) => {
          // The ring follows the indicator as it's moved, before the step is even saved.
          const live = { timestamp: controller.cursor, ...controller.indicator, offscreen: controller.offscreen };
          const haloParams = halo ? deriveHaloParams(controller.cursor, [live], halo, box) : null;
          return (
            <GestureSurface
              className="gesture-fill"
              onPinch={(delta) =>
                controller.applyPinch(delta.deltaDy, delta.deltaMidX, delta.deltaMidY, box.width, box.height)
              }
              onPan={(dx, dy) => controller.applyPan(dx, dy, box.width, box.height)}
              onRelease={() => controller.scheduleCommit()}
            >
              <HaloOverlay width={box.width} height={box.height} params={haloParams} rotationSpeed={halo?.rotationSpeed} />
              <IndicatorOverlay
                headY={controller.indicator.headY}
                feetY={controller.indicator.feetY}
                centerX={controller.indicator.centerX}
                offscreen={controller.offscreen}
                width={box.width}
                height={box.height}
              />
            </GestureSurface>
          );
        }}
      </VideoStage>

      <KeyframeStrip
        keyframes={state.keyframes}
        current={controller.cursor}
        duration={controller.duration}
        onSelect={controller.jumpTo}
      />

      <div className="track-controls">
        <button
          type="button"
          className="icon-btn"
          onClick={controller.stepPrev}
          disabled={!controller.canStepPrev}
          aria-label="previous frame"
        >
          <IconChevronLeft />
        </button>
        <button type="button" className="icon-btn icon-btn-primary icon-btn-lg" onClick={controller.commitNow} aria-label="confirm">
          <IconCheck />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={controller.stepNext}
          disabled={!controller.canStepNext}
          aria-label="next frame"
        >
          <IconChevronRight />
        </button>
        <button
          type="button"
          className={`icon-btn track-clear-btn${clearArmed ? " track-clear-armed" : ""}`}
          onClick={clearAll}
          disabled={state.keyframes.length === 0}
          aria-label={clearArmed ? "confirm clear all" : "clear all"}
        >
          <IconTrash />
        </button>
      </div>

      <PhaseNav
        onBack={() => dispatch({ type: "SET_PHASE", phase: "halo" })}
        onNext={() => dispatch({ type: "SET_PHASE", phase: "preview" })}
        nextDisabled={state.keyframes.length === 0}
      />
    </div>
  );
}
