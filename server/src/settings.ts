/**
 * Runtime-tunable settings.
 *
 * Boot defaults come from `config.ts` (env). The admin console may overwrite
 * them live via the admin API; overrides live in memory and apply until the
 * next restart. This module is the single source of truth for the values the
 * rest of the server reads at run time.
 */

import { MAX_MESSAGE_LENGTH } from "@cryo/shared";
import { config } from "./config.js";

export interface SettingsDict {
  maxMessageLength: number;
  maxRoomSize: number;
  roomTtlMs: number;
  messageTtlMs: number;
  messageCap: number;
  maxSocketsPerIp: number;
  messageRateLimit: number;
  messageRateWindowMs: number;
  reservedRoomCode: string;
  reservedRoomEnabled: boolean;
  sweepIntervalMs: number;
}

const MIN_MINUTES = 1;
const MAX_MINUTES = 7 * 24 * 60; // 7 days
const MIN_ROOM_SIZE = 2;
const MAX_ROOM_SIZE = 200;
const MIN_CAP = 20;
const MAX_CAP = 5000;
const MIN_RATE = 1;
const MAX_RATE = 500;
const MIN_WINDOW_S = 1;
const MAX_WINDOW_S = 3600;
const MIN_SOCKETS_PER_IP = 1;
const MAX_SOCKETS_PER_IP = 200;

/** Sanitize a reserved room code (empty string disables the concept). */
function normalizeReservedCode(raw: unknown): string {
  if (typeof raw !== "string") return config.reservedRoomCode;
  const clean = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (clean.length !== 4) return config.reservedRoomCode;
  return clean;
}

function base(): SettingsDict {
  return {
    maxMessageLength: Math.max(1, Math.min(MAX_MESSAGE_LENGTH, Number(process.env.MAX_MESSAGE_LENGTH ?? MAX_MESSAGE_LENGTH))),
    maxRoomSize: Math.min(MAX_ROOM_SIZE, Math.max(MIN_ROOM_SIZE, config.maxRoomSize)),
    roomTtlMs: config.roomTtlMs,
    messageTtlMs: config.messageTtlMs,
    messageCap: config.messageCap,
    maxSocketsPerIp: Math.min(MAX_SOCKETS_PER_IP, Math.max(MIN_SOCKETS_PER_IP, config.maxSocketsPerIp)),
    messageRateLimit: config.messageRateLimit,
    messageRateWindowMs: config.messageRateWindowMs,
    reservedRoomCode: config.reservedRoomCode,
    reservedRoomEnabled: true,
    sweepIntervalMs: config.sweepIntervalMs,
  };
}

let current: SettingsDict = base();

export function getSettings(): Readonly<SettingsDict> {
  return current;
}

/** Clamp a number into a range, rounding to an integer. Returns fallback on NaN. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Apply a validated partial update. Returns an error string when rejected. */
export function updateSettings(patch: Record<string, unknown>): { ok: true; settings: SettingsDict } | { ok: false; error: string } {
  const next: SettingsDict = { ...current };
  const errors: string[] = [];

  if (patch.maxMessageLength !== undefined) {
    // The protocol's client cap (shared MAX_MESSAGE_LENGTH) is the hard ceiling;
    // the admin may only lower it from there.
    next.maxMessageLength = clampInt(
      patch.maxMessageLength, 1, MAX_MESSAGE_LENGTH, next.maxMessageLength,
    );
  }
  if (patch.maxRoomSize !== undefined) {
    next.maxRoomSize = clampInt(patch.maxRoomSize, MIN_ROOM_SIZE, MAX_ROOM_SIZE, next.maxRoomSize);
  }
  if (patch.roomTtlMinutes !== undefined) {
    const mins = clampInt(patch.roomTtlMinutes, MIN_MINUTES, MAX_MINUTES, next.roomTtlMs / 60_000);
    next.roomTtlMs = mins * 60_000;
  }
  if (patch.messageTtlMinutes !== undefined) {
    const mins = clampInt(patch.messageTtlMinutes, MIN_MINUTES, MAX_MINUTES, next.messageTtlMs / 60_000);
    next.messageTtlMs = mins * 60_000;
  }
  if (patch.messageCap !== undefined) {
    next.messageCap = clampInt(patch.messageCap, MIN_CAP, MAX_CAP, next.messageCap);
  }
  if (patch.maxSocketsPerIp !== undefined) {
    next.maxSocketsPerIp = clampInt(patch.maxSocketsPerIp, MIN_SOCKETS_PER_IP, MAX_SOCKETS_PER_IP, next.maxSocketsPerIp);
  }
  if (patch.messageRateLimit !== undefined) {
    next.messageRateLimit = clampInt(patch.messageRateLimit, MIN_RATE, MAX_RATE, next.messageRateLimit);
  }
  if (patch.messageRateWindowSeconds !== undefined) {
    next.messageRateWindowMs = clampInt(patch.messageRateWindowSeconds, MIN_WINDOW_S, MAX_WINDOW_S, next.messageRateWindowMs / 1000) * 1000;
  }
  if (patch.reservedRoomCode !== undefined) {
    if (typeof patch.reservedRoomCode !== "string") {
      errors.push("reservedRoomCode must be a string");
    } else {
      const clean = patch.reservedRoomCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (clean.length !== 4) errors.push("Reserved code must be exactly 4 letters or digits.");
      else next.reservedRoomCode = clean;
    }
  }
  if (patch.reservedRoomEnabled !== undefined) {
    if (typeof patch.reservedRoomEnabled !== "boolean") {
      errors.push("reservedRoomEnabled must be a boolean");
    } else {
      next.reservedRoomEnabled = patch.reservedRoomEnabled;
    }
  }

  if (errors.length > 0) return { ok: false, error: errors.join(" ") };
  current = next;
  return { ok: true, settings: current };
}

/** True when `code` is the (enabled) preserved room code. */
export function isReservedCode(code: string): boolean {
  return current.reservedRoomEnabled && code === current.reservedRoomCode;
}

/** Effective message-length ceiling (min of protocol cap and admin setting). */
export function maxMessageLength(): number {
  return Math.max(1, Math.min(MAX_MESSAGE_LENGTH, current.maxMessageLength));
}

export { normalizeReservedCode };