import { useEffect, useRef, useState } from "react";
import PhaseNav from "../../components/PhaseNav";
import { IconDownload } from "../../components/icons";
import { exportVideo, hasSupportedExportFormat } from "../../lib/export";
import { useAppDispatch, useAppState } from "../../state/AppStateContext";

export default function ExportPhase() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [progress, setProgress] = useState<number | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultPoster, setResultPoster] = useState<string | null>(null);
  const started = useRef(false);

  const project = state.project;
  const supported = hasSupportedExportFormat();

  useEffect(() => {
    if (started.current || !project || !supported) return;
    started.current = true;
    void handleExport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, supported]);

  if (!project) return null;

  async function handleExport() {
    if (!project) return;
    setProgress(0);
    setResultUrl(null);
    setResultPoster(null);
    const { blob, posterDataUrl } = await exportVideo(project, state.keyframes, state.halo, (f) => setProgress(f));
    const url = URL.createObjectURL(blob);
    setResultUrl(url);
    setResultBlob(blob);
    setResultPoster(posterDataUrl);
    setProgress(null);
  }

  async function handleSave() {
    if (!resultBlob || !resultUrl) return;
    const extension = resultBlob.type.includes("mp4") ? "mp4" : "webm";
    const file = new File([resultBlob], `halotrack-export.${extension}`, { type: resultBlob.type });
    const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = file.name;
    a.click();
  }

  return (
    <div className="phase-container">
      <div className="export-stage">
        {resultUrl ? (
          <video
            src={resultUrl}
            poster={resultPoster ?? undefined}
            controls
            playsInline
            className="export-preview-video"
          />
        ) : (
          <div className="export-placeholder" />
        )}
      </div>

      <div className="export-controls">
        {progress !== null && <div className="export-progress" style={{ ["--p" as string]: progress }} />}
        {resultUrl && (
          <button type="button" className="export-save-btn" onClick={handleSave}>
            <IconDownload size={18} />
            <span>Export Video</span>
          </button>
        )}
        {!supported && !resultUrl && progress === null && (
          <div className="video-diagnostic">No supported export format on this browser</div>
        )}
      </div>

      <PhaseNav onBack={() => dispatch({ type: "SET_PHASE", phase: "preview" })} />
    </div>
  );
}
