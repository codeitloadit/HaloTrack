import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { pinchDelta, pinchFrame, type PinchDelta, type PinchFrame, type Point } from "../lib/geometry";

interface GestureSurfaceProps {
  children?: ReactNode;
  className?: string;
  onPinch?: (delta: PinchDelta, frame: PinchFrame) => void;
  onPan?: (dx: number, dy: number) => void;
  onRelease?: () => void;
}

export default function GestureSurface({ children, className, onPinch, onPan, onRelease }: GestureSurfaceProps) {
  const pointers = useRef(new Map<number, Point>());
  const lastPinchFrame = useRef<PinchFrame | null>(null);
  const lastSinglePoint = useRef<Point | null>(null);

  function activePoints(): Point[] {
    return Array.from(pointers.current.values());
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = activePoints();
    if (points.length === 2) {
      lastPinchFrame.current = pinchFrame(points[0], points[1]);
    } else if (points.length === 1) {
      lastSinglePoint.current = points[0];
    }
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = activePoints();

    if (points.length >= 2) {
      const frame = pinchFrame(points[0], points[1]);
      if (lastPinchFrame.current) {
        const delta = pinchDelta(frame, lastPinchFrame.current);
        onPinch?.(delta, frame);
      }
      lastPinchFrame.current = frame;
      lastSinglePoint.current = null;
    } else if (points.length === 1) {
      const point = points[0];
      if (lastSinglePoint.current) {
        onPan?.(point.x - lastSinglePoint.current.x, point.y - lastSinglePoint.current.y);
      }
      lastSinglePoint.current = point;
      lastPinchFrame.current = null;
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    const points = activePoints();
    if (points.length < 2) lastPinchFrame.current = null;
    if (points.length === 1) {
      lastSinglePoint.current = points[0];
    } else if (points.length === 0) {
      lastSinglePoint.current = null;
      onRelease?.();
    }
  }

  return (
    <div
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{ touchAction: "none" }}
    >
      {children}
    </div>
  );
}
