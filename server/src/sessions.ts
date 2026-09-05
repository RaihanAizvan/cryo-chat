/**
 * Anonymous session manager.
 *
 * A session is a temporary identity bound to a socket.io connection. It is NOT
 * a permanent user account. The concept is kept separate from "participant" so
 * that future features (persistence, matchmaking) can evolve independently.
 */

import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io";
import { normalizeName, randomDisplayName, colorFor } from "./util.js";

export interface Session {
  id: string;
  name: string;
  color: number;
  createdAt: number;
}

const sessions = new Map<Socket["id"], Session>();
// Session id -> socket id(s) currently using it. Lets us reuse the same
// identity across reconnects/room changes so a user's own messages keep
// aligning to the right.
const sessionById = new Map<string, Socket["id"]>();

const SESSION_NAMESPACE = "cryo:session";

/**
 * Lazily create and cache a session for a socket. If the client asks to resume
 * a previous session id (persisted on-device), reuse that identity so their
 * historical messages stay "theirs". The requested id is only trusted if it's
 * a valid UUID (we don't accept arbitrary strings).
 */
export function getSession(socket: Socket, requestedId?: unknown): Session {
  const cached = sessions.get(socket.id);
  if (cached) return cached;

  // Try to resume a previously issued session id.
  const wantId = typeof requestedId === "string" ? requestedId : undefined;
  const existingHolder = wantId ? sessionById.get(wantId) : undefined;
  if (wantId && existingHolder && sessions.has(existingHolder)) {
    const resumed = sessions.get(existingHolder)!;
    sessions.set(socket.id, resumed);
    return resumed;
  }

  const session: Session = {
    id: randomUUID(),
    name: randomDisplayName(),
    color: 0,
    createdAt: Date.now(),
  };
  session.color = colorFor(session.name);
  sessions.set(socket.id, session);
  sessionById.set(session.id, socket.id);
  return session;
}

export function updateName(socket: Socket, raw: unknown): Session | null {
  const existing = getSession(socket);
  const name = normalizeName(raw);
  if (!name) return null;
  existing.name = name;
  existing.color = colorFor(name);
  return existing;
}

export function destroy(socket: Socket): void {
  const session = sessions.get(socket.id);
  sessions.delete(socket.id);
  if (session) {
    // Only clear the by-id mapping if this socket was its holder.
    if (sessionById.get(session.id) === socket.id) {
      sessionById.delete(session.id);
    }
  }
}

/** Symbol used to pin a session reference onto the socket. */
export const SESSION_KEY = Symbol.for(SESSION_NAMESPACE);
