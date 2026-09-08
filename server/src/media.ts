/**
 * In-memory media store for uploaded images and gifs.
 *
 * Media is ephemeral, matching the rest of the app: bytes live only in memory
 * and are pruned on the same retention window as chat messages. Normal media is
 * served until it is pruned. View-once media is deleted the moment a participant
 * other than the uploader successfully fetches it (WhatsApp-style "opened").
 *
 * Media ids are random and effectively unguessable, which is the only access
 * control here — the app has no accounts, so a session id alone proves little.
 */

import { randomBytes } from "node:crypto";
import { config } from "./config.js";

export interface StoredMedia {
  id: string;
  buffer: Buffer;
  mime: string;
  /** "image" for stills, "gif" for animated gifs, "sticker" for stickers. */
  kind: "image" | "gif" | "sticker";
  width: number;
  height: number;
  name?: string;
  uploadedAt: number;
  uploadedBy: string;
  /** When true, bytes are deleted after the first non-uploader view. */
  viewOnce: boolean;
  /** Session id that consumed a view-once upload (if any). */
  viewedBy?: string;
}

const media = new Map<string, StoredMedia>();

/** Accepted MIME types. Anything else is rejected at upload. */
const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const MAX_MEDIA_BYTES = 32 * 1024 * 1024; // 32 MB
export const MIN_MEDIA_BYTES = 16;
export const MAX_MEDIA_COUNT = 256;
/**
 * Rough bound on total buffered bytes to keep the process sane. The 32 MB
 * per-file cap is intentional (host proxies often choke near ~1 MB, so the
 * client downscales big photos before upload anyway); this total just avoids
 * unbounded growth, e.g. 8 full-size uploads at once.
 */
export const MAX_MEDIA_TOTAL_BYTES = 256 * 1024 * 1024;

/** Newest first eviction when we run out of room — trims nornal media only. */
function evictOldestNormal(): boolean {
  const candidates: StoredMedia[] = [];
  for (const m of media.values()) {
    if (!m.viewOnce) candidates.push(m);
  }
  if (candidates.length === 0) return false;
  candidates.sort((a, b) => a.uploadedAt - b.uploadedAt);
  const victim = candidates[0];
  media.delete(victim.id);
  return true;
}

/**
 * Store an upload and return its public metadata. Returns null when the payload
 * is too big, empty, wrong type, or the store is at capacity.
 */
export function storeMedia(
  buffer: Buffer,
  mime: string,
  uploaderSessionId: string,
  options: { viewOnce?: boolean; name?: string; kind?: "sticker" } = {},
): Omit<StoredMedia, "buffer"> | null {
  if (buffer.length < MIN_MEDIA_BYTES || buffer.length > MAX_MEDIA_BYTES) return null;
  if (!ACCEPTED_MIME.has(mime)) return null;

  const dims = readDimensions(buffer);
  if (!dims) return null;
  const id = randomBytes(12).toString("hex");

  let total = buffer.length;
  for (const m of media.values()) total += m.buffer.length;
  while (media.size >= MAX_MEDIA_COUNT || total > MAX_MEDIA_TOTAL_BYTES) {
    if (!evictOldestNormal()) return null;
    total = buffer.length;
    for (const m of media.values()) total += m.buffer.length;
  }

  const record: StoredMedia = {
    id,
    buffer,
    mime,
    // Stickers are square by intent; otherwise classify from mime.
    kind:
      options.kind === "sticker"
        ? "sticker"
        : mime === "image/gif"
          ? "gif"
          : "image",
    width: dims.width,
    height: dims.height,
    // Strip paths, control chars and clamp length for the stored name.
    name: sanitizeName(options.name),
    uploadedAt: Date.now(),
    uploadedBy: uploaderSessionId,
    viewOnce: Boolean(options.viewOnce),
  };
  media.set(id, record);
  return {
    id: record.id,
    mime: record.mime,
    kind: record.kind,
    width: record.width,
    height: record.height,
    name: record.name,
    uploadedAt: record.uploadedAt,
    uploadedBy: record.uploadedBy,
    viewOnce: record.viewOnce,
  };
}

export function getMedia(id: string): StoredMedia | undefined {
  if (!id) return undefined;
  const m = media.get(id);
  if (m && Date.now() - m.uploadedAt > config.messageTtlMs) {
    media.delete(id);
    return undefined;
  }
  return m;
}

/** Whether a media item exists and is still retrievable. */
export function hasMedia(id: string): boolean {
  return Boolean(getMedia(id));
}

/**
 * Resolve media for a fetch. Returns null when it doesn't exist, or when a
 * one-time upload has already been viewed by someone else (the sender must not
 * be able to pull it back up after it was opened).
 */
export function getMediaFor(mediaId: string, sessionId: string): StoredMedia | null {
  const m = getMedia(mediaId);
  if (!m) return null;
  if (m.viewOnce && m.viewedBy && m.viewedBy !== sessionId) return null;
  return m;
}

/**
 * Record that a view-once upload was opened by a non-uploader. The bytes are
 * dropped immediately so no one (including the uploader) can fetch them again.
 * Returns the deleted record, if any.
 */
export function consumeViewOnce(mediaId: string, sessionId: string): StoredMedia | null {
  const m = getMedia(mediaId);
  if (!m || !m.viewOnce) return null;
  if (m.uploadedBy === sessionId) return null;
  m.viewedBy = sessionId;
  media.delete(mediaId);
  return m;
}

/** Drop expired uploads; call from the sweep loop. */
export function pruneMedia(now = Date.now()): void {
  for (const [id, m] of media) {
    if (now - m.uploadedAt > config.messageTtlMs) media.delete(id);
  }
}

function sanitizeName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const cleaned = name
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, 80);
}

/**
 * Lightweight dimensions + signature check for the four image formats we accept
 * (GIF, PNG, JPEG, WebP). No external dependency; returns null when the bytes
 * don't parse as a known image.
 */
function readDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;

  // GIF: "GIF87a"/"GIF89a" then width/height little-endian 16-bit.
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // PNG: 8-byte signature, IHDR width/height big-endian 32-bit.
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // WebP: "RIFF" + size + "WEBP".
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    const fourcc = buf.toString("latin1", 12, 16);
    if (fourcc === "VP8 ") {
      // Lossy: frame starts at offset 20 with 3-byte sync code; dims at 26/28.
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === "VP8L") {
      // Lossless: packed 14-bit dims beginning at offset 21.
      const b0 = buf[21];
      const b1 = buf[22];
      const b2 = buf[23];
      const b3 = buf[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
    if (fourcc === "VP8X") {
      // Extended: 24-bit little-endian canvas size at offset 24.
      if (buf.length < 30) return null;
      const w = buf[24] | (buf[25] << 8) | (buf[26] << 16);
      const h = buf[27] | (buf[28] << 8) | (buf[29] << 16);
      return { width: w + 1, height: h + 1 };
    }
    return null;
  }

  // JPEG: scan markers for a SOF frame (C0–C3, C5–C7, C9–CB, CD–CF).
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      // Standalone markers have no length field.
      if (
        marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)
      ) {
        i += 2;
        continue;
      }
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof) {
        if (i + 9 >= buf.length) return null;
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }

  return null;
}