import { beforeEach, describe, expect, it } from "vitest";
import type { Socket } from "socket.io";
import {
  getSession,
  updateName,
  destroy,
  allIdentities,
  identityById,
  allBindings,
  deleteIdentity,
  pruneIdentities,
  IDENTITY_MAX,
} from "./sessions";
import { ban, unban } from "./bans";

function fakeSocket(id: string): Socket {
  return { id } as unknown as Socket;
}

beforeEach(() => {
  // Prune module-level session state left by previous tests: both the bindings
  // (keyed by socket id) and the issued identities.
  for (const socketId of allBindings().keys()) destroy(fakeSocket(socketId));
  for (const s of allIdentities()) deleteIdentity(s.id);
});

describe("getSession", () => {
  it("creates a session with a random name + color", () => {
    const s = getSession(fakeSocket("s1"));
    expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(s.name.length).toBeGreaterThan(0);
    expect(s.color).toBeTypeOf("number");
    expect(identityById(s.id)).toBe(s);
  });

  it("caches the session for a socket", () => {
    const sock = fakeSocket("s1");
    expect(getSession(sock)).toBe(getSession(sock));
  });

  it("resumes a previously issued identity by UUID", () => {
    const sockA = fakeSocket("socket-A");
    const created = getSession(sockA);
    destroy(sockA); // disconnect but identity survives
    const sockB = fakeSocket("socket-B");
    const resumed = getSession(sockB, created.id);
    expect(resumed.id).toBe(created.id);
  });

  it("does not resume a non-UUID or unknown id", () => {
    const fresh = getSession(fakeSocket("sx"), "not-a-uuid");
    expect(fresh.id).not.toBe("not-a-uuid");
    const other = getSession(fakeSocket("sy"), "00000000-0000-0000-0000-000000000000");
    expect(other.id).not.toBe("00000000-0000-0000-0000-000000000000");
  });

  it("does not resume a banned identity", () => {
    const sockA = fakeSocket("ba");
    const created = getSession(sockA);
    ban(created.id);
    try {
      const fresh = getSession(fakeSocket("bb"), created.id);
      expect(fresh.id).not.toBe(created.id);
    } finally {
      unban(created.id);
    }
  });

  it("stamps lastSeenAt and refreshes it on resume", () => {
    const sockA = fakeSocket("s1");
    const created = getSession(sockA);
    expect(created.lastSeenAt).toBeGreaterThanOrEqual(created.createdAt);
    // Simulate a long-ago last sighting, then reconnect with the same id.
    const staleSeen = Date.now() - 1000 * 60 * 60;
    created.lastSeenAt = staleSeen;
    destroy(sockA);
    const resumed = getSession(fakeSocket("s2"), created.id);
    expect(resumed.lastSeenAt).toBeGreaterThan(staleSeen);
  });
});

describe("pruneIdentities", () => {
  const DAY_MS = 1000 * 60 * 60 * 24;

  it("drops identities that have not been seen for over the TTL", () => {
    const stale = getSession(fakeSocket("s1"));
    const fresh = getSession(fakeSocket("s2"));
    stale.lastSeenAt = Date.now() - 8 * DAY_MS;

    expect(pruneIdentities()).toBe(1);
    expect(identityById(stale.id)).toBeUndefined();
    expect(identityById(fresh.id)).toBe(fresh);
  });

  it("treats a missing lastSeenAt as createdAt", () => {
    const legacy = getSession(fakeSocket("s1"));
    // Simulate a row written before activity tracking existed.
    (legacy as { lastSeenAt?: number }).lastSeenAt = undefined;
    legacy.createdAt = Date.now() - 8 * DAY_MS;
    pruneIdentities();
    expect(identityById(legacy.id)).toBeUndefined();
  });

  it("never exceeds the cap and keeps the most recently seen", () => {
    const ancient = getSession(fakeSocket("s1"));
    ancient.lastSeenAt = Date.now() - 120_000;
    // `identities` is module-private, so overflow the cap by minting sessions.
    // The cap guard inside getSession trims as it goes, so the map must never
    // grow past IDENTITY_MAX even mid-flood.
    let newest = "";
    for (let i = 0; i < IDENTITY_MAX + 10; i++) {
      const s = getSession(fakeSocket(`filler-${i}`));
      s.lastSeenAt = Date.now() - 60_000;
      newest = s.id;
      expect(allIdentities().length).toBeLessThanOrEqual(IDENTITY_MAX);
    }
    pruneIdentities();
    expect(allIdentities().length).toBe(IDENTITY_MAX);
    // The least recently seen identity is evicted; the newest is kept.
    expect(identityById(ancient.id)).toBeUndefined();
    expect(identityById(newest)).toBeDefined();
  });
});

describe("updateName", () => {
  it("renames and recolors a session", () => {
    const sock = fakeSocket("s1");
    getSession(sock);
    const updated = updateName(sock, "  Coral   Wren  ");
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Coral Wren");
    expect(updated!.color).toBeTypeOf("number");
  });

  it("returns null for an invalid name", () => {
    const sock = fakeSocket("s1");
    getSession(sock);
    expect(updateName(sock, "   ")).toBeNull();
    expect(updateName(sock, 42)).toBeNull();
  });
});

describe("destroy / allBindings / deleteIdentity", () => {
  it("unbinds a socket but keeps the identity", () => {
    const sock = fakeSocket("s1");
    const created = getSession(sock);
    destroy(sock);
    expect(allBindings().get("s1")).toBeUndefined();
    expect(identityById(created.id)).toBe(created);
  });

  it("deletes an identity entirely (disables resume)", () => {
    const sock = fakeSocket("s1");
    const created = getSession(sock);
    expect(deleteIdentity(created.id)).toBe(true);
    expect(identityById(created.id)).toBeUndefined();
    const again = getSession(fakeSocket("s2"), created.id);
    expect(again.id).not.toBe(created.id);
  });

  it("rejects non-UUID ids in deleteIdentity", () => {
    expect(deleteIdentity("nope")).toBe(false);
  });
});