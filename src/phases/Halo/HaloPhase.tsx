import { useEffect, useRef } from "react";
import ColorPickerButton from "../../components/ColorPickerButton";
import GestureSurface from "../../components/GestureSurface";
import HaloOverlay from "../../components/HaloOverlay";
import IndicatorOverlay from "../../components/IndicatorOverlay";
import KeyframeStrip from "../../components/KeyframeStrip";
import PhaseNav from "../../components/PhaseNav";
import VideoStage from "../../components/VideoStage";
import { clamp } from "../../lib/geometry";
import { deriveHaloParams } from "../../lib/halo";
import { interpolateIndicator } from "../../lib/keyframes";
import { seekTo } from "../../lib/video";
import { useAppDispatch, useAppState } from "../../state/AppStateContext";
import { DEFAULT_HALO_OFFSET_Y, DEFAULT_HALO_OPACITY, type TrackKeyframe } from "../../state/types";

/** Who the ring is shown around before anything is tracked. */
const STAND_IN: TrackKeyframe = { timestamp: 0, headY: 0.2, feetY: 0.8, centerX: 0.5, offscreen: false };

function defaultReferenceTimestamp(keyframes: { timestamp: number; offscreen: boolean }[]): number {
  const firstOnscreen = keyframes.find((k) => !k.offscreen);
  return (firstOnscreen ?? keyframes[0])?.timestamp ?? 0;
}

export default function HaloPhase() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!state.halo) {
      dispatch({
        type: "SET_HALO_CONFIG",
        halo: {
          referenceTimestamp: defaultReferenceTimestamp(state.keyframes),
          horizontalRadius: 0.35,
          verticalRadius: 0.08,
          offsetX: 0,
          offsetY: DEFAULT_HALO_OFFSET_Y,
          color: "#ff3b30",
          secondColor: "#ff3b30",
          opacity: DEFAULT_HALO_OPACITY,
          style: "solid",
          rotationSpeed: 0,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFirstReferenceSeek = useRef(true);
  useEffect(() => {
    // Skip the very first run — VideoStage already seeks to this same timestamp
    // itself (via its `initialTime` prop) as part of its own mount sequence, and
    // seeking again here concurrently would race with that and risk the same
    // "briefly plays from the wrong spot" flash this is meant to avoid.
    if (isFirstReferenceSeek.current) {
      isFirstReferenceSeek.current = false;
      return;
    }
    if (videoRef.current && state.halo) void seekTo(videoRef.current, state.halo.referenceTimestamp);
  }, [state.halo?.referenceTimestamp]);

  if (!state.project || !state.halo) return null;
  const halo = state.halo;
  const tracked = state.keyframes.length > 0;
  const shownOn = tracked ? state.keyframes : [STAND_IN];
  const reference = interpolateIndicator(shownOn, halo.referenceTimestamp);
  const playerHeight = (boxHeight: number) => Math.max(1, (reference.feetY - reference.headY) * boxHeight);

  function selectReference(timestamp: number) {
    dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, referenceTimestamp: timestamp } });
  }

  function adjustRadiiAndPosition(
    deltaDx: number,
    deltaDy: number,
    deltaMidX: number,
    deltaMidY: number,
    boxHeight: number,
  ) {
    const unit = playerHeight(boxHeight);
    const horizontalRadius = clamp(halo.horizontalRadius + deltaDx / 2 / unit, 0.02, 3);
    const verticalRadius = clamp(halo.verticalRadius + deltaDy / 2 / unit, 0.01, 1.5);
    const offsetX = clamp(halo.offsetX + deltaMidX / unit, -1.5, 1.5);
    const offsetY = clamp(halo.offsetY + deltaMidY / unit, -1.5, 1.5);
    dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, horizontalRadius, verticalRadius, offsetX, offsetY } });
  }

  function adjustPosition(dx: number, dy: number, boxHeight: number) {
    const unit = playerHeight(boxHeight);
    const offsetX = clamp(halo.offsetX + dx / unit, -1.5, 1.5);
    const offsetY = clamp(halo.offsetY + dy / unit, -1.5, 1.5);
    dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, offsetX, offsetY } });
  }

  return (
    <div className="phase-container">
      <VideoStage src={state.project.objectUrl} initialTime={halo.referenceTimestamp} ref={videoRef}>
        {(box) => {
          const derived = deriveHaloParams(halo.referenceTimestamp, shownOn, halo, {
            width: box.width,
            height: box.height,
          });
          return (
            <GestureSurface
              className="gesture-fill"
              onPinch={(delta) =>
                adjustRadiiAndPosition(delta.deltaDx, delta.deltaDy, delta.deltaMidX, delta.deltaMidY, box.height)
              }
              onPan={(dx, dy) => adjustPosition(dx, dy, box.height)}
            >
              {!tracked && (
                <div className="halo-stand-in">
                  <IndicatorOverlay {...STAND_IN} width={box.width} height={box.height} />
                </div>
              )}
              <HaloOverlay width={box.width} height={box.height} params={derived} rotationSpeed={halo.rotationSpeed} />
            </GestureSurface>
          );
        }}
      </VideoStage>

      {tracked && (
        <KeyframeStrip
          keyframes={state.keyframes}
          current={halo.referenceTimestamp}
          reference={halo.referenceTimestamp}
          onSelect={selectReference}
        />
      )}

      <div className="halo-controls">
        <ColorPickerButton
          color={halo.color}
          opacity={halo.opacity}
          onColorChange={(color) => dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, color } })}
          secondColor={halo.secondColor}
          onSecondColorChange={(secondColor) => dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, secondColor } })}
          onOpacityChange={(opacity) => dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, opacity } })}
          style={halo.style}
          rotationSpeed={halo.rotationSpeed}
          onStyleChange={(style) => dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, style } })}
          onRotationSpeedChange={(rotationSpeed) => dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, rotationSpeed } })}
        />
      </div>

      <PhaseNav onNext={() => dispatch({ type: "SET_PHASE", phase: "track" })} />
    </div>
  );
}
