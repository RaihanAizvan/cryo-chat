import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io";
import {
  createRoom,
  getRoom,
  getRoomByCode,
  getOrCreateSpecialRoom,
  deleteRoom,
  addParticipant,
  participantForSocket,
  removeParticipant,
  removeParticipantById,
  removeParticipantLocalOnly,
  renameParticipant,
  renameParticipantById,
  addMessage,
  addSystemMessage,
  getMessages,
  clearMessages,
  setParticipantLastSeen,
  loadAllRoomsFromStore,
  toPublicRoom,
  snapshotRoom,
  restoreRoom,
  applyRemoteSnapshot,
  setRoomPassword,
  clearRoomPassword,
  setReserved,
  MIN_PASSWORD_LIFETIME_MS,
  MAX_PASSWORD_LIFETIME_MS,
  allRooms,
  isExpired,
  isLocked,
  type Room,
} from "./rooms";
import { updateSettings, getSettings } from "./settings";

/** Minimal socket stand-in: rooms.ts only touches `.id`. */
function fakeSocket(id: string): Socket {
  return { id } as unknown as Socket;
}

/** Fresh room with a host already seated (mirrors handlers.ts flow). */
function setupRoom(): Room {
  const room = createRoom();
  addParticipant(room, fakeSocket("sock-host"), "host-id", "Host", 0);
  return room;
}

beforeEach(() => {
  // Reset module-level room store between tests.
  for (const r of allRooms()) deleteRoom(r.id);
  updateSettings({
    maxRoomSize: 50,
    messageCap: 200,
    roomTtlMinutes: 120,
    messageTtlMinutes: 1440,
  });
});

describe("createRoom", () => {
  it("creates a non-reserved room with the default code & TTL", () => {
    const room = createRoom();
    expect(room.reserved).toBe(false);
    expect(room.code).toMatch(/^\d{4}$/);
    expect(room.expiresAt).toBe(room.createdAt + getSettings().roomTtlMs);
    expect(getRoom(room.id)).toBe(room);
  });

  it("is reserved when the code is the front door", () => {
    const room = createRoom({ code: "9999" });
    expect(room.reserved).toBe(true);
    expect(room.expiresAt).toBe(Number.POSITIVE_INFINITY);
  });

  it("lets the caller reserve any room, independently of its code", () => {
    const room = createRoom({ reserved: true });
    expect(room.reserved).toBe(true);
    expect(room.expiresAt).toBe(Number.POSITIVE_INFINITY);
  });

  it("creates a private-capable but public room by default", () => {
    const room = createRoom();
    expect(room.passwordHash).toBe("");
    expect(room.passwordExpiresAt).toBe(0);
    expect(isLocked(room)).toBe(false);
  });

  it("random code never shadows the front-door code", async () => {
    const util = await import("./util");
    const spy = vi.spyOn(util, "randomRoomCode").mockReturnValueOnce("9999");
    try {
      const room = createRoom();
      expect(room.code).not.toBe("9999");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("getRoom / getRoomByCode / isExpired", () => {
  it("returns undefined for unknown ids/codes", () => {
    expect(getRoom("missing")).toBeUndefined();
    expect(getRoomByCode("0000")).toBeUndefined();
  });

  it("evicts an expired room on access", () => {
    const room = setupRoom();
    vi.useFakeTimers();
    try {
      // roomTtlMs is 2h; jump past it.
      vi.setSystemTime(room.createdAt + getSettings().roomTtlMs + 1);
      expect(getRoom(room.id)).toBeUndefined();
      expect(isExpired(room)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finds rooms by code", () => {
    const room = setupRoom();
    expect(getRoomByCode(room.code)?.id).toBe(room.id);
  });
});

describe("getOrCreateSpecialRoom", () => {
  it("creates the front-door room on demand and reuses it", () => {
    const a = getOrCreateSpecialRoom();
    expect(a.reserved).toBe(true);
    expect(getOrCreateSpecialRoom()).toBe(a);
  });

  it("is an ordinary room as far as privacy goes", () => {
    // Reserved says "never expires", not "needs a password".
    expect(isLocked(getOrCreateSpecialRoom())).toBe(false);
  });
});

describe("addParticipant / participantForSocket", () => {
  it("seats a participant as host when room is empty", () => {
    const room = createRoom();
    const p = addParticipant(room, fakeSocket("s1"), "p1", "Alice", 3);
    expect(p).not.toBeNull();
    expect(room.hostParticipantId).toBe("p1");
    expect(participantForSocket(room, "s1")?.id).toBe("p1");
  });

  it("rejects when the room is full", () => {
    updateSettings({ maxRoomSize: 2 });
    const room = createRoom();
    addParticipant(room, fakeSocket("s1"), "p1", "A", 0);
    addParticipant(room, fakeSocket("s2"), "p2", "B", 0);
    expect(addParticipant(room, fakeSocket("s3"), "p3", "C", 0)).toBeNull();
  });

  it("rebinds an existing participant to a new socket (reconnect)", () => {
    const room = setupRoom();
    addParticipant(room, fakeSocket("s-other"), "other", "Other", 0);
    // Same participant id, new socket: should reuse entry, not duplicate. The
    // participant record is refreshed (joinedAt/status) but color/name keep
    // their current values (that's the reconnect semantics).
    const rejoined = addParticipant(room, fakeSocket("s-other2"), "other", "Other", 5);
    expect(rejoined?.id).toBe("other");
    if (rejoined) expect(rejoined.color).toBe(0);
    expect(room.participants.size).toBe(2);
    expect(participantForSocket(room, "s-other2")?.id).toBe("other");
  });
});

describe("removeParticipant", () => {
  it("removes by socket and reassigns host to the next participant", () => {
    const room = setupRoom();
    addParticipant(room, fakeSocket("s2"), "p2", "Second", 0);
    const res = removeParticipant(room, "sock-host");
    expect(res.participant?.id).toBe("host-id");
    expect(res.empty).toBe(false);
    expect(room.hostParticipantId).toBe("p2");
  });

  it("reports empty when the last participant leaves", () => {
    const room = setupRoom();
    const res = removeParticipant(room, "sock-host");
    expect(res.empty).toBe(true);
    expect(room.hostParticipantId).toBe("");
  });

  it("is a no-op for unknown sockets", () => {
    const room = setupRoom();
    const res = removeParticipant(room, "ghost");
    expect(participantForSocket(room, "ghost")).toBeUndefined();
    expect(res.empty).toBe(false);
    expect(room.participants.size).toBe(1);
  });
});

describe("renameParticipant / renameParticipantById", () => {
  it("renames a participant by socket", () => {
    const room = setupRoom();
    const updated = renameParticipant(room, "sock-host", "New Name", 4);
    expect(updated?.name).toBe("New Name");
    expect(updated?.color).toBe(4);
    expect(room.participants.get("host-id")?.name).toBe("New Name");
  });

  it("renames by participant id", () => {
    const room = setupRoom();
    const updated = renameParticipantById(room, "host-id", "Direct Rename");
    expect(updated?.name).toBe("Direct Rename");
  });

  it("returns undefined for unknown sockets/ids", () => {
    const room = setupRoom();
    expect(renameParticipant(room, "ghost", "x", 1)).toBeUndefined();
    expect(renameParticipantById(room, "missing", "x")).toBeUndefined();
  });
});

describe("removeParticipantById / removeParticipantLocalOnly", () => {
  it("removes a participant by id and clears their socket mappings", () => {
    const room = setupRoom();
    addParticipant(room, fakeSocket("s2"), "p2", "Second", 0);
    const removed = removeParticipantById(room, "p2");
    expect(removed?.id).toBe("p2");
    expect(room.participants.has("p2")).toBe(false);
    expect(participantForSocket(room, "s2")).toBeUndefined();
    expect(room.hostParticipantId).toBe("host-id");
  });

  it("reassigns the host when the removed participant was the host", () => {
    const room = setupRoom();
    addParticipant(room, fakeSocket("s2"), "p2", "Second", 0);
    removeParticipantById(room, "host-id");
    expect(room.hostParticipantId).toBe("p2");
  });

  it("is a no-op and leaves the room alone for unknown ids", () => {
    const room = setupRoom();
    expect(removeParticipantById(room, "ghost")).toBeUndefined();
    expect(room.participants.size).toBe(1);
    expect(room.sockets.size).toBe(1);
  });

  it("removeParticipantLocalOnly drops state without persisting (idempotent)", () => {
    const room = setupRoom();
    addParticipant(room, fakeSocket("s2"), "p2", "Second", 0);
    const removed = removeParticipantLocalOnly(room, "p2");
    expect(removed?.id).toBe("p2");
    expect(participantForSocket(room, "s2")).toBeUndefined();
    expect(room.participants.has("p2")).toBe(false);
    // A second call (e.g. a late kick event echo) is a safe no-op.
    expect(removeParticipantLocalOnly(room, "p2")).toBeUndefined();
    expect(room.participants.size).toBe(1);
  });
});

describe("addMessage / addSystemMessage / getMessages", () => {
  it("stores a user message with participant snapshot", () => {
    const room = setupRoom();
    const p = room.participants.get("host-id")!;
    const msg = addMessage(room, p, "hello", "client-1");
    expect(msg.text).toBe("hello");
    expect(msg.clientId).toBe("client-1");
    expect(msg.kind).toBe("user");
    expect(msg.name).toBe(p.name);
    expect(getMessages(room)).toHaveLength(1);
  });

  it("stores a system message", () => {
    const room = setupRoom();
    const msg = addSystemMessage(room, "Alice joined");
    expect(msg.kind).toBe("system");
    expect(msg.text).toBe("Alice joined");
  });

  it("prunes messages older than messageTtlMs (newest kept)", () => {
    const room = setupRoom();
    const p = room.participants.get("host-id")!;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000_000_000);
      addMessage(room, p, "old");
      vi.setSystemTime(1_000_000_000_000 + getSettings().messageTtlMs + 1);
      addMessage(room, p, "new");
      const msgs = getMessages(room);
      expect(msgs.map((m) => m.text)).toEqual(["new"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps room history to the rolling message cap (newest kept)", () => {
    updateSettings({ messageCap: 20 });
    const room = setupRoom();
    const p = room.participants.get("host-id")!;
    for (let i = 1; i <= 30; i++) addMessage(room, p, `m${i}`);
    const texts = getMessages(room).map((m) => m.text);
    expect(texts).toEqual([
      "m11", "m12", "m13", "m14", "m15", "m16", "m17", "m18", "m19", "m20",
      "m21", "m22", "m23", "m24", "m25", "m26", "m27", "m28", "m29", "m30",
    ]);
  });

  it("clearMessages wipes history and read positions", () => {
    const room = setupRoom();
    const p = room.participants.get("host-id")!;
    addMessage(room, p, "x");
    setParticipantLastSeen(room, "host-id", "some-id");
    clearMessages(room);
    expect(getMessages(room)).toEqual([]);
    expect(room.participants.get("host-id")?.lastSeenMessageId).toBeUndefined();
  });
});

describe("loadAllRoomsFromStore (admin live view, memory mode)", () => {
  it("lists live local rooms instead of ignoring them", async () => {
    const room = createRoom();
    addParticipant(room, fakeSocket("sock-host"), "host-id", "Host", 0);
    const rooms = await loadAllRoomsFromStore();
    expect(rooms.map((r) => r.id)).toContain(room.id);
  });
});

describe("toPublicRoom", () => {
  it("reports isHost only for the host socket", () => {
    const room = setupRoom();
    addParticipant(room, fakeSocket("s2"), "p2", "Second", 0);
    const hostView = toPublicRoom(room, "sock-host", room.hostParticipantId);
    expect(hostView.isHost).toBe(true);
    expect(hostView.participants).toHaveLength(2);
    expect(hostView.reserved).toBe(false);
    const otherView = toPublicRoom(room, "s2", room.hostParticipantId);
    expect(otherView.isHost).toBe(false);
  });

  it("serializes reserved expiry as MAX_SAFE_INTEGER (no JSON Infinity)", () => {
    const room = createRoom({ code: "9999" });
    addParticipant(room, fakeSocket("s1"), "p1", "A", 0);
    const view = toPublicRoom(room, "s1", "p1");
    expect(view.reserved).toBe(true);
    expect(view.expiresAt).toBe(Number.MAX_SAFE_INTEGER);
  });
});
describe("room privacy", () => {
  it("starts public and has no expiry", () => {
    const room = createRoom();
    expect(isLocked(room)).toBe(false);
    expect(room.passwordExpiresAt).toBe(0);
    expect(toPublicRoom(room, "sock", room.hostParticipantId).locked).toBe(false);
  });

  it("locks on a password and unlocks again on removal", () => {
    const room = createRoom();
    const set = setRoomPassword(room, "cold brew");
    expect(set.ok).toBe(true);
    expect(isLocked(room)).toBe(true);
    clearRoomPassword(room);
    expect(isLocked(room)).toBe(false);
  });

  it("stays locked with no expiry by default", () => {
    const room = createRoom();
    setRoomPassword(room, "cold brew");
    expect(room.passwordExpiresAt).toBe(0);
    expect(isLocked(room)).toBe(true);
  });

  it("reopens when the expiry passes, instead of locking everyone out", () => {
    const room = createRoom();
    setRoomPassword(room, "cold brew", Date.now() + 60_000);
    expect(isLocked(room)).toBe(true);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 120_000);
      expect(isLocked(room)).toBe(false);
      // The hash is kept, so the audit trail still explains why the room opened.
      expect(room.passwordHash).not.toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps an expiry in the past into the future", () => {
    const room = createRoom();
    const before = Date.now();
    setRoomPassword(room, "cold brew", 1);
    expect(room.passwordExpiresAt).toBeGreaterThanOrEqual(before + MIN_PASSWORD_LIFETIME_MS);
  });

  it("clamps a far-future expiry down to the ceiling", () => {
    const room = createRoom();
    const now = Date.now();
    setRoomPassword(room, "cold brew", now + MAX_PASSWORD_LIFETIME_MS * 100);
    expect(room.passwordExpiresAt).toBeLessThanOrEqual(now + MAX_PASSWORD_LIFETIME_MS + 1000);
  });

  it("rejects a password that is too short or too long, leaving the room as it was", () => {
    const room = createRoom();
    expect(setRoomPassword(room, "ab").ok).toBe(false);
    expect(setRoomPassword(room, "x".repeat(500)).ok).toBe(false);
    expect(isLocked(room)).toBe(false);
  });

  it("never exposes the password or its expiry to a public room view", () => {
    const room = createRoom();
    addParticipant(room, fakeSocket("s1"), "p1", "A", 0);
    setRoomPassword(room, "cold brew", Date.now() + 86_400_000);
    const view = toPublicRoom(room, "s1", "p1");
    expect(view.locked).toBe(true);
    expect(view.passwordExpiresAt).toBeGreaterThan(Date.now());
    expect(JSON.stringify(view)).not.toContain("scrypt");
  });

  it("reports no expiry on the public view of a public room", () => {
    const room = createRoom();
    addParticipant(room, fakeSocket("s1"), "p1", "A", 0);
    setRoomPassword(room, "cold brew", Date.now() + 86_400_000);
    clearRoomPassword(room);
    expect(toPublicRoom(room, "s1", "p1").passwordExpiresAt).toBe(0);
  });

  it("keeps reserved and locked independent", () => {
    const room = createRoom();
    setReserved(room, true);
    expect(room.reserved).toBe(true);
    expect(isLocked(room)).toBe(false);

    const other = createRoom();
    setRoomPassword(other, "cold brew");
    expect(other.reserved).toBe(false);
    expect(isLocked(other)).toBe(true);
  });

  it("carries the expiry through a snapshot round trip", () => {
    const room = createRoom();
    const expires = Date.now() + 86_400_000;
    setRoomPassword(room, "cold brew", expires);
    const back = restoreRoom(snapshotRoom(room));
    expect(back.passwordHash).toBe(room.passwordHash);
    expect(back.passwordExpiresAt).toBe(room.passwordExpiresAt);
    expect(isLocked(back)).toBe(true);
  });

  it("does not let a stale snapshot reopen a room that was just locked", () => {
    const room = createRoom();
    // A snapshot taken while the room was still public.
    const stale = snapshotRoom(room);
    const versionBefore = room.passwordVersion;
    setRoomPassword(room, "cold brew", Date.now() + 86_400_000);
    expect(room.passwordVersion).toBeGreaterThan(versionBefore);

    // Replaying the old snapshot must not undo the lock.
    applyRemoteSnapshot(room, stale);
    expect(isLocked(room)).toBe(true);
    expect(room.passwordExpiresAt).toBeGreaterThan(Date.now());
  });

  it("does not let a stale snapshot resurrect an old expiry", () => {
    const room = createRoom();
    setRoomPassword(room, "cold brew", Date.now() + 86_400_000);
    const stale = snapshotRoom({ ...room, passwordExpiresAt: 0, passwordVersion: 1 });
    // Clear then replay: the snapshot is older, so it must not win.
    clearRoomPassword(room);
    applyRemoteSnapshot(room, stale);
    expect(isLocked(room)).toBe(false);
  });
});
