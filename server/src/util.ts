/**
 * Cryptographic helpers and small shared utilities.
 */

import { randomBytes, randomInt } from "node:crypto";
import { ROOM_CODE_SIZE, ROOM_ID_SIZE, MAX_NAME_LENGTH, hash } from "@cryo/shared";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Generate a URL-safe, cryptographically random room id (used in links). */
export function randomRoomId(size = ROOM_ID_SIZE): string {
  const bytes = randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i++) {
    out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return out;
}

/** Generate a user-friendly short room code (easier to type). */
export function randomRoomCode(size = ROOM_CODE_SIZE): string {
  const bytes = randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** Random adjective + noun display name, reused from a fixed pool. */
const ADJECTIVES = [
  "Coral", "Nova", "Lunar", "Solar", "Amber", "Brisk", "Cobalt", "Drift",
  "Echo", "Fable", "Glint", "Hazel", "Ivory", "Jade", "Kind", "Maple",
  "Nimbus", "Onyx", "Pebble", "Quartz", "Rust", "Sable", "Tide", "Umber",
  "Vivid", "Willow", "Zephyr", "Moss", "Lilac", "Fern",
];

const NOUNS = [
  "Wren", "Otter", "Fox", "Lynx", "Heron", "Ibis", "Jaeger", "Kite",
  "Lark", "Mink", "Newt", "Orca", "Pika", "Quail", "Robin", "Sable",
  "Tern", "Urial", "Vireo", "Wolf", "Yak", "Zebra", "Bison", "Crane",
  "Dove", "Ermine", "Fawn", "Gull", "Hare", "Ibex",
];

export function randomDisplayName(): string {
  const a = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const n = NOUNS[randomInt(NOUNS.length)];
  return `${a} ${n}`;
}

/** Normalize + validate a display name. Returns null if invalid. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
  if (trimmed.length === 0) return null;
  // Reject control chars and line breaks.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(trimmed)) return null;
  return trimmed;
}

/** Normalize a room code: uppercase, strip separators/dashes. */
export function normalizeCode(raw: unknown, size = ROOM_CODE_SIZE): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (code.length !== size) return null;
  return code;
}

/** Pick a deterministic avatar color index from a name. */
export function colorFor(seed: string): number {
  return hash(seed) % AVATAR_COLOR_COUNT;
}

export const AVATAR_COLOR_COUNT = 10;
