/**
 * Full-stack integration test: boots the REAL production bundle
 * (server/dist/index.mjs, the same artifact `npm run build` produces) on an
 * ephemeral port and drives it with real socket.io clients + the admin REST
 * API. This validates the shipped artifact, not just source.
 */
import { describe, beforeAll, afterAll, expect, it } from "vitest";
import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { io as createClient, type Socket } from "socket.io-client";
import type { ErrorPayload, ServerToClientEventMap } from "@cryo/shared";

const ADMIN_KEY = "test-admin-key-2026";
const distPath = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));

/**
 * This suite boots the production bundle. CI always builds before testing, so
 * the dist exists there; for a bare local `npm test` (no build yet) we skip
 * gracefully instead of failing on a missing artifact.
 */
const runIntegration = existsSync(distPath) ? describe : describe.skip;

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

interface ServerHandle {
  port: number;
  stop: () => Promise<void>;
  /** Whatever the server wrote to stderr, for when a test needs to explain itself. */
  stderr: () => string;
}

async function bootServer(extraEnv: Record<string, string> = {}): Promise<ServerHandle> {
  const port = await freePort();
  // A fresh key namespace per boot. These tests run against whatever Redis
  // `.env` points at — including a shared remote one — so without this every
  // run would inherit the last run's rooms and code claims.
  const prefix = extraEnv.REDIS_PREFIX ?? `cryo:test:${randomUUID().slice(0, 8)}:`;
  const child = fork(distPath, [], {
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_KEY,
      MESSAGE_CAP: "50",
      REDIS_PREFIX: prefix,
      ...extraEnv,
    },
    silent: true,
  });
  // Nobody reads a child's stderr, and a full pipe buffer blocks the child
  // mid-test — a stall that looks like a hung request. Drain it and keep it.
  const errs: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => {
    errs.push(chunk.toString());
    if (errs.length > 50) errs.shift();
  });
  // Wait for the listen log line so clients never race the bind.
  const isUp = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server failed to boot")), 10_000);
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
  return { port, stop, stderr: () => errs.join("") };
}

function once<A>(s: Socket, event: string): Promise<A> {
  return new Promise((resolve) => s.once(event, (d: A) => resolve(d)));
}

/**
 * Create a client socket with all the room-lifecycle listeners attached up
 * front. The server sends `session:init` immediately after the CONNECT ack —
 * sometimes in the same tick as "connect" — so listeners must be registered
 * at creation time or we can miss event delivery.
 */
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
  const init = once<ServerToClientEventMap["session:init"]>(s, "session:init");
  return { socket: s, connected, init };
}

/** Same identity, fresh socket: what a reload or a new tab looks like. */
function makeClientWithSession(port: number, sessionId: string) {
  return makeClient(port, sessionId);
}

interface AdminSettingsView {
  voiceNotesEnabled?: boolean;
  maxRoomSize?: number;
  reservedRoomCode?: string;
  reservedRoomPasswordSet?: boolean;
}
type AdminBody = Record<string, unknown> & { settings?: AdminSettingsView };
let handle: ServerHandle;
let admin: (
  path: string,
  opts?: { method?: string; body?: unknown; key?: string },
) => Promise<{ status: number; body: AdminBody }>;

beforeAll(async () => {
  handle = await bootServer();
  admin = async (path, opts = {}) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/admin${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        "x-admin-key": opts.key ?? ADMIN_KEY,
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const body = res.status === 204 ? null : await res.json().catch(() => ({}));
    return { status: res.status, body };
  };
}, 30_000);

afterAll(async () => {
  await handle.stop();
}, 10_000);

runIntegration("socket protocol on the production bundle", () => {
  it("runs a full session → create → join → message → presence lifecycle", async () => {
    const aliceC = makeClient(handle.port);
    const bobC = makeClient(handle.port);
    const alice = await aliceC.connected;
    const bob = await bobC.connected;
    const aliceInit = await aliceC.init;
    await bobC.init;
    expect(aliceInit.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(aliceInit.name.length).toBeGreaterThan(0);
    expect(aliceInit.voiceNotesEnabled).toBe(true);

    // Alice creates a room.
    const aliceRoom = once<ServerToClientEventMap["room:joined"]>(alice, "room:joined");
    alice.emit("room:create", {});
    const room = (await aliceRoom).room;
    expect(room.code).toMatch(/^\d{4}$/);
    expect(room.isHost).toBe(true);

    // Bob joins via code; alice sees presence.
    const aliceSeesBob = once<ServerToClientEventMap["presence:joined"]>(alice, "presence:joined");
    const bobRoom = once<ServerToClientEventMap["room:joined"]>(bob, "room:joined");
    bob.emit("room:join", { code: room.code });
    const joinedTeam = await bobRoom;
    expect(joinedTeam.room.id).toBe(room.id);
    const pk = await aliceSeesBob;
    expect(pk.participant.name.length).toBeGreaterThan(0);

    // Alice sends a message, bob receives it.
    const bobMsg = once<ServerToClientEventMap["message:new"]>(bob, "message:new");
    alice.emit("message:send", { roomId: room.id, text: "hi from test", clientId: "t-1" });
    const recv = await bobMsg;
    expect(recv.message.text).toBe("hi from test");
    expect(recv.message.clientId).toBe("t-1");

    // History replays after a (re)join.
    const bobLeft = once<ServerToClientEventMap["room:left"]>(bob, "room:left");
    bob.emit("room:leave", { roomId: room.id });
    await bobLeft;
    const bobHistory = once<ServerToClientEventMap["message:history"]>(bob, "message:history");
    bob.emit("room:join", { roomId: room.id });
    const hist = await bobHistory;
    expect(hist.messages.some((m) => m.text === "hi from test")).toBe(true);

    // Invalid message is rejected with an error event.
    const errP = once<ErrorPayload>(bob, "error");
    bob.emit("message:send", { roomId: room.id, text: "   " });
    const err = await errP;
    expect(err.code).toBeTruthy();
    alice.disconnect();
    bob.disconnect();
  }, 60_000);

  it("applies voiceNotesEnabled flag from admin settings to new sessions", async () => {
    const s0 = await admin("/settings");
    expect(s0.status).toBe(200);
    expect(s0.body.settings!.voiceNotesEnabled).toBe(true);

    const off = await admin("/settings", {
      method: "PUT",
      body: { voiceNotesEnabled: false },
    });
    expect(off.status).toBe(200);
    expect(off.body.settings!.voiceNotesEnabled).toBe(false);

    const clientC = makeClient(handle.port);
    const client = await clientC.connected;
    try {
      const init = await clientC.init;
      expect(init.voiceNotesEnabled).toBe(false);
      // Live toggle goes out as a settings:update event to connected clients.
      const updateP = once<ServerToClientEventMap["settings:update"]>(client, "settings:update");
      await admin("/settings", { method: "PUT", body: { voiceNotesEnabled: true } });
      const upd = await updateP;
      expect(upd.voiceNotesEnabled).toBe(true);
    } finally {
      client.disconnect();
    }
  }, 20_000);
});

runIntegration("admin REST API on the production bundle", () => {
  it("guards endpoints without/with a wrong key", async () => {
    expect((await admin("/stats", { key: "" })).status).toBe(401);
    expect((await admin("/stats", { key: "nope" })).status).toBe(401);
  });

  it("serves stats, rooms, users, audit, and analytics", async () => {
    const stats = await admin("/stats");
    expect(stats.status).toBe(200);
    expect(typeof stats.body.liveRooms).toBe("number");

    const rooms = await admin("/rooms");
    expect(rooms.status).toBe(200);
    expect(Array.isArray(rooms.body.rooms)).toBe(true);

    const users = await admin("/users");
    expect(users.status).toBe(200);
    expect(Array.isArray(users.body.users)).toBe(true);

    const audit = await admin("/audit");
    expect(audit.status).toBe(200);
    expect(Array.isArray(audit.body.events)).toBe(true);

    const analytics = await admin("/analytics");
    expect(analytics.status).toBe(200);
    expect(Array.isArray(analytics.body.buckets)).toBe(true);
  });

  it("rejects an invalid reserved room code", async () => {
    const bad = await admin("/settings", { method: "PUT", body: { reservedRoomCode: "abc" } });
    expect(bad.status).toBe(400);
  });

  it("clamps nonsensical numeric settings instead of erroring", async () => {
    const ok = await admin("/settings", { method: "PUT", body: { maxRoomSize: 99999 } });
    expect(ok.status).toBe(200);
    expect(ok.body.settings!.maxRoomSize).toBe(200);
  });
});

runIntegration("sticker pack on the production bundle", () => {
  let packHandle: ServerHandle;
  let packPort: number;

  beforeAll(async () => {
    // STICKER_PACK_TEST_JSON seeds the pack without a Cloudinary account. One
    // row is deliberately invalid (format "set_up") and must be filtered.
    packHandle = await bootServer({
      STICKER_PACK_TEST_JSON: JSON.stringify([
        { publicId: "cryo/stickers/party", format: "webp", width: 256, height: 256 },
        { publicId: "cryo/stickers/zzz", format: "set_up", width: 1, height: 1 },
      ]),
    });
    packPort = packHandle.port;
  }, 30_000);

  afterAll(async () => {
    await packHandle.stop();
  }, 10_000);

  it("lists the pack, filtering invalid rows", async () => {
    const res = await fetch(`http://127.0.0.1:${packPort}/api/stickers`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stickers?: Array<{ id: string; url: string; width: number; height: number; name: string }>;
    };
    expect(body.stickers).toHaveLength(1);
    const [s] = body.stickers!;
    expect(s.id).toBe("cryo/stickers/party");
    expect(s.url).toContain("cryo/stickers/party");
    expect(s.width).toBe(256);
    expect(s.height).toBe(256);
    expect(s.name).toBe("party");
  });

  it("absent pack server reports 404 without a backend", async () => {
    // Neutralize any Cloudinary creds the environment may inject (e.g. a root
    // .env) so packEnabled() is false and the route 404s.
    const noPack = await bootServer({
      CLOUDINARY_CLOUD_NAME: "",
      CLOUDINARY_API_KEY: "",
      CLOUDINARY_API_SECRET: "",
    });
    try {
      const res = await fetch(`http://127.0.0.1:${noPack.port}/api/stickers`);
      expect(res.status).toBe(404);
    } finally {
      await noPack.stop();
    }
  }, 20_000);

  it("redirects pack media to the CDN url (302)", async () => {
    const res = await fetch(
      `http://127.0.0.1:${packPort}/api/media/${encodeURIComponent("cryo/stickers/party")}?session=viewer`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("cryo/stickers/party");
  });

  it("sends a pack sticker by reference to every participant", async () => {
    const aliceC = makeClient(packPort);
    const bobC = makeClient(packPort);
    const alice = await aliceC.connected;
    const bob = await bobC.connected;
    await aliceC.init;
    await bobC.init;

    const aliceRoom = once<ServerToClientEventMap["room:joined"]>(alice, "room:joined");
    alice.emit("room:create", {});
    const room = (await aliceRoom).room;

    const bobRoom = once<ServerToClientEventMap["room:joined"]>(bob, "room:joined");
    bob.emit("room:join", { code: room.code });
    await bobRoom;

    const bobMsg = once<ServerToClientEventMap["message:new"]>(bob, "message:new");
    alice.emit("message:send", {
      roomId: room.id,
      clientId: "pack-1",
      attachment: { mediaId: "cryo/stickers/party" },
    });
    const recv = await bobMsg;
    expect(recv.message.attachment?.type).toBe("sticker");
    expect(recv.message.attachment?.mediaId).toBe("cryo/stickers/party");
    expect(recv.message.attachment?.name).toBe("party");
    expect(recv.message.attachment?.width).toBe(256);

    // An unknown sticker id is rejected like any bad media — the error goes
    // to the sender.
    const errP = once<ErrorPayload>(alice, "error");
    alice.emit("message:send", {
      roomId: room.id,
      clientId: "pack-2",
      attachment: { mediaId: "cryo/stickers/nope" },
    });
    const err = await errP;
    expect(err.code).toBe("message_invalid");
    alice.disconnect();
    bob.disconnect();
  }, 30_000);
});
runIntegration("room passwords on the production bundle", () => {
  const PASSWORD = "cold brew";
  interface Ctx {
    port: number;
    admin: typeof admin;
    /** The room every test here locks down. */
    roomId: string;
  }

  /**
   * Boot a server, create a normal room, then put a password on *that* room.
   * Nothing is global any more: the password belongs to the room, so this is
   * what "lock a room" has to look like from the outside.
   */
  async function withLockedRoom(run: (ctx: Ctx) => Promise<void>): Promise<void> {
    const h = await bootServer();
    const adminLocal: typeof admin = async (path, opts = {}) => {
      const res = await fetch(`http://127.0.0.1:${h.port}/admin${path}`, {
        method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
        headers: {
          "x-admin-key": opts.key ?? ADMIN_KEY,
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const owner = makeClient(h.port);
    const ownerSocket = await owner.connected;
    await owner.init;
    const created = once<{ room: { id: string; code: string } }>(ownerSocket, "room:joined");
    ownerSocket.emit("room:create", {});
    const room = (await created).room;
    ownerSocket.disconnect();

    const locked = await adminLocal(`/rooms/${room.id}/password`, {
      method: "PUT",
      body: { password: PASSWORD },
    });
    expect(locked.status).toBe(200);
    try {
      await run({ port: h.port, admin: adminLocal, roomId: room.id });
    } finally {
      await h.stop();
    }
  }

  it("asks for the password, then issues a reusable access token", async () => {
    await withLockedRoom(async ({ port, roomId }) => {
      const c = makeClient(port);
      const socket = await c.connected;
      const init = await c.init;

      // No password, no token → refused, with the code so the UI can prompt.
      const refused = once<ErrorPayload>(socket, "error");
      socket.emit("room:join", { roomId });
      const err = await refused;
      expect(err.code).toBe("room_password_required");
      expect(err.roomCode).toBe(err.roomCode);
      expect(err.roomCode).toBeTruthy();

      // Wrong password → a different error, so the UI can say "try again".
      const wrong = once<ErrorPayload>(socket, "error");
      socket.emit("room:join", { roomId, password: "nope" });
      expect((await wrong).code).toBe("room_password_invalid");

      // Right password → in, and handed a token to keep.
      const joined = once<{ room: { id: string } }>(socket, "room:joined");
      const access = once<{ code: string; token: string; expiresAt: number }>(socket, "room:access");
      socket.emit("room:join", { roomId, password: PASSWORD });
      expect((await joined).room.id).toBe(roomId);
      const grant = await access;
      expect(grant.token).toBeTruthy();
      expect(grant.expiresAt).toBeGreaterThan(Date.now());

      // Same identity, brand new socket, presenting the token: straight in.
      const again = makeClientWithSession(port, init.sessionId);
      const socket2 = await again.connected;
      await again.init;
      const joined2 = once<{ room: { id: string } }>(socket2, "room:joined");
      socket2.emit("room:join", { roomId, token: grant.token });
      expect((await joined2).room.id).toBe(roomId);

      socket.disconnect();
      socket2.disconnect();
    });
  }, 40_000);

  it("gives every room its own password", async () => {
    await withLockedRoom(async ({ port, admin: adminLocal, roomId }) => {
      // A second, completely separate room, in the same server and the same
      // code space as the locked one.
      const b = makeClient(port);
      const socketB = await b.connected;
      await b.init;
      const created = once<{ room: { id: string; code: string } }>(socketB, "room:joined");
      socketB.emit("room:create", {});
      const other = (await created).room;
      const setOther = await adminLocal(`/rooms/${other.id}/password`, {
        method: "PUT",
        body: { password: "bravo pass" },
      });
      expect(setOther.status).toBe(200);

      /** Enter a room from outside and report which way the door opened. */
      const enter = async (target: string, password?: string): Promise<string> => {
        const c = makeClient(port);
        const s = await c.connected;
        await c.init;
        const outcome = Promise.race([
          once<{ room: { id: string } }>(s, "room:joined").then(() => "granted"),
          once<ErrorPayload>(s, "error").then((e) => e.code),
        ]);
        s.emit("room:join", { roomId: target, password });
        const result = await outcome;
        s.disconnect();
        return result;
      };

      // Each room answers only to its own password.
      expect(await enter(other.id, PASSWORD)).toBe("room_password_invalid");
      expect(await enter(other.id, "bravo pass")).toBe("granted");
      expect(await enter(roomId, "bravo pass")).toBe("room_password_invalid");
      expect(await enter(roomId, PASSWORD)).toBe("granted");

      socketB.disconnect();
    });
  }, 40_000);

  it("keeps the room shut for everyone else, on every way in", async () => {
    await withLockedRoom(async ({ port, admin: adminLocal, roomId }) => {
      // A different person, following a share link to the room.
      const b = makeClient(port);
      const socketB = await b.connected;
      await b.init;
      const denied = once<ErrorPayload>(socketB, "error");
      socketB.emit("room:join", { roomId });
      expect((await denied).code).toBe("room_password_required");

      // ...and by typing its code.
      const detail = await adminLocal(`/rooms/${roomId}`);
      const code = (detail.body.room as { code: string }).code;
      const byCode = once<ErrorPayload>(socketB, "error");
      socketB.emit("room:join", { code });
      expect((await byCode).code).toBe("room_password_required");

      // Status tells the home screen the room needs a password up front.
      const status = once<{ statuses: { code: string; locked: boolean }[] }>(
        socketB,
        "room:status:result",
      );
      socketB.emit("room:status", { refs: [{ code }] });
      const st = (await status).statuses[0];
      expect(st.locked).toBe(true);
      expect(st.code).toBe(code);

      socketB.disconnect();
    });
  }, 40_000);

  it("signs saved devices out on password change, revoke, and removal", async () => {
    await withLockedRoom(async ({ port, admin: adminLocal, roomId }) => {
      /**
       * Unlock once, then step back outside: a member still seated inside is
       * re-seated by the server's recovery path, and this test is about what
       * happens to a device that has to go through the door again.
       */
      const unlock = async () => {
        const c = makeClient(port);
        const s = await c.connected;
        const init = await c.init;
        const access = once<{ token: string }>(s, "room:access");
        const joined = once<{ room: { id: string } }>(s, "room:joined");
        s.emit("room:join", { roomId, password: PASSWORD });
        const room = (await joined).room;
        const token = (await access).token;
        const left = once<{ roomId: string }>(s, "room:left");
        s.emit("room:leave", { roomId: room.id });
        await left;
        return { socket: s, sessionId: init.sessionId, token };
      };
      /** Come back as a returning device with a saved token. */
      const tryToken = async (sessionId: string, token: string): Promise<string> => {
        const c = makeClientWithSession(port, sessionId);
        const s = await c.connected;
        await c.init;
        const outcome = Promise.race([
          once<{ room: { id: string } }>(s, "room:joined").then(() => "granted"),
          once<ErrorPayload>(s, "error").then((e) => e.code),
        ]);
        s.emit("room:join", { roomId, token });
        const result = await outcome;
        s.disconnect();
        return result;
      };

      const first = await unlock();
      expect(await tryToken(first.sessionId, first.token)).toBe("granted");
      const revoked = await adminLocal(`/rooms/${roomId}/revoke-access`, { method: "POST" });
      expect(revoked.status).toBe(200);
      expect(await tryToken(first.sessionId, first.token)).toBe("room_password_required");
      const second = await unlock();
      const rotated = await adminLocal(`/rooms/${roomId}/password`, {
        method: "PUT",
        body: { password: "new brew" },
      });
      expect(rotated.status).toBe(200);
      expect(await tryToken(second.sessionId, second.token)).toBe("room_password_required");
      const stale = makeClientWithSession(port, second.sessionId);
      const staleSocket = await stale.connected;
      await stale.init;
      const staleErr = once<ErrorPayload>(staleSocket, "error");
      staleSocket.emit("room:join", { roomId, password: PASSWORD });
      expect((await staleErr).code).toBe("room_password_invalid");
      staleSocket.disconnect();
      const cleared = await adminLocal(`/rooms/${roomId}/password`, { method: "DELETE" });
      expect(cleared.status).toBe(200);
      const c = makeClient(port);
      const s = await c.connected;
      await c.init;
      const openJoin = once<{ room: { id: string } }>(s, "room:joined");
      s.emit("room:join", { roomId });
      expect((await openJoin).room.id).toBe(roomId);
      first.socket.disconnect();
      second.socket.disconnect();
      s.disconnect();
    });
  }, 40_000);

  it("lets an admin mark any room reserved, from the rooms list", async () => {
    await withLockedRoom(async ({ admin: adminLocal, roomId }) => {
      const listed = await adminLocal("/rooms");
      const rooms = listed.body.rooms as { id: string; locked: boolean; persistent: boolean }[];
      const row = rooms.find((r) => r.id === roomId);
      expect(row).toBeDefined();
      expect(row!.locked).toBe(true);
      expect(row!.persistent).toBe(false);

      // Reserved means it will not expire on its own.
      const marked = await adminLocal(`/rooms/${roomId}`, {
        method: "PATCH",
        body: { reserved: true },
      });
      expect(marked.status).toBe(200);
      expect((marked.body.room as { persistent: boolean }).persistent).toBe(true);
      expect(
        (marked.body.room as { expiresAt: number }).expiresAt,
      ).toBe(Number.MAX_SAFE_INTEGER);

      // The room keeps its password when it becomes reserved.
      const stillLocked = await adminLocal("/rooms");
      const after = (stillLocked.body.rooms as { id: string; locked: boolean }[]).find(
        (r) => r.id === roomId,
      );
      expect(after!.locked).toBe(true);

      // And un-reserving hands it back to the normal expiry.
      const unmarked = await adminLocal(`/rooms/${roomId}`, {
        method: "PATCH",
        body: { reserved: false },
      });
      expect(unmarked.status).toBe(200);
      expect((unmarked.body.room as { persistent: boolean }).persistent).toBe(false);

      // Nonsense input is refused rather than silently ignored.
      const bad = await adminLocal(`/rooms/${roomId}`, {
        method: "PATCH",
        body: { reserved: "yes" },
      });
      expect(bad.status).toBe(400);
      const missing = await adminLocal("/rooms/nope/password", {
        method: "PUT",
        body: { password: PASSWORD },
      });
      expect(missing.status).toBe(404);
    });
  }, 40_000);

  it("never leaks the password or its hash through the admin API", async () => {
    await withLockedRoom(async ({ admin: adminLocal, roomId }) => {
      const rooms = await adminLocal("/rooms");
      expect(JSON.stringify(rooms.body)).not.toContain("scrypt");
      const room = await adminLocal(`/rooms/${roomId}`);
      expect(JSON.stringify(room.body)).not.toContain("scrypt");
      // The row tells the admin what it needs to know without holding a secret.
      expect((room.body.room as { locked: boolean }).locked).toBe(true);

      // A password cannot be smuggled in through the generic settings patch.
      const sneaky = await adminLocal("/settings", {
        method: "PUT",
        body: { reservedRoomPassword: "scrypt$1$2" },
      });
      expect(sneaky.status).toBe(400);

      // Audit entries record the change without the secret.
      const audit = await adminLocal("/audit");
      const events = (audit.body.events ?? []) as { kind: string }[];
      expect(events.some((e) => e.kind === "reserved:password:set")).toBe(true);
      expect(JSON.stringify(events)).not.toContain(PASSWORD);
    });
  }, 40_000);

  it("refuses a password that is too short or too long", async () => {
    await withLockedRoom(async ({ admin: adminLocal, roomId }) => {
      const short = await adminLocal(`/rooms/${roomId}/password`, {
        method: "PUT",
        body: { password: "ab" },
      });
      expect(short.status).toBe(400);
      const long = await adminLocal(`/rooms/${roomId}/password`, {
        method: "PUT",
        body: { password: "x".repeat(200) },
      });
      expect(long.status).toBe(400);
      // And the room is still exactly as it was.
      const room = await adminLocal(`/rooms/${roomId}`);
      expect((room.body.room as { locked: boolean }).locked).toBe(true);
    });
  }, 40_000);
});
