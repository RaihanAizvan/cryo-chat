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
  type: "image" | "gif" | "sticker";
  width?: number;
  height?: number;
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
  options: { viewOnce?: boolean; name?: string; sticker?: boolean } = {},
): Promise<UploadResult> {
  const headers: Record<string, string> = {
    "X-Session-Id": getStoredSessionId() ?? "",
    "Content-Type": file.type || "application/octet-stream",
  };
  if (options.viewOnce) headers["X-View-Once"] = "1";
  if (options.name) headers["X-Media-Name"] = options.name;
  if (options.sticker) headers["X-Media-Kind"] = "sticker";

  const res = await fetch(`${fetchBase}/api/media`, {
    method: "POST",
    headers,
    body: file,
  });
  if (!res.ok) {
    throw new Error(res.status === 413 ? "File too large." : "Upload failed.");
  }
  return (await res.json()) as UploadResult;
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