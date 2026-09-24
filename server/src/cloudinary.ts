/**
 * Thin wrapper around the Cloudinary SDK for remote (CDN-hosted) media.
 *
 * Cloudinary is optional: when the env vars are missing, `isConfigured()`
 * returns false, the preset endpoint 404s, and the app keeps using in-memory
 * uploads. Once configured, large files go straight from the browser to
 * Cloudinary via an unsigned preset (no bytes ever hit our process), and this
 * module only validates, serves, and deletes the resulting public assets.
 */

import { v2 as cloudinary } from "cloudinary";
import { config } from "./config.js";

/** True when every Cloudinary credential is present. */
export function isCloudinaryConfigured(): boolean {
  return Boolean(
    config.cloudinaryCloudName &&
      config.cloudinaryApiKey &&
      config.cloudinaryApiSecret &&
      config.cloudinaryUploadPreset,
  );
}

/**
 * True when Cloudinary admin credentials exist. The sticker pack only lists a
 * folder and streams CDN URLs, so it never needs the upload preset or spends
 * credits — gating on name+key+secret keeps the pack usable even when uploads
 * are gated off.
 */
export function isPackConfigured(): boolean {
  return Boolean(
    config.cloudinaryCloudName &&
      config.cloudinaryApiKey &&
      config.cloudinaryApiSecret,
  );
}

/** Public identifiers handed to the client so it can upload directly. Once the
 *  free-tier credit budget is nearly exhausted, null is returned so clients
 *  revert to the in-memory path instead of hard-failing on uploads. */
export async function cloudinaryUploadInfo(): Promise<{
  cloudName: string;
  uploadPreset: string;
} | null> {
  if (!(await isCloudinaryAvailable())) return null;
  return {
    cloudName: config.cloudinaryCloudName,
    uploadPreset: config.cloudinaryUploadPreset,
  };
}

/**
 * Cloudinary's free tier is 25 credits/month; each upload/transform spends one.
 * Poll account usage (cheap, cached) and flip the export off when almost out so
 * clients gracefully fall back to in-memory media instead of getting 402s. Any
 * usage-API failure fails open — the client has a fallback path anyway.
 */
const USAGE_CHECK_MS = 5 * 60_000;
/** Keep serving remote uploads until only this many credits remain. */
const MIN_REMAINING_CREDITS = 3;

let usageCache: { gated: boolean; checkedAt: number } | null = null;

export async function isCloudinaryAvailable(): Promise<boolean> {
  if (!isCloudinaryConfigured()) return false;
  const now = Date.now();
  if (usageCache && now - usageCache.checkedAt < USAGE_CHECK_MS) {
    return !usageCache.gated;
  }
  try {
    const gated = await usageGated();
    usageCache = { gated, checkedAt: now };
    return !gated;
  } catch {
    return true;
  }
}

async function usageGated(): Promise<boolean> {
  ensureConfigured();
  const res = (await cloudinary.api.usage()) as {
    credits_usage?: { usage?: unknown; limit?: unknown };
  };
  const usage = res.credits_usage;
  const used = Number(usage?.usage);
  const limit = Number(usage?.limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return false;
  return limit - used < MIN_REMAINING_CREDITS;
}

function ensureConfigured(): void {
  cloudinary.config({
    cloud_name: config.cloudinaryCloudName,
    api_key: config.cloudinaryApiKey,
    api_secret: config.cloudinaryApiSecret,
    secure: true,
  });
}

/**
 * Validate that a public_id exists and belongs to this account, returning the
 * metadata the message attachment needs. Null when it's missing/unusable.
 */
export async function fetchRemoteDetails(
  publicId: string,
): Promise<{ format: string; width: number; height: number } | null> {
  if (!publicId || publicId.length > 300) return null;
  ensureConfigured();
  try {
    const res = (await cloudinary.api.resource(publicId, { type: "upload" })) as {
      error?: { message?: string };
      format?: unknown;
      width?: unknown;
      height?: unknown;
    };
    if (res.error || !res.format) return null;
    const format = String(res.format).toLowerCase();
    const width = Number(res.width);
    const height = Number(res.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return { format, width, height };
  } catch {
    return null;
  }
}

/** Deterministic secure CDN URL (avoids re-signing for plain public uploads). */
export function remoteSecureUrl(publicId: string): string {
  return `https://res.cloudinary.com/${config.cloudinaryCloudName}/image/upload/${publicId}`;
}

/**
 * List image assets in a folder (Search API). Returns metadata only — bytes
 * stay on the CDN and are streamed on demand. Paginates until `maxResults` is
 * reached. Used once at boot and on the refresh interval to seed/prune the
 * in-memory sticker pack.
 *
 * This targets `asset_folder` (Search) rather than the classic `prefix`
 * listing: modern accounts use dynamic folders, where the folder is a metadata
 * field on a flat public_id and the prefix-based `resources` endpoint returns
 * nothing. `asset_folder` matching works in both modes. Requires read/Admin
 * permission on the API key — an ML-user-only key matches the folder in search
 * but returns no asset bodies.
 */
export async function listPackResources(
  folder: string,
  maxResults: number,
): Promise<{ publicId: string; format: string; width: number; height: number }[]> {
  if (folder?.includes('"') || folder?.includes("\\")) return [];
  ensureConfigured();
  const rows: { publicId: string; format: string; width: number; height: number }[] = [];
  let nextCursor: string | null = null;
  do {
    const query = cloudinary.search
      .expression(`asset_folder:"${folder}"`)
      .max_results(Math.min(maxResults, 500));
    if (nextCursor) query.next_cursor(nextCursor);
    const res = (await query.execute()) as {
      resources?: Array<{
        public_id?: unknown;
        format?: unknown;
        width?: unknown;
        height?: unknown;
      }>;
      next_cursor?: unknown;
    };
    for (const r of res.resources ?? []) {
      if (typeof r.public_id !== "string") continue;
      const format =
        typeof r.format === "string" ? r.format.toLowerCase() : "";
      const width = Number(r.width);
      const height = Number(r.height);
      rows.push({ publicId: r.public_id, format, width, height });
    }
    nextCursor =
      typeof res.next_cursor === "string" && res.next_cursor
        ? res.next_cursor
        : null;
  } while (nextCursor && rows.length < maxResults);
  return rows.slice(0, maxResults);
}

/** Delete a public asset (view-once consumption, expiry sweep). Never throws. */
export function destroyRemote(publicId: string): void {
  if (!publicId) return;
  ensureConfigured();
  cloudinary.uploader
    .destroy(publicId, { resource_type: "image", invalidate: true })
    .catch(() => {});
}