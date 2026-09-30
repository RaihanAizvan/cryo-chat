/**
 * On-device access tokens for password-protected rooms.
 *
 * After a visitor types the reserved-room password once, the server hands back a
 * signed token and we keep it here, so reloads, reconnects and re-joins never
 * ask again. Tokens are per room code and carry their own expiry, so a stale one
 * is dropped instead of being sent and rejected.
 *
 * localStorage is used on purpose: the whole point is surviving a reload and
 * being available before the socket connects, and the token only unlocks one
 * room (the anonymous identity it is bound to is a separate, equally local
 * thing). The same "storage may be unavailable" guard as prefs.ts applies.
 */

const STORAGE_KEY = "cryo_room_keys_v1";

export interface RoomKey {
  token: string;
  /** ms epoch after which the token is worthless. */
  expiresAt: number;
}

function read(): Record<string, RoomKey> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, RoomKey>;
  } catch {
    return {};
  }
}

function write(entries: Record<string, RoomKey>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable — the user will be asked again */
  }
}

/** Stored token for a room, or null when absent/expired (expired is pruned). */
export function getRoomKey(code: string): string | null {
  const entries = read();
  const key = entries[code];
  if (!key || typeof key.token !== "string") return null;
  if (!Number.isFinite(key.expiresAt) || key.expiresAt <= Date.now()) {
    delete entries[code];
    write(entries);
    return null;
  }
  return key.token;
}

/** Remember a freshly issued token. */
export function setRoomKey(code: string, key: RoomKey): void {
  const entries = read();
  entries[code] = key;
  write(entries);
}

/** Forget one room's access (used when the admin rotates the password). */
export function clearRoomKey(code: string): void {
  const entries = read();
  if (!(code in entries)) return;
  delete entries[code];
  write(entries);
}

/** Every room code this device is currently unlocked for. */
export function unlockedRoomCodes(): string[] {
  return Object.keys(read());
}
