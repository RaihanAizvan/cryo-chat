/**
 * Shared wire protocol between client and server.
 * This is the single source of truth for Socket.IO event names and payload
 * shapes. New features (matchmaking, E2EE, blocking) can extend these types
 * without breaking existing clients.
 */

/** Length alphabet used for room codes and avatar colors. */
export const ROOM_CODE_SIZE = 8;
export const ROOM_ID_SIZE = 12;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_NAME_LENGTH = 24;

/** Client -> Server events. */
export interface ClientToServerEventMap {
  /** Establish/refresh the anonymous display name for the connection. */
  "session:name": { name: string };
  /** Create a brand-new room. */
  "room:create": {};
  /** Join an existing room by code. */
  "room:join": { code?: string; roomId?: string };
  /** Leave a room (may be silent if not present). */
  "room:leave": { roomId: string };
  /** Send a chat message. */
  "message:send": { roomId: string; text: string };
}

/** Server -> Client events. */
export interface ServerToClientEventMap {
  /** Initial connection handshake with the temporary identity. */
  "session:init": { sessionId: string; name: string; color: AvatarColor };
  /** Name changed/confirmed (echo back the sanitized server view). */
  "session:name:updated": { name: string };
  /** Ack when a room was created. */
  "room:created": { roomId: string; code: string };
  /** Ack when the client successfully joined a room. */
  "room:joined": { room: PublicRoom };
  /** Ack when the client left a room. */
  "room:left": { roomId: string };
  /** A participant joined the room (client already inside). */
  "presence:joined": { participant: Participant };
  /** A participant left the room. */
  "presence:left": { participantId: string };
  /** A participant renamed their display name. */
  "presence:renamed": { participantId: string; name: string };
  /** Incoming chat message. */
  "message:new": { message: PublicMessage };
  /** Ordered historical messages delivered on join (ephemeral, in-memory). */
  "message:history": { messages: PublicMessage[] };
  /** Room expired while the client was inside it. */
  "room:expired": { roomId: string };
}

/** Error events are delivered via socket.io's socket.emit("error") convention. */
export type ErrorCode =
  | "room_not_found"
  | "room_full"
  | "room_expired"
  | "name_invalid"
  | "message_invalid"
  | "rate_limited"
  | "not_in_room";

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

/** Colors a participant may be assigned (index into a fixed palette). */
export type AvatarColor = number;

/** Fixed palette of avatar background colors (client & server agree on order). */
export const AVATAR_COLORS = [
  "#7c9cff",
  "#71c4ff",
  "#6ee7b7",
  "#a78bfa",
  "#f6a6d8",
  "#f59e9e",
  "#fbbf7d",
  "#5eead4",
  "#ef9f76",
  "#8b8fb8",
] as const;

export function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Resolve a stable avatar background color from a name or color index. */
export function avatarColor(
  seed: string | number,
): (typeof AVATAR_COLORS)[number] {
  const norm = typeof seed === "number" ? seed : hash(seed);
  return AVATAR_COLORS[((norm % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length];
}

export interface Participant {
  id: string;
  name: string;
  color: AvatarColor;
  /** Millisecond timestamp of last join. */
  joinedAt: number;
  /** Presence flags reserved for future use (typing, E2EE ready, etc). */
  status: "online";
}

export interface PublicMessage {
  id: string;
  roomId: string;
  participantId: string;
  /** Display name at time of send. */
  name: string;
  color: AvatarColor;
  text: string;
  /** Millisecond timestamp. */
  sentAt: number;
  /**
   * "user" for normal chat bubbles, "system" for join/left pills. Omitted for
   * backwards-compatible user messages (treated as "user" by clients).
   */
  kind?: MessageKind;
}

export type MessageKind = "user" | "system";

export interface PublicRoom {
  id: string;
  code: string;
  createdAt: number;
  /** Millisecond epoch after which the room will be cleaned up. */
  expiresAt: number;
  participants: Participant[];
  /** True if the requesting client is the room host. */
  isHost: boolean;
}
