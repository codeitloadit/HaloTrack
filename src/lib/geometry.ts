import { MIN_INDICATOR_HEIGHT } from "../state/types";

export interface Point {
  x: number;
  y: number;
}

export interface PinchFrame {
  p1: Point;
  p2: Point;
  midpoint: Point;
  dx: number;
  dy: number;
  distance: number;
}

export interface PinchDelta {
  deltaDx: number;
  deltaDy: number;
  deltaMidX: number;
  deltaMidY: number;
}

export function pinchFrame(p1: Point, p2: Point): PinchFrame {
  const dx = Math.abs(p1.x - p2.x);
  const dy = Math.abs(p1.y - p2.y);
  return {
    p1,
    p2,
    midpoint: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    dx,
    dy,
    distance: Math.hypot(p1.x - p2.x, p1.y - p2.y),
  };
}

export function pinchDelta(curr: PinchFrame, prev: PinchFrame): PinchDelta {
  return {
    deltaDx: curr.dx - prev.dx,
    deltaDy: curr.dy - prev.dy,
    deltaMidX: curr.midpoint.x - prev.midpoint.x,
    deltaMidY: curr.midpoint.y - prev.midpoint.y,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface IndicatorState {
  headY: number;
  feetY: number;
  centerX: number;
}

/** Keeps an indicator within a generous margin of the frame and at least MIN_INDICATOR_HEIGHT tall. */
export function clampIndicator(next: IndicatorState): IndicatorState {
  let headY = clamp(next.headY, -0.5, 1.5);
  let feetY = clamp(next.feetY, -0.5, 1.5);
  const centerX = clamp(next.centerX, -0.5, 1.5);
  if (feetY - headY < MIN_INDICATOR_HEIGHT) {
    const mid = (headY + feetY) / 2;
    headY = mid - MIN_INDICATOR_HEIGHT / 2;
    feetY = mid + MIN_INDICATOR_HEIGHT / 2;
  }
  return { headY, feetY, centerX };
}

export interface ContentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function computeContentBox(container: DOMRect, mediaWidth: number, mediaHeight: number): ContentBox {
  const containerAspect = container.width / container.height;
  const mediaAspect = mediaWidth / mediaHeight;

  if (mediaAspect > containerAspect) {
    const width = container.width;
    const height = width / mediaAspect;
    return {
      left: container.left,
      top: container.top + (container.height - height) / 2,
      width,
      height,
    };
  }

  const height = container.height;
  const width = height * mediaAspect;
  return {
    left: container.left + (container.width - width) / 2,
    top: container.top,
    width,
    height,
  };
}

export function toNormalized(clientX: number, clientY: number, box: ContentBox): Point {
  return {
    x: (clientX - box.left) / box.width,
    y: (clientY - box.top) / box.height,
  };
}
