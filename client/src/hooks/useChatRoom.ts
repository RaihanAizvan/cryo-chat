import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PublicMessage,
  PublicRoom,
  Participant,
  ErrorPayload,
  MessageAttachment,
} from "@cryo/shared";
import { connectAndInit, socket, useSession, wasRecentlyReconnected, lastDisconnectAt } from "../lib/store";
import { genClientId } from "../lib/ids";
import { recordRoomHistory, touchRoomHistory } from "../lib/roomHistory";
import { replySnapshot } from "../lib/reply";

// Slightly above the server's connection-state-recovery window (120s): if the
// drop lasted longer, the server can't restore us, so re-join explicitly.
const RECONNECT_REJOIN_MS = 125_000;

export interface RoomState {
  room: PublicRoom | null;
  messages: PublicMessage[];
  participants: Participant[];
  /** transient banner shown in the chat header (join/left/error). */
  notice: string | null;
  /** Last room join/create error (surfaced on the landing screen). */
  joinError: string | null;
  /** Modal alert for a room that was closed or expired behind the user. */
  alert: { title: string; message: string } | null;
  /** Participant IDs currently typing (auto-clears after a timeout). */
  typingParticipants: string[];
  /** Per-participant last-read message id (read receipts). */
  seenBy: Record<string, string>;
}

export interface RoomActions {
  createRoom: () => void;
  joinRoom: (codeOrId: string) => void;
  leaveRoom: () => void;
  closeRoom: () => void;
  sendMessage: (text: string, attachment?: MessageAttachment, replyTo?: PublicMessage) => void;
  sendTyping: () => void;
  sendSeen: () => void;
  clearChat: () => void;
  renameParticipant: (participantId: string, name: string) => void;
  clearNotice: () => void;
  clearJoinError: () => void;
  dismissAlert: () => void;
}

export function useChatRoom(): [RoomState, RoomActions] {
  const session = useSession();
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [alert, setAlert] = useState<RoomState["alert"]>(null);
  const [typingParticipants, setTypingParticipants] = useState<string[]>([]);
  const [seenBy, setSeenBy] = useState<Record<string, string>>({});

  // Mutable refs so stable event handlers read latest values.
  const roomRef = useRef<PublicRoom | null>(null);
  const participantsRef = useRef<Participant[]>([]);
  const messagesRef = useRef<PublicMessage[]>([]);
  const seenByRef = useRef<Record<string, string>>({});
  // A join-by-code that missed: remember it so we can create the room with that
  // exact code instead of showing a "room not available" dead end.
  const pendingJoinCode = useRef<string | null>(null);
  // Typing indicator debounce timer.
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-participant typing timeouts.
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearNotice = useCallback(() => setNotice(null), []);

  const enterRoom = useCallback((r: PublicRoom, msgs: PublicMessage[]) => {
    pendingJoinCode.current = null;
    roomRef.current = r;
    participantsRef.current = r.participants;
    messagesRef.current = msgs;
    setRoom(r);
    setMessages(msgs);
    setParticipants(r.participants);
    recordRoomHistory(r, { isHost: r.isHost });
  }, []);

  const touchHistory = useCallback(() => {
    const r = roomRef.current;
    if (r) touchRoomHistory(r, participantsRef.current.length);
  }, []);

  const exitRoom = useCallback(() => {
    pendingJoinCode.current = null;
    roomRef.current = null;
    participantsRef.current = [];
    messagesRef.current = [];
    seenByRef.current = {};
    setRoom(null);
    setMessages([]);
    setParticipants([]);
    setSeenBy({});
    setTypingParticipants([]);
  }, []);

  useEffect(() => {
    if (!socket.connected) connectAndInit();
  }, []);

  useEffect(() => {
    const onJoined = (data: { room: PublicRoom }) => {
      setJoinError(null);
      enterRoom(data.room, []);
      // Seed read receipts for any participants whose position we already know.
      const seen: Record<string, string> = {};
      for (const p of data.room.participants) {
        if (p.id !== session.sessionId && p.lastSeenMessageId) {
          seen[p.id] = p.lastSeenMessageId;
        }
      }
      seenByRef.current = seen;
      setSeenBy(seen);
      if (wasRecentlyReconnected()) {
        setNotice("Back online ✨");
        const t = window.setTimeout(() => setNotice(null), 3200);
        window.setTimeout(() => window.clearTimeout(t), 3500);
      }
    };
    const onHistory = (data: { messages: PublicMessage[] }) => {
      messagesRef.current = data.messages;
      setMessages(data.messages);
    };
    const onMessage = (data: { message: PublicMessage }) => {
      setMessages((prev) => {
        const m = data.message;
        // Optimistic echo: replace the pending copy in place (keeps position,
        // and removes the pending state so the message shows as sent/seen).
        let next: PublicMessage[];
        if (m.clientId) {
          const idx = prev.findIndex((p) => p.clientId === m.clientId);
          if (idx < 0) next = [...prev, m];
          else {
            next = prev.slice();
            next[idx] = m;
          }
        } else {
          // System pills (joined/left/cleared) always append.
          next = [...prev, m];
        }
        messagesRef.current = next;
        return next;
      });
    };
    const onPresenceJoined = (data: { participant: Participant }) => {
      participantsRef.current = [
        ...participantsRef.current.filter((p) => p.id !== data.participant.id),
        data.participant,
      ];
      setParticipants(participantsRef.current);
      touchHistory();
    };
    const onPresenceLeft = (data: { participantId: string }) => {
      participantsRef.current = participantsRef.current.filter(
        (p) => p.id !== data.participantId,
      );
      setParticipants(participantsRef.current);
      touchHistory();
    };
    const onPresenceRenamed = (data: { participantId: string; name: string }) => {
      participantsRef.current = participantsRef.current.map((p) =>
        p.id === data.participantId ? { ...p, name: data.name } : p,
      );
      setParticipants(participantsRef.current);
    };
    const onTyping = (data: { participantId: string; name: string }) => {
      if (data.participantId === session.sessionId) return;
      setTypingParticipants((prev) =>
        prev.includes(data.participantId)
          ? prev
          : [...prev, data.participantId],
      );
      // Auto-clear after a short silence.
      const existing = typingTimeoutsRef.current.get(data.participantId);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        setTypingParticipants((prev) =>
          prev.filter((id) => id !== data.participantId),
        );
        typingTimeoutsRef.current.delete(data.participantId);
      }, 2500);
      typingTimeoutsRef.current.set(data.participantId, t);
    };
    const onSeen = (data: { participantId: string; lastSeenMessageId: string }) => {
      if (data.participantId === session.sessionId) return;
      seenByRef.current = { ...seenByRef.current, [data.participantId]: data.lastSeenMessageId };
      setSeenBy(seenByRef.current);
    };
    const onCleared = () => {
      messagesRef.current = [];
      seenByRef.current = {};
      setMessages([]);
      setSeenBy({});
    };
    const onExpired = () => {
      const code = roomRef.current?.code;
      exitRoom();
      setAlert({
        title: "This room has expired.",
        message: code
          ? `Room ${code} faded away — rooms vanish when they're left alone. Start a new one?`
          : "Rooms fade away when they're left alone. Start a new one?",
      });
    };
    const onClosed = () => {
      const code = roomRef.current?.code;
      exitRoom();
      setAlert({
        title: "This room was closed.",
        message: code
          ? `Room ${code} was closed. It can be reopened anytime with the same code.`
          : "This room was closed. It can be reopened anytime with the same code.",
      });
    };
    // Admin moderation: the room removed us specifically (kick), optionally
    // with a reason. Leaving the room is done server-side; just surface it.
    const onKicked = (data: { code?: string; reason?: string }) => {
      const reason = data.reason?.trim();
      exitRoom();
      setAlert({
        title: "You were removed from the room.",
        message: reason
          ? reason
          : data.code
            ? `A moderator removed you from room ${data.code}.`
            : "A moderator removed you from this room.",
      });
    };
    // Ride out brief backgrounding drops: the server restores the room itself.
    // Only when the drop outlasted the server's recovery window do we need an
    // explicit re-join (fresh membership + history).
    const onConnect = () => {
      const r = roomRef.current;
      if (!r) return;
      const gap = Date.now() - lastDisconnectAt;
      if (gap > RECONNECT_REJOIN_MS) {
        socket.emit("room:join", { code: r.code });
      }
    };
    const onError = (err: ErrorPayload) => {
      // A message-specific error marks the matching optimistic bubble as failed.
      if (err.clientId) {
        setMessages((prev) =>
          prev.map((p) =>
            p.clientId === err.clientId ? { ...p, status: "failed" } : p,
          ),
        );
        return;
      }
      switch (err.code) {
        case "room_not_found":
          // Join-by-code missed → create the room with that exact code instead
          // of a dead-end error. Guarded to well-formed codes only.
          if (pendingJoinCode.current && /^[A-Z0-9]{4}$/.test(pendingJoinCode.current)) {
            const code = pendingJoinCode.current;
            pendingJoinCode.current = null;
            socket.emit("room:create", { code });
            return;
          }
          setJoinError("That room doesn't exist. Check the code and try again.");
          break;
        case "room_exists":
          // A room with the typed code appeared mid-flight → just join it.
          if (pendingJoinCode.current) {
            const code = pendingJoinCode.current;
            pendingJoinCode.current = null;
            socket.emit("room:join", { code });
            return;
          }
          break;
        case "room_full":
          setJoinError("That room is full right now.");
          break;
        case "room_expired":
          setJoinError("That room has expired.");
          break;
        case "banned":
          setJoinError("This identity has been banned.");
          break;
        case "name_invalid":
        case "message_invalid":
        case "rate_limited":
        case "not_in_room":
          // Not related to joining; ignore here.
          break;
      }
    };

    socket.on("room:joined", onJoined);
    socket.on("message:history", onHistory);
    socket.on("message:new", onMessage);
    socket.on("presence:joined", onPresenceJoined);
    socket.on("presence:left", onPresenceLeft);
    socket.on("presence:renamed", onPresenceRenamed);
    socket.on("presence:typing", onTyping);
    socket.on("presence:seen", onSeen);
    socket.on("message:cleared", onCleared);
    socket.on("room:expired", onExpired);
    socket.on("room:closed", onClosed);
    socket.on("room:kicked", onKicked);
    socket.on("connect", onConnect);
    socket.on("error", onError);

    return () => {
      socket.off("room:joined", onJoined);
      socket.off("message:history", onHistory);
      socket.off("message:new", onMessage);
      socket.off("presence:joined", onPresenceJoined);
      socket.off("presence:left", onPresenceLeft);
      socket.off("presence:renamed", onPresenceRenamed);
      socket.off("presence:typing", onTyping);
      socket.off("presence:seen", onSeen);
      socket.off("message:cleared", onCleared);
      socket.off("room:expired", onExpired);
      socket.off("room:closed", onClosed);
      socket.off("room:kicked", onKicked);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
  }, [enterRoom, exitRoom, touchHistory, session.sessionId]);

  const createRoom = useCallback(() => {
    setJoinError(null);
    pendingJoinCode.current = null;
    socket.emit("room:create", {});
  }, []);

  const joinRoom = useCallback((codeOrId: string) => {
    const trimmed = codeOrId.trim();
    if (!trimmed) return;
    setJoinError(null);
    if (trimmed.length <= 8) {
      const code = trimmed.toUpperCase();
      pendingJoinCode.current = code;
      socket.emit("room:join", { code });
    } else {
      pendingJoinCode.current = null;
      socket.emit("room:join", { roomId: trimmed });
    }
  }, []);

  const clearJoinError = useCallback(() => setJoinError(null), []);

  const dismissAlert = useCallback(() => setAlert(null), []);

  const leaveRoom = useCallback(() => {
    const id = roomRef.current?.id;
    if (id) socket.emit("room:leave", { roomId: id });
    exitRoom();
  }, [exitRoom]);

  const closeRoom = useCallback(() => {
    const id = roomRef.current?.id;
    if (id) socket.emit("room:close", { roomId: id });
    // The server confirms with room:closed (kicks everyone). Optimistically
    // exit so the rest of the world sees the immediate effect.
    exitRoom();
  }, [exitRoom]);

  // Typing indicator: throttle so we don't spam the socket while typing.
  const sendTyping = useCallback(() => {
    if (typingTimerRef.current) return;
    const r = roomRef.current;
    if (!r) return;
    socket.emit("message:typing", { roomId: r.id });
    typingTimerRef.current = setTimeout(() => {
      typingTimerRef.current = null;
    }, 1200);
  }, []);

  // Read receipt: inform the room that I've read up to the last message.
  // System pills (joined/left/cleared) don't advance the read position.
  const sendSeen = useCallback(() => {
    const r = roomRef.current;
    if (!r) return;
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (last && last.kind !== "system" && last.participantId !== session.sessionId) {
      socket.emit("message:seen", { roomId: r.id, messageId: last.id });
    }
  }, [session.sessionId]);

  const clearChat = useCallback(() => {
    const r = roomRef.current;
    if (!r) return;
    socket.emit("room:clear", { roomId: r.id });
  }, []);

  const renameParticipantRoom = useCallback((participantId: string, name: string) => {
    const r = roomRef.current;
    if (!r) return;
    socket.emit("room:rename", { roomId: r.id, participantId, name });
  }, []);

  const sendMessage = useCallback(
    (text: string, attachment?: MessageAttachment, replyTo?: PublicMessage) => {
      const r = roomRef.current;
      const trimmed = text.trim();
      if (!r || (!trimmed && !attachment)) return;
      const clientId = genClientId();
      // Optimistic append (WhatsApp-style): show the bubble instantly with a
      // clock, then flip to a tick once the server echoes it (message:new).
      const optimistic: PublicMessage = {
        id: `local-${clientId}`,
        roomId: r.id,
        participantId: session.sessionId ?? "",
        name: session.name ?? "You",
        color: session.color,
        text: trimmed,
        sentAt: Date.now(),
        kind: "user",
        clientId,
        status: "pending",
        attachment,
        replyTo: replyTo ? replySnapshot(replyTo) : undefined,
      };
      setMessages((prev) => {
        const next = [...prev, optimistic];
        messagesRef.current = next;
        return next;
      });
      socket.emit("message:send", {
        roomId: r.id,
        text: trimmed,
        clientId,
        attachment: attachment ? { mediaId: attachment.mediaId } : undefined,
        replyTo: replyTo ? { messageId: replyTo.id } : undefined,
      });
    },
    [session],
  );

  return [
    {
      room,
      messages,
      participants,
      notice,
      joinError,
      alert,
      typingParticipants,
      seenBy,
    },
    {
      createRoom,
      joinRoom,
      leaveRoom,
      closeRoom,
      sendMessage,
      sendTyping,
      sendSeen,
      clearChat,
      renameParticipant: renameParticipantRoom,
      clearNotice,
      clearJoinError,
      dismissAlert,
    },
  ];
}
