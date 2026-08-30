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
} from "@cryo/shared";
import { config } from "./config.js";
import { randomRoomCode, randomRoomId } from "./util.js";

interface InternalMessage {
  id: string;
  participantId: string;
  name: string;
  color: number;
  text: string;
  sentAt: number;
  kind: MessageKind;
  _roomId: string;
}

export interface Room {
  id: string;
  code: string;
  hostParticipantId: string;
  /** True for the reserved "private room" (fixed code, preserved). */
  isPrivate: boolean;
  /** Per-room participant cap; reserved room uses 2 (owner + friend). */
  maxParticipants: number;
  createdAt: number;
  expiresAt: number;
  /** Map of participant nonce -> participant. */
  participants: Map<string, Participant>;
  /** Map of socket.id -> participant nonce. */
  sockets: Map<Socket["id"], string>;
  /** Ring buffer of messages (ephemeral). */
  messages: InternalMessage[];
}

const rooms = new Map<string, Room>();

export interface CreateRoomOptions {
  code?: string;
  ttlMs?: number;
  maxParticipants?: number;
  isPrivate?: boolean;
}

/** Create a new room and return it. The host participant is added by caller. */
export function createRoom(options: CreateRoomOptions = {}): Room {
  const now = Date.now();
  const id = randomRoomId();
  const room: Room = {
    id,
    code: options.code ?? randomRoomCode(),
    hostParticipantId: "",
    isPrivate: options.isPrivate ?? false,
    maxParticipants: options.maxParticipants ?? config.maxRoomSize,
    createdAt: now,
    expiresAt: now + (options.ttlMs ?? config.roomTtlMs),
    participants: new Map(),
    sockets: new Map(),
    messages: [],
  };
  // Guard against a (vanishingly rare) id collision.
  while (rooms.has(room.id)) room.id = randomRoomId();
  // A random code must never shadow the preserved private-room code.
  while (!options.code && room.code === config.reservedRoomCode) {
    room.code = randomRoomCode();
  }
  rooms.set(id, room);
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
  for (const room of rooms.values()) {
    if (room.code !== code) continue;
    if (Date.now() > room.expiresAt) {
      deleteRoom(room.id);
      return undefined;
    }
    return room;
  }
  return undefined;
}

/**
 * Return the preserved "private room" for the fixed code, creating it on
 * demand if it was ever swept/expired. Because it is recreated lazily, the
 * code never becomes stale — it is effectively reserved forever.
 */
export function getOrCreateReservedRoom(): Room {
  const existing = getRoomByCode(config.reservedRoomCode);
  if (existing) return existing;
  return createRoom({
    code: config.reservedRoomCode,
    ttlMs: config.reservedRoomTtlMs,
    maxParticipants: config.reservedRoomMaxSize,
    isPrivate: true,
  });
}

export function deleteRoom(id: string): boolean {
  return rooms.delete(id);
}

/** Add a participant to a room. Returns false if the room is full. */
export function addParticipant(
  room: Room,
  socket: Socket,
  participantId: string,
  name: string,
  color: number,
): Participant | null {
  if (room.participants.size >= room.maxParticipants) return null;
  const participant: Participant = {
    id: participantId,
    name,
    color,
    joinedAt: Date.now(),
    status: "online",
  };
  room.participants.set(participantId, participant);
  room.sockets.set(socket.id, participantId);
  if (!room.hostParticipantId) room.hostParticipantId = participantId;
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
  return { participant, empty: room.participants.size === 0 };
}

/** Rename a participant in a room; returns the updated participant if found. */
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
  return participant;
}

/** Store a chat message, pruning old ones beyond the retention window. */
export function addMessage(
  room: Room,
  participant: Participant,
  text: string,
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
  };
  storeMessage(room, message);
  return {
    id: message.id,
    roomId: message._roomId,
    participantId: message.participantId,
    name: message.name,
    color: message.color,
    text: message.text,
    sentAt: message.sentAt,
    kind: message.kind,
  };
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
  return {
    id: message.id,
    roomId: message._roomId,
    participantId: message.participantId,
    name: message.name,
    color: message.color,
    text: message.text,
    sentAt: message.sentAt,
    kind: message.kind,
  };
}

function storeMessage(room: Room, message: InternalMessage): void {
  room.messages.push(message);
  const cutoff = Date.now() - config.messageTtlMs;
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
  // Hard cap on retained messages.
  if (room.messages.length > 500) {
    room.messages.splice(0, room.messages.length - 500);
  }
}

/** Get normalized public messages for a room (most-recent-first order kept). */
export function getMessages(room: Room): PublicMessage[] {
  return room.messages.map((m) => ({
    id: m.id,
    roomId: m._roomId,
    participantId: m.participantId,
    name: m.name,
    color: m.color,
    text: m.text,
    sentAt: m.sentAt,
    kind: m.kind,
  }));
}

/** Build the public (client-safe) representation of a room from a socket's view. */
export function toPublicRoom(room: Room, socketId: string, hostParticipantId: string): PublicRoom {
  const pid = room.sockets.get(socketId);
  return {
    id: room.id,
    code: room.code,
    createdAt: room.createdAt,
expiresAt: room.expiresAt,
      isHost: pid === hostParticipantId,
      isPrivate: room.isPrivate,
    participants: [...room.participants.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      joinedAt: p.joinedAt,
      status: p.status,
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
