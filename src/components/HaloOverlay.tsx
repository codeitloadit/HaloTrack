import { useEffect, useRef, type RefObject } from "react";
import { drawHalo, groundSourceFor, type HaloDrawParams } from "../lib/halo";
import type { HaloConfig } from "../state/types";

interface HaloOverlayProps {
  width: number;
  height: number;
  params: HaloDrawParams | null;
  /** Spins a rainbow or comet live, so the speed can be judged on a paused frame. */
  rotationSpeed?: number;
  /** The video under the overlay and the halo settings, for limiting the ring to the ground. */
  videoRef?: RefObject<HTMLVideoElement | null>;
  halo?: HaloConfig;
}

export default function HaloOverlay({ width, height, params, rotationSpeed = 0, videoRef, halo }: HaloOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Accumulated live spin, kept across re-renders so changing the speed (or any
  // other setting) carries on from the current angle instead of jumping back.
  const spinRef = useRef(0);
  const dpr = window.devicePixelRatio || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const video = videoRef?.current;
    const ground = video && halo && video.videoWidth ? groundSourceFor(halo, video, video.videoWidth / width) : null;

    function draw() {
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (params) drawHalo(ctx!, { ...params, rotation: params.rotation + spinRef.current }, ground);
    }

    if (!params || params.style === "solid" || rotationSpeed === 0) {
      draw();
      // The mask comes from the video frame, which changes after a seek lands.
      video?.addEventListener("seeked", draw);
      return () => video?.removeEventListener("seeked", draw);
    }

    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      spinRef.current += 2 * Math.PI * rotationSpeed * ((now - last) / 1000);
      last = now;
      draw();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [params, width, height, dpr, rotationSpeed, videoRef, halo]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.round(width * dpr)}
      height={Math.round(height * dpr)}
      style={{ position: "absolute", left: 0, top: 0, width, height, pointerEvents: "none" }}
    />
  );
}
