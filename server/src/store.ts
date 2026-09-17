/**
 * Shared state store.
 *
 * Two implementations sit behind one interface:
 *
 *  - `MemoryStore` (default): every module keeps its own Maps exactly like
 *    before, so a single instance runs entirely in process memory with zero
 *    network round-trips. `REDIS_URL` unset means this mode.
 *  - `RedisStore`: the same maps act as a per-instance cache, while Redis holds
 *    the durable copy and a pub/sub channel keeps instances coherent. Writes go
 *    through to Redis and any change made elsewhere is applied locally on
 *    arrival, so reads stay synchronous and fast.
 *
 * The modules own their in-memory data; the store only persists snapshots and
 * carries events. That keeps the hot path allocation-free in memory mode and
 * avoids making the socket handlers async.
 */

import Redis from "ioredis";
import type { RedisOptions } from "ioredis";
import { config, redisConfigured } from "./config.js";
import type { SettingsDict } from "./settings.js";
import type { Session } from "./sessions.js";
import type { RoomSnapshot } from "./rooms.js";

export type StoreMode = "memory" | "redis";

/** session:* events. `upsert` carries the full record; `delete` only the id. */
export type SessionEvent =
  | { kind: "upsert"; session: Session }
  | { kind: "delete"; id: string };

export type BanEvent = { kind: "ban"; id: string } | { kind: "unban"; id: string };

export type RoomEvent =
  | { kind: "snapshot"; room: RoomSnapshot }
  | { kind: "delete"; id: string }
  | { kind: "message"; roomId: string; message: unknown }
  | { kind: "clear"; roomId: string }
  | { kind: "seen"; roomId: string; participantId: string; messageId: string }
  | { kind: "rename"; roomId: string; participantId: string; name: string };

export interface StoreEvents {
  session: (e: SessionEvent) => void;
  ban: (e: BanEvent) => void;
  settings: (s: SettingsDict) => void;
  room: (e: RoomEvent) => void;
}

export interface AppendMessageInput {
  roomId: string;
  message: unknown;
  cap: number;
  /** Remaining room lifetime in seconds (0 = keep forever). */
  ttlSeconds: number;
}

export interface Store {
  readonly mode: StoreMode;
  /** Connect (Redis) and seed the module caches from the durable copy. */
  init(): Promise<void>;
  close(): Promise<void>;
  /** Register a listener for changes made by other instances. */
  on<K extends keyof StoreEvents>(scope: K, handler: StoreEvents[K]): void;

  loadSessions(): Promise<Session[]>;
  saveSession(session: Session): Promise<void>;
  deleteSession(id: string): Promise<void>;

  loadBans(): Promise<string[]>;
  saveBan(id: string): Promise<void>;
  deleteBan(id: string): Promise<void>;

  loadSettings(): Promise<SettingsDict | null>;
  saveSettings(settings: SettingsDict): Promise<void>;

  loadRooms(): Promise<RoomSnapshot[]>;
  saveRoom(room: RoomSnapshot): Promise<void>;
  deleteRoom(id: string): Promise<void>;
  appendMessage(input: AppendMessageInput): Promise<void>;
  publishRoom(event: RoomEvent): Promise<void>;

  /** Sliding-window check. Returns true when the call is allowed. */
  rateLimit(key: string, limit: number, windowMs: number): Promise<boolean>;
}

type Handlers = Partial<Record<keyof StoreEvents, Array<(payload: unknown) => void>>>;

/** Memory mode: nothing to persist and nobody to notify. */
class MemoryStore implements Store {
  readonly mode: StoreMode = "memory";
  async init(): Promise<void> {}
  async close(): Promise<void> {}
  on(): void {}
  async loadSessions(): Promise<Session[]> {
    return [];
  }
  async saveSession(): Promise<void> {}
  async deleteSession(): Promise<void> {}
  async loadBans(): Promise<string[]> {
    return [];
  }
  async saveBan(): Promise<void> {}
  async deleteBan(): Promise<void> {}
  async loadSettings(): Promise<SettingsDict | null> {
    return null;
  }
  async saveSettings(): Promise<void> {}
  async loadRooms(): Promise<RoomSnapshot[]> {
    return [];
  }
  async saveRoom(): Promise<void> {}
  async deleteRoom(): Promise<void> {}
  async appendMessage(): Promise<void> {}
  async publishRoom(): Promise<void> {}
  private buckets = new Map<string, { count: number; resetAt: number }>();
  async rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || now >= b.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (b.count >= limit) return false;
    b.count += 1;
    return true;
  }
}

/**
 * Atomically append a message and trim the room list to the rolling cap. The
 * cap check and append share one Redis command, so two instances writing at the
 * same moment can never exceed `messageCap`.
 */
const APPEND_SCRIPT = `
local key = KEYS[1]
local cap = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
redis.call('RPUSH', key, ARGV[3])
local len = redis.call('LLEN', key)
if len > cap then redis.call('LTRIM', key, len - cap, -1) end
if ttl > 0 and redis.call('TTL', key) < 0 then redis.call('EXPIRE', key, ttl) end
return len
`;

/** Sliding-window limiter: drop old hits, count, then record if under limit. */
const RATE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then return 0 end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return 1
`;

class RedisStore implements Store {
  readonly mode: StoreMode = "redis";
  private cmd: Redis;
  private sub: Redis;
  private handlers: Handlers = {};
  private readonly p: string;

  constructor() {
    this.p = config.redisPrefix;
    // Bounded backoff: retry quickly, but never wait longer than configured so
    // a network blip recovers promptly instead of stalling for minutes.
    const opts: RedisOptions = {
      maxRetriesPerRequest: 2,
      retryStrategy: (times: number) =>
        Math.min(times * 200, config.redisMaxRetryDelayMs),
    };
    const make = (): Redis =>
      config.redisUrl
        ? new Redis(config.redisUrl, opts)
        : new Redis({
            ...opts,
            host: config.redisHost,
            port: config.redisPort,
            password: config.redisPassword || undefined,
            db: config.redisDb,
            ...(config.redisTls ? { tls: {} } : {}),
          });
    this.cmd = make();
    this.sub = make();
  }

  private channel(scope: string): string {
    return `${this.p}:events:${scope}`;
  }

  async init(): Promise<void> {
    // Surface connection problems once, clearly, instead of silently queueing
    // commands forever. ioredis retries in the background either way.
    this.cmd.on("error", (err) => console.error("[cryo] redis error:", err.message));
    this.sub.on("error", (err) => console.error("[cryo] redis sub error:", err.message));
    await Promise.all([this.cmd.ping(), this.sub.ping()]);
    await this.sub.subscribe(
      this.channel("session"),
      this.channel("ban"),
      this.channel("settings"),
      this.channel("room"),
    );
    this.sub.on("message", (ch, raw) => {
      const scope = ch.slice(this.channel("").length);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const list = this.handlers[scope as keyof StoreEvents] as
        | Array<(x: unknown) => void>
        | undefined;
      if (list) for (const h of list) h(payload);
    });
    console.log(`[cryo] redis store connected (${this.cmd.options.host ?? "url"})`);
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.sub.quit(), this.cmd.quit()]);
  }

  on<K extends keyof StoreEvents>(scope: K, handler: StoreEvents[K]): void {
    const existing = this.handlers[scope];
    if (existing) existing.push(handler as (payload: unknown) => void);
    else this.handlers[scope] = [handler as (payload: unknown) => void];
  }

  private async publish(scope: keyof StoreEvents, payload: unknown): Promise<void> {
    await this.cmd.publish(this.channel(scope), JSON.stringify(payload));
  }

  private sk(id: string): string {
    return `${this.p}:session:${id}`;
  }
  private roomKey(id: string): string {
    return `${this.p}:room:${id}`;
  }
  private roomPeople(id: string): string {
    return `${this.p}:room:${id}:p`;
  }
  private roomMessages(id: string): string {
    return `${this.p}:room:${id}:m`;
  }
  private codeKey(code: string): string {
    return `${this.p}:code:${code}`;
  }

  async loadSessions(): Promise<Session[]> {
    const prefix = `${this.p}:session:`;
    const out: Session[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await this.cmd.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
      cursor = next;
      if (keys.length === 0) continue;
      const pipe = this.cmd.pipeline();
      for (const key of keys) pipe.hgetall(key);
      const rows = await pipe.exec();
      for (let i = 0; i < keys.length; i++) {
        const h = (rows?.[i]?.[1] ?? {}) as Record<string, string>;
        if (!h || !h.name) continue;
        out.push({
          id: keys[i].slice(prefix.length),
          name: h.name,
          color: Number(h.color ?? 0),
          createdAt: Number(h.createdAt ?? 0),
        });
      }
    } while (cursor !== "0");
    return out;
  }

  async saveSession(s: Session): Promise<void> {
    const ttl = 60 * 60 * 24 * 7; // 7 days, matches IDENTITY_TTL_MS
    await this.cmd
      .multi()
      .hset(this.sk(s.id), {
        name: s.name,
        color: String(s.color),
        createdAt: String(s.createdAt),
      })
      .expire(this.sk(s.id), ttl)
      .exec();
    await this.publish("session", { kind: "upsert", session: s } satisfies SessionEvent);
  }

  async deleteSession(id: string): Promise<void> {
    await this.cmd.del(this.sk(id));
    await this.publish("session", { kind: "delete", id } satisfies SessionEvent);
  }

  async loadBans(): Promise<string[]> {
    return this.cmd.smembers(`${this.p}:bans`);
  }

  async saveBan(id: string): Promise<void> {
    await this.cmd.sadd(`${this.p}:bans`, id);
    await this.publish("ban", { kind: "ban", id } satisfies BanEvent);
  }

  async deleteBan(id: string): Promise<void> {
    await this.cmd.srem(`${this.p}:bans`, id);
    await this.publish("ban", { kind: "unban", id } satisfies BanEvent);
  }

  async loadSettings(): Promise<SettingsDict | null> {
    const h = await this.cmd.hgetall(`${this.p}:settings`);
    if (!h || Object.keys(h).length === 0) return null;
    return JSON.parse(h.json) as SettingsDict;
  }

  async saveSettings(settings: SettingsDict): Promise<void> {
    await this.cmd.hset(`${this.p}:settings`, { json: JSON.stringify(settings) });
    await this.publish("settings", settings);
  }

  async loadRooms(): Promise<RoomSnapshot[]> {
    const ids = await this.cmd.smembers(`${this.p}:rooms`);
    const out: RoomSnapshot[] = [];
    for (const id of ids) {
      const [meta, people, messages] = await Promise.all([
        this.cmd.hgetall(this.roomKey(id)),
        this.cmd.hgetall(this.roomPeople(id)),
        this.cmd.lrange(this.roomMessages(id), 0, -1),
      ]);
      // A stale index entry (room expired, keys gone) is simply skipped.
      if (!meta || !meta.code) continue;
      const persistent = meta.persistent === "1";
      out.push({
        id,
        code: meta.code,
        hostParticipantId: meta.host ?? "",
        createdAt: Number(meta.createdAt ?? 0),
        expiresAt: persistent ? 0 : Number(meta.expiresAt ?? 0),
        persistent,
        participants: Object.values(people).map((j) => JSON.parse(j)),
        messages: messages.map((j) => JSON.parse(j)),
      });
    }
    return out;
  }

  async saveRoom(room: RoomSnapshot): Promise<void> {
    const id = room.id;
    const ttl =
      room.persistent || !Number.isFinite(room.expiresAt)
        ? 0
        : Math.max(1, Math.floor((room.expiresAt - Date.now()) / 1000));
    const tx = this.cmd
      .multi()
      .hset(this.roomKey(id), {
        code: room.code,
        host: room.hostParticipantId,
        createdAt: String(room.createdAt),
        expiresAt: String(room.expiresAt),
        persistent: room.persistent ? "1" : "0",
      })
      .del(this.roomPeople(id))
      .sadd(`${this.p}:rooms`, id)
      .set(this.codeKey(room.code), id);
    if (room.participants.length > 0) {
      tx.hset(
        this.roomPeople(id),
        Object.fromEntries(room.participants.map((p) => [p.id, JSON.stringify(p)])),
      );
    }
    if (ttl > 0) {
      tx.expire(this.roomKey(id), ttl)
        .expire(this.roomPeople(id), ttl)
        .expire(this.roomMessages(id), ttl)
        .expire(this.codeKey(room.code), ttl);
    } else {
      tx.persist(this.roomKey(id))
        .persist(this.roomPeople(id))
        .persist(this.roomMessages(id))
        .persist(this.codeKey(room.code));
    }
    await tx.exec();
    await this.publish("room", { kind: "snapshot", room } satisfies RoomEvent);
  }

  async deleteRoom(id: string): Promise<void> {
    const code = await this.cmd.hget(this.roomKey(id), "code");
    const tx = this.cmd
      .multi()
      .del(this.roomKey(id))
      .del(this.roomPeople(id))
      .del(this.roomMessages(id))
      .srem(`${this.p}:rooms`, id);
    if (code) tx.del(this.codeKey(code));
    await tx.exec();
    await this.publish("room", { kind: "delete", id } satisfies RoomEvent);
  }

  async appendMessage(input: AppendMessageInput): Promise<void> {
    await this.cmd.eval(
      APPEND_SCRIPT,
      1,
      this.roomMessages(input.roomId),
      String(input.cap),
      String(input.ttlSeconds),
      JSON.stringify(input.message),
    );
  }

  async publishRoom(event: RoomEvent): Promise<void> {
    await this.publish("room", event);
  }

  async rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const member = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const res = await this.cmd.eval(
      RATE_SCRIPT,
      1,
      `${this.p}:rl:${key}`,
      String(Date.now()),
      String(windowMs),
      String(limit),
      member,
    );
    return Number(res) === 1;
  }
}

export let store: Store = redisConfigured ? new RedisStore() : new MemoryStore();

/** Swap the singleton (tests). Returns the previous store so it can be restored. */
export function setStore(next: Store): Store {
  const prev = store;
  store = next;
  return prev;
}

/** True when a real Redis backend is active (vs the in-memory fallback). */
export const redisMode = (): boolean => store.mode === "redis";
