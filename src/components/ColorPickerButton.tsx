import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import type { HaloStyle } from "../state/types";
import { IconOpacity, IconRotateCcw, IconRotateCw } from "./icons";

const RAINBOW_CSS =
  "conic-gradient(hsl(0,100%,55%), hsl(60,100%,55%), hsl(120,100%,55%), hsl(180,100%,55%), hsl(240,100%,55%), hsl(300,100%,55%), hsl(360,100%,55%))";
// Speeds this close to zero snap to "off", so the slider's centre is easy to hit.
const ROTATION_SNAP = 0.05;

function swatchBackground(style: HaloStyle, color: string): string {
  if (style === "rainbow") return RAINBOW_CSS;
  if (style === "comet") return `conic-gradient(from 180deg, transparent, ${color} 80%, transparent 80%)`;
  return color;
}

const STYLES: { style: HaloStyle; label: string }[] = [
  { style: "solid", label: "solid color" },
  { style: "comet", label: "comet" },
  { style: "rainbow", label: "rainbow" },
];

interface ColorPickerButtonProps {
  color: string;
  opacity: number;
  style: HaloStyle;
  rotationSpeed: number;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
  onStyleChange: (style: HaloStyle) => void;
  onRotationSpeedChange: (speed: number) => void;
}

export default function ColorPickerButton({
  color,
  opacity,
  style,
  rotationSpeed,
  onColorChange,
  onOpacityChange,
  onStyleChange,
  onRotationSpeedChange,
}: ColorPickerButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="color-picker-btn">
      <button
        type="button"
        className="color-swatch"
        style={{ background: swatchBackground(style, color), opacity: 0.3 + opacity * 0.7 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="halo style"
      />
      {open && (
        <div className="color-picker-popover">
          <div className="halo-mode-toggle">
            {STYLES.map((s) => (
              <button
                key={s.style}
                type="button"
                className={style === s.style ? "active" : ""}
                style={{ background: swatchBackground(s.style, color) }}
                onClick={() => onStyleChange(s.style)}
                aria-label={s.label}
              />
            ))}
          </div>
          {style !== "rainbow" && <HexColorPicker color={color} onChange={onColorChange} />}
          {style !== "solid" && (
            <div className="slider-row">
              <IconRotateCcw size={16} />
              <input
                type="range"
                className="row-slider"
                min={-1}
                max={1}
                step={0.01}
                value={rotationSpeed}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onRotationSpeedChange(Math.abs(v) < ROTATION_SNAP ? 0 : v);
                }}
                aria-label="rotation speed"
              />
              <IconRotateCw size={16} />
            </div>
          )}
          <div className="slider-row">
            <IconOpacity size={16} />
            <input
              type="range"
              className="row-slider"
              min={0}
              max={1}
              step={0.01}
              value={opacity}
              onChange={(e) => onOpacityChange(Number(e.target.value))}
              aria-label="opacity"
            />
          </div>
        </div>
      )}
    </div>
  );
}
