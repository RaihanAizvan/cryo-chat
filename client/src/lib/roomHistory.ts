/**
 * Recently visited rooms, persisted to localStorage.
 *
 * Rooms are ephemeral on the server, so the only place a user's past rooms can
 * live is on-device. We remember every room they created or joined (id, code,
 * status metadata) so the home screen can offer one-tap reconnection and a
 * glanceable "open vs expired" status.
 *
 * Uses the same external-store pattern as lib/store.ts — no state library.
 */

import { useSyncExternalStore } from "react";
import type { AvatarColor, PublicRoom, RoomStatus } from "@cryo/shared";

const STORAGE_KEY = "cryo_history_v1";
/** Keep the list tight and WhatsApp-like: at most 10 recent rooms. */
const MAX_ENTRIES = 10;

export type HistoryStatus = "live" | "closed" | "expired";

export interface HistoryEntry {
  /** Room id — also the /r/:id deep-link path. */
  id: string;
  /** 4-digit join code. */
  code: string;
  color: AvatarColor;
  /** When the room was first created/joined. */
  createdAt: number;
  /** When the user was last inside the room. */
  lastVisitedAt: number;
  /** Millisecond epoch after which the room is presumed gone. */
  expiresAt: number;
  /** Last known number of participants. */
  lastParticipants: number;
  isHost: boolean;
  /** True for the preserved special room: never auto-expires. */
  persistent: boolean;
  /** True once the room is known to be closed (not just expired). */
  closed: boolean;
}

type Listener = () => void;

class RoomHistoryStore {
  private entries: HistoryEntry[];
  private listeners = new Set<Listener>();

  constructor() {
    this.entries = load();
  }

  get(): HistoryEntry[] {
    return this.entries;
  }

  private commit(): void {
    save(this.entries);
    for (const l of this.listeners) l();
  }

  /** Record a room when it's entered (created or joined). */
  record(room: PublicRoom, meta: { isHost: boolean; at?: number }): void {
    const at = meta.at ?? Date.now();
    const idx = this.entries.findIndex((e) => e.id === room.id);
    const entry: HistoryEntry = {
      id: room.id,
      code: room.code,
      color: room.participants.find((p) => p.id)?.color ?? 0,
      createdAt: idx >= 0 ? this.entries[idx].createdAt : room.createdAt,
      lastVisitedAt: at,
      // Persistent rooms never expire; a far-future sentinel keeps them "live".
      expiresAt: room.persistent ? Number.MAX_SAFE_INTEGER : room.expiresAt,
      lastParticipants: room.participants.length,
      isHost: meta.isHost,
      persistent: room.persistent,
      closed: false,
    };
    if (idx >= 0) this.entries.splice(idx, 1);
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES;
    this.commit();
  }

  /** Refresh metadata for the room the user is currently in. */
  touch(room: PublicRoom, participantCount: number): void {
    const idx = this.entries.findIndex((e) => e.id === room.id);
    if (idx < 0) {
      this.record(room, { isHost: room.isHost });
      return;
    }
    const e = this.entries[idx];
    const updated: HistoryEntry = {
      ...e,
      lastVisitedAt: Date.now(),
      lastParticipants: participantCount,
      expiresAt: room.persistent ? Number.MAX_SAFE_INTEGER : room.expiresAt,
      persistent: room.persistent,
      closed: false,
    };
    this.entries.splice(idx, 1);
    this.entries.unshift(updated);
    this.commit();
  }

  /** Apply live server status to saved rooms (open/closed + participant counts). */
  applyStatus(statuses: RoomStatus[]): void {
    let changed = false;
    for (const st of statuses) {
      const idx = this.entries.findIndex(
        (e) => e.id === st.roomId || (st.code && e.code === st.code),
      );
      if (idx < 0) continue;
      const e = this.entries[idx];
      const updated: HistoryEntry = {
        ...e,
        lastParticipants: st.exists ? st.participantCount : e.lastParticipants,
        closed: !st.exists,
        // A persistent room is never considered expired (stays "always open"),
        // but it IS closed when the server reports it gone.
        expiresAt: st.exists
          ? st.persistent
            ? Number.MAX_SAFE_INTEGER
            : st.expiresAt
          : Date.now(),
      };
      this.entries.splice(idx, 1);
      this.entries.unshift(updated);
      changed = true;
    }
    if (changed) this.commit();
  }

  remove(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.commit();
  }

  clear(): void {
    this.entries = [];
    this.commit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const store = new RoomHistoryStore();

export function useRoomHistory(): HistoryEntry[] {
  return useSyncExternalStore(
    store.subscribe.bind(store),
    store.get.bind(store),
    store.get.bind(store),
  );
}

/** Record a room the user just created or joined. */
export function recordRoomHistory(
  room: PublicRoom,
  meta: { isHost: boolean },
): void {
  store.record(room, meta);
}

/** Update the room the user is currently active in. */
export function touchRoomHistory(room: PublicRoom, participantCount: number): void {
  store.touch(room, participantCount);
}

/** Apply live server status snapshots to saved rooms. */
export function applyRoomStatus(statuses: RoomStatus[]): void {
  store.applyStatus(statuses);
}

export function removeRoomHistory(id: string): void {
  store.remove(id);
}

export function clearRoomHistory(): void {
  store.clear();
}

/** Resolve the live/closed/expired status of a history entry right now. */
export function roomStatus(entry: HistoryEntry, now = Date.now()): HistoryStatus {
  if (entry.closed) return "closed";
  return now < entry.expiresAt ? "live" : "expired";
}

function load(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function save(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* storage may be unavailable (private mode) — fail silently */
  }
}

function isValidEntry(e: unknown): e is HistoryEntry {
  if (!e || typeof e !== "object") return false;
  const rec = e as Record<string, unknown>;
  return (
    typeof rec.id === "string" &&
    typeof rec.code === "string" &&
    typeof rec.lastVisitedAt === "number" &&
    typeof rec.expiresAt === "number"
  );
}
