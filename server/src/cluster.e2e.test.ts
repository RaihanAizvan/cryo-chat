/**
 * Cross-instance integration test: boots the REAL production bundle
 * (server/dist/index.mjs) twice against one shared Redis and drives an admin
 * kick of a member seated on the *other* instance through real socket.io
 * clients + the admin REST API.
 *
 * This validates cluster moderation end to end: the victim's internal
 * membership is torn down on the instance that seats them, they can no longer
 * send or receive, and no snapshot flow resurrects them.
 *
 * Redis requirements: the suite needs a reachable `REDIS_URL` (defaults to
 * `redis://127.0.0.1:6379/15`). It self-skips when Redis is unreachable or the
 * bundle hasn't been built, mirroring integration.test.ts.
 */
import { describe, beforeAll, afterAll, expect, it } from "vitest";
import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  ErrorPayload,
  ServerToClientEventMap,
} from "@cryo/shared";

const ADMIN_KEY = "test-admin-key-2026";
const distPath = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));

const DEFAULT_REDIS = "redis://127.0.0.1:6379/15";
const redisUrl =
  process.env.REDIS_URL ??
  (process.env.REDIS_HOST
    ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT ?? "6379"}/${
        process.env.REDIS_DB ?? 0
      }`
    : DEFAULT_REDIS);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

/** Cheap TCP PING so the suite can skip cleanly when there's no Redis around. */
function probeRedis(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    const sock = createConnection(
      { host: parsed.hostname, port: Number(parsed.port || 6379) },
      () => sock.write("PING\r\n"),
    );
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(3000, () => finish(false));
    sock.on("data", (d) => finish(d.toString().includes("PONG")));
    sock.on("error", () => finish(false));
    sock.on("close", () => finish(false));
  });
}

interface ServerHandle {
  port: number;
  stop: () => Promise<void>;
}

async function bootInstance(extraEnv: Record<string, string>): Promise<ServerHandle> {
  const port = await freePort();
  const child = fork(distPath, [], {
    env: { ...process.env, PORT: String(port), ADMIN_KEY, MESSAGE_CAP: "50", ...extraEnv },
    silent: true,
  });
  const isUp = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server failed to boot")), 15_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("server listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("server exited before listening"));
    });
  });
  await isUp;
  const stop = () =>
    new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  return { port, stop };
}

function once<A>(s: Socket, event: string): Promise<A> {
  return new Promise((resolve) => s.once(event, (d: A) => resolve(d)));
}

function makeClient(port: number) {
  const s = createClient(`http://127.0.0.1:${port}`, {
    path: "/socket.io",
    transports: ["websocket"],
    timeout: 8000,
  });
  const connected = new Promise<Socket>((resolve, reject) => {
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
  const init = once<{ sessionId: string; name: string }>(s, "session:init");
  return { socket: s, connected, init };
}

/** Resolves after `ms` if nothing arrived; rejects if the event fired early. */
function expectNoEvent(s: Socket, event: string, label: string, ms = 900): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.off(event, handler);
      resolve();
    }, ms);
    const handler = () => {
      clearTimeout(timer);
      s.off(event, handler);
      reject(new Error(`${label}: unexpected "${event}" after kick`));
    };
    s.on(event, handler);
  });
}

function adminFor(port: number) {
  return async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/admin${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        "x-admin-key": ADMIN_KEY,
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return {
      status: res.status,
      body: (res.status === 204
        ? null
        : await res.json().catch(() => ({}))) as unknown,
    };
  };
}

/** Admin room-detail view, as rendered by the server's admin API. */
interface AdminRoomView {
  room: {
    id: string;
    code: string;
    participants: { id: string; name: string }[];
  };
}

const built = existsSync(distPath);
const redisUp = await probeRedis(redisUrl);
// A short-lived prefix keeps parallel/local runs isolated on a shared Redis.
const prefix = `cryo-cluster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const runCluster = built && redisUp ? describe : describe.skip;

runCluster("cross-instance moderation (shared Redis)", () => {
  let instA: ServerHandle;
  let instB: ServerHandle;
  let adminA: ReturnType<typeof adminFor>;

  beforeAll(async () => {
    instA = await bootInstance({
      REDIS_URL: redisUrl,
      REDIS_PREFIX: prefix,
      INSTANCE_ID: "cluster-test-a",
    });
    instB = await bootInstance({
      REDIS_URL: redisUrl,
      REDIS_PREFIX: prefix,
      INSTANCE_ID: "cluster-test-b",
    });
    adminA = adminFor(instA.port);
  }, 40_000);

  afterAll(async () => {
    await Promise.all([instA.stop(), instB.stop()]);
  }, 15_000);

  it("kicks a member seated on another instance so they cannot send or stay", async () => {
    // The admin (alice) is on instance A; the victim (bob) on instance B.
    const aliceC = makeClient(instA.port);
    const bobC = makeClient(instB.port);
    const alice = await aliceC.connected;
    const bob = await bobC.connected;
    await aliceC.init;
    const bobPid = (await bobC.init).sessionId;

    // Alice creates a room; bob joins it from the other instance.
    const aliceJoined = once<ServerToClientEventMap["room:joined"]>(alice, "room:joined");
    alice.emit("room:create", {});
    const room = (await aliceJoined).room;

    const bobJoined = once<ServerToClientEventMap["room:joined"]>(bob, "room:joined");
    const aliceSeesBob = once<ServerToClientEventMap["presence:joined"]>(alice, "presence:joined");
    bob.emit("room:join", { code: room.code });
    await bobJoined;
    const pk = await aliceSeesBob;
    expect(pk.participant.id).toBe(bobPid);

    // Admin kicks bob from instance A.
    const bobKicked = once<ServerToClientEventMap["room:kicked"]>(bob, "room:kicked");
    const aliceSawLeft = once<ServerToClientEventMap["presence:left"]>(alice, "presence:left");
    const kick = await adminA(`/rooms/${room.id}/kick`, {
      body: { participantId: bobPid, reason: "spam" },
    });
    expect(kick.status).toBe(200);

    // Bob is told, and the room sees him gone — across the cluster.
    const kickNotice = await bobKicked;
    expect(kickNotice.roomId).toBe(room.id);
    expect(kickNotice.reason).toBe("spam");
    const left = await aliceSawLeft;
    expect(left.participantId).toBe(bobPid);

    // The authoritative room snapshot no longer lists bob.
    const detailRes = await adminA(`/rooms/${room.id}`);
    expect(detailRes.status).toBe(200);
    const detail = detailRes.body as AdminRoomView;
    expect(detail.room.participants.some((p) => p.id === bobPid)).toBe(false);
    expect(detail.room.participants).toHaveLength(1);

    // Bob can't send anymore (rejected as not_in_room)...
    const bobErr = once<ErrorPayload>(bob, "error");
    const aliceNoSneak = expectNoEvent(alice, "message:new", "victim message leaked through");
    bob.emit("message:send", { roomId: room.id, text: "still here", clientId: "sneaky-1" });
    expect((await bobErr).code).toBe("not_in_room");
    await aliceNoSneak;

    // ...and bob no longer receives room broadcasts (alice posts a message).
    const bobNoMsg = expectNoEvent(bob, "message:new", "victim received a broadcast");
    const aliceMsg = once<ServerToClientEventMap["message:new"]>(alice, "message:new");
    alice.emit("message:send", { roomId: room.id, text: "after kick", clientId: "post-1" });
    const posted = await aliceMsg;
    expect(posted.message.text).toBe("after kick");
    await bobNoMsg;

    // A later participant persist (alice renames -> snapshot publish) must not
    // resurrect bob anywhere either.
    alice.emit("session:name", { name: "Alice Deux" });
    await new Promise((r) => setTimeout(r, 600));
    const afterRes = await adminA(`/rooms/${room.id}`);
    const after = afterRes.body as AdminRoomView;
    expect(after.room.participants.some((p) => p.id === bobPid)).toBe(false);

    alice.disconnect();
    bob.disconnect();
  }, 60_000);
});