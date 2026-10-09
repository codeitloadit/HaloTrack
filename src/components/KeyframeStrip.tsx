import type { TrackKeyframe } from "../state/types";

interface KeyframeStripProps {
  keyframes: TrackKeyframe[];
  current: number;
  reference?: number;
  onSelect: (timestamp: number) => void;
}

export default function KeyframeStrip({ keyframes, current, reference, onSelect }: KeyframeStripProps) {
  const EPSILON = 1e-6;
  return (
    <div className="keyframe-strip">
      {keyframes.map((k) => {
        const isCurrent = Math.abs(k.timestamp - current) < EPSILON;
        const isReference = reference !== undefined && Math.abs(k.timestamp - reference) < EPSILON;
        return (
          <button
            key={k.timestamp}
            type="button"
            className={`keyframe-dot${isCurrent ? " current" : ""}${isReference ? " reference" : ""}${k.offscreen ? " offscreen" : ""}`}
            onClick={() => onSelect(k.timestamp)}
            aria-label={`keyframe ${k.timestamp.toFixed(2)}`}
          />
        );
      })}
    </div>
  );
}
