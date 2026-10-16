import { useEffect, useRef } from "react";
import { gridTimes } from "../lib/keyframes";
import type { TrackKeyframe } from "../state/types";

interface KeyframeStripProps {
  keyframes: TrackKeyframe[];
  current: number;
  reference?: number;
  /** When given, every tracking step of the clip gets a slot, tracked or not. */
  duration?: number;
  onSelect: (timestamp: number) => void;
}

const EPSILON = 1e-6;

export default function KeyframeStrip({ keyframes, current, reference, duration, onSelect }: KeyframeStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  const slots: { timestamp: number; keyframe: TrackKeyframe | null }[] =
    duration === undefined
      ? keyframes.map((k) => ({ timestamp: k.timestamp, keyframe: k }))
      : gridTimes(duration).map((t) => ({
          timestamp: t,
          keyframe: keyframes.find((k) => Math.abs(k.timestamp - t) < EPSILON) ?? null,
        }));

  useEffect(() => {
    const strip = stripRef.current;
    const dot = strip?.querySelector<HTMLElement>(".keyframe-dot.current");
    if (!strip || !dot) return;
    strip.scrollTo({ left: dot.offsetLeft + dot.offsetWidth / 2 - strip.clientWidth / 2, behavior: "smooth" });
  }, [current, slots.length]);

  return (
    <div className="keyframe-strip" ref={stripRef}>
      <span className="keyframe-strip-cap" />
      {slots.map(({ timestamp, keyframe: k }) => {
        const isCurrent = Math.abs(timestamp - current) < EPSILON;
        const isReference = reference !== undefined && Math.abs(timestamp - reference) < EPSILON;
        const classes = [
          "keyframe-dot",
          !k && "empty",
          isCurrent && "current",
          isReference && "reference",
          k?.offscreen && "offscreen",
        ];
        return (
          <button
            key={timestamp}
            type="button"
            className={classes.filter(Boolean).join(" ")}
            onClick={() => onSelect(timestamp)}
            aria-label={`keyframe ${timestamp.toFixed(2)}`}
          />
        );
      })}
      <span className="keyframe-strip-cap" />
    </div>
  );
}
