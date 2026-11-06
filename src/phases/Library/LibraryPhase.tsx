import { useEffect, useRef, useState } from "react";
import TagSheet from "../../components/TagSheet";
import { IconImport, IconRecord } from "../../components/icons";
import { formatDuration, probeVideo, thumbnailFromBlob, type VideoInfo } from "../../lib/clipMedia";
import { allTags, deleteClip, listClips, newClipId, saveClip, updateClipTags } from "../../lib/clipStore";
import { clipTrackingKey, loadTracking } from "../../lib/savedTracking";
import { useAppDispatch } from "../../state/AppStateContext";
import type { ClipMeta } from "../../state/types";
import ClipDetail from "./ClipDetail";

type Filter = { kind: "all" } | { kind: "untagged" } | { kind: "tag"; tag: string };

interface PendingImport {
  file: File;
  info: VideoInfo;
  thumbnail: Blob;
  previewUrl: string;
}

function matches(clip: ClipMeta, filter: Filter): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "untagged") return clip.tags.length === 0;
  return clip.tags.includes(filter.tag);
}

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
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [openClipId, setOpenClipId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    listClips()
      .then(setClips)
      .catch((err) => {
        setClips([]);
        setMessage(describeError("Couldn't open the clip library", err));
      });
  }, []);

  const loadedClips = clips ?? [];
  const tags = allTags(loadedClips);
  const hasUntagged = loadedClips.some((c) => c.tags.length === 0);
  // A tag filter outlives its last clip being deleted or retagged; fall back to everything then.
  const activeFilter: Filter =
    (filter.kind === "tag" && !tags.includes(filter.tag)) || (filter.kind === "untagged" && !hasUntagged)
      ? { kind: "all" }
      : filter;
  const visible = loadedClips.filter((c) => matches(c, activeFilter));
  const openClip = loadedClips.find((c) => c.id === openClipId) ?? null;

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

  async function handleTagsChange(clip: ClipMeta, clipTags: string[]) {
    try {
      const updated = await updateClipTags(clip, clipTags);
      setClips((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setMessage(describeError("Couldn't update tags", err));
    }
  }

  function filterChip(label: string, value: Filter) {
    const selected =
      activeFilter.kind === value.kind && (value.kind !== "tag" || (activeFilter.kind === "tag" && activeFilter.tag === value.tag));
    return (
      <button
        key={value.kind === "tag" ? `tag:${value.tag}` : value.kind}
        type="button"
        className={`tag-chip${selected ? " selected" : ""}`}
        onClick={() => setFilter(value)}
      >
        {label}
      </button>
    );
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

      {loadedClips.length > 0 && (
        <div className="library-filters">
          {filterChip("All", { kind: "all" })}
          {tags.map((tag) => filterChip(tag, { kind: "tag", tag }))}
          {hasUntagged && filterChip("Untagged", { kind: "untagged" })}
        </div>
      )}

      <div className="library-body">
        {clips !== null && loadedClips.length === 0 ? (
          <div className="library-empty">
            <div>No clips yet.</div>
            <div>Record a clip or import one from Photos.</div>
          </div>
        ) : (
          <div className="library-grid">
            {visible.map((clip) => (
              <button key={clip.id} type="button" className="library-tile" onClick={() => setOpenClipId(clip.id)}>
                <BlobImage blob={clip.thumbnail} />
                <span className="library-tile-duration">{formatDuration(clip.durationSec)}</span>
                {clip.tags.length > 0 && <span className="library-tile-tags">{clip.tags.join(" · ")}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

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

      {openClip && (
        <ClipDetail
          clip={openClip}
          knownTags={tags}
          onClose={() => setOpenClipId(null)}
          onTrack={(file) => handleTrack(openClip, file)}
          onDelete={() => handleDelete(openClip)}
          onTagsChange={(clipTags) => handleTagsChange(openClip, clipTags)}
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
