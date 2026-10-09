import { IconPause, IconPlay } from "./icons";

interface ScrubberProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onScrub: (t: number) => void;
}

export default function Scrubber({ currentTime, duration, isPlaying, onTogglePlay, onScrub }: ScrubberProps) {
  return (
    <div className="scrubber">
      <button type="button" className="icon-btn" onClick={onTogglePlay} aria-label={isPlaying ? "pause" : "play"}>
        {isPlaying ? <IconPause /> : <IconPlay />}
      </button>
      <input
        type="range"
        className="scrub-track"
        min={0}
        max={duration || 0}
        step={0.01}
        value={currentTime}
        onChange={(e) => onScrub(Number(e.target.value))}
      />
    </div>
  );
}
