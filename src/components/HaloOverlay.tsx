import { useEffect, useRef } from "react";
import { drawHalo, type HaloDrawParams } from "../lib/halo";

interface HaloOverlayProps {
  width: number;
  height: number;
  params: HaloDrawParams | null;
}

export default function HaloOverlay({ width, height, params }: HaloOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (params) drawHalo(ctx, params);
  }, [params, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
    />
  );
}
