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
 *
 * Identity hygiene: a disconnect deliberately keeps the identity resumable, so
 * without a reaper the map only ever grows. Identities are stamped with their
 * last activity and swept on a timer, so the admin user list reflects people
 * who actually came back rather than every transient visitor.
 */

import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io";
import { normalizeName, randomDisplayName, colorFor } from "./util.js";
import * as audit from "./audit.js";
import { isBanned } from "./bans.js";
import { store } from "./store.js";
import type { SessionEvent } from "./store.js";

export interface Session {
  id: string;
  name: string;
  color: number;
  createdAt: number;
  /** Last time this identity was connected/resumed. Drives idle pruning. */
  lastSeenAt: number;
}

/** Active bindings: socket.id -> session currently using it. */
const sessions = new Map<Socket["id"], Session>();

/** Issued identities: session.id -> session. Survives disconnects. */
const identities = new Map<string, Session>();

/**
 * Session identities are stored in Redis (when configured) as the durable
 * copy. The Map above is a per-instance cache: reads stay synchronous and fast,
 * writes go through to Redis, and changes made on other instances arrive over
 * pub/sub via this listener.
 */
function applyRemoteSession(event: SessionEvent): void {
  if (event.kind === "upsert") {
    const existing = identities.get(event.session.id);
    if (existing) {
      existing.name = event.session.name;
      existing.color = event.session.color;
      existing.lastSeenAt = event.session.lastSeenAt;
    } else {
      identities.set(event.session.id, { ...event.session });
    }
  } else {
    identities.delete(event.id);
  }
}
store.on("session", applyRemoteSession);

/** Seed the identity cache from the durable copy (run once at boot). */
export async function loadFromStore(): Promise<void> {
  const rows = await store.loadSessions();
  for (const s of rows) {
    if (!identities.has(s.id)) identities.set(s.id, s);
  }
  // Rows that were already past the idle window when we booted are dropped now
  // rather than lingering until the first sweep tick.
  pruneIdentities();
}

/** Only UUID-shaped ids are accepted for resume (avoids spoofing). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How long an identity may go unseen before pruning. Counts from the last
 * activity, not creation, so long-lived users are never dropped mid-life.
 */
const IDENTITY_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
/** Cap on retained identities to bound memory. */
export const IDENTITY_MAX = 4_000;

/** How often the background sweep reaps idle identities. */
const IDENTITY_SWEEP_MS = 1000 * 60 * 10; // 10 minutes

let sweepTimer: NodeJS.Timeout | null = null;

/**
 * Persist throttling: a busy chat reconnects often, and rewriting every
 * identity to Redis on each resume is wasted I/O. Only re-persist once the
 * identity has been idle long enough that the write would actually matter.
 */
const TOUCH_PERSIST_MS = 1000 * 60 * 5; // 5 minutes

/** Last time each identity was written to the store (throttle watermark). */
const persistedAt = new Map<string, number>();

/** Mark an identity as active now, re-persisting when the window has elapsed. */
function touch(session: Session): void {
  const now = Date.now();
  session.lastSeenAt = now;
  if (now - (persistedAt.get(session.id) ?? 0) < TOUCH_PERSIST_MS) return;
  persistedAt.set(session.id, now);
  void store.saveSession(session);
}

/**
 * Lazily create and cache a session for a socket, resuming a previously issued
 * id when the client asks for it (and it's still known/valid).
 */
export function getSession(socket: Socket, requestedId?: unknown): Session {
  const cached = sessions.get(socket.id);
  if (cached) return cached;

  const wantId = typeof requestedId === "string" ? requestedId : undefined;
  // Banned identities can't be resumed — the client silently gets a fresh one.
  const resumed =
    wantId && UUID_RE.test(wantId) && !isBanned(wantId)
      ? identities.get(wantId)
      : undefined;
  if (resumed) {
    sessions.set(socket.id, resumed);
    touch(resumed);
    return resumed;
  }

  const now = Date.now();
  const session: Session = {
    id: randomUUID(),
    name: randomDisplayName(),
    color: 0,
    createdAt: now,
    lastSeenAt: now,
  };
  session.color = colorFor(session.name);
  identities.set(session.id, session);
  sessions.set(socket.id, session);
  persistedAt.set(session.id, now);
  void store.saveSession(session);
  // Idle reaping runs on the sweep timer; only pay for a scan here when the
  // map is close to the cap and needs the hard trim.
  if (identities.size >= IDENTITY_MAX) pruneIdentities();
  audit.record({
    kind: "session:created",
    message: `Session created for ${session.name}`,
    actor: session.name,
    sessionId: session.id,
  });
  return session;
}

export function updateName(socket: Socket, raw: unknown): Session | null {
  const existing = getSession(socket);
  const name = normalizeName(raw);
  if (!name) return null;
  existing.name = name;
  existing.color = colorFor(name);
  // A rename is a deliberate act: count it as activity and always persist.
  existing.lastSeenAt = Date.now();
  persistedAt.set(existing.id, existing.lastSeenAt);
  void store.saveSession(existing);
  return existing;
}

export function destroy(socket: Socket): void {
  sessions.delete(socket.id);
  // The identity is intentionally KEPT so a reconnect can resume it.
}

/**
 * Drop identities that have gone quiet, then enforce the hard cap.
 *
 * Sweeping by inactivity (instead of creation time) is what keeps the identity
 * count honest: a user who connects every day survives, while the one-off
 * visitors that make up almost all of the map are reaped on the next pass. The
 * cap trim is a backstop for a sudden burst, and keeps the most recently seen.
 */
export function pruneIdentities(): number {
  if (identities.size === 0) return 0;
  const now = Date.now();
  const stale: string[] = [];
  for (const [id, s] of identities) {
    const seen = s.lastSeenAt || s.createdAt;
    if (now - seen > IDENTITY_TTL_MS) stale.push(id);
  }
  for (const id of stale) dropIdentity(id);

  if (identities.size > IDENTITY_MAX) {
    const byRecency = [...identities.entries()].sort(
      (a, b) => (a[1].lastSeenAt || a[1].createdAt) - (b[1].lastSeenAt || b[1].createdAt),
    );
    for (let i = 0; i < byRecency.length - IDENTITY_MAX; i++) {
      dropIdentity(byRecency[i][0]);
    }
  }
  return stale.length;
}

/** Forget an identity locally and in the durable copy. */
function dropIdentity(id: string): void {
  identities.delete(id);
  persistedAt.delete(id);
  void store.deleteSession(id);
}

/**
 * Run the idle sweep on a timer. Reaping only on session creation (the old
 * behaviour) let abandoned identities pile up indefinitely: a small site with
 * a handful of real users could sit on hundreds of stale entries.
 */
export function startSessionSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    pruneIdentities();
  }, IDENTITY_SWEEP_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

/** All issued identities (admin user list). */
export function allIdentities(): Session[] {
  return [...identities.values()];
}

/** Look up an issued identity by id without resuming/allocating anything. */
export function identityById(id: string): Session | undefined {
  return UUID_RE.test(id) ? identities.get(id) : undefined;
}

/** Active socket->session bindings (admin "online" view). */
export function allBindings(): Map<Socket["id"], Session> {
  return new Map(sessions);
}

/** Drop a stored identity entirely (admin user purge — disables resume). */
export function deleteIdentity(id: string): boolean {
  if (!UUID_RE.test(id)) return false;
  persistedAt.delete(id);
  void store.deleteSession(id);
  return identities.delete(id);
}
