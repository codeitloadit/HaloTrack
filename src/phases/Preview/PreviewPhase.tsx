import { useEffect, useRef, useState } from "react";
import PhaseNav from "../../components/PhaseNav";
import Scrubber from "../../components/Scrubber";
import { IconCrosshair, IconRing } from "../../components/icons";
import { renderFrame } from "../../lib/export";
import { useAppDispatch, useAppState } from "../../state/AppStateContext";

export default function PreviewPhase() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const project = state.project;

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !project) return;

    function draw(t: number) {
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;
      renderFrame(ctx, video!, t, state.keyframes, state.halo, { width: canvas!.width, height: canvas!.height });
    }

    let rafHandle: number | null = null;

    function loop() {
      if (video!.readyState >= video!.HAVE_CURRENT_DATA) {
        draw(video!.currentTime);
        setCurrentTime(video!.currentTime);
      }
      rafHandle = requestAnimationFrame(loop);
    }
    rafHandle = requestAnimationFrame(loop);

    video
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));

    return () => {
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, state.keyframes, state.halo]);

  if (!project) return null;

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }

  function scrub(t: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = t;
    setCurrentTime(t);
  }

  function editTrack() {
    dispatch({ type: "SET_TRACK_CURSOR", timestamp: nearestKeyframeTimestamp(currentTime) });
    dispatch({ type: "SET_PHASE", phase: "track" });
  }

  function nearestKeyframeTimestamp(t: number): number {
    if (state.keyframes.length === 0) return 0;
    return state.keyframes.reduce((best, k) => (Math.abs(k.timestamp - t) < Math.abs(best - t) ? k.timestamp : best), state.keyframes[0].timestamp);
  }

  return (
    <div className="phase-container">
      <div className="preview-stage">
        <video
          ref={videoRef}
          src={project.objectUrl}
          playsInline
          muted
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
        <canvas ref={canvasRef} width={project.width} height={project.height} className="preview-canvas" />
      </div>

      <Scrubber
        currentTime={currentTime}
        duration={project.durationSec}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        onScrub={scrub}
      />

      <div className="preview-controls">
        <button type="button" className="icon-btn" onClick={editTrack} aria-label="edit track">
          <IconCrosshair />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => dispatch({ type: "SET_PHASE", phase: "halo" })}
          aria-label="edit halo"
        >
          <IconRing />
        </button>
      </div>

      <PhaseNav onBack={() => dispatch({ type: "SET_PHASE", phase: "track" })} onNext={() => dispatch({ type: "SET_PHASE", phase: "export" })} />
    </div>
  );
}
