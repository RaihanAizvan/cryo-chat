/**
 * Room manager.
 *
 * Rooms are ephemeral, in-memory objects. A single host creates a room; others
 * join via code or link. Participants are keyed by their internal nonce so that
 * the client's raw socket can never be trusted as membership proof. A periodic
 * sweep handles expiry and cleanup.
 */

import type { Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import type {
  Participant,
  PublicMessage,
  PublicRoom,
  MessageKind,
  MessageAttachment,
  MessageReply,
} from "@cryo/shared";
import { randomRoomCode, randomRoomId } from "./util.js";
import { getSettings, isSpecialCode, specialRoomCode } from "./settings.js";
import { hashPassword, isPasswordInForce, isRoomLocked } from "./reserved.js";
import { store } from "./store.js";
import type { RoomEventEnvelope } from "./store.js";
import { redisMode } from "./store.js";
import { config } from "./config.js";

interface InternalMessage {
  id: string;
  participantId: string;
  name: string;
  color: number;
  text: string;
  sentAt: number;
  kind: MessageKind;
  _roomId: string;
  clientId?: string;
  attachment?: MessageAttachment;
  replyTo?: MessageReply;
}

export interface Room {
  id: string;
  code: string;
  hostParticipantId: string;
  createdAt: number;
  expiresAt: number;
  /** Admin-owned: a reserved room never auto-expires. Unrelated to privacy. */
  reserved: boolean;
  /**
   * Salted scrypt hash of this room's password, or "" when the room is public.
   * Every room has its own — there is no shared password. The hash is never
   * sent to a client; it doubles as the signing key for this room's access
   * tokens, so rotating it invalidates every token handed out so far.
   */
  passwordHash: string;
  /** Bumped to revoke access without rotating the password. */
  passwordVersion: number;
  /**
   * Epoch ms after which the password stops being honoured, or 0 for "never".
   * A room with a non-empty `passwordHash` past this point falls back to public
   * rather than locking everyone out — see `passwordInForce`.
   */
  passwordExpiresAt: number;
  /** Map of participant nonce -> participant. */
  participants: Map<string, Participant>;
  /** Map of socket.id -> participant nonce. */
  sockets: Map<Socket["id"], string>;
  /** Ring buffer of messages (ephemeral). */
  messages: InternalMessage[];
}

/**
 * A JSON-safe copy of a room, used to persist to Redis and to ship to other
 * instances. `reserved` rooms serialize `expiresAt` as 0 because JSON has no
 * Infinity (same trick the public room view uses).
 *
 * Older snapshots predate per-room passwords; the missing fields are treated as
 * "no password, version 1" when restored, so an in-flight upgrade never turns
 * into a crash or a lockout.
 */
export interface RoomSnapshot {
  id: string;
  code: string;
  hostParticipantId: string;
  createdAt: number;
  expiresAt: number;
  reserved: boolean;
  passwordHash?: string;
  passwordVersion?: number;
  passwordExpiresAt?: number;
  participants: Participant[];
  messages: InternalMessage[];
}

const rooms = new Map<string, Room>();

/**
 * code -> room index. `getRoomByCode` used to scan every room, which is O(n) on
 * the hottest join path; an index makes it O(1) and keeps large instances fast.
 */
const codeIndex = new Map<string, Room>();

export interface CreateRoomOptions {
  code?: string;
  /** Set false so a caller can claim the code in the store before persisting. */
  persist?: boolean;
  /** Never auto-expire. Defaults to true for the front-door code only. */
  reserved?: boolean;
}

/** Create a new room and return it. The host participant is added by caller. */
export function createRoom(options: CreateRoomOptions = {}): Room {
  const now = Date.now();
  const settings = getSettings();
  const id = randomRoomId();
  // The front door is reserved so it cannot quietly expire out from under the
  // people who type its code. Everything else is created ordinary.
  const reserved = options.reserved ?? Boolean(options.code && isSpecialCode(options.code));
  const room: Room = {
    id,
    code: options.code ?? randomRoomCode(),
    hostParticipantId: "",
    createdAt: now,
    expiresAt: reserved ? Number.POSITIVE_INFINITY : now + settings.roomTtlMs,
    reserved,
    passwordHash: "",
    passwordVersion: 1,
    passwordExpiresAt: 0,
    participants: new Map(),
    sockets: new Map(),
    messages: [],
  };
  // Guard against a (vanishingly rare) id collision.
  while (rooms.has(room.id)) room.id = randomRoomId();
  // A random code must never shadow the front-door code, and two live
  // rooms must not share a code (the join path resolves by code).
  if (!options.code) {
    while (isSpecialCode(room.code) || codeIndex.has(room.code)) {
      room.code = randomRoomCode();
    }
  }
  rooms.set(id, room);
  codeIndex.set(room.code, room);
  if (options.persist !== false) persistRoom(room);
  return room;
}

/** Shortest password we accept — long enough not to be a slip, short enough to type. */
export const MIN_ROOM_PASSWORD_LENGTH = 4;
/** Longest accepted password, so pasting a whole document cannot wedge it. */
export const MAX_ROOM_PASSWORD_LENGTH = 128;
/** Upper bound on a host-chosen password lifetime. */
export const MAX_PASSWORD_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** Floor, so a password can never be created already lapsed. */
export const MIN_PASSWORD_LIFETIME_MS = 60_000;

/**
 * True when this room is actually private right now.
 *
 * Delegates to the access-control module so there is exactly one definition of
 * "locked" — the join gate and the UI must not be able to disagree about it.
 */
export function isLocked(room: Pick<Room, "passwordHash" | "passwordExpiresAt">): boolean {
  return isRoomLocked(room);
}

/** False once `passwordExpiresAt` has passed. A zero expiry never lapses. */
export function passwordInForce(room: Pick<Room, "passwordExpiresAt">): boolean {
  return isPasswordInForce(room);
}

/**
 * Set or change this room's password. Stores only a hash, and bumps the access
 * version, which is what invalidates every token issued under the old password
 * (they are signed with a key derived from the hash).
 *
 * `expiresAt` is the host's choice: an epoch ms, or 0 / undefined for "never".
 * Not calling this does not evict anyone already seated — a password governs
 * who may enter next, which is the only thing a password can meaningfully do
 * after the fact.
 */
export function setRoomPassword(
  room: Room,
  password: string,
  expiresAt?: number,
): { ok: true } | { ok: false; error: string } {
  const clean = password.normalize("NFKC").trim();
  if (clean.length < MIN_ROOM_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_ROOM_PASSWORD_LENGTH} characters.` };
  }
  if (clean.length > MAX_ROOM_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at most ${MAX_ROOM_PASSWORD_LENGTH} characters.` };
  }
  room.passwordHash = hashPassword(clean);
  room.passwordVersion += 1;
  room.passwordExpiresAt = normalizePasswordExpiry(expiresAt);
  persistRoom(room);
  return { ok: true };
}

/** Clamp a requested expiry into a sane future window, or 0 for "never". */
function normalizePasswordExpiry(raw: unknown): number {
  if (raw === undefined || raw === null || raw === 0) return 0;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  // Clamped at BOTH ends on purpose. A client with a wrong clock must not be
  // able to publish an open room by asking for an expiry that has already
  // passed, and no host should be able to set a password that lapses instantly.
  const now = Date.now();
  return Math.min(Math.max(ms, now + MIN_PASSWORD_LIFETIME_MS), now + MAX_PASSWORD_LIFETIME_MS);
}

/** Remove the password: the room goes back to being open to anyone with the code. */
export function clearRoomPassword(room: Room): void {
  room.passwordHash = "";
  room.passwordVersion += 1;
  room.passwordExpiresAt = 0;
  persistRoom(room);
}

/**
 * Sign every saved device out without changing the password: existing tokens
 * stop verifying, so the next join asks for the password again.
 */
export function revokeRoomAccess(room: Room): void {
  room.passwordVersion += 1;
  persistRoom(room);
}

/**
 * Mark a room reserved. Reserved rooms never auto-expire, so they survive being
 * left alone. This is an operator decision and is independent of privacy: a
 * room can be reserved without a password, or have a password without being
 * reserved.
 */
export function setReserved(room: Room, reserved: boolean): void {
  if (room.reserved === reserved) return;
  room.reserved = reserved;
  // Reserving a room that has already timed out would be pointless, so give it
  // a fresh long life; un-reserving hands it back to the normal TTL.
  room.expiresAt = reserved ? Number.POSITIVE_INFINITY : Date.now() + getSettings().roomTtlMs;
  persistRoom(room);
}

/** Take a JSON-safe copy of a room for Redis / cross-instance transport. */
export function snapshotRoom(room: Room): RoomSnapshot {
  return {
    id: room.id,
    code: room.code,
    hostParticipantId: room.hostParticipantId,
    createdAt: room.createdAt,
    expiresAt: room.reserved ? 0 : room.expiresAt,
    reserved: room.reserved,
    passwordHash: room.passwordHash,
    passwordVersion: room.passwordVersion,
    passwordExpiresAt: room.passwordExpiresAt,
    participants: [...room.participants.values()].map((p) => ({ ...p })),
    messages: room.messages.map((m) => ({ ...m })),
  };
}

/** Rebuild a live room from a snapshot (Redis hydration / remote update). */
export function restoreRoom(snapshot: RoomSnapshot): Room {
  const room: Room = {
    id: snapshot.id,
    code: snapshot.code,
    hostParticipantId: snapshot.hostParticipantId,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.reserved ? Number.POSITIVE_INFINITY : snapshot.expiresAt,
    reserved: snapshot.reserved,
    passwordHash: snapshot.passwordHash ?? "",
    passwordVersion: snapshot.passwordVersion ?? 1,
    passwordExpiresAt: snapshot.passwordExpiresAt ?? 0,
    participants: new Map(snapshot.participants.map((p) => [p.id, { ...p }])),
    sockets: new Map(),
    messages: snapshot.messages.map((m) => ({ ...m })),
  };
  return room;
}

export function getRoom(id: string): Room | undefined {
  const room = rooms.get(id);
  if (room && Date.now() > room.expiresAt) {
    deleteRoom(id);
    return undefined;
  }
  return room;
}

export function getRoomByCode(code: string): Room | undefined {
  const room = codeIndex.get(code);
  if (!room) return undefined;
  if (Date.now() > room.expiresAt) {
    deleteRoom(room.id);
    return undefined;
  }
  return room;
}

/**
 * Return the room for the fixed reserved code, creating it on demand if it was
 * ever swept/expired. Because it is recreated lazily, the code is effectively
 * always available — anyone who knows it can jump back in. Returns undefined
 * when the reserved room is disabled in settings.
 */
export function getOrCreateSpecialRoom(): Room {
  const existing = getRoomByCode(specialRoomCode());
  if (existing) return existing;
  return createRoom({ code: specialRoomCode() });
}

export function deleteRoom(id: string): boolean {
  const room = rooms.get(id);
  const removed = removeLocalRoom(id, room);
  if (removed) void store.deleteRoom(id);
  return removed;
}

/** Evict a room from the local caches only (no store write, no loop). */
function removeLocalRoom(id: string, room = rooms.get(id)): boolean {
  if (room && codeIndex.get(room.code) === room) codeIndex.delete(room.code);
  return rooms.delete(id);
}

/** Add a participant to a room. Returns null if the room is full.
 *  If a participant with the same id already exists (e.g. session restart /
 *  reconnect after grace period), the existing entry is reused and rebound
 *  to the new socket so messages stay on the correct side. */
export function addParticipant(
  room: Room,
  socket: Socket,
  participantId: string,
  name: string,
  color: number,
): Participant | null {
  const settings = getSettings();
  if (room.participants.size >= settings.maxRoomSize && !room.participants.has(participantId)) {
    return null;
  }
  const existing = room.participants.get(participantId);
  const participant: Participant = existing
    ? { ...existing, joinedAt: Date.now(), status: "online" }
    : {
        id: participantId,
        name,
        color,
        joinedAt: Date.now(),
        status: "online",
      };
  room.participants.set(participantId, participant);
  room.sockets.set(socket.id, participantId);
  if (!room.hostParticipantId) room.hostParticipantId = participantId;
  persistRoom(room);
  return participant;
}

export function participantForSocket(room: Room, socketId: string): Participant | undefined {
  const pid = room.sockets.get(socketId);
  if (!pid) return undefined;
  return room.participants.get(pid);
}

/** Remove a participant by socket id; returns the removed participant and whether room is now empty. */
export function removeParticipant(
  room: Room,
  socketId: string,
): { participant?: Participant; empty: boolean } {
  const pid = room.sockets.get(socketId);
  if (!pid) return { empty: room.participants.size === 0 };
  room.sockets.delete(socketId);
  const participant = room.participants.get(pid);
  room.participants.delete(pid);
  if (room.hostParticipantId === pid) {
    // Reassign host to whoever remains (first participant).
    const next = room.participants.values().next().value;
    room.hostParticipantId = next ? next.id : "";
  }
  persistRoom(room);
  return { participant, empty: room.participants.size === 0 };
}

/** Rename a participant in a room by socket id; returns the updated participant if found. */
export function renameParticipant(
  room: Room,
  socketId: string,
  name: string,
  color: number,
): Participant | undefined {
  const pid = room.sockets.get(socketId);
  if (!pid) return undefined;
  const participant = room.participants.get(pid);
  if (!participant) return undefined;
  participant.name = name;
  participant.color = color;
  persistRoom(room);
  return participant;
}

/** Rename any participant by their id (for room-level renames). */
export function renameParticipantById(
  room: Room,
  participantId: string,
  name: string,
): Participant | undefined {
  const participant = room.participants.get(participantId);
  if (!participant) return undefined;
  participant.name = name;
  persistRoom(room);
  return participant;
}

/** Store a chat message, pruning old ones beyond the retention window. */
export function addMessage(
  room: Room,
  participant: Participant,
  text: string,
  clientId?: string,
  attachment?: MessageAttachment,
  replyTo?: MessageReply,
): PublicMessage {
  const now = Date.now();
  const message: InternalMessage = {
    id: randomUUID(),
    participantId: participant.id,
    name: participant.name,
    color: participant.color,
    text,
    sentAt: now,
    kind: "user",
    _roomId: room.id,
    clientId,
    attachment,
    replyTo,
  };
  storeMessage(room, message);
  return toPublicMessage(message);
}

/** Store a system message (join/left pill) in the room history. */
export function addSystemMessage(room: Room, text: string): PublicMessage {
  const now = Date.now();
  const message: InternalMessage = {
    id: randomUUID(),
    participantId: "",
    name: "",
    color: 0,
    text,
    sentAt: now,
    kind: "system",
    _roomId: room.id,
  };
  storeMessage(room, message);
  return toPublicMessage(message);
}

function toPublicMessage(message: InternalMessage): PublicMessage {
  return {
    id: message.id,
    roomId: message._roomId,
    participantId: message.participantId,
    name: message.name,
    color: message.color,
    text: message.text,
    sentAt: message.sentAt,
    kind: message.kind,
    clientId: message.clientId,
    attachment: message.attachment,
    replyTo: message.replyTo,
  };
}

function storeMessage(room: Room, message: InternalMessage): void {
  room.messages.push(message);
  const settings = getSettings();
  const cutoff = Date.now() - settings.messageTtlMs;
  // Prune from the front while too old — messages are ordered by insertion.
  let firstValid = 0;
  for (let i = 0; i < room.messages.length; i++) {
    if (room.messages[i].sentAt >= cutoff) {
      firstValid = i;
      break;
    }
    firstValid = i + 1;
  }
  if (firstValid > 0) room.messages.splice(0, firstValid);
  // Hard cap on retained messages (rolling window: newest kept).
  if (room.messages.length > settings.messageCap) {
    room.messages.splice(0, room.messages.length - settings.messageCap);
  }
  persistMessage(room, message);
}

/** Get normalized public messages for a room (most-recent-first order kept). */
export function getMessages(room: Room): PublicMessage[] {
  return room.messages.map(toPublicMessage);
}

/** Clear all messages in a room and reset every participant's read position. */
export function clearMessages(room: Room): void {
  room.messages.length = 0;
  for (const p of room.participants.values()) p.lastSeenMessageId = undefined;
  void store.clearRoomMessages(room.id);
  void store.publishRoom({ kind: "clear", roomId: room.id });
}

/** Update the read position for a participant. */
export function setParticipantLastSeen(room: Room, participantId: string, messageId: string): void {
  const p = room.participants.get(participantId);
  if (p) {
    p.lastSeenMessageId = messageId;
    persistRoom(room);
  }
}

/** Build the public (client-safe) representation of a room from a socket's view. */
export function toPublicRoom(room: Room, socketId: string, hostParticipantId: string): PublicRoom {
  const pid = room.sockets.get(socketId);
  return {
    id: room.id,
    code: room.code,
    createdAt: room.createdAt,
    // Reserved rooms never auto-expire; serialize a far-future number since
    // JSON cannot carry Infinity (it would arrive as null on the client).
    expiresAt: room.reserved ? Number.MAX_SAFE_INTEGER : room.expiresAt,
    isHost: pid === hostParticipantId,
    reserved: room.reserved,
    locked: isLocked(room),
    passwordExpiresAt: isLocked(room) ? room.passwordExpiresAt : 0,
    participants: [...room.participants.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      joinedAt: p.joinedAt,
      status: p.status,
      lastSeenMessageId: p.lastSeenMessageId,
    })),
  };
}

/** All rooms (used by the sweep). */
export function allRooms(): Room[] {
  return [...rooms.values()];
}

export function isExpired(room: Room): boolean {
  return Date.now() > room.expiresAt;
}

// ---------------------------------------------------------------------------
// Shared store integration
//
// In memory mode every call below is a no-op, so single-instance behaviour is
// unchanged. In Redis mode the same Maps act as a per-instance cache: mutations
// go through to Redis and a pub/sub listener applies other instances' changes.
// ---------------------------------------------------------------------------

/** Remaining room lifetime in seconds for the message list TTL (0 = forever). */
function ttlSeconds(room: Room): number {
  if (room.reserved || !Number.isFinite(room.expiresAt)) return 0;
  return Math.max(1, Math.floor((room.expiresAt - Date.now()) / 1000));
}

/**
 * Persist meta + participants and broadcast the change. Messages are persisted
 * separately by `appendMessage`, so the broadcast payload carries none of them.
 */
function persistRoom(room: Room): void {
  // A detached room (deleted on another instance) must never be resurrected.
  if (rooms.get(room.id) !== room) return;
  void store.saveRoom({ ...snapshotRoom(room), messages: [] });
}

/** Append one message with the atomic cap + TTL trim, then tell other instances. */
function persistMessage(room: Room, message: InternalMessage): void {
  if (rooms.get(room.id) !== room) return;
  void store.appendMessage({
    roomId: room.id,
    message,
    cap: getSettings().messageCap,
    ttlSeconds: ttlSeconds(room),
  });
  void store.publishRoom({ kind: "message", roomId: room.id, message });
}

/** Trim a room's message list to the current rolling cap. */
function capMessages(room: Room): void {
  const cap = getSettings().messageCap;
  if (room.messages.length > cap) room.messages.splice(0, room.messages.length - cap);
}

/**
 * Copy remote metadata/participants/messages onto a cached room. Participants
 * this instance still holds live sockets for are kept even if the snapshot no
 * longer lists them (the local socket is the source of truth for its member).
 * A kicked member cannot come back this way: the kick flow removes their
 * socket mappings from `room.sockets` first, so the keeping-loop has nothing
 * to restore and the authoritative removal snapshot stays authoritative.
 */
export function applyRemoteSnapshot(room: Room, snap: RoomSnapshot): void {
  room.code = snap.code;
  room.hostParticipantId = snap.hostParticipantId;
  room.createdAt = snap.createdAt;
  room.expiresAt = snap.reserved ? Number.POSITIVE_INFINITY : snap.expiresAt;
  room.reserved = snap.reserved;
  // Take the authoritative password fields from the snapshot: an access token
  // is checked against them, so a stale local hash would lock people out (or
  // let them in with a rotated password). Every change to them bumps the
  // version, so an older snapshot must never win — otherwise a snapshot still
  // in flight would quietly reopen a room someone had just locked.
  const version = snap.passwordVersion ?? 1;
  if (version >= room.passwordVersion) {
    room.passwordHash = snap.passwordHash ?? "";
    room.passwordVersion = version;
    // The expiry rides along with the hash it belongs to, so it must only be
    // taken from the same snapshot that won the version check — otherwise a
    // stale "never expires" could outlive the password it was set for.
    room.passwordExpiresAt = snap.passwordExpiresAt ?? 0;
  }
  const next = new Map(snap.participants.map((p) => [p.id, { ...p }]));
  for (const [, pid] of room.sockets) {
    if (!next.has(pid)) {
      const local = room.participants.get(pid);
      if (local) next.set(pid, local);
    }
  }
  room.participants = next;
  const byId = new Map(room.messages.map((m) => [m.id, m]));
  for (const m of snap.messages) if (!byId.has(m.id)) byId.set(m.id, { ...m });
  room.messages = [...byId.values()].sort((a, b) => a.sentAt - b.sentAt);
  capMessages(room);
}

/** Apply a room event another instance published. */
function applyRemoteRoom(event: RoomEventEnvelope): void {
  // Our own echo: this instance already applied the mutation locally.
  if (event.origin === config.instanceId) return;
  switch (event.kind) {
    case "snapshot": {
      const room = rooms.get(event.room.id);
      // Only track rooms this instance actually has members in.
      if (room) applyRemoteSnapshot(room, event.room);
      return;
    }
    case "message": {
      const room = rooms.get(event.roomId);
      const incoming = event.message as InternalMessage | undefined;
      if (!room || !incoming || room.messages.some((m) => m.id === incoming.id)) return;
      room.messages.push({ ...incoming });
      capMessages(room);
      return;
    }
    case "clear": {
      const room = rooms.get(event.roomId);
      if (!room) return;
      room.messages.length = 0;
      for (const p of room.participants.values()) p.lastSeenMessageId = undefined;
      return;
    }
    case "seen": {
      const p = rooms.get(event.roomId)?.participants.get(event.participantId);
      if (p) p.lastSeenMessageId = event.messageId;
      return;
    }
    case "rename": {
      const p = rooms.get(event.roomId)?.participants.get(event.participantId);
      if (p) p.name = event.name;
      return;
    }
    case "kick": {
      // Socket/state eviction for a kicked member is handled by the socket
      // layer (handlers.ts) on whichever instance seats them. Nothing else is
      // needed here: the kick publish precedes the removal snapshot, so by the
      // time applySnapshot runs the member's socket mappings are gone and the
      // resurrection loop below has nothing to restore.
      return;
    }
    case "delete": {
      removeLocalRoom(event.id);
      return;
    }
  }
}
store.on("room", applyRemoteRoom);

/** Rebuild a room from a snapshot, or refresh it if already cached. */
function hydrateRoom(snapshot: RoomSnapshot): Room {
  const existing = rooms.get(snapshot.id);
  if (existing) {
    applyRemoteSnapshot(existing, snapshot);
    return existing;
  }
  const room = restoreRoom(snapshot);
  rooms.set(room.id, room);
  codeIndex.set(room.code, room);
  return room;
}

/** Load a room by id, hitting Redis only on a cache miss. */
export async function loadRoomFromStore(id: string): Promise<Room | undefined> {
  const local = getRoom(id);
  if (local) return local;
  const snapshot = await store.loadRoom(id);
  return snapshot ? hydrateRoom(snapshot) : undefined;
}

/** Load a room by code, hitting Redis only on a cache miss. */
export async function loadRoomByCodeFromStore(code: string): Promise<Room | undefined> {
  const local = getRoomByCode(code);
  if (local) return local;
  const snapshot = await store.loadRoomByCode(code);
  return snapshot ? hydrateRoom(snapshot) : undefined;
}

/** All live rooms for admin views. Single instance: the local cache — the
 * shared store has nothing to add. Cluster: list from the shared store and
 * hydrate each into this instance's cache. */
export async function loadAllRoomsFromStore(): Promise<Room[]> {
  if (!redisMode()) return allRooms().filter((r) => !isExpired(r));
  const snaps = await store.loadRooms();
  return snaps.map(hydrateRoom).filter((r) => !isExpired(r));
}

const CODE_CLAIM_ATTEMPTS = 8;

/**
 * Create a room and atomically claim its code in the shared store. A random
 * code owned by another instance is regenerated; a caller-requested code that
 * is already taken returns null so the caller can answer "room_exists".
 */
export async function createRoomClaimed(options: CreateRoomOptions = {}): Promise<Room | null> {
  const wanted = options.code;
  for (let attempt = 0; attempt < CODE_CLAIM_ATTEMPTS; attempt++) {
    // Create locally first, then claim + persist only once the code is ours.
    const room = createRoom({ code: wanted, persist: false });
    if (await store.claimCode(room.code, room.id)) {
      await store.saveRoom(snapshotRoom(room));
      return room;
    }
    removeLocalRoom(room.id);
    if (wanted) return null;
  }
  return null;
}

/**
 * Reserved room, deduped across instances: whoever claims the code first wins
 * and every other instance hydrates that same room.
 */
export async function getOrCreateSpecialRoomClaimed(): Promise<Room | undefined> {
  const existing = await loadRoomByCodeFromStore(specialRoomCode());
  if (existing) return existing;
  const created = await createRoomClaimed({ code: specialRoomCode() });
  if (created) return created;
  // Lost a race: the winner's room is now in the store.
  return loadRoomByCodeFromStore(specialRoomCode());
}

/** Remove a participant from the local room state (maps + host reassignment)
 * WITHOUT writing to the shared store. The moderating instance persists the
 * authoritative removal; every other instance uses this so a stale snapshot or
 * an in-flight persist can never resurrect/duplicate a kicked member. */
export function removeParticipantLocalOnly(
  room: Room,
  participantId: string,
): Participant | undefined {
  const participant = room.participants.get(participantId);
  if (!participant) return undefined;
  for (const [sid, pid] of room.sockets) {
    if (pid === participantId) room.sockets.delete(sid);
  }
  room.participants.delete(participantId);
  if (room.hostParticipantId === participantId) {
    const next = room.participants.values().next().value;
    room.hostParticipantId = next ? next.id : "";
  }
  return participant;
}

/** Remove a participant by id (admin moderation, including remote members). */
export function removeParticipantById(room: Room, participantId: string): Participant | undefined {
  const participant = removeParticipantLocalOnly(room, participantId);
  if (participant) persistRoom(room);
  return participant;
}

