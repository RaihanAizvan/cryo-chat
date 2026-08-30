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
import type { AvatarColor, PublicRoom } from "@cryo/shared";

const STORAGE_KEY = "cryo_history_v1";
const MAX_ENTRIES = 12;

export type RoomStatus = "live" | "expired";

export interface HistoryEntry {
  /** Room id — also the /r/:id deep-link path. */
  id: string;
  /** 8-char join code. */
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
  /** True for the preserved "private room" (fixed code, always available). */
  isPrivate?: boolean;
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
      expiresAt: room.expiresAt,
      lastParticipants: room.participants.length,
      isHost: meta.isHost,
      isPrivate: room.isPrivate ?? false,
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
      expiresAt: room.expiresAt,
      isPrivate: room.isPrivate ?? e.isPrivate,
    };
    this.entries.splice(idx, 1);
    this.entries.unshift(updated);
    this.commit();
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

export function removeRoomHistory(id: string): void {
  store.remove(id);
}

export function clearRoomHistory(): void {
  store.clear();
}

/** Resolve the live/expired status of a history entry right now. */
export function roomStatus(entry: HistoryEntry, now = Date.now()): RoomStatus {
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
