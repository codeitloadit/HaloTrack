import type { FrameSize, Rect } from "../lib/autoTrack";

interface PickOverlayProps {
  /** Detected people, in video pixels. */
  boxes: Rect[];
  frame: FrameSize;
  /** Size of the displayed video, in CSS pixels. */
  width: number;
  height: number;
  /** Changes each time a tap misses, to replay the flash. */
  flash: number;
  onPick: (x: number, y: number) => void;
}

/** Outlines everyone found in the frame; tapping picks who to track (in video pixels). */
export default function PickOverlay({ boxes, frame, width, height, flash, onPick }: PickOverlayProps) {
  const sx = width / frame.w;
  const sy = height / frame.h;
  return (
    <div
      className="pick-overlay"
      style={{ width, height }}
      onPointerUp={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onPick(((e.clientX - r.left) / width) * frame.w, ((e.clientY - r.top) / height) * frame.h);
      }}
    >
      <svg key={flash} width={width} height={height} className={flash > 0 ? "pick-miss" : undefined}>
        {boxes.map((b, i) => (
          <rect key={i} x={b.x * sx} y={b.y * sy} width={b.w * sx} height={b.h * sy} rx={4} className="pick-box" />
        ))}
      </svg>
    </div>
  );
}
