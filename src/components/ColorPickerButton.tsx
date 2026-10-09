import { useState } from "react";
import { HexColorPicker } from "react-colorful";

interface ColorPickerButtonProps {
  color: string;
  opacity: number;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
}

export default function ColorPickerButton({ color, opacity, onColorChange, onOpacityChange }: ColorPickerButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="color-picker-btn">
      <button
        type="button"
        className="color-swatch"
        style={{ background: color, opacity: 0.3 + opacity * 0.7 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="color"
      />
      {open && (
        <div className="color-picker-popover">
          <HexColorPicker color={color} onChange={onColorChange} />
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
