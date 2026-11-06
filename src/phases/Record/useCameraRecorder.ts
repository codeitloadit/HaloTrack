import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { captureThumbnail } from "../../lib/clipMedia";
import { pickSupportedMime } from "../../lib/export";

export type FacingMode = "environment" | "user";

export interface RecordedClip {
  blob: Blob;
  mimeType: string;
  /** Wall-clock length of the recording, used when the file itself doesn't report one. */
  durationSec: number;
  thumbnail: Blob;
}

const VIDEO_CONSTRAINTS = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 60 },
};
const VIDEO_BITS_PER_SECOND = 8_000_000;
// Same reasoning as the exporter: without a timeslice WebKit buffers the whole
// encoded stream until stop(), which degrades longer recordings.
const TIMESLICE_MS = 1000;
const ELAPSED_TICK_MS = 250;

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

async function openCamera(facingMode: FacingMode): Promise<MediaStream> {
  const video = { ...VIDEO_CONSTRAINTS, facingMode };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: true });
  } catch (err) {
    // A missing or refused microphone shouldn't block recording video.
    if (err instanceof DOMException && (err.name === "NotFoundError" || err.name === "NotAllowedError")) {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    }
    throw err;
  }
}

function describeCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") return "Camera access was denied. Allow it in Settings to record.";
    if (err.name === "NotFoundError") return "No camera found.";
    return `Camera error: ${err.name} — ${err.message}`;
  }
  return `Camera error: ${String(err)}`;
}

/**
 * Keeps a camera stream open (shown in `videoRef`) for as long as the caller is
 * mounted, so clips can be recorded back to back without re-acquiring it.
 */
export function useCameraRecorder(videoRef: RefObject<HTMLVideoElement | null>) {
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const thumbnailRef = useRef<Promise<Blob> | null>(null);

  const cameraSupported = Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (!cameraSupported) return;
    let cancelled = false;
    let acquired: MediaStream | null = null;
    openCamera(facingMode)
      .then((s) => {
        if (cancelled) return stopTracks(s);
        acquired = s;
        setStream(s);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(describeCameraError(err));
      });
    return () => {
      cancelled = true;
      if (acquired) stopTracks(acquired);
      setStream(null);
    };
  }, [facingMode, cameraSupported]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => {});
  }, [videoRef, stream]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => setElapsed((performance.now() - startedAtRef.current) / 1000), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, [isRecording]);

  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    },
    [],
  );

  const start = useCallback(() => {
    const video = videoRef.current;
    if (!stream || !video || recorderRef.current) return;
    const recorder = new MediaRecorder(stream, {
      mimeType: pickSupportedMime(),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    thumbnailRef.current = captureThumbnail(video);
    recorder.start(TIMESLICE_MS);
    recorderRef.current = recorder;
    startedAtRef.current = performance.now();
    setElapsed(0);
    setIsRecording(true);
  }, [stream, videoRef]);

  const stop = useCallback((): Promise<RecordedClip> => {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.reject(new Error("Not recording"));
    const durationSec = (performance.now() - startedAtRef.current) / 1000;
    return new Promise<RecordedClip>((resolve, reject) => {
      recorder.onstop = async () => {
        recorderRef.current = null;
        setIsRecording(false);
        const mimeType = recorder.mimeType || chunksRef.current[0]?.type || "video/mp4";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        try {
          const thumbnail = await thumbnailRef.current!;
          resolve({ blob, mimeType, durationSec, thumbnail });
        } catch (err) {
          reject(err);
        }
      };
      recorder.onerror = (e) => {
        recorderRef.current = null;
        setIsRecording(false);
        reject((e as Event & { error?: unknown }).error ?? new Error("Recording failed"));
      };
      recorder.stop();
    });
  }, []);

  const flip = useCallback(() => {
    if (recorderRef.current) return;
    setFacingMode((m) => (m === "environment" ? "user" : "environment"));
  }, []);

  return {
    ready: stream !== null,
    error: cameraSupported ? error : "Camera isn't available here. It needs HTTPS (or the home-screen app).",
    isRecording, elapsed, facingMode, start, stop, flip };
}
