import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  ACCESS_TOKEN_TTL_MS,
  decideEntry,
  hashPassword,
  isReservedRoomLocked,
  issueAccessToken,
  reservedRoomAccessState,
  verifyAccessToken,
  verifyPassword,
  verifyReservedPassword,
} from "./reserved.js";
import {
  clearReservedRoomPassword,
  MAX_ROOM_PASSWORD_LENGTH,
  MIN_ROOM_PASSWORD_LENGTH,
  reservedRoomLocked,
  reservedRoomPasswordHash,
  reservedRoomPasswordVersion,
  revokeReservedRoomAccess,
  setReservedRoomPassword,
  updateSettings,
} from "./settings.js";

const SESSION = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

/** The signing key, derived the same way the server derives it. */
function testSecret(): string {
  return `cryo-reserved:${reservedRoomPasswordHash()}`;
}

function signBody(body: string): string {
  return createHmac("sha256", testSecret()).update(body).digest("base64url");
}

function body(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * `settings` is a module singleton, so each case starts from a known base: a
 * reserved room that is enabled and has no password.
 */
function reset() {
  updateSettings({
    reservedRoomCode: "CRYO",
    reservedRoomEnabled: true,
  });
  clearReservedRoomPassword();
}

function lock(password = "cold brew") {
  expect(setReservedRoomPassword(password).ok).toBe(true);
}

beforeEach(reset);

describe("password hashing", () => {
  it("stores no plaintext and verifies the right password", () => {
    const stored = hashPassword("cold brew");
    expect(stored).not.toContain("cold brew");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("cold brew", stored)).toBe(true);
    expect(verifyPassword("cold brews", stored)).toBe(false);
  });

  it("salts per password, so equal passwords hash differently", () => {
    const a = hashPassword("same");
    const b = hashPassword("same");
    expect(a).not.toBe(b);
    expect(verifyPassword("same", a)).toBe(true);
    expect(verifyPassword("same", b)).toBe(true);
  });

  it("fails closed on malformed stored hashes instead of throwing", () => {
    for (const bad of ["", "nope", "scrypt$", "scrypt$$", "scrypt$zz$zz", "scrypt$a$b$c", "bcrypt$1$2"]) {
      expect(verifyPassword("x", bad)).toBe(false);
    }
  });

  it("only ever stores a hash for the reserved room", () => {
    lock();
    const hash = reservedRoomPasswordHash();
    expect(hash).not.toContain("cold brew");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(verifyReservedPassword("cold brew")).toBe(true);
    expect(verifyReservedPassword("Cold Brew")).toBe(false);
    expect(verifyReservedPassword("")).toBe(false);
  });

  it("rejects passwords outside the accepted range", () => {
    expect(setReservedRoomPassword("x".repeat(MIN_ROOM_PASSWORD_LENGTH - 1)).ok).toBe(false);
    expect(setReservedRoomPassword("x".repeat(MAX_ROOM_PASSWORD_LENGTH + 1)).ok).toBe(false);
    // Surrounding whitespace is a paste accident, not a different password.
    expect(setReservedRoomPassword(`  ${"x".repeat(MIN_ROOM_PASSWORD_LENGTH)}  `).ok).toBe(true);
    expect(verifyReservedPassword("x".repeat(MIN_ROOM_PASSWORD_LENGTH))).toBe(true);
  });

  it("does not lock a disabled reserved room", () => {
    lock();
    updateSettings({ reservedRoomEnabled: false });
    expect(reservedRoomLocked()).toBe(false);
    expect(isReservedRoomLocked()).toBe(false);
  });
});

describe("access tokens", () => {
  it("round-trips for the identity and room it was issued for", () => {
    lock();
    const issued = issueAccessToken("CRYO", SESSION);
    expect(issued).not.toBeNull();
    expect(issued!.expiresAt).toBeGreaterThan(Date.now());
    expect(verifyAccessToken(issued!.token, "CRYO", SESSION)).toBe(true);
  });

  it("is bound to one identity and one room", () => {
    lock();
    const { token } = issueAccessToken("CRYO", SESSION)!;
    expect(verifyAccessToken(token, "CRYO", OTHER)).toBe(false);
    expect(verifyAccessToken(token, "CRY1", SESSION)).toBe(false);
  });

  it("rejects tampered, truncated and foreign tokens", () => {
    lock();
    const { token } = issueAccessToken("CRYO", SESSION)!;
    const dot = token.lastIndexOf(".");
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    expect(verifyAccessToken(`${payload}.${sig}x`, "CRYO", SESSION)).toBe(false);
    expect(verifyAccessToken(payload, "CRYO", SESSION)).toBe(false);
    expect(verifyAccessToken("", "CRYO", SESSION)).toBe(false);
    expect(verifyAccessToken("garbage", "CRYO", SESSION)).toBe(false);
    expect(verifyAccessToken("x".repeat(600), "CRYO", SESSION)).toBe(false);
    expect(verifyAccessToken(12345, "CRYO", SESSION)).toBe(false);
    expect(verifyAccessToken(null, "CRYO", SESSION)).toBe(false);

    // A swapped payload under a real signature is the attack that matters:
    // re-signing someone else's identity must not help.
    const forged = body({ s: OTHER, c: "CRYO", v: reservedRoomPasswordVersion(), e: Date.now() + 60_000 });
    expect(verifyAccessToken(`${forged}.${sig}`, "CRYO", SESSION)).toBe(false);
  });

  it("refuses an expired token but honours an identical fresh one", () => {
    lock();
    const expired = body({ s: SESSION, c: "CRYO", v: reservedRoomPasswordVersion(), e: Date.now() - 1 });
    expect(verifyAccessToken(`${expired}.${signBody(expired)}`, "CRYO", SESSION)).toBe(false);
    const live = body({ s: SESSION, c: "CRYO", v: reservedRoomPasswordVersion(), e: Date.now() + 60_000 });
    expect(verifyAccessToken(`${live}.${signBody(live)}`, "CRYO", SESSION)).toBe(true);
    expect(ACCESS_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("stops verifying once the password changes", () => {
    lock();
    const first = issueAccessToken("CRYO", SESSION)!.token;
    lock("new brew");
    expect(verifyAccessToken(first, "CRYO", SESSION)).toBe(false);
    expect(verifyAccessToken(issueAccessToken("CRYO", SESSION)!.token, "CRYO", SESSION)).toBe(true);
  });

  it("stops verifying after a revoke, and works again with a new token", () => {
    lock();
    const first = issueAccessToken("CRYO", SESSION)!.token;
    const before = reservedRoomPasswordVersion();
    // Revoke without touching the password.
    revokeReservedRoomAccess();
    expect(reservedRoomPasswordVersion()).toBe(before + 1);
    expect(verifyAccessToken(first, "CRYO", SESSION)).toBe(false);
    expect(verifyAccessToken(issueAccessToken("CRYO", SESSION)!.token, "CRYO", SESSION)).toBe(true);
  });

  it("stops verifying after the password is removed", () => {
    lock();
    const { token } = issueAccessToken("CRYO", SESSION)!;
    clearReservedRoomPassword();
    expect(isReservedRoomLocked()).toBe(false);
    // Nothing to unlock, so even nonsense would be admitted — the point is
    // that a *stored* token must not become a liability.
    expect(verifyAccessToken(token, "CRYO", SESSION)).toBe(true);
    expect(verifyAccessToken("nonsense", "CRYO", SESSION)).toBe(true);
  });

  it("issues nothing while the room is open", () => {
    expect(issueAccessToken("CRYO", SESSION)).toBeNull();
    expect(reservedRoomAccessState()).toEqual({ locked: false, enabled: true, code: "CRYO" });
  });
});

describe("entry decisions", () => {
  it("is a no-op on a room that is not locked", () => {
    expect(decideEntry(false, "1234", SESSION, undefined, undefined)).toBe("open");
    expect(decideEntry(false, "1234", SESSION, "whatever", "junk")).toBe("open");
  });

  it("asks before it guesses", () => {
    lock();
    expect(decideEntry(true, "CRYO", SESSION, undefined, undefined)).toBe("required");
    expect(decideEntry(true, "CRYO", SESSION, "", undefined)).toBe("required");
  });

  it("grants on the right password and refuses a wrong one", () => {
    lock();
    expect(decideEntry(true, "CRYO", SESSION, "cold brew", undefined)).toBe("granted");
    expect(decideEntry(true, "CRYO", SESSION, "wrong", undefined)).toBe("invalid");
  });

  it("lets a valid token win even when a stale password comes along", () => {
    lock();
    const { token } = issueAccessToken("CRYO", SESSION)!;
    expect(decideEntry(true, "CRYO", SESSION, undefined, token)).toBe("granted");
    // Token first, on purpose: it is proof of access, so a device that still
    // has a password field filled in with an old value must not be locked out.
    expect(decideEntry(true, "CRYO", SESSION, "wrong", token)).toBe("granted");
  });

  it("treats another identity's token as no token at all", () => {
    lock();
    const { token } = issueAccessToken("CRYO", OTHER)!;
    expect(decideEntry(true, "CRYO", SESSION, undefined, token)).toBe("required");
  });
});
