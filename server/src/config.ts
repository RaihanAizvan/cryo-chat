/**
 * Central configuration, loaded from environment with sane defaults.
 * Keep secrets/internals out of the client.
 *
 * Loads a root `.env` (if present) so a single repo-root file works for local
 * dev and matches Abasthan's "env lives at the root" settings model. Real
 * deployments inject vars into process.env directly; the file is optional.
 */
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { existsSync } from "node:fs";

/**
 * Load a repo-root `.env` (gitignored, optional). npm workspaces start this
 * server with cwd = `server/`, so process.cwd() would miss a root `.env` —
 * resolve it from this file's location instead. Real deployments inject vars
 * into process.env directly (dotenv never overrides those), which is how
 * Abasthan settings are picked up.
 */
const rootEnvPath = new URL("../../.env", import.meta.url).pathname;
if (existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, quiet: true });
}

export interface Config {
  port: number;
  /** Comma separated list of allowed origins for CORS. */
  corsOrigin: string[];
  /** Shared secret for the /admin console. Empty = admin API disabled. */
  adminKey: string;
  /** In-memory message retention window before pruning. */
  messageTtlMs: number;
  /** Rolling cap of messages retained per room (newest kept). */
  messageCap: number;
  /** How long a room lives after creation before expiring, in ms. */
  roomTtlMs: number;
  /** Room stays alive while it has participants, capped by grace period. */
  roomGraceMs: number;
  /** Max concurrent participants per room. */
  maxRoomSize: number;
  /** Max messages per participant per window. */
  messageRateWindowMs: number;
  messageRateLimit: number;
  /** Max concurrent sockets per IP. */
  maxSocketsPerIp: number;
  /** Fixed code for the preserved room (easy to remember). */
  reservedRoomCode: string;
  /** Sweep interval for expiry/cleanup. */
  sweepIntervalMs: number;
  /** If set, serve the built client from this directory (production). */
  clientDist: string | null;
  /** Giphy API key used for GIF/sticker search (server-side, never exposed). */
  giphyApiKey: string;
  /** Cloudinary credentials for remote (CDN-hosted) media. Empty = disabled. */
  cloudinaryCloudName: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
  /** Unsigned upload preset the client uses to push files straight to Cloudinary. */
  cloudinaryUploadPreset: string;
  /** Cloudinary folder hosting the curated sticker pack (metadata cached in-memory). */
  stickerPackFolder: string;
  /** How often the sticker pack re-syncs from Cloudinary, in ms. */
  stickerPackRefreshMs: number;
  /**
   * TEST/DEV-ONLY: JSON array of sticker rows that seeds the pack without a
   * Cloudinary account (normalized like listPackResources output). Not for
   * production; empty by default.
   */
  stickerPackTestJson: string;
  /** Redis connection URL, e.g. redis://:password@host:6379/0. Empty = memory mode. */
  redisUrl: string;
  /** Alternatively, discrete Redis host (used when redisUrl is empty). */
  redisHost: string;
  redisPort: number;
  redisPassword: string;
  redisDb: number;
  /** Use TLS for the Redis connection (managed providers usually need it). */
  redisTls: boolean;
  /** Namespace for every Redis key/channel so one Redis can host several apps. */
  redisPrefix: string;
  /** Max reconnect delay; a runaway backoff would stall recovery after a blip. */
  redisMaxRetryDelayMs: number;
  /**
   * Stable per-process id used to tag store events with their origin, so an
   * instance can ignore its own pub/sub echo. Set INSTANCE_ID in a fleet;
   * defaults to a fresh uuid per boot.
   */
  instanceId: string;
}

const list = (v: string | undefined): string[] =>
  v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];

/** Comma-separated origins, falling back to local dev when unset/empty. */
const corsOriginList = (v: string | undefined): string[] => {
  const parsed = list(v);
  return parsed.length > 0 ? parsed : ["http://localhost:5173"];
};

// Path to the built client, used when serving the frontend in production.
// Defaults to <repo>/client/dist so a single Abasthan/VPS app can host both.
const DEFAULT_CLIENT_DIST = new URL("../../client/dist", import.meta.url).pathname;

export const config: Config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: corsOriginList(process.env.CORS_ORIGIN),
  adminKey: process.env.ADMIN_KEY ?? "",
  messageTtlMs: Number(process.env.MESSAGE_TTL_MS ?? 1000 * 60 * 60 * 24),
  messageCap: Number(process.env.MESSAGE_CAP ?? 200),
  roomTtlMs: Number(process.env.ROOM_TTL_MS ?? 1000 * 60 * 60 * 2),
  roomGraceMs: Number(process.env.ROOM_GRACE_MS ?? 1000 * 60 * 30),
  maxRoomSize: Number(process.env.MAX_ROOM_SIZE ?? 50),
  messageRateWindowMs: Number(process.env.MESSAGE_RATE_WINDOW_MS ?? 10_000),
  messageRateLimit: Number(process.env.MESSAGE_RATE_LIMIT ?? 10),
  maxSocketsPerIp: Number(process.env.MAX_SOCKETS_PER_IP ?? 20),
  reservedRoomCode: process.env.RESERVED_ROOM_CODE ?? "9999",
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS ?? 30_000),
  clientDist: process.env.CLIENT_DIST ?? DEFAULT_CLIENT_DIST,
  giphyApiKey: process.env.GIPHY_API_KEY ?? "",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  cloudinaryUploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET ?? "",
  stickerPackFolder: process.env.STICKER_PACK_FOLDER ?? "cryo/stickers",
  stickerPackRefreshMs: Number(process.env.STICKER_PACK_REFRESH_MS ?? 5 * 60_000),
  stickerPackTestJson: process.env.STICKER_PACK_TEST_JSON ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  redisHost: process.env.REDIS_HOST ?? "",
  redisPort: Number(process.env.REDIS_PORT ?? 6379),
  redisPassword: process.env.REDIS_PASSWORD ?? "",
  redisDb: Number(process.env.REDIS_DB ?? 0),
  redisTls: ["1", "true", "yes", "on"].includes(
    (process.env.REDIS_TLS ?? "").toLowerCase(),
  ),
  redisPrefix: process.env.REDIS_PREFIX ?? "cryo",
  redisMaxRetryDelayMs: Number(process.env.REDIS_MAX_RETRY_DELAY_MS ?? 3_000),
  instanceId: process.env.INSTANCE_ID ?? randomUUID(),
};

/** True when a Redis backend is configured (memory mode is the default). */
export const redisConfigured = Boolean(config.redisUrl || config.redisHost);
