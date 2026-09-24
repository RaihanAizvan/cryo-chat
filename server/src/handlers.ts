/**
 * Socket.IO event handlers.
 *
 * Sessions, participants, rooms and messages are kept as distinct concepts.
 * This module wires them together. Adding matchmaking / blocking / E2EE later
 * means adding new handlers here and new types in the shared protocol — the
 * managers stay untouched.
 */

import type { Server, Socket } from "socket.io";
import type { ErrorPayload, MessageAttachment, MessageReply, Participant, RoomRef } from "@cryo/shared";
import { config } from "./config.js";
import { getSession, updateName } from "./sessions.js";
import type { Session } from "./sessions.js";
import * as rooms from "./rooms.js";
import * as media from "./media.js";
import * as audit from "./audit.js";
import { normalizeMessage, normalizeCaption } from "./validation.js";
import { normalizeCode } from "./util.js";
import { getSettings, isReservedCode } from "./settings.js";
import { isBanned } from "./bans.js";
import { store } from "./store.js";
import type { RoomEventEnvelope } from "./store.js";

/** Internal participant nonce bound to a socket within a room. */
const ROOM_MEMBERSHIP = new WeakMap<Socket, { room: rooms.Room; pid: string }>();

/** A disconnected participant stays in their room this long before being dropped. */
const DEPARTURE_GRACE_MS = 30_000;

/** Pending departures keyed by `${roomId}::${sessionId}`, cancelled on recovery. */
const pendingDepartures = new Map<string, NodeJS.Timeout>();

function departKey(roomId: string, sessionId: string): string {
  return `${roomId}::${sessionId}`;
}

/**
 * Current membership for a socket, dropping it if the room was deleted on
 * another instance (e.g. an admin closed it) while this socket was seated.
 */
function activeMembership(socket: Socket): { room: rooms.Room; pid: string } | undefined {
  const membership = ROOM_MEMBERSHIP.get(socket);
  if (!membership) return undefined;
  if (rooms.getRoom(membership.room.id) !== membership.room) {
    ROOM_MEMBERSHIP.delete(socket);
    return undefined;
  }
  return membership;
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

/**
 * Re-seat a reconnecting session into its room. The local recovery path above
 * only covers same-instance reconnects; this covers a reconnect that landed on
 * another instance (or a reload) using the shared session -> rooms index.
 */
async function resumeRoom(io: Server, socket: Socket, session: Session): Promise<void> {
  const roomIds = await store.sessionRooms(session.id);
  for (const roomId of roomIds) {
    if (ROOM_MEMBERSHIP.has(socket)) return; // already re-seated
    const room = await rooms.loadRoomFromStore(roomId);
    if (!room || rooms.isExpired(room)) continue;
    if (!joinInternal(io, socket, room)) continue;
    emitJoined(io, socket, room);
    return;
  }
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
      const pid = room.sockets.get(socket.id)!;
      ROOM_MEMBERSHIP.set(socket, { room, pid });
      socket.data.pid = pid;
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
    voiceNotesEnabled: getSettings().voiceNotesEnabled,
  });

  // A reconnect that landed on a different instance (or a reload without
  // connection-state recovery) is re-seated from the shared room index.
  if (!ROOM_MEMBERSHIP.has(socket)) void resumeRoom(io, socket, session);

  socket.on("session:name", (raw) => {
    const session = getSession(socket);
    const prevName = session.name;
    const updated = updateName(socket, raw?.name);
    if (!updated) {
      sendError(socket, { code: "name_invalid", message: "That name isn't allowed." });
      return;
    }
    socket.emit("session:name:updated", { name: updated.name });

    // Propagate rename to any active room membership.
    const membership = activeMembership(socket);
    if (membership) {
      const p = rooms.renameParticipant(membership.room, socket.id, updated.name, updated.color);
      if (p) {
        socket.to(membership.room.id).emit("presence:renamed", {
          participantId: p.id,
          name: p.name,
        });
        if (p.name !== prevName) {
          audit.record({
            kind: "session:renamed",
            message: `${prevName} renamed to ${p.name}`,
            actor: p.name,
            sessionId: session.id,
            roomId: membership.room.id,
            roomCode: membership.room.code,
          });
        }
      }
    }
  });

  socket.on("room:create", async (raw) => {
    // Users can request a specific code (typed in the join box, or a room that
    // was closed/expired and is being reopened). Validate it, ensure it's not
    // already taken by a live room anywhere in the cluster, then create.
    const wanted =
      typeof raw?.code === "string" ? normalizeCode(raw.code) : undefined;
    if (wanted && (await rooms.loadRoomByCodeFromStore(wanted))) {
      sendError(socket, { code: "room_exists", message: "That code is taken." });
      return;
    }
    const room = await rooms.createRoomClaimed(wanted ? { code: wanted } : {});
    if (!room) {
      sendError(socket, { code: "room_exists", message: "That code is taken." });
      return;
    }
    if (!joinInternal(io, socket, room)) return;
    socket.emit("room:created", { roomId: room.id, code: room.code });
    audit.record({
      kind: "room:created",
      message: `Room ${room.code} created` + (room.persistent ? " (reserved)" : ""),
      actor: getSession(socket).name,
      sessionId: getSession(socket).id,
      roomId: room.id,
      roomCode: room.code,
    });
    emitJoined(io, socket, room);
  });

  socket.on("room:join", async (raw) => {
    // Accept either a short code or a full room id (from a shared link).
    const code = typeof raw?.code === "string" ? normalizeCode(raw.code) : undefined;
    const roomId = typeof raw?.roomId === "string" ? raw.roomId : undefined;
    // The reserved code always works — recreate (or reuse) it on demand.
    const room = roomId
      ? await rooms.loadRoomFromStore(roomId)
      : code && isReservedCode(code)
        ? await rooms.getOrCreateReservedRoomClaimed()
        : code
          ? await rooms.loadRoomByCodeFromStore(code)
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
    const membership = activeMembership(socket);
    if (!membership || (roomId && membership.room.id !== roomId)) {
      sendError(socket, { code: "not_in_room", message: "You're not in that room." });
      return;
    }
    leaveRoom(io, socket, membership.room);
    socket.emit("room:left", { roomId: membership.room.id });
  });

  socket.on("room:close", (raw) => {
    const roomId = typeof raw?.roomId === "string" ? raw.roomId : undefined;
    const membership = activeMembership(socket);
    if (!membership || (roomId && membership.room.id !== roomId)) {
      sendError(socket, { code: "not_in_room", message: "You're not in that room." });
      return;
    }
    closeRoom(io, membership.room);
  });

  // Home screen: current status of a handful of saved rooms (live participant
  // counts, open vs closed). Used by the recent-rooms list to stay truthful.
  socket.on("room:status", async (raw) => {
    const refs: RoomRef[] = Array.isArray(raw?.refs) ? raw.refs : [];
    const statuses = [];
    for (const ref of refs.slice(0, 30)) {
      const code = typeof ref?.code === "string" ? normalizeCode(ref.code) : undefined;
      const roomId = typeof ref?.roomId === "string" ? ref.roomId : undefined;
      // Resolve by code first: codes are unique among live rooms and survive
      // room re-creation, while a saved roomId can go stale (e.g. 9999 after
      // it is recreated). Falling back to the id covers deep-link refs.
      const room = code
        ? isReservedCode(code)
          ? await rooms.getOrCreateReservedRoomClaimed()
          : await rooms.loadRoomByCodeFromStore(code)
        : roomId
          ? await rooms.loadRoomFromStore(roomId)
          : undefined;
      if (!room) {
        statuses.push({ code, roomId, exists: false, participantCount: 0, expiresAt: 0, persistent: false });
        continue;
      }
      statuses.push({
        code: room.code,
        roomId: room.id,
        exists: true,
        participantCount: room.participants.size,
        expiresAt: room.persistent ? Number.MAX_SAFE_INTEGER : room.expiresAt,
        persistent: room.persistent,
      });
    }
    socket.emit("room:status:result", { statuses });
  });

  socket.on("message:send", async (raw) => {
    const membership = activeMembership(socket);
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
        duration: m.duration,
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
    const participant = rooms.participantForSocket(membership.room, socket.id);
    if (!participant) return;
    // Cluster-wide rate limit keyed by the (shared) participant identity so a
    // flooding client can't dodge it by reconnecting to another instance.
    if (
      !(await store.rateLimit(
        `msg:${participant.id}`,
        getSettings().messageRateLimit,
        getSettings().messageRateWindowMs,
      ))
    ) {
      sendError(socket, {
        code: "rate_limited",
        message: "Slow down a little.",
        clientId,
      });
      return;
    }

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
    audit.record({
      kind: "message:send",
      message: attachment
        ? `${participant.name} sent ${attachment.type}${text ? " with a caption" : ""}`
        : `${participant.name} sent a message`,
      actor: participant.name,
      sessionId: participant.id,
      roomId: membership.room.id,
      roomCode: membership.room.code,
      detail: attachment?.type ?? "text",
    });
  });

  // Typing indicator: relay to other room members (no server storage).
  socket.on("message:typing", () => {
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
    const membership = activeMembership(socket);
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
    const membership = activeMembership(socket);
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
    audit.record({
      kind: "room:cleared",
      message: `${name} cleared the chat in ${membership.room.code}`,
      actor: name,
      sessionId: getSession(socket).id,
      roomId: membership.room.id,
      roomCode: membership.room.code,
    });
  });

  // Rename any participant in a room.
  socket.on("room:rename", (raw) => {
    const roomId = typeof raw?.roomId === "string" ? raw.roomId : undefined;
    const targetId = typeof raw?.participantId === "string" ? raw.participantId : undefined;
    const newName = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!targetId || !newName || newName.length > 24) return;
    const membership = activeMembership(socket);
    if (!membership || (roomId && membership.room.id !== roomId)) return;
    const p = rooms.renameParticipantById(membership.room, targetId, newName);
    if (p) {
      io.to(membership.room.id).emit("presence:renamed", {
        participantId: p.id,
        name: p.name,
      });
      audit.record({
        kind: "room:renamed",
        message: `${p.name} was renamed to ${newName} by ${getSession(socket).name}`,
        actor: getSession(socket).name,
        sessionId: getSession(socket).id,
        roomId: membership.room.id,
        roomCode: membership.room.code,
      });
    }
  });

  socket.on("disconnect", () => {
    const membership = ROOM_MEMBERSHIP.get(socket);
    if (!membership) return;
    // If the room was deleted elsewhere while we were seated, there is nothing
    // to leave (and persisting would resurrect it) — just drop the index entry.
    if (rooms.getRoom(membership.room.id) !== membership.room) {
      ROOM_MEMBERSHIP.delete(socket);
      void store.removeSessionRoom(session.id, membership.room.id);
      return;
    }
    scheduleDeparture(io, socket, membership.room, session.id);
  });
}

function joinInternal(
  io: Server,
  socket: Socket,
  room: rooms.Room,
): boolean {
  const session = getSession(socket);
  // Banned identities are refused at the door (they also can't resume).
  if (isBanned(session.id)) {
    sendError(socket, { code: "banned", message: "You're not allowed in this chat." });
    return false;
  }
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
  // Expose the participant id on the socket so other instances can locate this
  // socket for moderation (fetchSockets + data.pid).
  socket.data.pid = participant.id;
  socket.join(room.id);
  void store.addSessionRoom(session.id, room.id);
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
    audit.record({
      kind: "room:joined",
      message: `${participant.name} joined ${room.code}`,
      actor: participant.name,
      sessionId: participant.id,
      roomId: room.id,
      roomCode: room.code,
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
  const session = getSession(socket);
  void store.removeSessionRoom(session.id, room.id);
  // A room deleted on another instance is already gone; only announce a leave
  // while it is still live locally, else we would emit into a dead room.
  const live = rooms.getRoom(room.id) === room;
  if (participant && live) {
    const system = rooms.addSystemMessage(room, `${participant.name} left`);
    io.to(room.id).emit("message:new", { message: system });
    io.to(room.id).emit("presence:left", { participantId: participant.id });
    audit.record({
      kind: "room:left",
      message: `${participant.name} left ${room.code}`,
      actor: participant.name,
      sessionId: participant.id,
      roomId: room.id,
      roomCode: room.code,
    });
  }
  // A room's lifetime is fixed at creation (roomTtlMs). Leaving does NOT pull
  // the expiry forward — otherwise an empty room's countdown would jump down,
  // and the room would die while people are just stepping out. The special
  // room never expires, so nothing happens here for it.
}

/**
 * Remove a member by participant id (admin moderation). Unlike a normal leave,
 * the affected socket(s) get an explicit `room:kicked` notice first. Works for
 * local sockets and for members seated on another instance: a `kick` room event
 * tells every instance to evict the sockets it seats, so the victim's internal
 * membership is torn down wherever it actually lives. Also works during the
 * disconnect-grace window. Returns the removed participant, or null.
 */
export async function adminRemoveMember(
  io: Server,
  room: rooms.Room,
  participantId: string,
  reason?: string,
): Promise<Participant | null> {
  const participant = room.participants.get(participantId);
  if (!participant) return null;
  const notice = kickNotice(room.id, reason);
  // Announce the kick BEFORE the authoritative removal snapshot below:
  // pub/sub is FIFO on one connection, so every instance evicts the victim's
  // sockets first and a later snapshot cannot resurrect them from a stale
  // local view.
  await store.publishRoom({
    kind: "kick",
    roomId: room.id,
    participantId,
    reason,
  });
  // This instance evicts whoever it seats directly (its own kick echo is
  // ignored by the store listener), then removes the member from the shared
  // store so the removal is persisted cluster-wide.
  evictParticipant(io, room, participantId, notice);
  rooms.removeParticipantById(room, participantId);
  const system = rooms.addSystemMessage(room, `${participant.name} was removed`);
  io.to(room.id).emit("message:new", { message: system });
  io.to(room.id).emit("presence:left", { participantId: participant.id });
  audit.record({
    kind: "member:kicked",
    message: `${participant.name} was removed from ${room.code}${reason ? ` (${reason})` : ""}`,
    actor: "admin",
    sessionId: participant.id,
    roomId: room.id,
    roomCode: room.code,
    detail: reason,
  });
  return participant;
}

/** The payload every kicked client receives. */
function kickNotice(
  roomId: string,
  reason?: string,
): { roomId: string; reason: string } {
  return {
    roomId,
    reason: reason ?? "You were removed from the room by an admin.",
  };
}

/**
 * Evict every socket this instance seats for `participantId` in `room`, and
 * drop the member's local room state (without writing to the store, so a
 * non-authoritative instance can never persist a stale copy of them).
 */
function evictParticipant(
  io: Server,
  room: rooms.Room,
  participantId: string,
  notice: { roomId: string; reason: string },
): void {
  // No resume: remove the shared session -> room index so a reconnect cannot
  // be re-seated after the kick.
  void store.removeSessionRoom(participantId, room.id);
  cancelDeparture(room.id, participantId);
  const held: string[] = [];
  for (const [sid, pid] of room.sockets) {
    if (pid === participantId) held.push(sid);
  }
  // Tear down the internal membership FIRST so a kicked client cannot race a
  // message through the gap between the notice and the cleanup.
  for (const sid of held) {
    room.sockets.delete(sid);
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    ROOM_MEMBERSHIP.delete(s);
    s.leave(room.id);
    if (s.data?.pid === participantId) s.data.pid = undefined;
  }
  // Always drop the local participant entry: a later snapshot or in-flight
  // persist on this instance must not resurrect the kicked member.
  rooms.removeParticipantLocalOnly(room, participantId);
  for (const sid of held) {
    const s = io.sockets.sockets.get(sid);
    if (s) s.emit("room:kicked", notice);
  }
}

/**
 * Route cluster-wide moderation events to the socket layer. `io` is only known
 * once the server boots, so index.ts wires this up before listening starts.
 */
export function attachClusterModeration(io: Server): void {
  store.on("room", (e: RoomEventEnvelope) => {
    if (e.origin === config.instanceId || e.kind !== "kick") return;
    const room = rooms.getRoom(e.roomId);
    if (!room) return;
    evictParticipant(io, room, e.participantId, kickNotice(e.roomId, e.reason));
  });
}

/** Close a room: kick everyone, announce it, and destroy it. */
export function closeRoom(io: Server, room: rooms.Room): void {
  // The adapter fans this out to every instance, so remote members are told too.
  io.to(room.id).emit("room:closed", { roomId: room.id });
  cancelDeparturesForRoom(room.id);
  for (const sid of room.sockets.keys()) {
    const s = io.sockets.sockets.get(sid);
    if (s) ROOM_MEMBERSHIP.delete(s);
  }
  audit.record({
    kind: "room:closed",
    message: `Room ${room.code} was closed`,
    actor: "admin",
    roomId: room.id,
    roomCode: room.code,
  });
  // Publishes a `delete` event, so other instances evict their cache too.
  rooms.deleteRoom(room.id);
}

/** Periodically prune expired rooms and rate-limiter buckets. */
export function startSweeper(io: Server): NodeJS.Timeout {
  const interval = setInterval(() => {
    void sweep(io);
  }, config.sweepIntervalMs);
  if (typeof interval.unref === "function") interval.unref();
  return interval;
}

async function sweep(io: Server): Promise<void> {
  media.pruneMedia();
  media.pruneRemoteMedia();
  for (const room of rooms.allRooms()) {
    if (!rooms.isExpired(room)) continue;
    // Only one instance broadcasts the expiry cluster-wide; the rest still drop
    // their local copy (idempotent, and deleteRoom re-publishes harmlessly).
    if (await store.acquireExpiryLock(room.id)) {
      io.to(room.id).emit("room:expired", { roomId: room.id });
      cancelDeparturesForRoom(room.id);
      // Force-disconnect members seated on this instance.
      for (const sid of room.sockets.keys()) {
        const s = io.sockets.sockets.get(sid);
        if (s) ROOM_MEMBERSHIP.delete(s);
      }
      audit.record({
        kind: "room:expired",
        message: `Room ${room.code} expired`,
        roomId: room.id,
        roomCode: room.code,
      });
    }
    rooms.deleteRoom(room.id);
  }
}

function sendError(socket: Socket, payload: ErrorPayload): void {
  socket.emit("error", payload);
}
