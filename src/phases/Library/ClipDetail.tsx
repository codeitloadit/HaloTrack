import { useEffect, useRef, useState } from "react";
import TagSheet from "../../components/TagSheet";
import { IconClose, IconRing, IconShare, IconTrash } from "../../components/icons";
import { useForceVideoFirstFrame } from "../../hooks/useForceVideoFirstFrame";
import { formatDuration } from "../../lib/clipMedia";
import { loadClipFile } from "../../lib/clipStore";
import type { ClipMeta } from "../../state/types";

interface ClipDetailProps {
  clip: ClipMeta;
  knownTags: string[];
  onClose: () => void;
  onTrack: (file: File) => void;
  onDelete: () => Promise<void>;
  onTagsChange: (tags: string[]) => Promise<void>;
}

export default function ClipDetail({ clip, knownTags, onClose, onTrack, onDelete, onTagsChange }: ClipDetailProps) {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const diagnostic = useForceVideoFirstFrame(videoRef, videoUrl);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    loadClipFile(clip)
      .then((f) => {
        if (cancelled) return;
        url = URL.createObjectURL(f);
        setFile(f);
        setVideoUrl(url);
      })
      .catch((err) => !cancelled && setError(`Couldn't load clip: ${err instanceof Error ? err.message : String(err)}`));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // Only the video identity matters; retagging must not reload the video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  async function handleShare() {
    if (!file) return;
    const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch {
        // Dismissing the share sheet rejects; nothing to do.
      }
      return;
    }
    const a = document.createElement("a");
    a.href = videoUrl!;
    a.download = file.name;
    a.click();
  }

  async function handleDelete() {
    if (!window.confirm("Delete this clip? This can't be undone.")) return;
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  }

  async function handleTags(tags: string[]) {
    setBusy(true);
    try {
      await onTagsChange(tags);
      setEditingTags(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="clip-detail">
      <div className="clip-detail-header">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="close">
          <IconClose />
        </button>
        <div className="clip-detail-title">
          {new Date(clip.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          <span className="clip-detail-duration">
            {formatDuration(clip.durationSec)} · {clip.width}×{clip.height}
          </span>
        </div>
      </div>

      <div className="clip-detail-stage">
        {videoUrl && <video ref={videoRef} src={videoUrl} controls playsInline className="clip-detail-video" />}
        {(error ?? diagnostic) && <div className="video-diagnostic">{error ?? diagnostic}</div>}
      </div>

      <button type="button" className="clip-detail-tags" onClick={() => setEditingTags(true)}>
        {clip.tags.length > 0 ? (
          clip.tags.map((tag) => (
            <span key={tag} className="tag-chip selected">
              {tag}
            </span>
          ))
        ) : (
          <span className="tag-chip">Add tags</span>
        )}
      </button>

      <div className="clip-detail-actions">
        <button type="button" className="icon-btn icon-btn-lg" onClick={handleDelete} disabled={busy} aria-label="delete clip">
          <IconTrash />
        </button>
        <button type="button" className="export-save-btn" onClick={() => file && onTrack(file)} disabled={!file || busy}>
          <IconRing size={18} />
          <span>Track Halo</span>
        </button>
        <button type="button" className="icon-btn icon-btn-lg" onClick={handleShare} disabled={!file || busy} aria-label="share clip">
          <IconShare />
        </button>
      </div>

      {editingTags && (
        <TagSheet
          mode="edit"
          knownTags={knownTags}
          initialTags={clip.tags}
          busy={busy}
          onSave={handleTags}
          onDiscard={() => setEditingTags(false)}
        />
      )}
    </div>
  );
}
