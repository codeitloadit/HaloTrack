import { useState, type FormEvent } from "react";
import { applyBulkTags, bulkTagStates, canonicalTag, type BulkTagState } from "../lib/clipFilters";
import type { ClipMeta } from "../state/types";

interface BulkTagSheetProps {
  clips: ClipMeta[];
  knownTags: string[];
  busy?: boolean;
  /** Receives only the clips whose tags changed. */
  onSave: (changed: ClipMeta[]) => void;
  onCancel: () => void;
}

/**
 * Edits tags across several clips. A tag some of the clips have shows as
 * partial and is left alone unless tapped; tapping cycles it through on all
 * clips, on none, and (for such a tag) back to untouched.
 */
export default function BulkTagSheet({ clips, knownTags, busy, onSave, onCancel }: BulkTagSheetProps) {
  const [initial] = useState(() => bulkTagStates(clips, knownTags));
  const [states, setStates] = useState(initial);
  const [draft, setDraft] = useState("");
  const tags = [...states.keys()];

  function cycle(tag: string) {
    const state = states.get(tag);
    const next: BulkTagState = state === "all" ? "none" : state === "none" && initial.get(tag) === "some" ? "some" : "all";
    setStates(new Map(states).set(tag, next));
  }

  function addDraft(): Map<string, BulkTagState> {
    const tag = canonicalTag(draft, tags);
    setDraft("");
    if (!tag) return states;
    const next = new Map(states).set(tag, "all");
    setStates(next);
    return next;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    addDraft();
  }

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          Tags for {clips.length} {clips.length === 1 ? "clip" : "clips"}
        </div>

        <div className="tag-chips">
          {tags.map((tag) => {
            const state = states.get(tag)!;
            return (
              <button
                key={tag}
                type="button"
                className={`tag-chip${state === "all" ? " selected" : state === "some" ? " partial" : ""}`}
                onClick={() => cycle(tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
        {[...states.values()].includes("some") && (
          <div className="sheet-hint">Outlined tags are on some of the clips and stay that way unless you tap them.</div>
        )}

        <form className="tag-new" onSubmit={handleSubmit}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="New tag"
            enterKeyHint="done"
            autoCapitalize="words"
            autoCorrect="off"
          />
          <button type="submit" className="sheet-btn" disabled={!draft.trim()}>
            Add
          </button>
        </form>

        <div className="sheet-actions">
          <button type="button" className="sheet-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="sheet-btn primary" onClick={() => onSave(applyBulkTags(clips, addDraft()))} disabled={busy}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
