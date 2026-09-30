/**
 * Reserved-room access control.
 *
 * The reserved room is protected by a password instead of by its 4-character
 * code. This module owns the two pieces of crypto that need:
 *
 *  - **Password hashing.** Only a salted scrypt hash is ever stored, so a
 *    settings dump (or a Redis snapshot) never hands over the password. The
 *    hash doubles as the signing key for access tokens.
 *  - **Access tokens.** Once a visitor types the password, they get a signed
 *    token that their device keeps, so they are not asked again on every
 *    reload or reconnect.
 *
 * The tokens are deliberately **stateless**: a token is a signed payload, not a
 * row in a table. That keeps them working across instances and across restarts
 * with no extra storage or a new store interface, and it means there is no
 * session table to leak. The signing key is derived from the current password
 * hash, so changing the password invalidates every outstanding token by
 * construction — no cleanup job can forget to run.
 *
 * A token is bound to the anonymous identity that unlocked it, expires on its
 * own, and carries the access "version" so the admin can revoke access without
 * rotating the password.
 */

import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  getSettings,
  reservedRoomLocked,
  reservedRoomPasswordHash,
  reservedRoomPasswordVersion,
} from "./settings.js";

/** How long an unlocked device stays unlocked. */
export const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * scrypt work factor. Chosen so a single verification is expensive enough to
 * make an online guessing run pointless, while a legitimate join still feels
 * instant. Attempts are also rate limited per caller (see handlers.ts).
 */
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Marker so a stored value is recognisably ours (and versionable later). */
const HASH_PREFIX = "scrypt";

/**
 * Hash a password for storage. The salt is per-password and random, so two
 * users/rooms with the same password never share a hash.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, 32, SCRYPT_OPTIONS);
  return `${HASH_PREFIX}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Check a password against a stored hash in constant time. A malformed or
 * missing hash fails closed rather than throwing.
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "hex");
    expected = Buffer.from(parts[2], "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password.normalize("NFKC"), salt, expected.length, SCRYPT_OPTIONS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

interface AccessPayload {
  /** Session the token was issued to. */
  s: string;
  /** Room code it opens. */
  c: string;
  /** Access version at issue time. */
  v: number;
  /** Expiry, ms epoch. */
  e: number;
}

/**
 * Signing key for access tokens: derived from the live password hash, so it
 * changes exactly when the password does. An unlocked device is therefore
 * signed out by a password change, on every instance, with no bookkeeping.
 */
function tokenSecret(): string {
  return `cryo-reserved:${reservedRoomPasswordHash()}`;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function encodePayload(payload: AccessPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(body: string): AccessPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.s !== "string" || typeof p.c !== "string") return null;
    if (typeof p.v !== "number" || typeof p.e !== "number") return null;
    return { s: p.s, c: p.c, v: p.v, e: p.e };
  } catch {
    return null;
  }
}

export interface IssuedAccess {
  token: string;
  expiresAt: number;
}

/**
 * Mint an access token for a session that just proved the password. Returns
 * null when the room has no password, so callers can skip the round trip.
 */
export function issueAccessToken(code: string, sessionId: string): IssuedAccess | null {
  if (!reservedRoomLocked()) return null;
  const expiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
  const body = encodePayload({
    s: sessionId,
    c: code,
    v: reservedRoomPasswordVersion(),
    e: expiresAt,
  });
  return { token: `${body}.${sign(body, tokenSecret())}`, expiresAt };
}

/**
 * Verify a token for a specific code + session. Fails closed on anything
 * unexpected: bad shape, bad signature, wrong room, wrong identity, stale
 * version, or expired.
 */
export function verifyAccessToken(token: unknown, code: string, sessionId: string): boolean {
  if (typeof token !== "string" || token.length === 0 || token.length > 512) return false;
  if (!reservedRoomLocked()) return true; // nothing to unlock anymore
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body, tokenSecret());
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const payload = decodePayload(body);
  if (!payload) return false;
  if (payload.c !== code) return false;
  if (payload.s !== sessionId) return false;
  if (payload.v !== reservedRoomPasswordVersion()) return false;
  if (!Number.isFinite(payload.e) || payload.e <= Date.now()) return false;
  return true;
}

/** Check a password against the current reserved-room password. */
export function verifyReservedPassword(password: string): boolean {
  return verifyPassword(password, reservedRoomPasswordHash());
}

export type EntryDecision = "open" | "granted" | "invalid" | "required";

/**
 * Decide whether a caller may enter a room.
 *
 * `locked` is what the caller believes the room requires; the password and
 * token are whatever arrived with the request. A correct password or a valid
 * token both grant entry, and a token additionally returns a fresh one so an
 * old device keeps its access alive as long as it keeps using it.
 */
export function decideEntry(
  locked: boolean,
  code: string,
  sessionId: string,
  password: unknown,
  token: unknown,
): EntryDecision {
  if (!locked) return "open";
  if (verifyAccessToken(token, code, sessionId)) return "granted";
  if (typeof password === "string" && password.length > 0) {
    return verifyReservedPassword(password) ? "granted" : "invalid";
  }
  return "required";
}

/** Whether the reserved room needs a password right now (cheap read for the UI). */
export function isReservedRoomLocked(): boolean {
  return reservedRoomLocked();
}

/** Admin-facing summary. Contains no secret material. */
export function reservedRoomAccessState(): {
  locked: boolean;
  enabled: boolean;
  code: string;
} {
  const s = getSettings();
  return {
    locked: s.reservedRoomPassword !== "",
    enabled: s.reservedRoomEnabled,
    code: s.reservedRoomCode,
  };
}
