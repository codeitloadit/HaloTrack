import { useState, type FormEvent } from "react";
import { IconTrash } from "./icons";

interface TagSheetProps {
  /** "new" asks to keep or delete a fresh clip; "edit" just retags a saved one. */
  mode: "new" | "edit";
  knownTags: string[];
  initialTags?: string[];
  previewUrl?: string;
  busy?: boolean;
  onSave: (tags: string[]) => void;
  onDiscard: () => void;
}

/** Reuses an existing tag's spelling when the typed one only differs by case. */
function canonicalTag(input: string, existing: string[]): string | null {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return existing.find((t) => t.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
}

export default function TagSheet({ mode, knownTags, initialTags = [], previewUrl, busy, onSave, onDiscard }: TagSheetProps) {
  const [selected, setSelected] = useState<string[]>(initialTags);
  const [draft, setDraft] = useState("");
  const chips = [...knownTags, ...selected.filter((t) => !knownTags.includes(t))];

  function toggle(tag: string) {
    setSelected((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function addDraft(): string[] {
    const tag = canonicalTag(draft, chips);
    setDraft("");
    if (!tag || selected.includes(tag)) return selected;
    const next = [...selected, tag];
    setSelected(next);
    return next;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    addDraft();
  }

  return (
    <div className="sheet-backdrop" onClick={mode === "edit" && !busy ? onDiscard : undefined}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {previewUrl && <video className="sheet-preview" src={previewUrl} autoPlay muted loop playsInline />}

        <div className="tag-chips">
          {chips.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`tag-chip${selected.includes(tag) ? " selected" : ""}`}
              onClick={() => toggle(tag)}
            >
              {tag}
            </button>
          ))}
        </div>

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
          <button type="button" className={`sheet-btn${mode === "new" ? " danger" : ""}`} onClick={onDiscard} disabled={busy}>
            {mode === "new" && <IconTrash size={18} />}
            <span>{mode === "new" ? "Delete" : "Cancel"}</span>
          </button>
          <button type="button" className="sheet-btn primary" onClick={() => onSave(addDraft())} disabled={busy}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
