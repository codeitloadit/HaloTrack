import { describe, expect, it } from "vitest";
import { deriveHaloParams } from "./halo";
import { gridTimes } from "./keyframes";
import type { HaloConfig, TrackKeyframe } from "../state/types";

const halo: HaloConfig = {
  referenceTimestamp: 0,
  horizontalRadius: 0.35,
  verticalRadius: 0.08,
  offsetX: 0.1,
  offsetY: 0.03,
  color: "#ff0000",
  secondColor: "#ff0000",
  opacity: 0.5,
  style: "solid",
  rotationSpeed: 0,
};
const canvas = { width: 720, height: 1280 };
const at = (timestamp: number, headY: number, feetY: number, centerX: number, offscreen = false): TrackKeyframe => ({
  timestamp, headY, feetY, centerX, offscreen,
});

describe("gridTimes", () => {
  it("matches the steps the Track phase creates, ending exactly at the duration", () => {
    expect(gridTimes(2)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(gridTimes(1.2)).toEqual([0, 0.5, 1, 1.2]);
  });
});

describe("deriveHaloParams", () => {
  it("sizes and offsets the ring in player heights, around the feet", () => {
    // A player 0.25 of the frame tall (320px), feet at y=0.75, centred at x=0.5.
    const p = deriveHaloParams(0, [at(0, 0.5, 0.75, 0.5)], halo, canvas);
    expect(p.radiusX).toBeCloseTo(0.35 * 320);
    expect(p.radiusY).toBeCloseTo(0.08 * 320);
    expect(p.centerX).toBeCloseTo(360 + 0.1 * 320);
    expect(p.centerY).toBeCloseTo(960 + 0.03 * 320);
    expect(p.opacity).toBeCloseTo(0.5);
  });

  it("grows and shrinks with the player as they move nearer or further", () => {
    const keyframes = [at(0, 0.5, 0.75, 0.5), at(1, 0.25, 0.75, 0.5)];
    expect(deriveHaloParams(1, keyframes, halo, canvas).radiusX).toBeCloseTo(2 * deriveHaloParams(0, keyframes, halo, canvas).radiusX);
  });

  it("hides the ring while the player is off-screen", () => {
    expect(deriveHaloParams(0, [at(0, 0.5, 0.75, -0.05, true)], halo, canvas).opacity).toBe(0);
  });
});
