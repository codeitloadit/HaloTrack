import { clearTracking, clipTrackingKey } from "./savedTracking";
import type { ClipMeta } from "../state/types";

const DB_NAME = "halotrack";
const DB_VERSION = 1;
const CLIPS = "clips";
const VIDEOS = "clipVideos";

interface ClipVideoRecord {
  id: string;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLIPS)) db.createObjectStore(CLIPS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(VIDEOS)) db.createObjectStore(VIDEOS, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

export function newClipId(): string {
  return crypto.randomUUID();
}

/**
 * Copies a blob read from IndexedDB into memory. WebKit backs those blobs with
 * files in its database directory, and images loaded from them have been seen
 * to go blank after a while; thumbnails are small enough to just hold.
 */
async function inMemory(blob: Blob): Promise<Blob> {
  try {
    return new Blob([await blob.arrayBuffer()], { type: blob.type || "image/jpeg" });
  } catch {
    return blob;
  }
}

export async function listClips(): Promise<ClipMeta[]> {
  const db = await openDb();
  const clips = await requestResult(db.transaction(CLIPS).objectStore(CLIPS).getAll() as IDBRequest<ClipMeta[]>);
  const withThumbnails = await Promise.all(clips.map(async (c) => ({ ...c, thumbnail: await inMemory(c.thumbnail) })));
  return withThumbnails.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveClip(meta: ClipMeta, video: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([CLIPS, VIDEOS], "readwrite");
  tx.objectStore(CLIPS).put(meta);
  tx.objectStore(VIDEOS).put({ id: meta.id, blob: video } satisfies ClipVideoRecord);
  await transactionDone(tx);
  void requestPersistence();
}

export async function getClipVideo(id: string): Promise<Blob> {
  const db = await openDb();
  const record = await requestResult(
    db.transaction(VIDEOS).objectStore(VIDEOS).get(id) as IDBRequest<ClipVideoRecord | undefined>,
  );
  if (!record) throw new Error(`Clip video ${id} not found`);
  return record.blob;
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("quicktime")) return "mov";
  return "mp4";
}

export async function loadClipFile(clip: ClipMeta): Promise<File> {
  const blob = await getClipVideo(clip.id);
  const name = `halotrack-${new Date(clip.createdAt).toISOString().slice(0, 23).replace(/[T:.]/g, "-")}.${extensionFor(clip.mimeType)}`;
  return new File([blob], name, { type: clip.mimeType });
}

/** Overwrites the metadata of existing clips, all in one transaction. */
export async function updateClips(clips: ClipMeta[]): Promise<void> {
  if (clips.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(CLIPS, "readwrite");
  const store = tx.objectStore(CLIPS);
  for (const clip of clips) store.put(clip);
  await transactionDone(tx);
}

/** Read-modify-write in one transaction, using callbacks so it stays active between the get and the put. */
export async function markClipHaloed(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(CLIPS, "readwrite");
  const store = tx.objectStore(CLIPS);
  const request = store.get(id) as IDBRequest<ClipMeta | undefined>;
  request.onsuccess = () => {
    if (request.result) store.put({ ...request.result, haloedAt: Date.now() });
  };
  await transactionDone(tx);
}

export async function updateClipTags(clip: ClipMeta, tags: string[]): Promise<ClipMeta> {
  const updated = { ...clip, tags };
  await updateClips([updated]);
  return updated;
}

export async function deleteClips(ids: string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([CLIPS, VIDEOS], "readwrite");
  for (const id of ids) {
    tx.objectStore(CLIPS).delete(id);
    tx.objectStore(VIDEOS).delete(id);
  }
  await transactionDone(tx);
  for (const id of ids) clearTracking(clipTrackingKey(id));
}

export function deleteClip(id: string): Promise<void> {
  return deleteClips([id]);
}

/** Unique tags across all clips, most used first, ties alphabetical. */
export function allTags(clips: ClipMeta[]): string[] {
  const counts = new Map<string, number>();
  for (const clip of clips) {
    for (const tag of clip.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
}

let persistenceRequested = false;

/**
 * Asks the browser not to evict our storage under pressure. Clips are the only
 * copy of what was recorded, so losing them silently would be much worse than
 * losing a cache.
 */
async function requestPersistence(): Promise<void> {
  if (persistenceRequested) return;
  persistenceRequested = true;
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not supported; storage stays best-effort.
  }
}
