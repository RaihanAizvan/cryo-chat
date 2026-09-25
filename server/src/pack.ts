/**
 * Sticker pack: a curated set of stickers hosted in the project's Cloudinary
 * account under a dedicated folder (STICKER_PACK_FOLDER).
 *
 * Only metadata (public id, CDN url, format, dimensions) is held in memory —
 * image bytes stay on the CDN and are streamed to viewers through a 302
 * redirect on fetch. The folder is listed once at boot and re-synced on an
 * interval, so stickers added in the Cloudinary dashboard appear without a
 * restart and deletions prune themselves. This keeps the repository lean while
 * access stays instant (the redirect hits a public CDN URL, no re-validation
 * per fetch).
 *
 * Pack sticker ids ARE the Cloudinary public_id, so historical messages keep
 * resolving across restarts (a boot-time random id would break them). Pack
 * messages are shared by every participant — there is no owner gate at send.
 *
 * Cloudinary is optional: without credentials the pack is simply empty and the
 * client hides the surface. STICKER_PACK_TEST_JSON is a test/dev seam that
 * seeds the pack from a JSON array of rows (same shape as listPackResources),
 * so the feature is fully testable without a Cloudinary account.
 */

import {
  isPackConfigured,
  listPackResources,
  remoteSecureUrl,
} from "./cloudinary.js";
import { config } from "./config.js";

/** Hard bound on pack size so the metadata cache stays trivially small. */
export const MAX_PACK_STICKERS = 512;

/** Formats the pack accepts (anything else in the folder is ignored). */
const PACK_FORMATS: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** Safe public_id shape (mirrors media.ts's guard for remote uploads). */
const PUBLIC_ID_RE = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/;

export interface PackSticker {
  /** Stable id used as the attachment mediaId in messages (the public_id). */
  id: string;
  publicId: string;
  /** CDN url the bytes are streamed from. */
  secureUrl: string;
  format: string;
  mime: string;
  kind: "sticker";
  width: number;
  height: number;
  /** File base name (without extension) for display / aria labels. */
  name: string;
}

const pack = new Map<string, PackSticker>();
let refreshTimer: NodeJS.Timeout | null = null;

/** True when a pack backend is configured (Cloudinary or the test seam). */
export function packEnabled(): boolean {
  return isPackConfigured() || Boolean(config.stickerPackTestJson);
}

export function getPackSticker(id: string): PackSticker | null {
  return pack.get(id) ?? null;
}

export function listPackStickers(): PackSticker[] {
  return [...pack.values()];
}

/** Current pack size (0 when the pack is empty or disabled). */
export function packSize(): number {
  return pack.size;
}

/** TEST-ONLY: clear the cache so unit tests start from a clean slate. */
export function resetPackForTest(): void {
  pack.clear();
}

const TEST_ROW_SHAPE = ["publicId", "format", "width", "height"];

function buildPack(rows: { publicId: string; format: string; width: number; height: number }[]): void {
  const next = new Map<string, PackSticker>();
  for (const r of rows) {
    if (next.size >= MAX_PACK_STICKERS) break;
    const mime = PACK_FORMATS[r.format];
    const publicId = typeof r.publicId === "string" ? r.publicId.trim() : "";
    const width = Number(r.width);
    const height = Number(r.height);
    if (
      !mime ||
      !PUBLIC_ID_RE.test(publicId) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      continue;
    }
    next.set(publicId, {
      id: publicId,
      publicId,
      secureUrl: remoteSecureUrl(publicId),
      format: r.format,
      mime,
      kind: "sticker",
      width,
      height,
      name: publicId.split("/").pop() ?? publicId,
    });
  }
  pack.clear();
  for (const [id, sticker] of next) pack.set(id, sticker);
}

function rowsFromTestJson(raw: string): { publicId: string; format: string; width: number; height: number }[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("sticker pack test json must be an array");
  for (const row of parsed) {
    if (!row || typeof row !== "object") throw new Error("sticker pack test rows must be objects");
    for (const key of TEST_ROW_SHAPE) {
      if (!(key in (row as Record<string, unknown>))) {
        throw new Error(`sticker pack test row missing "${key}"`);
      }
    }
  }
  return parsed as { publicId: string; format: string; width: number; height: number }[];
}

/**
 * Refresh the in-memory pack from Cloudinary (or the test seam). Non-fatal: on
 * any failure the previous cache is kept — a Cloudinary blip must never empty
 * the pack. Returns the new size, or null when the pack is disabled/failed.
 */
export async function refreshStickerPack(): Promise<number | null> {
  if (!packEnabled()) return null;
  try {
    const rows = config.stickerPackTestJson
      ? rowsFromTestJson(config.stickerPackTestJson)
      : await listPackResources(config.stickerPackFolder, MAX_PACK_STICKERS);
    buildPack(rows);
    return pack.size;
  } catch {
    return null;
  }
}

/**
 * Load the pack once at boot, then start the interval refresh. Safe to call
 * multiple times; the timer (and unref'd so it never holds the process open) is
 * only started once. Returns the initial size, or null when disabled.
 */
export async function loadStickerPack(): Promise<number | null> {
  const count = await refreshStickerPack();
  if (packEnabled() && !refreshTimer) {
    refreshTimer = setInterval(() => {
      void refreshStickerPack();
    }, config.stickerPackRefreshMs);
    refreshTimer.unref?.();
  }
  return count;
}