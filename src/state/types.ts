export type Phase = "import" | "track" | "halo" | "preview" | "export";

export interface Project {
  file: File;
  objectUrl: string;
  durationSec: number;
  width: number;
  height: number;
}

export interface TrackKeyframe {
  timestamp: number;
  headY: number;
  feetY: number;
  centerX: number;
  offscreen: boolean;
}

export interface HaloConfig {
  referenceTimestamp: number;
  horizontalRadius: number;
  verticalRadius: number;
  offsetX: number;
  offsetY: number;
  color: string;
  opacity: number;
  rainbow: boolean;
  /** Revolutions per second of the rainbow gradient; the sign sets direction. */
  rotationSpeed: number;
}

export interface PlaybackState {
  currentTime: number;
  isPlaying: boolean;
}

export interface AppState {
  phase: Phase;
  project: Project | null;
  keyframes: TrackKeyframe[];
  halo: HaloConfig | null;
  trackCursor: number;
  playback: PlaybackState;
}

export const STEP_SECONDS = 0.5;
export const MIN_INDICATOR_HEIGHT = 0.03;
export const DEFAULT_HALO_OPACITY = 0.5;
export const DEFAULT_HALO_OFFSET_Y = 0.008;
