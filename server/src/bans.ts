/**
 * Ban list.
 *
 * Bans are keyed by session id (the anonymous identity a participant carries
 * across reconnects). A banned session can no longer join rooms or resume an
 * identity until unbanned. The Set here is a per-instance cache: Redis (when
 * configured) holds the durable copy and pub/sub pushes changes between
 * instances, so a moderator action applies everywhere immediately.
 */

import { store } from "./store.js";
import type { BanEvent } from "./store.js";

const banned = new Set<string>();

function applyRemoteBan(event: BanEvent): void {
  if (event.kind === "ban") banned.add(event.id);
  else banned.delete(event.id);
}
store.on("ban", applyRemoteBan);

/** Seed the cache from the durable copy (run once at boot). */
export async function loadFromStore(): Promise<void> {
  const rows = await store.loadBans();
  for (const id of rows) banned.add(id);
}

export function isBanned(sessionId: string): boolean {
  return banned.has(sessionId);
}

/** Add a session to the ban list. Returns false if already present. */
export function ban(sessionId: string): boolean {
  if (banned.has(sessionId)) return false;
  banned.add(sessionId);
  void store.saveBan(sessionId);
  return true;
}

/** Remove a session from the ban list. Returns false if not present. */
export function unban(sessionId: string): boolean {
  if (!banned.delete(sessionId)) return false;
  void store.deleteBan(sessionId);
  return true;
}

export function bannedCount(): number {
  return banned.size;
}

export function allBanned(): readonly string[] {
  return [...banned];
}