/**
 * Socket.IO event handlers.
 *
 * Sessions, participants, rooms and messages are kept as distinct concepts.
 * This module wires them together. Adding matchmaking / blocking / E2EE later
 * means adding new handlers here and new types in the shared protocol — the
 * managers stay untouched.
 */

import type { Server, Socket } from "socket.io";
import type { ErrorPayload } from "@cryo/shared";
import { config } from "./config.js";
import { getSession, updateName } from "./sessions.js";
import * as rooms from "./rooms.js";
import { normalizeMessage, RateLimiter } from "./validation.js";
import { normalizeCode } from "./util.js";

const messageLimiter = new RateLimiter(
  config.messageRateLimit,
  config.messageRateWindowMs,
);

/** Internal participant nonce bound to a socket within a room. */
const ROOM_MEMBERSHIP = new WeakMap<Socket, { room: rooms.Room; pid: string }>();

export function attachHandlers(io: Server, socket: Socket): void {
  const session = getSession(socket);
  socket.emit("session:init", {
    sessionId: session.id,
    name: session.name,
    color: session.color,
  });

  socket.on("session:name", (raw) => {
    const updated = updateName(socket, raw?.name);
    if (!updated) {
      sendError(socket, { code: "name_invalid", message: "That name isn't allowed." });
      return;
    }
    socket.emit("session:name:updated", { name: updated.name });

    // Propagate rename to any active room membership.
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (membership) {
      const p = rooms.renameParticipant(membership.room, socket.id, updated.name, updated.color);
      if (p) {
        socket.to(membership.room.id).emit("presence:renamed", {
          participantId: p.id,
          name: p.name,
        });
      }
    }
  });

  socket.on("room:create", () => {
    const room = rooms.createRoom();
    joinInternal(io, socket, room);
    socket.emit("room:created", { roomId: room.id, code: room.code });
    emitJoined(io, socket, room);
  });

  socket.on("room:join", (raw) => {
    // Accept either a short code or a full room id (from a shared link).
    const code = typeof raw?.code === "string" ? normalizeCode(raw.code) : undefined;
    const roomId = typeof raw?.roomId === "string" ? raw.roomId : undefined;
    const room = roomId
      ? rooms.getRoom(roomId)
      : code
        ? rooms.getRoomByCode(code)
        : undefined;
    if (!room) {
      sendError(socket, { code: "room_not_found", message: "Room not found." });
      return;
    }
    joinInternal(io, socket, room);
    emitJoined(io, socket, room);
  });

  socket.on("room:leave", (raw) => {
    const roomId = typeof raw?.roomId === "string" ? raw.roomId : undefined;
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (!membership || (roomId && membership.room.id !== roomId)) {
      sendError(socket, { code: "not_in_room", message: "You're not in that room." });
      return;
    }
    leaveRoom(io, socket, membership.room);
    socket.emit("room:left", { roomId: membership.room.id });
  });

  socket.on("message:send", (raw) => {
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (!membership) {
      sendError(socket, { code: "not_in_room", message: "Join a room first." });
      return;
    }
    const text = normalizeMessage(raw?.text);
    if (!text) {
      sendError(socket, { code: "message_invalid", message: "Message rejected." });
      return;
    }
    if (!messageLimiter.allow(socket.id)) {
      sendError(socket, { code: "rate_limited", message: "Slow down a little." });
      return;
    }
    const participant = rooms.participantForSocket(membership.room, socket.id);
    if (!participant) return;
    const message = rooms.addMessage(membership.room, participant, text);
    io.to(membership.room.id).emit("message:new", { message });
  });

  socket.on("disconnect", (reason) => {
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (membership) {
      leaveRoom(io, socket, membership.room);
    }
  });
}

function joinInternal(
  io: Server,
  socket: Socket,
  room: rooms.Room,
): void {
  const session = getSession(socket);
  // If the socket is already in another room, leave it first.
  const existing = ROOM_MEMBERSHIP.get(socket);
  if (existing) {
    leaveRoom(io, socket, existing.room);
  }

  const participant = rooms.addParticipant(room, socket, session.id, session.name, session.color);
  if (!participant) {
    sendError(socket, { code: "room_full", message: "This room is full." });
    return;
  }
  ROOM_MEMBERSHIP.set(socket, { room, pid: participant.id });
  socket.join(room.id);
}

function emitJoined(io: Server, socket: Socket, room: rooms.Room): void {
  socket.emit("room:joined", { room: rooms.toPublicRoom(room, socket.id, room.hostParticipantId) });
  socket.emit("message:history", { messages: rooms.getMessages(room) });
  // Notify others + a persistent system pill in their history/feed.
  const participant = rooms.participantForSocket(room, socket.id);
  if (participant) {
    const system = rooms.addSystemMessage(room, `${participant.name} joined`);
    socket.to(room.id).emit("message:new", { message: system });
    socket.to(room.id).emit("presence:joined", {
      participant: {
        id: participant.id,
        name: participant.name,
        color: participant.color,
        joinedAt: participant.joinedAt,
        status: "online",
      },
    });
  }
}

function leaveRoom(io: Server, socket: Socket, room: rooms.Room): void {
  const { participant } = rooms.removeParticipant(room, socket.id);
  ROOM_MEMBERSHIP.delete(socket);
  socket.leave(room.id);
  if (participant) {
    const system = rooms.addSystemMessage(room, `${participant.name} left`);
    io.to(room.id).emit("message:new", { message: system });
    io.to(room.id).emit("presence:left", { participantId: participant.id });
  }
  // Room becomes empty -> schedule expiry (grace period from last activity).
  if (room.participants.size === 0) {
    const graceEnd = Date.now() + config.roomGraceMs;
    if (graceEnd < room.expiresAt) room.expiresAt = graceEnd;
  }
}

/** Periodically prune expired rooms and rate-limiter buckets. */
export function startSweeper(io: Server): NodeJS.Timeout {
  const interval = setInterval(() => {
    messageLimiter.sweep();
    for (const room of rooms.allRooms()) {
      if (rooms.isExpired(room)) {
        io.to(room.id).emit("room:expired", { roomId: room.id });
        // Force-disconnect members.
        for (const sid of room.sockets.keys()) {
          const s = io.sockets.sockets.get(sid);
          if (s) ROOM_MEMBERSHIP.delete(s);
        }
        rooms.deleteRoom(room.id);
      }
    }
  }, config.sweepIntervalMs);
  if (typeof interval.unref === "function") interval.unref();
  return interval;
}

function sendError(socket: Socket, payload: ErrorPayload): void {
  socket.emit("error", payload);
}
