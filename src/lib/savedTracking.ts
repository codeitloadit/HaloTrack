import type { TrackKeyframe } from "../state/types";

const STORAGE_PREFIX = "halotrack:tracking:";

/**
 * Identifies a video across separate imports. Deliberately not the file name,
 * which iOS doesn't keep stable between picks from the photo library; byte
 * size, duration and dimensions together are effectively unique per video.
 */
export function videoKey(file: File, durationSec: number, width: number, height: number): string {
  return `${file.size}:${Math.round(durationSec * 1000)}:${width}x${height}`;
}

export function loadTracking(key: string): TrackKeyframe[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isKeyframe)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveTracking(key: string, keyframes: TrackKeyframe[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(keyframes));
  } catch {
    // Storage unavailable or full; tracking just won't be remembered.
  }
}

function isKeyframe(value: unknown): value is TrackKeyframe {
  if (typeof value !== "object" || value === null) return false;
  const k = value as Record<string, unknown>;
  return (
    typeof k.timestamp === "number" &&
    typeof k.headY === "number" &&
    typeof k.feetY === "number" &&
    typeof k.centerX === "number" &&
    typeof k.offscreen === "boolean"
  );
}
