export type Phase = "import" | "track" | "halo" | "preview" | "export";

export interface Project {
  /** Stable identity used to remember this video's tracking across imports. */
  key: string;
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
  /** The second colour, for the gradient (east/west) and comet (second comet) styles. */
  secondColor: string;
  opacity: number;
  style: HaloStyle;
  /** Revolutions per second of the rainbow or comet; the sign sets direction. */
  rotationSpeed: number;
  /** Fill the inside of the ring with a fainter version of it. */
  filled: boolean;
  /** Only draw the ring where the video shows ground, so players and objects in front hide it. */
  groundOnly: boolean;
  groundColors: string[];
  /** See GroundSource.tolerance. */
  groundTolerance: number;
}

export type HaloStyle = "solid" | "gradient" | "comet" | "rainbow";

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
/** A keyframe this close to the video's end counts as the final step. */
export const TRACK_END_EPSILON = 1e-3;
export const MIN_INDICATOR_HEIGHT = 0.03;
export const DEFAULT_HALO_OPACITY = 0.5;
export const DEFAULT_HALO_OFFSET_Y = 0.008;
