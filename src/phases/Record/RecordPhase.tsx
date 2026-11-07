import { useEffect, useRef, useState } from "react";
import TagSheet from "../../components/TagSheet";
import { IconChevronLeft, IconFlipCamera } from "../../components/icons";
import { formatDuration, probeVideo, type VideoInfo } from "../../lib/clipMedia";
import { allTags, listClips, newClipId, saveClip } from "../../lib/clipStore";
import { useAppDispatch } from "../../state/AppStateContext";
import { useCameraRecorder, type RecordedClip } from "./useCameraRecorder";

interface PendingClip {
  clip: RecordedClip;
  info: VideoInfo;
  previewUrl: string;
}

export default function RecordPhase() {
  const dispatch = useAppDispatch();
  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useCameraRecorder(videoRef);
  const [pending, setPending] = useState<PendingClip | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [knownTags, setKnownTags] = useState<string[]>([]);

  useEffect(() => {
    listClips()
      .then((clips) => setKnownTags(allTags(clips)))
      .catch(() => {});
  }, []);

  async function handleShutter() {
    setMessage(null);
    if (!camera.isRecording) {
      camera.start();
      return;
    }
    setFinishing(true);
    try {
      const clip = await camera.stop();
      const info = await probeVideo(clip.blob, clip.durationSec);
      setPending({ clip, info, previewUrl: URL.createObjectURL(clip.blob) });
    } catch (err) {
      setMessage(`Recording failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFinishing(false);
    }
  }

  function closePending() {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  }

  async function handleSave(tags: string[]) {
    if (!pending) return;
    setSaving(true);
    try {
      await saveClip(
        {
          id: newClipId(),
          createdAt: Date.now(),
          ...pending.info,
          mimeType: pending.clip.mimeType,
          tags,
          thumbnail: pending.clip.thumbnail,
        },
        pending.clip.blob,
      );
      setKnownTags((prev) => [...prev, ...tags.filter((t) => !prev.includes(t))]);
      closePending();
    } catch (err) {
      setMessage(`Couldn't save the clip (storage may be full): ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="record-phase">
      <video
        ref={videoRef}
        className={`record-viewfinder${camera.facingMode === "user" ? " mirrored" : ""}`}
        autoPlay
        muted
        playsInline
      />

      {(camera.error || message) && <div className="video-diagnostic">{camera.error ?? message}</div>}

      <div className="record-top">
        <button
          type="button"
          className="icon-btn"
          onClick={() => dispatch({ type: "SET_PHASE", phase: "library" })}
          disabled={camera.isRecording || finishing}
          aria-label="back to library"
        >
          <IconChevronLeft />
        </button>
        {camera.isRecording && <div className="record-elapsed">{formatDuration(camera.elapsed)}</div>}
      </div>

      <div className="record-bottom">
        <div className="record-bottom-side start">
          {camera.canZoom2x && (
            <button
              type="button"
              className={`zoom-toggle${camera.zoom === 2 ? " zoomed" : ""}`}
              onClick={() => camera.setZoom(camera.zoom === 2 ? 1 : 2)}
              disabled={finishing}
              aria-label={camera.zoom === 2 ? "zoom out to 1x" : "zoom in to 2x"}
            >
              {camera.zoom}×
            </button>
          )}
        </div>
        <button
          type="button"
          className={`shutter${camera.isRecording ? " recording" : ""}`}
          onClick={handleShutter}
          disabled={!camera.ready || finishing || pending !== null}
          aria-label={camera.isRecording ? "stop recording" : "start recording"}
        >
          <span className="shutter-dot" />
        </button>
        <div className="record-bottom-side">
          <button
            type="button"
            className="icon-btn icon-btn-lg"
            onClick={camera.flip}
            disabled={camera.isRecording || finishing}
            aria-label="switch camera"
          >
            <IconFlipCamera />
          </button>
        </div>
      </div>

      {pending && (
        <TagSheet
          mode="new"
          knownTags={knownTags}
          previewUrl={pending.previewUrl}
          busy={saving}
          onSave={handleSave}
          onDiscard={closePending}
        />
      )}
    </div>
  );
}
