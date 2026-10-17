import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

interface ColorSamplerProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Size of the displayed video, in CSS pixels. */
  width: number;
  height: number;
  onPick: (hex: string) => void;
}

/** Half the side, in video pixels, of the patch averaged into one colour, so noise doesn't speckle it. */
const PATCH_RADIUS = 2;
/** How far above the finger the magnifier floats, so the finger doesn't hide it. */
const LOUPE_OFFSET = 70;

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Touch and drag over the video to pick a colour from it; lifting the finger picks. */
export default function ColorSampler({ videoRef, width, height, onPick }: ColorSamplerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [probe, setProbe] = useState<{ x: number; y: number; hex: string } | null>(null);

  function sample(x: number, y: number): string | null {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    const side = PATCH_RADIUS * 2 + 1;
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const vx = Math.min(Math.max((x / width) * video.videoWidth, PATCH_RADIUS), video.videoWidth - PATCH_RADIUS - 1);
    const vy = Math.min(Math.max((y / height) * video.videoHeight, PATCH_RADIUS), video.videoHeight - PATCH_RADIUS - 1);
    ctx.drawImage(video, vx - PATCH_RADIUS, vy - PATCH_RADIUS, side, side, 0, 0, side, side);
    const { data } = ctx.getImageData(0, 0, side, side);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const n = data.length / 4;
    return toHex(r / n, g / n, b / n);
  }

  function update(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), width);
    const y = Math.min(Math.max(e.clientY - rect.top, 0), height);
    const hex = sample(x, y);
    if (hex) setProbe({ x, y, hex });
    return hex;
  }

  return (
    <div
      className="color-sampler"
      style={{ width, height }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        if (probe) update(e);
      }}
      onPointerUp={(e) => {
        const hex = update(e);
        setProbe(null);
        if (hex) onPick(hex);
      }}
      onPointerCancel={() => setProbe(null)}
    >
      {probe && (
        <>
          <div className="color-sampler-target" style={{ left: probe.x, top: probe.y }} />
          <div
            className="color-sampler-loupe"
            style={{ left: probe.x, top: Math.max(probe.y - LOUPE_OFFSET, 36), background: probe.hex }}
          />
        </>
      )}
    </div>
  );
}
