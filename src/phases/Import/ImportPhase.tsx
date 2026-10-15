import { useRef } from "react";
import { IconImport } from "../../components/icons";
import { loadTracking, videoKey } from "../../lib/savedTracking";
import { useAppDispatch } from "../../state/AppStateContext";

export default function ImportPhase() {
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = objectUrl;
    video.onloadedmetadata = () => {
      const key = videoKey(file, video.duration, video.videoWidth, video.videoHeight);
      dispatch({
        type: "LOAD_PROJECT",
        project: {
          key,
          file,
          objectUrl,
          durationSec: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        },
        savedKeyframes: loadTracking(key),
      });
    };
  }

  return (
    <div className="import-phase">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button type="button" className="import-btn" onClick={() => inputRef.current?.click()}>
        <IconImport size={22} />
        <span>Import Video</span>
      </button>
      <div className="app-version">{__APP_VERSION__}</div>
    </div>
  );
}
