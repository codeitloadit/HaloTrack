import { describe, expect, it } from "vitest";
import {
  createTracker,
  pickTarget,
  sampleTimes,
  trackPass,
  type Detection,
  type FrameSize,
  type Rect,
} from "./autoTrack";
import { gridTimes } from "./keyframes";
import type { TrackKeyframe } from "../state/types";

const frame: FrameSize = { w: 720, h: 1280 };

// A person 300px tall whose box is 100px wide, positioned by its centre.
function person(cx: number, cy: number, h = 300, score = 0.9): Detection {
  const w = h / 3;
  return { x: cx - w / 2, y: cy - h / 2, w, h, score };
}

// Detections the scene contains at time t, limited to the searched region like
// the real detector (which only sees the cropped area).
function detector(scene: (t: number) => Detection[]) {
  return async (region: Rect, t: number) =>
    scene(t).filter((d) => {
      const cx = d.x + d.w / 2;
      const cy = d.y + d.h / 2;
      return cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h;
    });
}

async function run(
  scene: (t: number) => Detection[],
  duration: number,
  manual = new Map<number, TrackKeyframe>(),
  seed = scene(0)[0],
) {
  const tracker = createTracker(seed, frame);
  return trackPass(tracker, sampleTimes(0, duration), duration, manual, detector(scene), () => {}, new AbortController().signal);
}

describe("gridTimes", () => {
  it("matches the steps the Track phase creates, ending exactly at the duration", () => {
    expect(gridTimes(2)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(gridTimes(1.2)).toEqual([0, 0.5, 1, 1.2]);
  });
});

describe("sampleTimes", () => {
  it("steps every 0.25s in either direction, including both ends", () => {
    expect(sampleTimes(0, 1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(sampleTimes(1, 0)).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(sampleTimes(0, 0.6)).toEqual([0, 0.25, 0.5, 0.6]);
  });
});

describe("pickTarget", () => {
  const boxes = [person(200, 600), person(500, 600)];
  it("picks the box containing the tap", () => {
    expect(pickTarget(boxes, { x: 510, y: 650 }, frame)).toBe(boxes[1]);
  });
  it("falls back to the nearest box within 0.1 of the frame height", () => {
    expect(pickTarget(boxes, { x: 300, y: 600 }, frame)).toBe(boxes[0]);
  });
  it("returns null when nothing is close", () => {
    expect(pickTarget(boxes, { x: 360, y: 100 }, frame)).toBeNull();
  });
});

describe("trackPass", () => {
  it("follows a moving player and emits a keyframe at every step", async () => {
    const keyframes = await run((t) => [person(200 + t * 100, 600)], 2);
    expect(keyframes.map((k) => k.timestamp)).toEqual([0.5, 1, 1.5, 2]);
    const last = keyframes[keyframes.length - 1];
    expect(last.centerX).toBeCloseTo(400 / frame.w, 2);
    expect(last.headY).toBeCloseTo(450 / frame.h, 2);
    expect(last.feetY).toBeCloseTo(750 / frame.h, 2);
    expect(keyframes.every((k) => k.auto === "ok" && !k.offscreen)).toBe(true);
  });

  it("keeps the right player when two cross, and flags the crossing", async () => {
    // A runs right, B runs left, at the same height; they overlap exactly at
    // t = 1, after which only A's momentum tells them apart. B is listed first so
    // a tie wouldn't happen to favour A.
    const a = (t: number) => person(200 + t * 150, 600);
    const b = (t: number) => person(500 - t * 150, 600);
    const keyframes = await run((t) => [b(t), a(t)], 2, undefined, a(0));
    const last = keyframes[keyframes.length - 1];
    expect(last.centerX).toBeCloseTo(500 / frame.w, 1);
    expect(keyframes.some((k) => k.auto === "low")).toBe(true);
  });

  it("marks the player off-screen after leaving by an edge, and picks them up again", async () => {
    // Moves left from x=150, exits around t=1, comes back from the left at t=2.5.
    const scene = (t: number) => {
      if (t < 1) return [person(150 - t * 150, 600)];
      if (t < 2.5) return [];
      return [person(30 + (t - 2.5) * 100, 600)];
    };
    const keyframes = await run(scene, 3.5);
    const at = (t: number) => keyframes.find((k) => k.timestamp === t)!;
    expect(at(1.5).offscreen).toBe(true);
    expect(at(1.5).centerX).toBeLessThan(0);
    expect(at(3.5).offscreen).toBe(false);
    expect(at(3.5).centerX).toBeCloseTo(130 / frame.w, 1);
  });

  it("carries the player through a short mid-frame occlusion, flagged low", async () => {
    const scene = (t: number) => (t > 0.6 && t < 1.4 ? [] : [person(360 + t * 40, 600)]);
    const keyframes = await run(scene, 2);
    const at = (t: number) => keyframes.find((k) => k.timestamp === t)!;
    expect(at(1).auto).toBe("low");
    expect(at(1).offscreen).toBe(false);
    expect(at(2).auto).toBe("ok");
    expect(at(2).centerX).toBeCloseTo(440 / frame.w, 2);
  });

  it("re-seeds from a hand-set keyframe instead of overwriting it", async () => {
    // The detector would follow the wrong player from t=1; the hand-set keyframe
    // at t=1 puts the tracker back on the right one.
    const scene = () => [person(200, 600), person(520, 600)];
    const manual = new Map<number, TrackKeyframe>([
      [1, { timestamp: 1, headY: 450 / frame.h, feetY: 750 / frame.h, centerX: 520 / frame.w, offscreen: false }],
    ]);
    const keyframes = await run(scene, 2, manual);
    expect(keyframes.map((k) => k.timestamp)).toEqual([0.5, 1.5, 2]);
    expect(keyframes[2].centerX).toBeCloseTo(520 / frame.w, 2);
  });
});
