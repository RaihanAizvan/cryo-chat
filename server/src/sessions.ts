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

const SESSION_NAMESPACE = "cryo:session";

/** Lazily create and cache a session for a socket. */
export function getSession(socket: Socket): Session {
  const cached = sessions.get(socket.id);
  if (cached) return cached;
  const session: Session = {
    id: randomUUID(),
    name: randomDisplayName(),
    color: 0,
    createdAt: Date.now(),
  };
  session.color = colorFor(session.name);
  sessions.set(socket.id, session);
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
  sessions.delete(socket.id);
}

/** Symbol used to pin a session reference onto the socket. */
export const SESSION_KEY = Symbol.for(SESSION_NAMESPACE);
