/**
 * Upload + fetch helpers for chat media (images/gifs).
 *
 * Media travels over plain HTTP rather than the socket: blobs are large, and a
 * raw upload endpoint keeps the socket's buffer limits free for messages. The
 * uploader's session id rides in the `X-Session-Id` header so the server can
 * (a) reject payloads that weren't uploaded by this session when a message is
 * sent and (b) enforce view-once semantics on fetch.
 */

export interface UploadResult {
  mediaId: string;
  type: "image" | "gif" | "sticker" | "voice";
  width?: number;
  height?: number;
  /** Length of a voice note in seconds. */
  duration?: number;
  name?: string;
  viewOnce: boolean;
}

import { getStoredSessionId } from "./prefs";

const serverUrl = import.meta.env.VITE_SERVER_URL?.trim() ?? "";
const fetchBase = serverUrl ? serverUrl : "";

/**
 * Upload an image or gif. `viewOnce` uploads are deleted after the first
 * non-uploader view. Throws on failure (caller shows the error).
 */
export async function uploadMedia(
  file: File | Blob,
  options: {
    viewOnce?: boolean;
    name?: string;
    sticker?: boolean;
    /** Voice notes always ride the in-memory upload path. */
    voice?: boolean;
    /** Seconds-long voice note length, sent with the upload. */
    duration?: number;
  } = {},
): Promise<UploadResult> {
  const headers: Record<string, string> = {
    "X-Session-Id": getStoredSessionId() ?? "",
    "Content-Type": file.type || "application/octet-stream",
  };
  if (options.viewOnce) headers["X-View-Once"] = "1";
  if (options.name) headers["X-Media-Name"] = options.name;
  if (options.sticker) headers["X-Media-Kind"] = "sticker";
  if (options.voice) {
    headers["X-Media-Kind"] = "voice";
    if (options.duration != null) headers["X-Media-Duration"] = String(options.duration);
  }

  const res = await fetch(`${fetchBase}/api/media`, {
    method: "POST",
    headers,
    body: file,
  });
  if (!res.ok) {
    let code = "";
    try {
      code = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* non-JSON error body */
    }
    if (code === "too_many_uploads") {
      throw new Error("Too many uploads right now. Try again in a minute.");
    }
    if (res.status === 413) throw new Error("File too large for this server.");
    throw new Error("Upload failed. Try again.");
  }
  return (await res.json()) as UploadResult;
}

/** One sticker from the project's Cloudinary pack (metadata only). */
export interface PackSticker {
  /** Pack mediaId (the Cloudinary public_id). Send a message referencing it. */
  id: string;
  /** Public CDN url of the sticker bytes. */
  url: string;
  width?: number;
  height?: number;
  /** Human label for aria/tooltips (file base name). */
  name?: string;
}

/**
 * Fetch the sticker pack list. Returns null when the pack is unavailable
 * (Cloudinary not configured, or a network failure) so the caller can hide the
 * tab; an empty array means a configured pack that has no stickers yet.
 */
export async function fetchStickers(): Promise<PackSticker[] | null> {
  try {
    const res = await fetch(`${fetchBase}/api/stickers`);
    if (!res.ok) return null;
    const d = (await res.json()) as { stickers?: PackSticker[] };
    return d.stickers ?? [];
  } catch {
    return null;
  }
}

// Module-level cache so the sticker tray opens instantly (no re-fetch each
// open). `undefined` = not fetched yet; a background refresh on open keeps it
// fresh for the next open.
let stickersCache: PackSticker[] | null | undefined;
let stickersInFlight: Promise<PackSticker[] | null> | null = null;

/**
 * Sticker-pack fetch that memoizes its result: after the first call the value
 * is served synchronously (through a resolved promise), so re-opening the
 * picker never shows a loading state. Pass `forceRefresh` to re-pull from the
 * server (the pack is small; used on open to pick up new uploads between
 * sessions without blocking the UI).
 */
export function preloadStickers(forceRefresh = false): Promise<PackSticker[] | null> {
  if (!forceRefresh && stickersCache !== undefined) {
    return Promise.resolve(stickersCache);
  }
  if (stickersInFlight) return stickersInFlight;
  stickersInFlight = fetchStickers().then((list) => {
    stickersCache = list;
    stickersInFlight = null;
    return list;
  });
  return stickersInFlight;
}

/**
 * Synchronous view of the cached pack for first-paint rendering: undefined
 * when never fetched (tray shows skeletons), null when the pack is disabled,
 * otherwise the cached list (tray opens with content, zero flash).
 */
export function peekStickers(): PackSticker[] | null | undefined {
  return stickersCache;
}

/** URL that serves the media bytes back for a given viewer session. */
export function mediaUrl(mediaId: string, sessionId: string): string {
  const q = new URLSearchParams({ session: sessionId });
  return `${fetchBase}/api/media/${encodeURIComponent(mediaId)}?${q}`;
}

/**
 * Confirm the viewer opened a view-once upload so the server drops the bytes.
 * Returns true when the upload was actually consumed (non-uploader first view);
 * false for the uploader themselves or when the request failed.
 */
export async function markMediaViewed(mediaId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${fetchBase}/api/media/${encodeURIComponent(mediaId)}/view`,
      {
        method: "POST",
        headers: { "X-Session-Id": getStoredSessionId() ?? "" },
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

/** Identifiers the server hands us for direct-to-Cloudinary uploads. */
export interface CloudinaryPreset {
  cloudName: string;
  uploadPreset: string;
}

/**
 * Ask the server for the Cloudinary direct-upload preset. Returns null when
 * Cloudinary isn't configured (or the request fails) — the caller then falls
 * back to the regular in-memory upload path, so local dev needs no account.
 */
export async function getCloudinaryPreset(): Promise<CloudinaryPreset | null> {
  try {
    const res = await fetch(`${fetchBase}/api/cloudinary/preset`);
    if (!res.ok) return null;
    const d = (await res.json()) as { cloudName?: unknown; uploadPreset?: unknown };
    if (!d.cloudName || !d.uploadPreset) return null;
    return {
      cloudName: String(d.cloudName),
      uploadPreset: String(d.uploadPreset),
    };
  } catch {
    return null;
  }
}

export interface RemoteUploaded {
  publicId: string;
  width: number;
  height: number;
}

/**
 * Push a file straight to Cloudinary from the browser (unsigned preset, so no
 * credentials are needed client-side). Throws on failure.
 */
export async function uploadToCloudinary(
  file: File | Blob,
  preset: CloudinaryPreset,
): Promise<RemoteUploaded> {
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", preset.uploadPreset);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${preset.cloudName}/image/upload`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error("Cloudinary upload failed.");
  const d = (await res.json()) as {
    public_id?: unknown;
    width?: unknown;
    height?: unknown;
  };
  if (!d.public_id) throw new Error("Cloudinary upload failed.");
  return {
    publicId: String(d.public_id),
    width: Number(d.width),
    height: Number(d.height),
  };
}

/**
 * Tell the server about a file already in Cloudinary so it gets a normal
 * mediaId (message send, rendering, view-once and TTL all key off that id).
 * The server re-validates the public_id against Cloudinary before accepting.
 */
export async function registerRemoteMedia(input: {
  publicId: string;
  width: number;
  height: number;
  viewOnce?: boolean;
  name?: string;
  sticker?: boolean;
}): Promise<UploadResult> {
  const headers: Record<string, string> = {
    "X-Session-Id": getStoredSessionId() ?? "",
    "Content-Type": "application/json",
  };
  if (input.viewOnce) headers["X-View-Once"] = "1";
  if (input.name) headers["X-Media-Name"] = input.name;
  if (input.sticker) headers["X-Media-Kind"] = "sticker";

  const res = await fetch(`${fetchBase}/api/media/remote`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      publicId: input.publicId,
      width: input.width,
      height: input.height,
    }),
  });
  if (!res.ok) {
    let code = "";
    try {
      code = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* non-JSON error body */
    }
    if (code === "too_many_uploads") {
      throw new Error("Too many uploads right now. Try again in a minute.");
    }
    throw new Error("Upload failed. Try again.");
  }
  return (await res.json()) as UploadResult;
}