import { describe, expect, it } from "vitest";
import { groundAlpha, groundKeys } from "./groundMask";

describe("groundAlpha", () => {
  const turf = groundKeys(["#2f7fd0"]);

  it("treats the ground colour as ground", () => {
    expect(groundAlpha(0x2f, 0x7f, 0xd0, turf, 40)).toBe(1);
  });

  it("still matches the ground in shadow or under brighter light", () => {
    // Same hue, a quarter darker and a quarter brighter.
    expect(groundAlpha(0x23, 0x5f, 0x9c, turf, 40)).toBe(1);
    expect(groundAlpha(0x3b, 0x9f, 0xff, turf, 40)).toBeGreaterThan(0.5);
  });

  it("rejects things on top of the ground: skin, white kit, dark shoes", () => {
    expect(groundAlpha(0xc6, 0x8e, 0x6b, turf, 40)).toBe(0);
    expect(groundAlpha(0xf2, 0xf2, 0xf2, turf, 40)).toBe(0);
    expect(groundAlpha(0x18, 0x18, 0x18, turf, 40)).toBe(0);
  });

  it("fades softly between ground and not-ground", () => {
    const halfway = groundAlpha(0x5a, 0x7f, 0xa8, turf, 40);
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(1);
  });

  it("matches any of several ground colours, like turf stripes and lines", () => {
    const keys = groundKeys(["#2f7fd0", "#f0f0f0"]);
    expect(groundAlpha(0xf2, 0xf2, 0xf2, keys, 40)).toBe(1);
  });
});
