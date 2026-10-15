import { useEffect, useRef } from "react";
import { drawHalo, type HaloDrawParams } from "../lib/halo";

interface HaloOverlayProps {
  width: number;
  height: number;
  params: HaloDrawParams | null;
  /** Spins a rainbow or comet live, so the speed can be judged on a paused frame. */
  rotationSpeed?: number;
}

export default function HaloOverlay({ width, height, params, rotationSpeed = 0 }: HaloOverlayProps) {
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

    function draw() {
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (params) drawHalo(ctx!, { ...params, rotation: params.rotation + spinRef.current });
    }

    if (!params || params.style === "solid" || rotationSpeed === 0) {
      draw();
      return;
    }

    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      spinRef.current += 2 * Math.PI * rotationSpeed * ((now - last) / 1000);
      last = now;
      draw();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [params, width, height, dpr, rotationSpeed]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.round(width * dpr)}
      height={Math.round(height * dpr)}
      style={{ position: "absolute", left: 0, top: 0, width, height, pointerEvents: "none" }}
    />
  );
}
