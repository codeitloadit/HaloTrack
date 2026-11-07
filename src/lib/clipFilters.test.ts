import { describe, expect, it } from "vitest";
import { applyBulkTags, bulkTagStates, matchesFilter, NO_FILTER, type BulkTagState } from "./clipFilters";
import type { ClipMeta } from "../state/types";

function clip(id: string, tags: string[]): ClipMeta {
  return { id, createdAt: 0, durationSec: 1, width: 1, height: 1, mimeType: "video/mp4", tags, thumbnail: new Blob() };
}

const a = clip("a", ["Sam", "Game 1"]);
const b = clip("b", ["Sam", "Game 2"]);
const c = clip("c", []);

describe("matchesFilter", () => {
  it("shows everything with no filter", () => {
    expect([a, b, c].filter((x) => matchesFilter(x, NO_FILTER))).toEqual([a, b, c]);
  });

  it("narrows down: a clip needs every selected tag", () => {
    expect([a, b, c].filter((x) => matchesFilter(x, { tags: ["Sam"], untagged: false }))).toEqual([a, b]);
    expect([a, b, c].filter((x) => matchesFilter(x, { tags: ["Sam", "Game 2"], untagged: false }))).toEqual([b]);
  });

  it("can show only untagged clips", () => {
    expect([a, b, c].filter((x) => matchesFilter(x, { tags: [], untagged: true }))).toEqual([c]);
  });
});

describe("bulk tags", () => {
  it("reports whether a tag is on all, some or none of the clips", () => {
    const states = bulkTagStates([a, b], ["Sam", "Game 1", "Other"]);
    expect(Object.fromEntries(states)).toEqual({ Sam: "all", "Game 1": "some", Other: "none" });
  });

  it("adds, removes, and leaves partial tags alone", () => {
    const states = new Map<string, BulkTagState>([
      ["Sam", "none"],
      ["Game 1", "some"],
      ["Game 2", "some"],
      ["Final", "all"],
    ]);
    const changed = applyBulkTags([a, b, c], states);
    expect(changed.map((x) => [x.id, x.tags])).toEqual([
      ["a", ["Game 1", "Final"]],
      ["b", ["Game 2", "Final"]],
      ["c", ["Final"]],
    ]);
  });

  it("returns only clips that changed", () => {
    expect(applyBulkTags([a, b], bulkTagStates([a, b], ["Sam", "Game 1"]))).toEqual([]);
  });
});
