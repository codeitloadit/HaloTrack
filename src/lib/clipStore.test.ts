import { describe, expect, it } from "vitest";
import { allTags } from "./clipStore";
import { formatDuration } from "./clipMedia";
import { appReducer, initialState } from "../state/appReducer";
import type { ClipMeta } from "../state/types";

function clip(tags: string[]): ClipMeta {
  return {
    id: tags.join(","),
    createdAt: 0,
    durationSec: 1,
    width: 1,
    height: 1,
    mimeType: "video/mp4",
    tags,
    thumbnail: new Blob(),
  };
}

describe("allTags", () => {
  it("lists each tag once, most used first", () => {
    expect(allTags([clip(["Sam"]), clip(["Alex", "Sam"]), clip(["Game 3", "Alex", "Sam"])])).toEqual([
      "Sam",
      "Alex",
      "Game 3",
    ]);
  });

  it("breaks ties alphabetically", () => {
    expect(allTags([clip(["Zed"]), clip(["Amy"])])).toEqual(["Amy", "Zed"]);
  });

  it("ignores untagged clips", () => {
    expect(allTags([clip([])])).toEqual([]);
  });
});

describe("formatDuration", () => {
  it("shows minutes and zero-padded seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9.9)).toBe("0:09");
    expect(formatDuration(75)).toBe("1:15");
  });
});

describe("app navigation", () => {
  it("opens on the clip library", () => {
    expect(initialState.phase).toBe("library");
  });

  it("returns to the library on reset, dropping the project", () => {
    const tracking = { ...initialState, phase: "track" as const, keyframes: [{ timestamp: 0, headY: 0, feetY: 1, centerX: 0.5, offscreen: false }] };
    const reset = appReducer(tracking, { type: "RESET" });
    expect(reset.phase).toBe("library");
    expect(reset.keyframes).toEqual([]);
  });
});
