interface IconProps {
  size?: number;
}

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconChevronLeft({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function IconChevronRight({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function IconCheck({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 12.5l5 5L20 7" />
    </svg>
  );
}

export function IconPlay({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 5.5v13l11-6.5-11-6.5z" />
    </svg>
  );
}

export function IconPause({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function IconDownload({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function IconRecord({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

export function IconCrosshair({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}

export function IconRing({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <ellipse cx="12" cy="15" rx="8" ry="4" />
      <path d="M8 15c0-3 1.5-9 4-9s4 6 4 9" />
    </svg>
  );
}

export function IconImport({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function IconRotateCcw({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

export function IconRotateCw({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

export function IconOpacity({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}

export function IconTrash({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}
