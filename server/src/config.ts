/**
 * Central configuration, loaded from environment with sane defaults.
 * Keep secrets/internals out of the client.
 */

export interface Config {
  port: number;
  /** Comma separated list of allowed origins for CORS. */
  corsOrigin: string[];
  /** In-memory message retention window before pruning. */
  messageTtlMs: number;
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
  messageTtlMs: Number(process.env.MESSAGE_TTL_MS ?? 1000 * 60 * 60 * 24),
  roomTtlMs: Number(process.env.ROOM_TTL_MS ?? 1000 * 60 * 60 * 2),
  roomGraceMs: Number(process.env.ROOM_GRACE_MS ?? 1000 * 60 * 30),
  maxRoomSize: Number(process.env.MAX_ROOM_SIZE ?? 50),
  messageRateWindowMs: Number(process.env.MESSAGE_RATE_WINDOW_MS ?? 10_000),
  messageRateLimit: Number(process.env.MESSAGE_RATE_LIMIT ?? 10),
  maxSocketsPerIp: Number(process.env.MAX_SOCKETS_PER_IP ?? 20),
  reservedRoomCode: process.env.RESERVED_ROOM_CODE ?? "99999999",
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS ?? 30_000),
  clientDist: process.env.CLIENT_DIST ?? DEFAULT_CLIENT_DIST,
};
