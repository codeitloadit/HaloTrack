import { useEffect, useRef } from "react";
import { drawHalo, type HaloDrawParams } from "../lib/halo";

interface HaloOverlayProps {
  width: number;
  height: number;
  params: HaloDrawParams | null;
}

export default function HaloOverlay({ width, height, params }: HaloOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dpr = window.devicePixelRatio || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (params) drawHalo(ctx, params);
  }, [params, width, height, dpr]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.round(width * dpr)}
      height={Math.round(height * dpr)}
      style={{ position: "absolute", left: 0, top: 0, width, height, pointerEvents: "none" }}
    />
  );
}
