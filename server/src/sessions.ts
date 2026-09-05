/**
 * Anonymous session manager.
 *
 * A session is a temporary identity that outlives a single socket connection.
 * It is NOT a permanent user account. The concept is kept separate from
 * "participant" so that future features (persistence, matchmaking) can evolve
 * independently.
 *
 * Identity reuse: the client persists its session id (localStorage) and sends
 * it as a connection query. The server keeps issued identities in a store that
 * survives disconnect, so a re-join after a page reload reuses the same id.
 * That keeps a user's own historical messages aligned to the right.
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

/** Active bindings: socket.id -> session currently using it. */
const sessions = new Map<Socket["id"], Session>();

/** Issued identities: session.id -> session. Survives disconnects. */
const identities = new Map<string, Session>();

/** Only UUID-shaped ids are accepted for resume (avoids spoofing). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How long a disconnected identity stays reusable before pruning. */
const IDENTITY_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
/** Cap on retained identities to bound memory. */
const IDENTITY_MAX = 4_000;

/**
 * Lazily create and cache a session for a socket, resuming a previously issued
 * id when the client asks for it (and it's still known/valid).
 */
export function getSession(socket: Socket, requestedId?: unknown): Session {
  const cached = sessions.get(socket.id);
  if (cached) return cached;

  const wantId = typeof requestedId === "string" ? requestedId : undefined;
  const resumed = wantId && UUID_RE.test(wantId) ? identities.get(wantId) : undefined;
  if (resumed) {
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
  identities.set(session.id, session);
  sessions.set(socket.id, session);
  pruneIdentities();
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
  // The identity is intentionally KEPT so a reconnect can resume it.
}

/** Remove stale/oversized identities that no longer need to be resumable. */
function pruneIdentities(): void {
  if (identities.size < IDENTITY_MAX) return;
  const now = Date.now();
  for (const [id, s] of identities) {
    if (now - s.createdAt > IDENTITY_TTL_MS || identities.size > IDENTITY_MAX) {
      identities.delete(id);
    }
  }
}
