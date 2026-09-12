/**
 * Ban list.
 *
 * Bans are keyed by session id (the anonymous identity a participant carries
 * across reconnects). A banned session can no longer join rooms or resume an
 * identity until unbanned. Purely in-memory, consistent with the rest of the
 * app; resets on restart.
 */

const banned = new Set<string>();

export function isBanned(sessionId: string): boolean {
  return banned.has(sessionId);
}

/** Add a session to the ban list. Returns false if already present. */
export function ban(sessionId: string): boolean {
  if (banned.has(sessionId)) return false;
  banned.add(sessionId);
  return true;
}

/** Remove a session from the ban list. Returns false if not present. */
export function unban(sessionId: string): boolean {
  return banned.delete(sessionId);
}

export function bannedCount(): number {
  return banned.size;
}

export function allBanned(): readonly string[] {
  return [...banned];
}