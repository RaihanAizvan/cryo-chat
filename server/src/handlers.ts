/**
 * Socket.IO event handlers.
 *
 * Sessions, participants, rooms and messages are kept as distinct concepts.
 * This module wires them together. Adding matchmaking / blocking / E2EE later
 * means adding new handlers here and new types in the shared protocol — the
 * managers stay untouched.
 */

import type { Server, Socket } from "socket.io";
import type { ErrorPayload, MessageAttachment, MessageReply, RoomRef } from "@cryo/shared";
import { config } from "./config.js";
import { getSession, updateName } from "./sessions.js";
import * as rooms from "./rooms.js";
import * as media from "./media.js";
import { normalizeMessage, normalizeCaption, RateLimiter } from "./validation.js";
import { normalizeCode } from "./util.js";

const messageLimiter = new RateLimiter(
  config.messageRateLimit,
  config.messageRateWindowMs,
);

/** Internal participant nonce bound to a socket within a room. */
const ROOM_MEMBERSHIP = new WeakMap<Socket, { room: rooms.Room; pid: string }>();

/** A disconnected participant stays in their room this long before being dropped. */
const DEPARTURE_GRACE_MS = 30_000;

/** Pending departures keyed by `${roomId}::${sessionId}`, cancelled on recovery. */
const pendingDepartures = new Map<string, NodeJS.Timeout>();

function departKey(roomId: string, sessionId: string): string {
  return `${roomId}::${sessionId}`;
}

function cancelDeparture(roomId: string, sessionId: string): void {
  const t = pendingDepartures.get(departKey(roomId, sessionId));
  if (t) {
    clearTimeout(t);
    pendingDepartures.delete(departKey(roomId, sessionId));
  }
}

/** Cancel all pending departures for a room (closed/expired rooms). */
function cancelDeparturesForRoom(roomId: string): void {
  for (const [k, t] of pendingDepartures) {
    if (k.startsWith(`${roomId}::`)) {
      clearTimeout(t);
      pendingDepartures.delete(k);
    }
  }
}

/** After a disconnect, give the client a grace window to recover before leaving. */
function scheduleDeparture(
  io: Server,
  socket: Socket,
  room: rooms.Room,
  sessionId: string,
): void {
  cancelDeparture(room.id, sessionId);
  const t = setTimeout(() => {
    pendingDepartures.delete(departKey(room.id, sessionId));
    // No-op if the client recovered and re-seated its membership; the socket.id
    // is preserved by connection-state recovery, so the map lookup stays valid.
    if (!room.sockets.has(socket.id)) return;
    leaveRoom(io, socket, room);
  }, DEPARTURE_GRACE_MS);
  pendingDepartures.set(departKey(room.id, sessionId), t);
}

export function attachHandlers(io: Server, socket: Socket): void {
  // Allow resuming a persisted session id (sent as a connection query).
  const requestedSessionId = (socket.handshake.query?.sessionId as string | undefined);
  const session = getSession(socket, requestedSessionId);

  // Connection-state recovery succeeded: the server restored our socket id and
  // room membership. Re-link the membership bookkeeping and resend the current
  // room snapshot so the client is seamlessly back in the conversation.
  if (socket.recovered) {
    for (const room of rooms.allRooms()) {
      if (!room.sockets.has(socket.id)) continue;
      ROOM_MEMBERSHIP.set(socket, { room, pid: room.sockets.get(socket.id)! });
      cancelDeparture(room.id, session.id);
      socket.emit("room:joined", {
        room: rooms.toPublicRoom(room, socket.id, room.hostParticipantId),
      });
      socket.emit("message:history", { messages: rooms.getMessages(room) });
      break;
    }
  }

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

  socket.on("room:create", (raw) => {
    // Users can request a specific code (typed in the join box, or a room that
    // was closed/expired and is being reopened). Validate it, ensure it's not
    // already taken by a live room, then create.
    const wanted =
      typeof raw?.code === "string" ? normalizeCode(raw.code) : undefined;
    if (wanted) {
      const existing = rooms.getRoomByCode(wanted);
      if (existing) {
        sendError(socket, { code: "room_exists", message: "That code is taken." });
        return;
      }
    }
    const room = rooms.createRoom(wanted ? { code: wanted } : {});
    if (!joinInternal(io, socket, room)) return;
    socket.emit("room:created", { roomId: room.id, code: room.code });
    emitJoined(io, socket, room);
  });

  socket.on("room:join", (raw) => {
    // Accept either a short code or a full room id (from a shared link).
    const code = typeof raw?.code === "string" ? normalizeCode(raw.code) : undefined;
    const roomId = typeof raw?.roomId === "string" ? raw.roomId : undefined;
    // The reserved code always works — recreate the room on demand.
    const room = roomId
      ? rooms.getRoom(roomId)
      : code === config.reservedRoomCode
        ? rooms.getOrCreateReservedRoom()
        : code
          ? rooms.getRoomByCode(code)
          : undefined;
    if (!room) {
      sendError(socket, { code: "room_not_found", message: "Room not found." });
      return;
    }
    if (!joinInternal(io, socket, room)) return;
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

  socket.on("room:close", (raw) => {
    const roomId = typeof raw?.roomId === "string" ? raw.roomId : undefined;
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (!membership || (roomId && membership.room.id !== roomId)) {
      sendError(socket, { code: "not_in_room", message: "You're not in that room." });
      return;
    }
    closeRoom(io, membership.room);
  });

  // Home screen: current status of a handful of saved rooms (live participant
  // counts, open vs closed). Used by the recent-rooms list to stay truthful.
  socket.on("room:status", (raw) => {
    const refs: RoomRef[] = Array.isArray(raw?.refs) ? raw.refs : [];
    const statuses = refs
      .slice(0, 30)
      .map((ref) => {
        const code = typeof ref?.code === "string" ? normalizeCode(ref.code) : undefined;
        const roomId = typeof ref?.roomId === "string" ? ref.roomId : undefined;
        // Resolve by code first: codes are unique among live rooms and survive
        // room re-creation, while a saved roomId can go stale (e.g. 9999 after
        // it is recreated). Falling back to the id covers deep-link refs.
        const room = code
          ? code === config.reservedRoomCode
            ? rooms.getOrCreateReservedRoom()
            : rooms.getRoomByCode(code)
          : roomId
            ? rooms.getRoom(roomId)
            : undefined;
        if (!room) {
          return { code, roomId, exists: false, participantCount: 0, expiresAt: 0, persistent: false };
        }
        return {
          code: room.code,
          roomId: room.id,
          exists: true,
          participantCount: room.participants.size,
          expiresAt: room.persistent ? Number.MAX_SAFE_INTEGER : room.expiresAt,
          persistent: room.persistent,
        };
      });
    socket.emit("room:status:result", { statuses });
  });

  socket.on("message:send", (raw) => {
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (!membership) {
      sendError(socket, { code: "not_in_room", message: "Join a room first." });
      return;
    }
    const clientId =
      typeof raw?.clientId === "string" && raw.clientId.length <= 64
        ? raw.clientId
        : undefined;

    // Media messages: the reference must come from this session's own upload.
    const mediaId =
      typeof raw?.attachment?.mediaId === "string" ? raw.attachment.mediaId : "";
    let attachment: MessageAttachment | undefined;
    if (mediaId) {
      const m = media.getMedia(mediaId);
      if (!m || m.uploadedBy !== getSession(socket).id) {
        sendError(socket, {
          code: "message_invalid",
          message: "Unknown media attachment.",
          clientId,
        });
        return;
      }
      attachment = {
        type: m.kind,
        mediaId: m.id,
        viewOnce: m.viewOnce,
        width: m.width,
        height: m.height,
        name: m.name,
      };
    }

    const text =
      normalizeMessage(raw?.text) ?? (attachment ? normalizeCaption(raw?.text) : "");

    if (!text && !attachment) {
      sendError(socket, {
        code: "message_invalid",
        message: "Message rejected.",
        clientId,
      });
      return;
    }
    if (!messageLimiter.allow(socket.id)) {
      sendError(socket, {
        code: "rate_limited",
        message: "Slow down a little.",
        clientId,
      });
      return;
    }
    const participant = rooms.participantForSocket(membership.room, socket.id);
    if (!participant) return;

    // Resolve the quoted message server-side: never trust client-supplied reply
    // content. If the target isn't a real user message in this room (e.g. the
    // sender replied to a not-yet-echoed local bubble), the quote is dropped
    // and the message is still delivered.
    let replyTo: MessageReply | undefined;
    const replyTargetId = typeof raw?.replyTo?.messageId === "string" ? raw.replyTo.messageId : "";
    if (replyTargetId) {
      const target = membership.room.messages.find(
        (m) => m.id === replyTargetId && m.kind === "user",
      );
      if (target) {
        replyTo = {
          messageId: target.id,
          participantId: target.participantId,
          name: target.name,
          text: target.text ?? "",
          viewOnce: Boolean(target.attachment?.viewOnce),
        };
        // View-once media must not leak a mediaId (and the preview is gone
        // anyway once consumed); other media is quoted with a thumbnail.
        if (target.attachment && !target.attachment.viewOnce) {
          replyTo.attachment = {
            type: target.attachment.type,
            mediaId: target.attachment.mediaId,
            name: target.attachment.name,
          };
        }
      }
    }

    const message = rooms.addMessage(
      membership.room,
      participant,
      text,
      clientId,
      attachment,
      replyTo,
    );
    io.to(membership.room.id).emit("message:new", { message });
  });

  // Typing indicator: relay to other room members (no server storage).
  socket.on("message:typing", (raw) => {
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (!membership) return;
    const participant = rooms.participantForSocket(membership.room, socket.id);
    if (!participant) return;
    socket.to(membership.room.id).emit("presence:typing", {
      participantId: participant.id,
      name: participant.name,
    });
  });

  // Read receipt: update the participant's read position and notify everyone.
  socket.on("message:seen", (raw) => {
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (!membership) return;
    const participant = rooms.participantForSocket(membership.room, socket.id);
    if (!participant) return;
    const messageId = typeof raw?.messageId === "string" ? raw.messageId : "";
    if (!messageId) return;
    rooms.setParticipantLastSeen(membership.room, participant.id, messageId);
    io.to(membership.room.id).emit("presence:seen", {
      participantId: participant.id,
      lastSeenMessageId: messageId,
    });
  });

  // Clear all messages in a room.
  socket.on("room:clear", (raw) => {
    const roomId = typeof raw?.roomId === "string" ? raw.roomId : undefined;
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (!membership || (roomId && membership.room.id !== roomId)) {
      sendError(socket, { code: "not_in_room", message: "You're not in that room." });
      return;
    }
    rooms.clearMessages(membership.room);
    const participant = rooms.participantForSocket(membership.room, socket.id);
    const name = participant?.name ?? "Someone";
    const system = rooms.addSystemMessage(membership.room, `${name} cleared the chat`);
    io.to(membership.room.id).emit("message:cleared", {});
    io.to(membership.room.id).emit("message:new", { message: system });
  });

  // Rename any participant in a room.
  socket.on("room:rename", (raw) => {
    const roomId = typeof raw?.roomId === "string" ? raw.roomId : undefined;
    const targetId = typeof raw?.participantId === "string" ? raw.participantId : undefined;
    const newName = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!targetId || !newName || newName.length > 24) return;
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (!membership || (roomId && membership.room.id !== roomId)) return;
    const p = rooms.renameParticipantById(membership.room, targetId, newName);
    if (p) {
      io.to(membership.room.id).emit("presence:renamed", {
        participantId: p.id,
        name: p.name,
      });
    }
  });

  socket.on("disconnect", () => {
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (membership) {
      scheduleDeparture(io, socket, membership.room, session.id);
    }
  });
}

function joinInternal(
  io: Server,
  socket: Socket,
  room: rooms.Room,
): boolean {
  const session = getSession(socket);
  // A fresh join means the participant is back — cancel any pending departure.
  cancelDeparture(room.id, session.id);
  // If the socket is already in another room, leave it first.
  const existing = ROOM_MEMBERSHIP.get(socket);
  if (existing) {
    leaveRoom(io, socket, existing.room);
  }

  const participant = rooms.addParticipant(room, socket, session.id, session.name, session.color);
  if (!participant) {
    sendError(socket, { code: "room_full", message: "This room is full." });
    return false;
  }
  ROOM_MEMBERSHIP.set(socket, { room, pid: participant.id });
  socket.join(room.id);
  return true;
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
    // Share this participant's read position with everyone so senders can
    // show read receipts immediately, and broadcast other positions to us.
    if (participant.lastSeenMessageId) {
      io.to(room.id).emit("presence:seen", {
        participantId: participant.id,
        lastSeenMessageId: participant.lastSeenMessageId,
      });
    }
    // Also send existing read positions for other participants.
    for (const [, p] of room.participants) {
      if (p.id !== participant.id && p.lastSeenMessageId) {
        socket.emit("presence:seen", {
          participantId: p.id,
          lastSeenMessageId: p.lastSeenMessageId,
        });
      }
    }
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
  // A room's lifetime is fixed at creation (roomTtlMs). Leaving does NOT pull
  // the expiry forward — otherwise an empty room's countdown would jump down,
  // and the room would die while people are just stepping out. The special
  // room never expires, so nothing happens here for it.
}

/** Close a room: kick everyone, announce it, and destroy it. */
function closeRoom(io: Server, room: rooms.Room): void {
  io.to(room.id).emit("room:closed", { roomId: room.id });
  cancelDeparturesForRoom(room.id);
  for (const sid of room.sockets.keys()) {
    const s = io.sockets.sockets.get(sid);
    if (s) ROOM_MEMBERSHIP.delete(s);
  }
  rooms.deleteRoom(room.id);
}

/** Periodically prune expired rooms and rate-limiter buckets. */
export function startSweeper(io: Server): NodeJS.Timeout {
  const interval = setInterval(() => {
    messageLimiter.sweep();
    media.pruneMedia();
    media.pruneRemoteMedia();
    for (const room of rooms.allRooms()) {
      if (rooms.isExpired(room)) {
        io.to(room.id).emit("room:expired", { roomId: room.id });
        cancelDeparturesForRoom(room.id);
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
