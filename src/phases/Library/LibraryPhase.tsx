import { useEffect, useRef, useState } from "react";
import BulkTagSheet from "../../components/BulkTagSheet";
import TagSheet from "../../components/TagSheet";
import { IconCheck, IconDownload, IconImport, IconRecord, IconTag, IconTrash } from "../../components/icons";
import { matchesFilter, NO_FILTER, type ClipFilter } from "../../lib/clipFilters";
import { formatDuration, probeVideo, thumbnailFromBlob, thumbnailFromImageUrl, type VideoInfo } from "../../lib/clipMedia";
import {
  allTags,
  deleteClip,
  deleteClips,
  listClips,
  loadClipFile,
  newClipId,
  saveClip,
  updateClips,
  updateClipTags,
} from "../../lib/clipStore";
import { clipTrackingKey, loadTracking } from "../../lib/savedTracking";
import { shareFiles } from "../../lib/shareFiles";
import type { StabilizeResult } from "../../lib/stabilize/stabilize";
import { useAppDispatch } from "../../state/AppStateContext";
import type { ClipMeta } from "../../state/types";
import ClipDetail from "./ClipDetail";

interface PendingImport {
  file: File;
  info: VideoInfo;
  thumbnail: Blob;
  previewUrl: string;
}

const NOTICE_MS = 4000;

function BlobImage({ blob }: { blob: Blob }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    ref.current!.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return <img ref={ref} alt="" />;
}

function describeError(prefix: string, err: unknown): string {
  return `${prefix}: ${err instanceof Error ? err.message : String(err)}`;
}

export default function LibraryPhase() {
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const [clips, setClips] = useState<ClipMeta[] | null>(null);
  const [filter, setFilter] = useState<ClipFilter>(NO_FILTER);
  const [openClipId, setOpenClipId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  // Files for selected clips, loaded ahead of time: the share sheet must open
  // synchronously in the tap, with no time to read them from storage first.
  const [files, setFiles] = useState<ReadonlyMap<string, File>>(new Map());
  const [bulkTagging, setBulkTagging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listClips()
      .then(setClips)
      .catch((err) => {
        setClips([]);
        setMessage(describeError("Couldn't open the clip library", err));
      });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const loadedClips = clips ?? [];
  const tags = allTags(loadedClips);
  const hasUntagged = loadedClips.some((c) => c.tags.length === 0);
  // A filter outlives its last clip being deleted or retagged; drop what no longer applies.
  const activeFilter: ClipFilter = {
    tags: filter.tags.filter((t) => tags.includes(t)),
    untagged: filter.untagged && hasUntagged,
  };
  const visible = loadedClips.filter((c) => matchesFilter(c, activeFilter));
  const openClip = loadedClips.find((c) => c.id === openClipId) ?? null;
  // Selection only ever acts on what the filter shows.
  const selected = visible.filter((c) => selectedIds.has(c.id));
  const allVisibleSelected = visible.length > 0 && selected.length === visible.length;
  const toSave = selected.filter((c) => !c.savedAt);
  const filesReady = toSave.every((c) => files.has(c.id));

  async function handleImportFile(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const [info, thumbnail] = await Promise.all([probeVideo(file), thumbnailFromBlob(file)]);
      setPendingImport({ file, info, thumbnail, previewUrl: URL.createObjectURL(file) });
    } catch (err) {
      setMessage(describeError("Couldn't read that video", err));
    } finally {
      setBusy(false);
    }
  }

  function closePendingImport() {
    if (pendingImport) URL.revokeObjectURL(pendingImport.previewUrl);
    setPendingImport(null);
  }

  async function handleSaveImport(clipTags: string[]) {
    if (!pendingImport) return;
    const { file, info, thumbnail } = pendingImport;
    const clip: ClipMeta = {
      id: newClipId(),
      createdAt: Date.now(),
      ...info,
      mimeType: file.type || "video/mp4",
      tags: clipTags,
      thumbnail,
    };
    setBusy(true);
    try {
      await saveClip(clip, file);
      setClips((prev) => [clip, ...(prev ?? [])]);
      closePendingImport();
    } catch (err) {
      setMessage(describeError("Couldn't save the clip (storage may be full)", err));
    } finally {
      setBusy(false);
    }
  }

  function handleTrack(clip: ClipMeta, file: File) {
    const key = clipTrackingKey(clip.id);
    dispatch({
      type: "LOAD_PROJECT",
      project: {
        key,
        file,
        objectUrl: URL.createObjectURL(file),
        durationSec: clip.durationSec,
        width: clip.width,
        height: clip.height,
      },
      savedKeyframes: loadTracking(key),
    });
  }

  async function handleDelete(clip: ClipMeta) {
    try {
      await deleteClip(clip.id);
      setClips((prev) => (prev ?? []).filter((c) => c.id !== clip.id));
      setOpenClipId(null);
    } catch (err) {
      setMessage(describeError("Couldn't delete the clip", err));
    }
  }

  /** Saves the stabilized copy alongside the original (same tags, sorted right next to it) and opens it. */
  async function handleStabilized(original: ClipMeta, { blob, posterDataUrl }: StabilizeResult) {
    const info = await probeVideo(blob, original.durationSec);
    const thumbnail = posterDataUrl ? await thumbnailFromImageUrl(posterDataUrl) : original.thumbnail;
    const clip: ClipMeta = {
      id: newClipId(),
      createdAt: original.createdAt + 1,
      ...info,
      mimeType: blob.type || original.mimeType,
      tags: original.tags,
      thumbnail,
      stabilizedFrom: original.id,
    };
    await saveClip(clip, blob);
    setClips((prev) => [...(prev ?? []), clip].sort((a, b) => b.createdAt - a.createdAt));
    setOpenClipId(clip.id);
  }

  async function handleTagsChange(clip: ClipMeta, clipTags: string[]) {
    try {
      const updated = await updateClipTags(clip, clipTags);
      setClips((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setMessage(describeError("Couldn't update tags", err));
    }
  }

  function toggleTagFilter(tag: string) {
    const next = activeFilter.tags.includes(tag) ? activeFilter.tags.filter((t) => t !== tag) : [...activeFilter.tags, tag];
    setFilter({ tags: next, untagged: false });
  }

  function filterChip(label: string, selected: boolean, onClick: () => void) {
    return (
      <button key={label} type="button" className={`tag-chip${selected ? " selected" : ""}`} onClick={onClick}>
        {label}
      </button>
    );
  }

  function loadFiles(toLoad: ClipMeta[]) {
    for (const clip of toLoad) {
      if (clip.savedAt || files.has(clip.id)) continue;
      loadClipFile(clip)
        .then((file) => setFiles((prev) => new Map(prev).set(clip.id, file)))
        .catch((err) => setMessage(describeError("Couldn't load a clip", err)));
    }
  }

  function setSelection(ids: ReadonlySet<string>) {
    setSelectedIds(ids);
    loadFiles(loadedClips.filter((c) => ids.has(c.id)));
  }

  function toggleSelected(clip: ClipMeta) {
    const next = new Set(selectedIds);
    if (!next.delete(clip.id)) next.add(clip.id);
    setSelection(next);
  }

  function toggleSelectAll() {
    const next = new Set(selectedIds);
    for (const clip of visible) {
      if (allVisibleSelected) next.delete(clip.id);
      else next.add(clip.id);
    }
    setSelection(next);
  }

  function exitSelecting() {
    setSelecting(false);
    setSelectedIds(new Set());
    setFiles(new Map());
  }

  function replaceClips(updated: ClipMeta[]) {
    const byId = new Map(updated.map((c) => [c.id, c]));
    setClips((prev) => (prev ?? []).map((c) => byId.get(c.id) ?? c));
  }

  async function markSaved(saved: ClipMeta[]) {
    const savedAt = Date.now();
    const updated = saved.map((c) => ({ ...c, savedAt }));
    await updateClips(updated);
    replaceClips(updated);
  }

  function handleSaveSelected() {
    const skipped = selected.length - toSave.length;
    setMessage(null);
    setNotice(null);
    setBusy(true);
    shareFiles(toSave.map((c) => files.get(c.id)!))
      .then(async (shared) => {
        if (!shared) return;
        await markSaved(toSave);
        exitSelecting();
        if (skipped > 0) setNotice(`Skipped ${skipped} already saved ${skipped === 1 ? "clip" : "clips"}.`);
      })
      .catch((err) => setMessage(describeError("Couldn't save to Photos", err)))
      .finally(() => setBusy(false));
  }

  async function handleDeleteSelected() {
    const count = selected.length;
    if (!window.confirm(`Delete ${count} ${count === 1 ? "clip" : "clips"}? This can't be undone.`)) return;
    setBusy(true);
    try {
      const ids = new Set(selected.map((c) => c.id));
      await deleteClips([...ids]);
      setClips((prev) => (prev ?? []).filter((c) => !ids.has(c.id)));
      exitSelecting();
    } catch (err) {
      setMessage(describeError("Couldn't delete clips", err));
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkTags(changed: ClipMeta[]) {
    setBusy(true);
    try {
      await updateClips(changed);
      replaceClips(changed);
      setBulkTagging(false);
    } catch (err) {
      setMessage(describeError("Couldn't update tags", err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="library-phase">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleImportFile(file);
        }}
      />

      {message && (
        <div className="video-diagnostic" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}
      {notice && !message && (
        <div className="video-diagnostic info" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {loadedClips.length > 0 && (
        <div className="library-header">
          {selecting ? (
            <button type="button" className="library-header-btn" onClick={toggleSelectAll} disabled={busy || visible.length === 0}>
              {allVisibleSelected ? "Deselect All" : "Select All"}
            </button>
          ) : (
            <span className="library-title">Clips</span>
          )}
          {selecting && <span className="library-count">{selected.length} selected</span>}
          <button
            type="button"
            className="library-header-btn"
            onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
            disabled={busy}
          >
            {selecting ? "Done" : "Select"}
          </button>
        </div>
      )}

      {loadedClips.length > 0 && (
        <div className="library-filters">
          {filterChip("All", activeFilter.tags.length === 0 && !activeFilter.untagged, () => setFilter(NO_FILTER))}
          {tags.map((tag) => filterChip(tag, activeFilter.tags.includes(tag), () => toggleTagFilter(tag)))}
          {hasUntagged &&
            filterChip("Untagged", activeFilter.untagged, () => setFilter({ tags: [], untagged: !activeFilter.untagged }))}
        </div>
      )}

      <div className="library-body">
        {clips !== null && loadedClips.length === 0 ? (
          <div className="library-empty">
            <div>No clips yet.</div>
            <div>Record a clip or import one from Photos.</div>
          </div>
        ) : (
          <div className={`library-grid${selecting ? " selecting" : ""}`}>
            {visible.map((clip) => {
              const isSelected = selectedIds.has(clip.id);
              return (
                <button
                  key={clip.id}
                  type="button"
                  className={`library-tile${isSelected ? " selected" : ""}`}
                  onClick={() => (selecting ? toggleSelected(clip) : setOpenClipId(clip.id))}
                  aria-pressed={selecting ? isSelected : undefined}
                >
                  <BlobImage blob={clip.thumbnail} />
                  <span className="library-tile-duration">{formatDuration(clip.durationSec)}</span>
                  {clip.tags.length > 0 && <span className="library-tile-tags">{clip.tags.join(" · ")}</span>}
                  <span className="library-tile-badges">
                    {clip.savedAt && (
                      <span className="library-tile-saved" title="Saved to Photos" aria-label="saved to Photos">
                        <IconDownload size={12} />
                      </span>
                    )}
                    {clip.stabilizedFrom && <span className="library-tile-badge">Stabilized</span>}
                  </span>
                  {selecting && <span className="library-tile-check">{isSelected && <IconCheck size={14} />}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selecting ? (
        <div className="library-bar">
          <button
            type="button"
            className="library-action danger"
            onClick={handleDeleteSelected}
            disabled={busy || selected.length === 0}
          >
            <IconTrash size={22} />
            <span>Delete</span>
          </button>
          <button
            type="button"
            className="library-action"
            onClick={() => setBulkTagging(true)}
            disabled={busy || selected.length === 0}
          >
            <IconTag size={22} />
            <span>Tags</span>
          </button>
          <button
            type="button"
            className="library-action end"
            onClick={handleSaveSelected}
            disabled={busy || toSave.length === 0 || !filesReady}
          >
            <IconDownload size={22} />
            <span>
              {selected.length > 0 && toSave.length === 0
                ? "All saved"
                : toSave.length < selected.length
                  ? `Save ${toSave.length} new`
                  : "Save"}
            </span>
          </button>
        </div>
      ) : (
        <div className="library-bar">
          <button
            type="button"
            className="library-import-btn"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            aria-label="import video"
          >
            <IconImport size={22} />
            <span>Import</span>
          </button>
          <button
            type="button"
            className="library-record-btn"
            onClick={() => dispatch({ type: "SET_PHASE", phase: "record" })}
            disabled={busy}
            aria-label="record clips"
          >
            <IconRecord size={30} />
          </button>
          <div className="library-version">{__APP_VERSION__}</div>
        </div>
      )}

      {openClip && (
        <ClipDetail
          key={openClip.id}
          clip={openClip}
          knownTags={tags}
          onClose={() => setOpenClipId(null)}
          onTrack={(file) => handleTrack(openClip, file)}
          onDelete={() => handleDelete(openClip)}
          onTagsChange={(clipTags) => handleTagsChange(openClip, clipTags)}
          onSaved={() => markSaved([openClip])}
          onStabilized={(result) => handleStabilized(openClip, result)}
        />
      )}

      {bulkTagging && (
        <BulkTagSheet
          clips={selected}
          knownTags={tags}
          busy={busy}
          onSave={handleBulkTags}
          onCancel={() => setBulkTagging(false)}
        />
      )}

      {pendingImport && (
        <TagSheet
          mode="new"
          knownTags={tags}
          previewUrl={pendingImport.previewUrl}
          busy={busy}
          onSave={handleSaveImport}
          onDiscard={closePendingImport}
        />
      )}
    </div>
  );
}
