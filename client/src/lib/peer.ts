export interface StoredPeer {
  name: string;
  color: number;
  lastSeen: number;
}

const KEY = (code: string) => `cryo_peer_${code}`;

/** Last known peer of a persistent space, remembered so the "last seen" line
 * survives leaving, rejoining, and even full page reloads. */
export function getStoredPeer(code: string): StoredPeer | null {
  try {
    const raw = localStorage.getItem(KEY(code));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredPeer>;
    if (typeof p.name !== "string" || typeof p.lastSeen !== "number") return null;
    return { name: p.name, color: typeof p.color === "number" ? p.color : 0, lastSeen: p.lastSeen };
  } catch {
    return null;
  }
}

export function storePeer(code: string, peer: StoredPeer): void {
  try {
    localStorage.setItem(KEY(code), JSON.stringify(peer));
  } catch {
    // Quota/unavailable storage: last seen just won't survive a reload.
  }
}