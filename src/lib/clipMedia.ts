import { seekTo } from "./video";

export interface VideoInfo {
  durationSec: number;
  width: number;
  height: number;
}

const THUMBNAIL_WIDTH = 320;
const DURATION_PROBE_TIMEOUT_MS = 3000;
const FRAME_TIMEOUT_MS = 1500;
const IMPORT_THUMBNAIL_TIME = 0.1;

/**
 * A muted, inline video kept off-screen but attached, since some mobile browsers
 * won't decode frames for media elements that aren't in the document.
 */
function createProbeVideo(url: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.style.position = "fixed";
  video.style.left = "-100000px";
  video.style.top = "0";
  video.style.pointerEvents = "none";
  video.src = url;
  document.body.appendChild(video);
  return video;
}

function disposeProbeVideo(video: HTMLVideoElement, url: string) {
  video.removeAttribute("src");
  video.load();
  video.remove();
  URL.revokeObjectURL(url);
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= video.HAVE_METADATA) return resolve();
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(video.error ?? new Error("Could not read video")), { once: true });
  });
}

/**
 * MediaRecorder output on some browsers (notably Chrome's webm) reports an
 * Infinity duration until the whole file has been scanned. Seeking far past the
 * end forces that scan, after which the real duration is known.
 */
function resolveUnknownDuration(video: HTMLVideoElement): Promise<number | null> {
  return new Promise((resolve) => {
    const finish = (value: number | null) => {
      video.removeEventListener("durationchange", onChange);
      video.removeEventListener("timeupdate", onChange);
      clearTimeout(timer);
      resolve(value);
    };
    const onChange = () => {
      if (Number.isFinite(video.duration)) finish(video.duration);
    };
    const timer = setTimeout(() => finish(null), DURATION_PROBE_TIMEOUT_MS);
    video.addEventListener("durationchange", onChange);
    video.addEventListener("timeupdate", onChange);
    video.currentTime = Number.MAX_SAFE_INTEGER;
  });
}

export async function probeVideo(blob: Blob, fallbackDurationSec?: number): Promise<VideoInfo> {
  const url = URL.createObjectURL(blob);
  const video = createProbeVideo(url);
  try {
    await waitForMetadata(video);
    let durationSec: number | null = Number.isFinite(video.duration) ? video.duration : null;
    durationSec ??= await resolveUnknownDuration(video);
    durationSec ??= fallbackDurationSec ?? null;
    if (durationSec === null || durationSec <= 0) throw new Error("Could not determine video duration");
    return { durationSec, width: video.videoWidth, height: video.videoHeight };
  } finally {
    disposeProbeVideo(video, url);
  }
}

function drawThumbnail(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const scale = sourceWidth > 0 ? THUMBNAIL_WIDTH / sourceWidth : 1;
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = Math.max(1, Math.round((sourceHeight || THUMBNAIL_WIDTH) * scale));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (sourceWidth > 0) ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Thumbnail encoding failed"))), "image/jpeg", 0.7);
  });
}

/** Grabs whatever frame a playing (e.g. live camera) video is currently showing. */
export function captureThumbnail(video: HTMLVideoElement): Promise<Blob> {
  return drawThumbnail(video, video.videoWidth, video.videoHeight);
}

export async function thumbnailFromImageUrl(url: string): Promise<Blob> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return drawThumbnail(img, img.naturalWidth, img.naturalHeight);
}

/** Resolves once the element has a decoded frame to draw, nudging playback if it won't produce one. */
async function ensureFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= video.HAVE_CURRENT_DATA) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      video.removeEventListener("timeupdate", finish);
      video.pause();
      resolve();
    };
    const timer = setTimeout(finish, FRAME_TIMEOUT_MS);
    video.addEventListener("timeupdate", finish);
    video.play().catch(finish);
  });
}

export async function thumbnailFromBlob(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  const video = createProbeVideo(url);
  try {
    await waitForMetadata(video);
    const duration = Number.isFinite(video.duration) ? video.duration : IMPORT_THUMBNAIL_TIME * 2;
    await seekTo(video, Math.min(IMPORT_THUMBNAIL_TIME, duration / 2));
    await ensureFrame(video);
    return await drawThumbnail(video, video.videoWidth, video.videoHeight);
  } finally {
    disposeProbeVideo(video, url);
  }
}

export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
