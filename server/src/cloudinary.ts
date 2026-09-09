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

/** Delete a public asset (view-once consumption, expiry sweep). Never throws. */
export function destroyRemote(publicId: string): void {
  if (!publicId) return;
  ensureConfigured();
  cloudinary.uploader
    .destroy(publicId, { resource_type: "image", invalidate: true })
    .catch(() => {});
}