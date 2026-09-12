/**
 * Admin audit trail + usage analytics.
 *
 * Records a bounded, in-memory log of the events an admin cares about (join /
 * leave timing, message traffic, moderation actions) plus rolling per-minute
 * buckets and split counters for the analytics view. Everything resets on
 * process restart, matching the app's ephemeral, in-memory design.
 */

import type { AdminAuditEvent, AdminAuditKind, AdminSeriesBucket } from "@cryo/shared";

const MAX_EVENTS = 5_000;
const BUCKET_MINUTES = 120;

const events: AdminAuditEvent[] = [];
let seq = 0;

/** Cumulative counters (survive event pruning). */
const counts = {
  messages: 0,
  uploads: 0,
  joins: 0,
  leaves: 0,
  roomsCreated: 0,
  sessionsCreated: 0,
};

/** Message-type split (analytics). */
const splits: Record<string, number> = {
  text: 0,
  image: 0,
  gif: 0,
  sticker: 0,
  voice: 0,
};

/** Per-room message traffic (analytics "busiest rooms"). bounded below. */
const roomTraffic = new Map<string, { code: string; count: number }>();

/** Per-session activity for the user list. */
const userMessages = new Map<string, number>();
const userUploads = new Map<string, number>();
const userLastActive = new Map<string, number>();

interface Bucket extends AdminSeriesBucket {
  messages: number;
  joins: number;
  leaves: number;
  uploads: number;
}

/** Per-minute buckets, oldest-first. */
const buckets: Bucket[] = [];

function minuteKey(ts = Date.now()): number {
  return Math.floor(ts / 60_000);
}

function bucketFor(minute: number): Bucket {
  let b = buckets[buckets.length - 1];
  if (!b || b.ts !== minute) {
    b = { ts: minute, messages: 0, joins: 0, leaves: 0, uploads: 0 };
    buckets.push(b);
    if (buckets.length > BUCKET_MINUTES) buckets.shift();
  }
  return b;
}

export interface AuditInput {
  kind: AdminAuditKind;
  message: string;
  actor?: string;
  roomId?: string;
  roomCode?: string;
  sessionId?: string;
  /** Free-form detail (e.g. attachment type, settings diff). */
  detail?: string;
}

export function record(input: AuditInput): void {
  const ts = Date.now();
  events.push({
    id: `a${++seq}`,
    ts,
    kind: input.kind,
    message: input.message,
    actor: input.actor,
    roomId: input.roomId,
    roomCode: input.roomCode,
    sessionId: input.sessionId,
    detail: input.detail,
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);

  const b = bucketFor(minuteKey(ts));
  switch (input.kind) {
    case "message:send":
      counts.messages += 1;
      b.messages += 1;
      {
        const split = (input.detail && input.detail in splits ? input.detail : "text") as keyof typeof splits;
        splits[split] += 1;
      }
      if (input.sessionId) {
        userMessages.set(input.sessionId, (userMessages.get(input.sessionId) ?? 0) + 1);
        userLastActive.set(input.sessionId, ts);
      }
      if (input.roomId) {
        const t = roomTraffic.get(input.roomId);
        if (t) t.count += 1;
        else {
          if (roomTraffic.size >= 500) {
            // Drop the smallest room to bound memory.
            let minCount = Number.POSITIVE_INFINITY;
            let minKey = "";
            for (const [k, v] of roomTraffic) {
              if (v.count < minCount || (v.count === minCount && k < minKey)) {
                minCount = v.count;
                minKey = k;
              }
            }
            roomTraffic.delete(minKey);
          }
          roomTraffic.set(input.roomId, { code: input.roomCode ?? "", count: 1 });
        }
      }
      break;
    case "media:upload":
      counts.uploads += 1;
      b.uploads += 1;
      if (input.sessionId) {
        userUploads.set(input.sessionId, (userUploads.get(input.sessionId) ?? 0) + 1);
        userLastActive.set(input.sessionId, ts);
      }
      break;
    case "room:joined":
      counts.joins += 1;
      b.joins += 1;
      if (input.sessionId) userLastActive.set(input.sessionId, ts);
      break;
    case "room:left":
      counts.leaves += 1;
      b.leaves += 1;
      break;
    case "room:created":
      counts.roomsCreated += 1;
      break;
    case "session:created":
      counts.sessionsCreated += 1;
      break;
    default:
      break;
  }
}

/** Newest-first event log. */
export function recent(limit = 200): AdminAuditEvent[] {
  return events.slice(-limit).reverse();
}

/** Filtered events: restrict kinds and/or only newer than `since`. */
export function query(opts: { kinds?: Set<AdminAuditKind>; limit?: number; since?: number } = {}): AdminAuditEvent[] {
  const limit = opts.limit ?? 200;
  const out: AdminAuditEvent[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = events[i];
    if (opts.since && e.ts < opts.since) continue;
    if (opts.kinds && !opts.kinds.has(e.kind)) continue;
    out.push(e);
  }
  return out;
}

/** Per-minute buckets for analytics, zero-filled for gaps over the window. */
export function series(now = Date.now()): AdminSeriesBucket[] {
  const currentMinute = minuteKey(now);
  const out: AdminSeriesBucket[] = [];
  for (let m = currentMinute - (BUCKET_MINUTES - 1); m <= currentMinute; m++) {
    const b = buckets.find((x) => x.ts === m);
    out.push(
      b
        ? { ts: b.ts, messages: b.messages, joins: b.joins, leaves: b.leaves, uploads: b.uploads }
        : { ts: m * 60_000, messages: 0, joins: 0, leaves: 0, uploads: 0 },
    );
  }
  return out;
}

export function splitsTotals(): { text: number; image: number; gif: number; sticker: number; voice: number } {
  return {
    text: splits.text,
    image: splits.image,
    gif: splits.gif,
    sticker: splits.sticker,
    voice: splits.voice,
  };
}

/** Busiest rooms by message volume (newest-burst biased within the bounded map). */
export function topRooms(limit = 10): { roomId: string; code: string; count: number }[] {
  return [...roomTraffic.entries()]
    .map(([roomId, v]) => ({ roomId, code: v.code, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function totals(): typeof counts {
  return { ...counts };
}

export function userStats(sessionId: string): { messages: number; uploads: number; lastActiveAt?: number } {
  return {
    messages: userMessages.get(sessionId) ?? 0,
    uploads: userUploads.get(sessionId) ?? 0,
    lastActiveAt: userLastActive.get(sessionId),
  };
}