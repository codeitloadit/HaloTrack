import { describe, expect, it } from "vitest";
import type { Detection, Rect } from "./autoTrack";
import { runAutoTrack, type AutoTrackSession } from "./autoTrackRunner";
import { mergeAutoKeyframes } from "./keyframes";
import type { TrackKeyframe } from "../state/types";

const frame = { w: 720, h: 1280 };

function person(cx: number, cy: number, h = 300): Detection {
  const w = h / 3;
  return { x: cx - w / 2, y: cy - h / 2, w, h, score: 0.9 };
}

function session(scene: (t: number) => Detection[]): AutoTrackSession {
  return {
    frame,
    wholeFrame: { x: -280, y: 0, w: 1280, h: 1280 },
    async detect(region: Rect, t: number) {
      return scene(t).filter((d) => {
        const cx = d.x + d.w / 2;
        const cy = d.y + d.h / 2;
        return cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h;
      });
    },
    close() {},
  };
}

const at = (keyframes: TrackKeyframe[], t: number) => keyframes.find((k) => Math.abs(k.timestamp - t) < 1e-6);

// Two players standing still: A on the left, B on the right.
const a = person(200, 600);
const b = person(520, 600);
const scene = () => [a, b];
const onA = (timestamp: number, auto?: "ok" | "low"): TrackKeyframe => ({
  timestamp, headY: 450 / frame.h, feetY: 750 / frame.h, centerX: 200 / frame.w, offscreen: false, ...(auto && { auto }),
});

describe("runAutoTrack from a pick", () => {
  it("switches every later step to the picked player and leaves earlier ones alone", async () => {
    const existing = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((t) => onA(t, "ok"));
    const run = await runAutoTrack(session(scene), { box: b }, 1.5, 3, existing, "pick", new AbortController().signal, () => {});
    const merged = mergeAutoKeyframes(existing, run.keyframes);
    expect(run.from).toBe(1.5);
    for (const t of [0, 0.5, 1]) expect(at(merged, t)).toEqual(at(existing, t));
    for (const t of [1.5, 2, 2.5, 3]) expect(at(merged, t)!.centerX).toBeCloseTo(520 / frame.w, 2);
    expect(at(merged, 1.5)!.auto).toBeUndefined();
  });

  it("replaces a step set by hand where the new player is picked, but keeps later ones as anchors", async () => {
    const existing = [onA(0), onA(1), onA(2)];
    const run = await runAutoTrack(session(scene), { box: b }, 1, 3, existing, "pick", new AbortController().signal, () => {});
    const merged = mergeAutoKeyframes(existing, run.keyframes);
    expect(at(merged, 1)!.centerX).toBeCloseTo(520 / frame.w, 2);
    expect(at(merged, 2)).toEqual(onA(2));
    // Re-seeded from the step at 2s, so tracking carries on with A after it.
    expect(at(merged, 3)!.centerX).toBeCloseTo(200 / frame.w, 2);
  });

  it("only tracks backwards over untracked steps", async () => {
    const existing = [onA(0, "ok")];
    const run = await runAutoTrack(session(scene), { box: b }, 1.5, 2, existing, "pick", new AbortController().signal, () => {});
    expect(run.keyframes.map((k) => k.timestamp).sort()).toEqual([0.5, 1, 1.5, 2]);
    expect(run.from).toBe(0.5);
  });
});
