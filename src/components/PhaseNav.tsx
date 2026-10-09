import { IconChevronLeft, IconChevronRight } from "./icons";

interface PhaseNavProps {
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
}

export default function PhaseNav({ onBack, onNext, nextDisabled }: PhaseNavProps) {
  return (
    <div className="phase-nav">
      {onBack && (
        <button type="button" className="icon-btn" onClick={onBack} aria-label="back">
          <IconChevronLeft />
        </button>
      )}
      <div className="phase-nav-spacer" />
      {onNext && (
        <button
          type="button"
          className="icon-btn icon-btn-primary"
          onClick={onNext}
          disabled={nextDisabled}
          aria-label="next"
        >
          <IconChevronRight />
        </button>
      )}
    </div>
  );
}
