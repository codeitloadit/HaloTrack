import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import { IconRotateCcw, IconRotateCw } from "./icons";

const RAINBOW_CSS =
  "conic-gradient(hsl(0,100%,55%), hsl(60,100%,55%), hsl(120,100%,55%), hsl(180,100%,55%), hsl(240,100%,55%), hsl(300,100%,55%), hsl(360,100%,55%))";
// Speeds this close to zero snap to "off", so the slider's centre is easy to hit.
const ROTATION_SNAP = 0.05;

interface ColorPickerButtonProps {
  color: string;
  opacity: number;
  rainbow: boolean;
  rotationSpeed: number;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
  onRainbowChange: (rainbow: boolean) => void;
  onRotationSpeedChange: (speed: number) => void;
}

export default function ColorPickerButton({
  color,
  opacity,
  rainbow,
  rotationSpeed,
  onColorChange,
  onOpacityChange,
  onRainbowChange,
  onRotationSpeedChange,
}: ColorPickerButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="color-picker-btn">
      <button
        type="button"
        className="color-swatch"
        style={{ background: rainbow ? RAINBOW_CSS : color, opacity: 0.3 + opacity * 0.7 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="halo style"
      />
      {open && (
        <div className="color-picker-popover">
          <div className="halo-mode-toggle">
            <button
              type="button"
              className={rainbow ? "" : "active"}
              style={{ background: color }}
              onClick={() => onRainbowChange(false)}
              aria-label="solid color"
            />
            <button
              type="button"
              className={rainbow ? "active" : ""}
              style={{ background: RAINBOW_CSS }}
              onClick={() => onRainbowChange(true)}
              aria-label="rainbow"
            />
          </div>
          {rainbow ? (
            <div className="rotation-row">
              <IconRotateCcw size={16} />
              <input
                type="range"
                className="rotation-slider"
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
          ) : (
            <HexColorPicker color={color} onChange={onColorChange} />
          )}
          <input
            type="range"
            className="opacity-slider"
            min={0}
            max={1}
            step={0.01}
            value={opacity}
            onChange={(e) => onOpacityChange(Number(e.target.value))}
            aria-label="opacity"
          />
        </div>
      )}
    </div>
  );
}
