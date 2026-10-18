import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import type { HaloStyle } from "../state/types";
import { IconEyedropper, IconGroundOnly, IconOpacity, IconRotateCcw, IconRotateCw, IconTolerance } from "./icons";

const RAINBOW_CSS =
  "conic-gradient(hsl(0,100%,55%), hsl(60,100%,55%), hsl(120,100%,55%), hsl(180,100%,55%), hsl(240,100%,55%), hsl(300,100%,55%), hsl(360,100%,55%))";
const MAX_GROUND_COLORS = 6;
// Speeds this close to zero snap to "off", so the slider's centre is easy to hit.
const ROTATION_SNAP = 0.05;

function swatchBackground(style: HaloStyle, color: string, secondColor: string): string {
  if (style === "rainbow") return RAINBOW_CSS;
  if (style === "gradient") return `conic-gradient(${color}, ${secondColor}, ${color}, ${secondColor}, ${color})`;
  if (style === "comet") {
    return `conic-gradient(from 180deg, transparent, ${color} 45%, transparent 45% 50%, ${secondColor} 95%, transparent 95%)`;
  }
  return color;
}

const STYLES: { style: HaloStyle; label: string }[] = [
  { style: "solid", label: "solid color" },
  { style: "gradient", label: "two-color gradient" },
  { style: "comet", label: "comet" },
  { style: "rainbow", label: "rainbow" },
];

interface ColorPickerButtonProps {
  color: string;
  secondColor: string;
  opacity: number;
  style: HaloStyle;
  rotationSpeed: number;
  onColorChange: (color: string) => void;
  onSecondColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
  onStyleChange: (style: HaloStyle) => void;
  onRotationSpeedChange: (speed: number) => void;
  /** Starts picking a colour from the video; the picked colour goes to `apply`. */
  onEyedropper: (apply: (color: string) => void) => void;
  /** Picking from the video: the panel steps aside, and tapping the swatch cancels. */
  sampling: boolean;
  onCancelSampling: () => void;
  groundOnly: boolean;
  groundColors: string[];
  groundTolerance: number;
  onGroundOnlyChange: (on: boolean) => void;
  onGroundColorsChange: (colors: string[]) => void;
  onGroundToleranceChange: (tolerance: number) => void;
}

export default function ColorPickerButton({
  color,
  secondColor,
  opacity,
  style,
  rotationSpeed,
  onColorChange,
  onSecondColorChange,
  onOpacityChange,
  onStyleChange,
  onRotationSpeedChange,
  onEyedropper,
  sampling,
  onCancelSampling,
  groundOnly,
  groundColors,
  groundTolerance,
  onGroundOnlyChange,
  onGroundColorsChange,
  onGroundToleranceChange,
}: ColorPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [editingSecond, setEditingSecond] = useState(false);
  const twoColors = style === "comet" || style === "gradient";
  const pickingSecond = twoColors && editingSecond;
  const colorLabels = style === "comet" ? ["comet 1 color", "comet 2 color"] : ["north/south color", "east/west color"];

  return (
    <div className="color-picker-btn">
      <button
        type="button"
        className="color-swatch"
        style={{ background: swatchBackground(style, color, secondColor), opacity: 0.3 + opacity * 0.7 }}
        onClick={() => (sampling ? onCancelSampling() : setOpen((v) => !v))}
        aria-label={sampling ? "cancel picking from video" : "halo style"}
      />
      {open && !sampling && (
        <div className="color-picker-popover">
          <div className="halo-mode-toggle">
            {STYLES.map((s) => (
              <button
                key={s.style}
                type="button"
                className={style === s.style ? "active" : ""}
                style={{ background: swatchBackground(s.style, color, secondColor) }}
                onClick={() => onStyleChange(s.style)}
                aria-label={s.label}
              />
            ))}
          </div>
          {style !== "rainbow" && (
            <div className="comet-color-select">
              {twoColors &&
                [color, secondColor].map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    className={(i === 1) === editingSecond ? "active" : ""}
                    style={{ background: c }}
                    onClick={() => setEditingSecond(i === 1)}
                    aria-label={colorLabels[i]}
                  />
                ))}
              <button
                type="button"
                className="eyedropper-btn"
                onClick={() => onEyedropper(pickingSecond ? onSecondColorChange : onColorChange)}
                aria-label="pick color from video"
              >
                <IconEyedropper />
              </button>
            </div>
          )}
          {style !== "rainbow" && (
            <HexColorPicker
              color={pickingSecond ? secondColor : color}
              onChange={pickingSecond ? onSecondColorChange : onColorChange}
            />
          )}
          {style !== "solid" && (
            <div className="slider-row">
              <IconRotateCcw size={20} />
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
              <IconRotateCw size={20} />
            </div>
          )}
          <div className="ground-row">
            <button
              type="button"
              className={`ground-toggle${groundOnly ? " active" : ""}`}
              onClick={() => onGroundOnlyChange(!groundOnly)}
              aria-pressed={groundOnly}
              aria-label="only draw on the ground"
            >
              <IconGroundOnly />
            </button>
            {groundOnly &&
              groundColors.map((c, i) => (
                <button
                  key={`${c}-${i}`}
                  type="button"
                  className="ground-chip"
                  style={{ background: c }}
                  onClick={() => onGroundColorsChange(groundColors.filter((_, j) => j !== i))}
                  aria-label={`remove ground color ${c}`}
                />
              ))}
            {groundOnly && groundColors.length < MAX_GROUND_COLORS && (
              <button
                type="button"
                className="ground-add"
                onClick={() => onEyedropper((c) => onGroundColorsChange([...groundColors, c]))}
                aria-label="add ground color from video"
              >
                <IconEyedropper />
              </button>
            )}
          </div>
          {groundOnly && (
            <div className="slider-row">
              <IconTolerance size={20} />
              <input
                type="range"
                className="row-slider"
                min={10}
                max={120}
                step={1}
                value={groundTolerance}
                onChange={(e) => onGroundToleranceChange(Number(e.target.value))}
                aria-label="ground color tolerance"
              />
            </div>
          )}
          <div className="slider-row">
            <IconOpacity size={20} />
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
