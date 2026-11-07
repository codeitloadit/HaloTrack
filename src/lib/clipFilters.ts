import type { ClipMeta } from "../state/types";

/** No tags and not untagged means everything. Several tags narrow down: a clip must have all of them. */
export interface ClipFilter {
  tags: string[];
  untagged: boolean;
}

export const NO_FILTER: ClipFilter = { tags: [], untagged: false };

export function matchesFilter(clip: ClipMeta, filter: ClipFilter): boolean {
  if (filter.untagged) return clip.tags.length === 0;
  return filter.tags.every((tag) => clip.tags.includes(tag));
}

/** Reuses an existing tag's spelling when the typed one only differs by case. */
export function canonicalTag(input: string, existing: string[]): string | null {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return existing.find((t) => t.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
}

/** How a tag applies across several clips at once. */
export type BulkTagState = "all" | "some" | "none";

export function bulkTagStates(clips: ClipMeta[], tags: string[]): Map<string, BulkTagState> {
  const states = new Map<string, BulkTagState>();
  for (const tag of tags) {
    const count = clips.filter((c) => c.tags.includes(tag)).length;
    states.set(tag, count === 0 ? "none" : count === clips.length ? "all" : "some");
  }
  return states;
}

/**
 * Applies a bulk tag edit: "all" adds the tag to every clip, "none" removes it
 * from every clip, and "some" leaves each clip as it was. Returns only the
 * clips whose tags actually changed.
 */
export function applyBulkTags(clips: ClipMeta[], states: Map<string, BulkTagState>): ClipMeta[] {
  const changed: ClipMeta[] = [];
  for (const clip of clips) {
    const tags = clip.tags.filter((t) => states.get(t) !== "none");
    for (const [tag, state] of states) {
      if (state === "all" && !tags.includes(tag)) tags.push(tag);
    }
    if (tags.length !== clip.tags.length || tags.some((t, i) => t !== clip.tags[i])) changed.push({ ...clip, tags });
  }
  return changed;
}
