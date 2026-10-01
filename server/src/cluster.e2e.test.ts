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
  // `silent` gives the child pipes that nobody reads. An undrained stderr fills
  // its buffer and stalls the child mid-test, which surfaces as a mystery
  // timeout rather than as a server error.
  child.stderr?.resume();
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

function makeClient(port: number, sessionId?: string) {
  const s = createClient(`http://127.0.0.1:${port}`, {
    path: "/socket.io",
    transports: ["websocket"],
    timeout: 8000,
    ...(sessionId ? { query: { sessionId } } : {}),
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
runCluster("room passwords are shared across instances (shared Redis)", () => {
  /** Like `once`, but names the event that never arrived instead of hanging. */
  function soon<A>(s: Socket, event: string, ms = 10_000): Promise<A> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`no "${event}" within ${ms}ms`)), ms);
      s.once(event, (d: A) => {
        clearTimeout(t);
        res(d);
      });
    });
  }

  let instA: ServerHandle;
  let instB: ServerHandle;
  let adminA: ReturnType<typeof adminFor>;
  let adminB: ReturnType<typeof adminFor>;

  beforeAll(async () => {
    instA = await bootInstance({
      REDIS_URL: redisUrl,
      REDIS_PREFIX: prefix,
      INSTANCE_ID: "roomkey-cluster-a",
    });
    instB = await bootInstance({
      REDIS_URL: redisUrl,
      REDIS_PREFIX: prefix,
      INSTANCE_ID: "roomkey-cluster-b",
    });
    adminA = adminFor(instA.port);
    adminB = adminFor(instB.port);
  }, 40_000);

  afterAll(async () => {
    await Promise.all([instA.stop(), instB.stop()]);
  }, 15_000);

  it("enforces one password and one signing key on every instance", async () => {
    // Create the room on A, then lock it through A's admin API only. B has
    // never heard of this room: it learns the password from the shared store,
    // exactly as a second instance behind a load balancer would.
    const owner = makeClient(instA.port);
    const socketO = await owner.connected;
    await owner.init;
    const created = soon<{ room: { id: string; code: string } }>(socketO, "room:joined");
    socketO.emit("room:create", {});
    const room = (await created).room;
    const locked = await adminA(`/rooms/${room.id}/password`, {
      method: "PUT",
      body: { password: "cold brew" },
    });
    expect(locked.status).toBe(200);

    // Instance B's own room list shows it as locked: the hash reached Redis and
    // came back, rather than the room quietly being wide open.
    const listB = await adminB("/rooms");
    const rowB = (listB.body as { rooms: { id: string; locked: boolean }[] }).rooms.find(
      (r) => r.id === room.id,
    );
    expect(rowB?.locked).toBe(true);

    // ...and B enforces it.
    const bob = makeClient(instB.port);
    const socketB = await bob.connected;
    const bobInit = await bob.init;
    const denied = soon<ErrorPayload>(socketB, "error");
    socketB.emit("room:join", { roomId: room.id });
    expect((await denied).code).toBe("room_password_required");

    // Unlocking on B yields a token that A accepts: the signing key is derived
    // from the shared password hash, not from per-instance state.
    const joined = soon<{ room: { code: string } }>(socketB, "room:joined");
    const access = soon<{ token: string }>(socketB, "room:access");
    socketB.emit("room:join", { roomId: room.id, password: "cold brew" });
    expect((await joined).room.code).toBe(room.code);
    const { token } = await access;

    // Same identity, landed on the *other* instance: this is the leg that proves
    // the token is not signed with per-instance state.
    const alice = makeClient(instA.port, bobInit.sessionId);
    const socketA = await alice.connected;
    await alice.init;
    const joinedA = soon<{ room: { code: string } }>(socketA, "room:joined");
    socketA.emit("room:join", { roomId: room.id, token });
    expect((await joinedA).room.code).toBe(room.code);

    // A revoke on A invalidates the token B handed out. Checked from a *fresh*
    // identity: an identity that is already a member is deliberately re-seated
    // on reconnect by the server's recovery path, without a password check.
    const revoke = await adminA(`/rooms/${room.id}/revoke-access`, { method: "POST" });
    expect(revoke.status).toBe(200);
    await new Promise((r) => setTimeout(r, 500));
    const dave = makeClient(instB.port);
    const socketD = await dave.connected;
    await dave.init;
    const afterRevoke = soon<ErrorPayload>(socketD, "error");
    socketD.emit("room:join", { roomId: room.id, token });
    expect((await afterRevoke).code).toBe("room_password_required");

    // Rotating the password on A changes what B accepts, and both instances end
    // up signing with the new hash.
    const rotated = await adminA(`/rooms/${room.id}/password`, {
      method: "PUT",
      body: { password: "new brew" },
    });
    expect(rotated.status).toBe(200);
    await new Promise((r) => setTimeout(r, 500));
    const erin = makeClient(instB.port);
    const socketE = await erin.connected;
    const erinInit = await erin.init;
    const stale = soon<ErrorPayload>(socketE, "error");
    socketE.emit("room:join", { roomId: room.id, password: "cold brew" });
    expect((await stale).code).toBe("room_password_invalid");
    const joinedE = soon<{ room: { code: string } }>(socketE, "room:joined");
    const accessE = soon<{ token: string }>(socketE, "room:access");
    socketE.emit("room:join", { roomId: room.id, password: "new brew" });
    expect((await joinedE).room.code).toBe(room.code);
    const erinToken = (await accessE).token;
    const frank = makeClient(instA.port, erinInit.sessionId);
    const socketF = await frank.connected;
    await frank.init;
    const joinedF = soon<{ room: { code: string } }>(socketF, "room:joined");
    socketF.emit("room:join", { roomId: room.id, token: erinToken });
    expect((await joinedF).room.code).toBe(room.code);

    socketO.disconnect();
    socketA.disconnect();
    socketB.disconnect();
    socketD.disconnect();
    socketE.disconnect();
    socketF.disconnect();
  }, 60_000);

  it("keeps each room's password to itself", async () => {
    // Two rooms, locked from the same admin key on two instances. Neither
    // password opens the other room.
    const mk = async (port: number) => {
      const c = makeClient(port);
      const s = await c.connected;
      await c.init;
      const joined = soon<{ room: { id: string; code: string } }>(s, "room:joined");
      s.emit("room:create", {});
      return { socket: s, room: (await joined).room };
    };
    const one = await mk(instA.port);
    const two = await mk(instB.port);
    expect(
      (await adminA(`/rooms/${one.room.id}/password`, { method: "PUT", body: { password: "alpha pass" } }))
        .status,
    ).toBe(200);
    expect(
      (await adminB(`/rooms/${two.room.id}/password`, { method: "PUT", body: { password: "bravo pass" } }))
        .status,
    ).toBe(200);

    const tryPassword = async (roomId: string, password: string): Promise<string> => {
      const c = makeClient(instB.port);
      const s = await c.connected;
      await c.init;
      const outcome = Promise.race([
        soon<{ room: { id: string } }>(s, "room:joined", 10_000).then(() => "granted"),
        soon<ErrorPayload>(s, "error", 10_000).then((e) => e.code),
      ]);
      s.emit("room:join", { roomId, password });
      const result = await outcome;
      s.disconnect();
      return result;
    };

    expect(await tryPassword(one.room.id, "alpha pass")).toBe("granted");
    expect(await tryPassword(two.room.id, "alpha pass")).toBe("room_password_invalid");
    expect(await tryPassword(two.room.id, "bravo pass")).toBe("granted");
    expect(await tryPassword(one.room.id, "bravo pass")).toBe("room_password_invalid");

    one.socket.disconnect();
    two.socket.disconnect();
  }, 60_000);
});
