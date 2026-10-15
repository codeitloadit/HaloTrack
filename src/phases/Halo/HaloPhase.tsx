import { useEffect, useRef } from "react";
import ColorPickerButton from "../../components/ColorPickerButton";
import GestureSurface from "../../components/GestureSurface";
import HaloOverlay from "../../components/HaloOverlay";
import KeyframeStrip from "../../components/KeyframeStrip";
import PhaseNav from "../../components/PhaseNav";
import VideoStage from "../../components/VideoStage";
import { clamp } from "../../lib/geometry";
import { deriveHaloParams } from "../../lib/halo";
import { seekTo } from "../../lib/video";
import { useAppDispatch, useAppState } from "../../state/AppStateContext";
import { DEFAULT_HALO_OFFSET_Y, DEFAULT_HALO_OPACITY } from "../../state/types";

function defaultReferenceTimestamp(keyframes: { timestamp: number; offscreen: boolean }[]): number {
  const firstOnscreen = keyframes.find((k) => !k.offscreen);
  return (firstOnscreen ?? keyframes[0])?.timestamp ?? 0;
}

export default function HaloPhase() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!state.halo && state.keyframes.length > 0) {
      dispatch({
        type: "SET_HALO_CONFIG",
        halo: {
          referenceTimestamp: defaultReferenceTimestamp(state.keyframes),
          horizontalRadius: 0.17,
          verticalRadius: 0.022,
          offsetX: 0,
          offsetY: DEFAULT_HALO_OFFSET_Y,
          color: "#ff3b30",
          opacity: DEFAULT_HALO_OPACITY,
          rainbow: false,
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

  function selectReference(timestamp: number) {
    dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, referenceTimestamp: timestamp } });
  }

  function adjustRadiiAndPosition(
    deltaDx: number,
    deltaDy: number,
    deltaMidX: number,
    deltaMidY: number,
    boxWidth: number,
    boxHeight: number,
  ) {
    const horizontalRadius = clamp(halo.horizontalRadius + deltaDx / 2 / boxWidth, 0.01, 1);
    const verticalRadius = clamp(halo.verticalRadius + deltaDy / 2 / boxHeight, 0.01, 1);
    const offsetX = clamp(halo.offsetX + deltaMidX / boxWidth, -0.5, 0.5);
    const offsetY = clamp(halo.offsetY + deltaMidY / boxHeight, -0.5, 0.5);
    dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, horizontalRadius, verticalRadius, offsetX, offsetY } });
  }

  function adjustPosition(dx: number, dy: number, boxWidth: number, boxHeight: number) {
    const offsetX = clamp(halo.offsetX + dx / boxWidth, -0.5, 0.5);
    const offsetY = clamp(halo.offsetY + dy / boxHeight, -0.5, 0.5);
    dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, offsetX, offsetY } });
  }

  return (
    <div className="phase-container">
      <VideoStage src={state.project.objectUrl} initialTime={halo.referenceTimestamp} ref={videoRef}>
        {(box) => {
          const derived = deriveHaloParams(halo.referenceTimestamp, state.keyframes, halo, {
            width: box.width,
            height: box.height,
          });
          return (
            <GestureSurface
              className="gesture-fill"
              onPinch={(delta) =>
                adjustRadiiAndPosition(delta.deltaDx, delta.deltaDy, delta.deltaMidX, delta.deltaMidY, box.width, box.height)
              }
              onPan={(dx, dy) => adjustPosition(dx, dy, box.width, box.height)}
            >
              <HaloOverlay width={box.width} height={box.height} params={derived} rotationSpeed={halo.rotationSpeed} />
            </GestureSurface>
          );
        }}
      </VideoStage>

      <KeyframeStrip
        keyframes={state.keyframes}
        current={halo.referenceTimestamp}
        reference={halo.referenceTimestamp}
        onSelect={selectReference}
      />

      <div className="halo-controls">
        <ColorPickerButton
          color={halo.color}
          opacity={halo.opacity}
          onColorChange={(color) => dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, color } })}
          onOpacityChange={(opacity) => dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, opacity } })}
          rainbow={halo.rainbow}
          rotationSpeed={halo.rotationSpeed}
          onRainbowChange={(rainbow) => dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, rainbow } })}
          onRotationSpeedChange={(rotationSpeed) => dispatch({ type: "SET_HALO_CONFIG", halo: { ...halo, rotationSpeed } })}
        />
      </div>

      <PhaseNav
        onBack={() => dispatch({ type: "SET_PHASE", phase: "track" })}
        onNext={() => dispatch({ type: "SET_PHASE", phase: "preview" })}
      />
    </div>
  );
}
