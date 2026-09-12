/**
 * Shared wire protocol between client and server.
 * This is the single source of truth for Socket.IO event names and payload
 * shapes. New features (matchmaking, E2EE, blocking) can extend these types
 * without breaking existing clients.
 */

/** Length alphabet used for room codes and avatar colors. */
export const ROOM_CODE_SIZE = 4;
export const ROOM_ID_SIZE = 12;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_NAME_LENGTH = 24;

/** Client -> Server events. */
export interface ClientToServerEventMap {
  /** Establish/refresh the anonymous display name for the connection. */
  "session:name": { name: string };
  /** Create a brand-new room. Pass a code to claim a specific one. */
  "room:create": { code?: string };
  /** Join an existing room by code. */
  "room:join": { code?: string; roomId?: string };
  /** Leave a room (may be silent if not present). */
  "room:leave": { roomId: string };
  /** Close a room: everyone is kicked and it is destroyed. */
  "room:close": { roomId: string };
  /** Clear all messages in a room. */
  "room:clear": { roomId: string };
  /** Rename any participant in a room. */
  "room:rename": { roomId: string; participantId: string; name: string };
  /** Send a chat message. clientId lets the sender match their optimistic copy.
   *  An image/gif message may carry `attachment`; `text` then holds the caption
   *  (and may be empty). `replyTo` quotes an earlier user message. */
  "message:send": {
    roomId: string;
    text: string;
    clientId?: string;
    attachment?: { mediaId: string };
    replyTo?: { messageId: string };
  };
  /** Broadcast a typing indicator to other room members. */
  "message:typing": { roomId: string };
  /** Mark the last message I've seen (read receipt). */
  "message:seen": { roomId: string; messageId: string };
  /** Ask the server for current status of a list of rooms (home screen). */
  "room:status": { refs: RoomRef[] };
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
  /** A participant is typing. */
  "presence:typing": { participantId: string; name: string };
  /** A participant's read position in the room (read receipts). */
  "presence:seen": { participantId: string; lastSeenMessageId: string };
  /** Incoming chat message. */
  "message:new": { message: PublicMessage };
  /** Ordered historical messages delivered on join (ephemeral, in-memory). */
  "message:history": { messages: PublicMessage[] };
  /** All messages in the room have been cleared. */
  "message:cleared": {};
  /** Room expired while the client was inside it. */
  "room:expired": { roomId: string };
  /** Room was closed (manually) while the client was inside it. */
  "room:closed": { roomId: string };
  /** Current status for the requested rooms (home screen). */
  "room:status:result": { statuses: RoomStatus[] };
}

/** Error events are delivered via socket.io's socket.emit("error") convention. */
export type ErrorCode =
  | "room_not_found"
  | "room_exists"
  | "room_full"
  | "room_expired"
  | "name_invalid"
  | "message_invalid"
  | "rate_limited"
  | "not_in_room";

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  /** When set, this error is about the matching message send. */
  clientId?: string;
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
  /** Presence flags reserved for future use (E2EE ready, etc). */
  status: "online";
  /** Last message this participant has read (read receipt position). */
  lastSeenMessageId?: string;
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
  /** Echoed from the sender (message:send) so clients can match them. */
  clientId?: string;
  /**
   * Client-only delivery status for optimistic sends ("pending"). Sent by the
   * server without this field. Not part of the wire protocol for history.
   */
  status?: "pending" | "failed";
  /** Uploaded image/gif shown with, or instead of, text. */
  attachment?: MessageAttachment;
  /** The message this one is replying to (quote block above the bubble). */
  replyTo?: MessageReply;
}

/** Snapshot of a quoted message, resolved server-side when sending. */
export interface MessageReply {
  messageId: string;
  participantId: string;
  /** Display name of the quoted author. */
  name: string;
  /** Preview text (caption for media messages; may be empty). */
  text: string;
  /** Media summary for the quote. Omitted for view-once (no preview). */
  attachment?: { type: MessageAttachment["type"]; mediaId?: string; name?: string };
  /** True when the original is one-time media (preview hidden). */
  viewOnce?: boolean;
}

/** An uploaded image/gif/sticker/voice-note attached to a chat message. */
export interface MessageAttachment {
  /** Still image, animated gif, square sticker (WhatsApp-style), or voice note. */
  type: "image" | "gif" | "sticker" | "voice";
  /** Server-assigned id used to fetch the media. */
  mediaId: string;
  /** One-time media: bytes are deleted after the first non-uploader view. */
  viewOnce?: boolean;
  /** Intrinsic pixel dimensions (client uses them for layout). */
  width?: number;
  height?: number;
  /** Sanitized original file name, if provided at upload. */
  name?: string;
  /** Length of a voice note in seconds. */
  duration?: number;
}

export type MessageKind = "user" | "system";

/** A reference to a room: share-code, room id, or both. */
export interface RoomRef {
  code?: string;
  roomId?: string;
}

/** Status snapshot of one room, used to keep the home screen accurate. */
export interface RoomStatus {
  code?: string;
  roomId?: string;
  /** Whether the room currently exists on the server. */
  exists: boolean;
  /** Current number of participants inside. */
  participantCount: number;
  /** Expiry the client should use (far-future for the persistent room). */
  expiresAt: number;
  persistent: boolean;
}

export interface PublicRoom {
  id: string;
  code: string;
  createdAt: number;
  /** Millisecond epoch after which the room will be cleaned up. */
  expiresAt: number;
  participants: Participant[];
  /** True if the requesting client is the room host. */
  isHost: boolean;
  /** True for the special preserved room: never auto-expires, closed manually. */
  persistent: boolean;
}
