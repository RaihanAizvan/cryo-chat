import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  ACCESS_TOKEN_TTL_MS,
  decideEntry,
  hashPassword,
  issueAccessToken,
  verifyAccessToken,
  verifyPassword,
  isRoomLocked,
  isPasswordInForce,
  type PasswordRoom,
} from "./reserved.js";
import { isLocked } from "./rooms.js";

const SESSION = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

/** A locked room, without dragging the whole room module's state into a test. */
function lockedRoom(code: string, password: string): PasswordRoom {
  return { code, passwordHash: hashPassword(password), passwordVersion: 1, passwordExpiresAt: 0 };
}

/** The signing key, derived the same way the server derives it. */
function testSecret(room: PasswordRoom): string {
  return `cryo-room:${room.passwordHash}`;
}

function signBody(room: PasswordRoom, body: string): string {
  return createHmac("sha256", testSecret(room)).update(body).digest("base64url");
}

function body(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

const openRoom: PasswordRoom = {
  code: "1234",
  passwordHash: "",
  passwordVersion: 1,
  passwordExpiresAt: 0,
};

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
});

describe("access tokens", () => {
  it("round-trips for the identity and room it was issued for", () => {
    const room = lockedRoom("CRYO", "cold brew");
    const issued = issueAccessToken(room, SESSION);
    expect(issued).not.toBeNull();
    expect(issued!.expiresAt).toBeGreaterThan(Date.now());
    expect(verifyAccessToken(issued!.token, room, SESSION)).toBe(true);
  });

  it("is bound to one identity and one room", () => {
    const room = lockedRoom("CRYO", "cold brew");
    const { token } = issueAccessToken(room, SESSION)!;
    expect(verifyAccessToken(token, room, OTHER)).toBe(false);
    expect(verifyAccessToken(token, { ...room, code: "CRY1" }, SESSION)).toBe(false);
  });

  it("never crosses rooms, even with the same password", () => {
    // The whole point of per-room passwords: the key comes from the room's own
    // hash, so one room's token cannot open another even at equal passwords.
    const a = lockedRoom("AAAA", "same password");
    const b = lockedRoom("BBBB", "same password");
    const { token } = issueAccessToken(a, SESSION)!;
    expect(verifyAccessToken(token, b, SESSION)).toBe(false);
  });

  it("rejects tampered, truncated and foreign tokens", () => {
    const room = lockedRoom("CRYO", "cold brew");
    const { token } = issueAccessToken(room, SESSION)!;
    const dot = token.lastIndexOf(".");
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    expect(verifyAccessToken(`${payload}.${sig}x`, room, SESSION)).toBe(false);
    expect(verifyAccessToken(payload, room, SESSION)).toBe(false);
    expect(verifyAccessToken("", room, SESSION)).toBe(false);
    expect(verifyAccessToken("garbage", room, SESSION)).toBe(false);
    expect(verifyAccessToken("x".repeat(600), room, SESSION)).toBe(false);
    expect(verifyAccessToken(12345, room, SESSION)).toBe(false);
    expect(verifyAccessToken(null, room, SESSION)).toBe(false);

    // A swapped payload under a real signature is the attack that matters:
    // re-signing someone else's identity must not help.
    const forged = body({ s: OTHER, c: room.code, v: room.passwordVersion, e: Date.now() + 60_000 });
    expect(verifyAccessToken(`${forged}.${sig}`, room, SESSION)).toBe(false);
  });

  it("refuses an expired token but honours an identical fresh one", () => {
    const room = lockedRoom("CRYO", "cold brew");
    const expired = body({ s: SESSION, c: room.code, v: room.passwordVersion, e: Date.now() - 1 });
    expect(verifyAccessToken(`${expired}.${signBody(room, expired)}`, room, SESSION)).toBe(false);
    const live = body({ s: SESSION, c: room.code, v: room.passwordVersion, e: Date.now() + 60_000 });
    expect(verifyAccessToken(`${live}.${signBody(room, live)}`, room, SESSION)).toBe(true);
    expect(ACCESS_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("stops verifying once the password changes", () => {
    const room = lockedRoom("CRYO", "cold brew");
    const first = issueAccessToken(room, SESSION)!.token;
    const rotated = lockedRoom("CRYO", "new brew");
    expect(verifyAccessToken(first, rotated, SESSION)).toBe(false);
    expect(verifyAccessToken(issueAccessToken(rotated, SESSION)!.token, rotated, SESSION)).toBe(true);
  });

  it("stops verifying after a revoke", () => {
    const room = lockedRoom("CRYO", "cold brew");
    const first = issueAccessToken(room, SESSION)!.token;
    const revoked = { ...room, passwordVersion: room.passwordVersion + 1 };
    expect(verifyAccessToken(first, revoked, SESSION)).toBe(false);
    expect(verifyAccessToken(issueAccessToken(revoked, SESSION)!.token, revoked, SESSION)).toBe(true);
  });

  it("stops verifying after the password is removed", () => {
    const room = lockedRoom("CRYO", "cold brew");
    const { token } = issueAccessToken(room, SESSION)!;
    const opened = { ...room, passwordHash: "" };
    expect(isLocked(opened)).toBe(false);
    // Nothing to unlock, so the token is neither useful nor a liability.
    expect(verifyAccessToken(token, opened, SESSION)).toBe(true);
  });

  it("issues nothing while the room is open", () => {
    expect(issueAccessToken(openRoom, SESSION)).toBeNull();
  });
});

describe("entry decisions", () => {
  it("is a no-op on a room with no password", () => {
    expect(decideEntry(openRoom, SESSION, undefined, undefined)).toBe("open");
    expect(decideEntry(openRoom, SESSION, "whatever", "junk")).toBe("open");
  });

  it("asks before it guesses", () => {
    const room = lockedRoom("CRYO", "cold brew");
    expect(decideEntry(room, SESSION, undefined, undefined)).toBe("required");
    expect(decideEntry(room, SESSION, "", undefined)).toBe("required");
  });

  it("grants on the right password and refuses a wrong one", () => {
    const room = lockedRoom("CRYO", "cold brew");
    expect(decideEntry(room, SESSION, "cold brew", undefined)).toBe("granted");
    expect(decideEntry(room, SESSION, "wrong", undefined)).toBe("invalid");
  });

  it("lets a valid token win even when a stale password comes along", () => {
    const room = lockedRoom("CRYO", "cold brew");
    const { token } = issueAccessToken(room, SESSION)!;
    expect(decideEntry(room, SESSION, undefined, token)).toBe("granted");
    // Token first, on purpose: it is proof of access, so a device that still
    // has a password field filled in with an old value must not be locked out.
    expect(decideEntry(room, SESSION, "wrong", token)).toBe("granted");
  });

  it("treats another identity's token as no token at all", () => {
    const room = lockedRoom("CRYO", "cold brew");
    const { token } = issueAccessToken(room, OTHER)!;
    expect(decideEntry(room, SESSION, undefined, token)).toBe("required");
  });

  it("does not accept one room's password for another", () => {
    const a = lockedRoom("AAAA", "alpha pass");
    const b = lockedRoom("BBBB", "bravo pass");
    expect(decideEntry(a, SESSION, "alpha pass", undefined)).toBe("granted");
    expect(decideEntry(b, SESSION, "alpha pass", undefined)).toBe("invalid");
  });
});

describe("password expiry", () => {
  const lapsed: PasswordRoom = {
    code: "CRYO",
    passwordHash: hashPassword("cold brew"),
    passwordVersion: 2,
    passwordExpiresAt: Date.now() - 1,
  };

  it("stops requiring a password once it has lapsed", () => {
    expect(isRoomLocked(lapsed)).toBe(false);
    expect(decideEntry(lapsed, SESSION, undefined, undefined)).toBe("open");
  });

  it("does not care what the visitor supplies any more", () => {
    // A lapsed room is public. Even a wrong password must not turn the visit
    // into a rejection — that is the confusing failure mode where the room
    // "rejects" people for a password it is not even checking.
    expect(decideEntry(lapsed, SESSION, "wrong", undefined)).toBe("open");
  });

  it("still accepts the right password on a room that has not lapsed", () => {
    const live: PasswordRoom = { ...lapsed, passwordExpiresAt: Date.now() + 60_000 };
    expect(isRoomLocked(live)).toBe(true);
    expect(decideEntry(live, SESSION, "cold brew", undefined)).toBe("granted");
    expect(decideEntry(live, SESSION, "wrong", undefined)).toBe("invalid");
  });

  it("treats zero as never expiring", () => {
    const forever: PasswordRoom = { ...lapsed, passwordExpiresAt: 0 };
    expect(isPasswordInForce(forever)).toBe(true);
    expect(isRoomLocked(forever)).toBe(true);
  });
});
