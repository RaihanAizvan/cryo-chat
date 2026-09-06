import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PublicMessage,
  PublicRoom,
  Participant,
  ErrorPayload,
} from "@cryo/shared";
import { connectAndInit, socket, useSession, wasRecentlyReconnected, lastDisconnectAt } from "../lib/store";
import { genClientId } from "../lib/ids";
import { recordRoomHistory, touchRoomHistory } from "../lib/roomHistory";

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
}

export interface RoomActions {
  createRoom: () => void;
  joinRoom: (codeOrId: string) => void;
  leaveRoom: () => void;
  closeRoom: () => void;
  sendMessage: (text: string) => void;
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

  // Mutable refs so stable event handlers read latest values.
  const roomRef = useRef<PublicRoom | null>(null);
  const participantsRef = useRef<Participant[]>([]);

  const clearNotice = useCallback(() => setNotice(null), []);

  const enterRoom = useCallback((r: PublicRoom, msgs: PublicMessage[]) => {
    roomRef.current = r;
    participantsRef.current = r.participants;
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
    roomRef.current = null;
    participantsRef.current = [];
    setRoom(null);
    setMessages([]);
    setParticipants([]);
  }, []);

  useEffect(() => {
    if (!socket.connected) connectAndInit();
  }, []);

  useEffect(() => {
    const onJoined = (data: { room: PublicRoom }) => {
      setJoinError(null);
      enterRoom(data.room, []);
      if (wasRecentlyReconnected()) {
        setNotice("Back online ✨");
        const t = window.setTimeout(() => setNotice(null), 3200);
        window.setTimeout(() => window.clearTimeout(t), 3500);
      }
    };
    const onHistory = (data: { messages: PublicMessage[] }) => {
      setMessages(data.messages);
    };
    const onMessage = (data: { message: PublicMessage }) => {
      setMessages((prev) => {
        const m = data.message;
        // Optimistic echo: replace the pending copy in place (keeps position,
        // and removes the pending state so the message shows as sent/seen).
        if (m.clientId) {
          const idx = prev.findIndex((p) => p.clientId === m.clientId);
          if (idx < 0) return [...prev, m];
          const next = prev.slice();
          next[idx] = m;
          return next;
        }
        return [...prev, m];
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
          setJoinError("That room doesn't exist. Check the code and try again.");
          break;
        case "room_full":
          setJoinError("That room is full right now.");
          break;
        case "room_expired":
          setJoinError("That room has expired.");
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
    socket.on("room:expired", onExpired);
    socket.on("room:closed", onClosed);
    socket.on("connect", onConnect);
    socket.on("error", onError);

    return () => {
      socket.off("room:joined", onJoined);
      socket.off("message:history", onHistory);
      socket.off("message:new", onMessage);
      socket.off("presence:joined", onPresenceJoined);
      socket.off("presence:left", onPresenceLeft);
      socket.off("presence:renamed", onPresenceRenamed);
      socket.off("room:expired", onExpired);
      socket.off("room:closed", onClosed);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
  }, [enterRoom, exitRoom, touchHistory]);

  const createRoom = useCallback(() => {
    setJoinError(null);
    socket.emit("room:create", {});
  }, []);

  const joinRoom = useCallback((codeOrId: string) => {
    const trimmed = codeOrId.trim();
    if (!trimmed) return;
    setJoinError(null);
    if (trimmed.length <= 8) {
      socket.emit("room:join", { code: trimmed.toUpperCase() });
    } else {
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

  const sendMessage = useCallback(
    (text: string) => {
      const r = roomRef.current;
      const trimmed = text.trim();
      if (!r || !trimmed) return;
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
      };
      setMessages((prev) => [...prev, optimistic]);
      socket.emit("message:send", { roomId: r.id, text: trimmed, clientId });
    },
    [session],
  );

  return [
    { room, messages, participants, notice, joinError, alert },
    {
      createRoom,
      joinRoom,
      leaveRoom,
      closeRoom,
      sendMessage,
      clearNotice,
      clearJoinError,
      dismissAlert,
    },
  ];
}
