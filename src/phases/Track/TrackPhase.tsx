import { useRef } from "react";
import GestureSurface from "../../components/GestureSurface";
import IndicatorOverlay from "../../components/IndicatorOverlay";
import KeyframeStrip from "../../components/KeyframeStrip";
import PhaseNav from "../../components/PhaseNav";
import VideoStage from "../../components/VideoStage";
import { IconCheck, IconChevronLeft, IconChevronRight } from "../../components/icons";
import type { ContentBox } from "../../lib/geometry";
import { useAppDispatch, useAppState } from "../../state/AppStateContext";
import { useTrackController } from "./useTrackController";

export default function TrackPhase() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<ContentBox | null>(null);
  const controller = useTrackController(videoRef);

  if (!state.project) return null;

  return (
    <div className="phase-container">
      <VideoStage src={state.project.objectUrl} initialTime={controller.cursor} ref={videoRef}>
        {(box) => {
          boxRef.current = box;
          return (
            <GestureSurface
              className="gesture-fill"
              onPinch={(delta) =>
                controller.applyPinch(delta.deltaDy, delta.deltaMidX, delta.deltaMidY, box.width, box.height)
              }
              onPan={(dx, dy) => controller.applyPan(dx, dy, box.width, box.height)}
              onRelease={() => controller.scheduleCommit()}
            >
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

      <KeyframeStrip keyframes={state.keyframes} current={controller.cursor} onSelect={controller.jumpTo} />

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
      </div>

      <PhaseNav
        onNext={() => dispatch({ type: "SET_PHASE", phase: "halo" })}
        nextDisabled={state.keyframes.length === 0}
      />
    </div>
  );
}
