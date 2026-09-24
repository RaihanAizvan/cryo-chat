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
}

async function bootServer(): Promise<ServerHandle> {
  const port = await freePort();
  const child = fork(distPath, [], {
    env: { ...process.env, PORT: String(port), ADMIN_KEY, MESSAGE_CAP: "50" },
    silent: true,
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
  return { port, stop };
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
  const init = once<ServerToClientEventMap["session:init"]>(s, "session:init");
  return { socket: s, connected, init };
}

interface AdminSettingsView {
  voiceNotesEnabled?: boolean;
  maxRoomSize?: number;
  reservedRoomCode?: string;
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