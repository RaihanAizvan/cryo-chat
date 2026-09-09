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

/** Public identifiers handed to the client so it can upload directly. */
export function cloudinaryUploadInfo(): {
  cloudName: string;
  uploadPreset: string;
} | null {
  if (!isCloudinaryConfigured()) return null;
  return {
    cloudName: config.cloudinaryCloudName,
    uploadPreset: config.cloudinaryUploadPreset,
  };
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