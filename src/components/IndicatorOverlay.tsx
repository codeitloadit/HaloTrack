interface IndicatorOverlayProps {
  headY: number;
  feetY: number;
  centerX: number;
  width: number;
  height: number;
  offscreen: boolean;
}

export default function IndicatorOverlay({ headY, feetY, centerX, width, height, offscreen }: IndicatorOverlayProps) {
  const headPx = headY * height;
  const feetPx = feetY * height;
  const centerPx = centerX * width;
  const color = offscreen ? "rgba(255,80,80,0.9)" : "rgba(80,220,255,0.9)";

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}
    >
      <line x1={0} y1={headPx} x2={width} y2={headPx} stroke={color} strokeWidth={2} />
      <line x1={0} y1={feetPx} x2={width} y2={feetPx} stroke={color} strokeWidth={2} />
      <line x1={centerPx} y1={headPx} x2={centerPx} y2={feetPx} stroke={color} strokeWidth={2} />
    </svg>
  );
}
