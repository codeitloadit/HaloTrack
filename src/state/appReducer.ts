import { STEP_SECONDS, TRACK_END_EPSILON, type AppState, type HaloConfig, type Phase, type PlaybackState, type Project, type TrackKeyframe } from "./types";

export type AppAction =
  | { type: "LOAD_PROJECT"; project: Project; savedKeyframes: TrackKeyframe[] | null }
  | { type: "SET_PHASE"; phase: Phase }
  | { type: "UPSERT_KEYFRAME"; keyframe: TrackKeyframe }
  | { type: "SET_HALO_CONFIG"; halo: HaloConfig }
  | { type: "SET_TRACK_CURSOR"; timestamp: number }
  | { type: "SET_PLAYBACK"; playback: Partial<PlaybackState> }
  | { type: "RESET" };

export const initialState: AppState = {
  phase: "import",
  project: null,
  keyframes: [],
  halo: null,
  trackCursor: 0,
  playback: { currentTime: 0, isPlaying: false },
};

function upsertKeyframe(keyframes: TrackKeyframe[], keyframe: TrackKeyframe): TrackKeyframe[] {
  const EPSILON = 1e-6;
  const existingIndex = keyframes.findIndex((k) => Math.abs(k.timestamp - keyframe.timestamp) < EPSILON);
  const next = existingIndex >= 0
    ? keyframes.map((k, i) => (i === existingIndex ? keyframe : k))
    : [...keyframes, keyframe];
  return next.sort((a, b) => a.timestamp - b.timestamp);
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "LOAD_PROJECT": {
      const keyframes = action.savedKeyframes ?? [];
      const last = keyframes[keyframes.length - 1];
      // Fully tracked previously: skip straight to the halo. Partly tracked:
      // resume tracking at the first step after the last one recorded.
      const complete = last !== undefined && last.timestamp >= action.project.durationSec - TRACK_END_EPSILON;
      return {
        ...initialState,
        project: action.project,
        keyframes,
        phase: complete ? "halo" : "track",
        trackCursor: last && !complete ? Math.min(last.timestamp + STEP_SECONDS, action.project.durationSec) : 0,
      };
    }
    case "SET_PHASE":
      return { ...state, phase: action.phase };
    case "UPSERT_KEYFRAME":
      return { ...state, keyframes: upsertKeyframe(state.keyframes, action.keyframe) };
    case "SET_HALO_CONFIG":
      return { ...state, halo: action.halo };
    case "SET_TRACK_CURSOR":
      return { ...state, trackCursor: action.timestamp };
    case "SET_PLAYBACK":
      return { ...state, playback: { ...state.playback, ...action.playback } };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}
