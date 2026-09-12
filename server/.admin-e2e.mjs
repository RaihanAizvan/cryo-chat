/**
 * Quick e2e for the admin console: admin REST API + kick/ban socket flow.
 * Requires the server running with ADMIN_KEY=test-admin-key on PORT.
 *
 * Usage: node server/.admin-e2e.mjs http://localhost:PORT test-admin-key
 */
import { io as createClient } from "socket.io-client";

const BASE = process.argv[2] ?? "http://localhost:4567";
const KEY = process.argv[3] ?? "test-admin-key";

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};

const ok = (msg) => console.log(`✓ ${msg}`);

const headers = { "x-admin-key": KEY };
const json = async (path, { body, method, includeKey = true, h = {} } = {}) => {
  const hh = { ...(includeKey ? headers : {}), ...h };
  if (body !== undefined) hh["content-type"] = "application/json";
  const res = await fetch(`${BASE}/admin${path}`, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: hh,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const b = res.status === 204 ? null : await res.json().catch(() => ({}));
  return { status: res.status, body: b };
};

const assert = (cond, msg) => (cond ? ok(msg) : fail(msg));

// 1) Auth / disabled paths
{
  const unauth = await json("/stats", { includeKey: false });
  assert(unauth.status === 401, `no key → 401 (got ${unauth.status})`);

  const wrong = await json("/stats", { h: { "x-admin-key": "nope" } });
  assert(wrong.status === 401, `wrong key → 401 (got ${wrong.status})`);

  const ping = await json("/stats");
  assert(ping.status === 200 && typeof ping.body.liveRooms === "number", `stats 200 (${ping.status})`);
}

// 2) Socket flow: alice creates room, bob joins, both send
const baseSocketIo = "socket.io"; // path default
const connect = () => new Promise((resolve, reject) => {
  const s = createClient(BASE, { path: "/socket.io", transports: ["websocket"] });
  s.on("connect", () => resolve(s));
  s.on("connect_error", reject);
});

const alice = await connect();
const bob = await connect();
const ids = {};
alice.on("session:init", (d) => (ids.alice = d.sessionId));
bob.on("session:init", (d) => (ids.bob = d.sessionId));
const aliceRoom = new Promise((resolve) => {
  alice.once("room:joined", (d) => resolve(d.room));
});
alice.emit("room:create", {});
const created = await aliceRoom;

ok(`alice created room ${created.code} (${created.id})`);

const bobRoom = new Promise((resolve) => {
  bob.once("room:joined", (d) => resolve(d.room));
});
bob.emit("room:join", { code: created.code });
await bobRoom;
ok(`bob joined ${created.code}`);

const aliceName = alice.id; // placeholder
const bobAckRecv = new Promise((resolve) => bob.once("message:new", (d) => resolve(d)));
alice.emit("message:send", { roomId: created.id, text: "hello admin", clientId: "e2e-1" });
await bobAckRecv;
ok("message echoed to bob");

// 3) Admin sees the room + message log + users
{
  const rooms = await json("/rooms");
  const found = rooms.body.rooms.find((r) => r.id === created.id);
  assert(!!found && found.messageCount >= 1, `rooms list includes room (count=${found?.messageCount})`);

  const detail = await json(`/rooms/${created.id}`);
  assert(detail.status === 200 && detail.body.room.participants.length >= 2, `room detail has 2+ members`);
  assert(detail.body.room.messages.some((m) => m.text === "hello admin"), "message log contains sent text");

  const users = await json("/users");
  assert(array(users.body.users).length >= 2, `users lists identities (${array(users.body.users).length})`);
}

// 4) Settings GET/PUT
{
  const s0 = await json("/settings");
  assert(s0.status === 200 && s0.body.settings.maxMessageLength >= 1, "settings GET");
  const before = s0.body.settings.messageCap;
  const s1 = await json("/settings", { method: "PUT", body: { messageCap: 123 } });
  assert(s1.status === 200 && s1.body.settings.messageCap === 123, "settings PUT changes value");
  const s2 = await json("/settings");
  assert(s2.body.settings.messageCap === 123, "settings persisted in memory");
  await json("/settings", { method: "PUT", body: { messageCap: before } });

  const bad = await json("/settings", { method: "PUT", body: { reservedRoomCode: "abc" } });
  assert(bad.status === 400, `bad reserved code => 400 (got ${bad.status})`);
}

// 5) Audit + analytics
{
  const audit = await json("/audit");
  assert(array(audit.body.events).length > 0, `audit has events (${array(audit.body.events).length})`);
  const kinds = audit.body.events.map((e) => e.kind);
  assert(kinds.includes("room:created") && kinds.includes("message:send"), "audit records room created + message");

  const an = await json("/analytics");
  assert(an.status === 200 && Array.isArray(an.body.buckets), "analytics buckets present");
}

// 6) Kick + ban: bob gets room:kicked, then can't rejoin, admin user flags banned
{
  const kicked = new Promise((resolve) => bob.once("room:kicked", (d) => resolve(d)));
  const kick = await json(`/rooms/${created.id}/kick`, {
    body: { participantId: ids.bob, ban: true },
  });
  assert(kick.status === 200 && kick.body.banned === true, `kick+mban accepted (${kick.status})`);
  const kd = await kicked;
  ok(`bob received room:kicked (code=${kd.code ?? "n/a"})`);

  const users = await json("/users");
  const b = array(users.body.users).find((u) => u.sessionId === ids.bob);
  assert(b && b.banned === true, "bob flagged banned in user list");

  const jr = new Promise((resolve) => bob.once("error", (d) => resolve(d)));
  bob.emit("room:join", { code: created.code });
  const jerr = await jr;
  assert(jerr.code === "banned", `banned join rejected with 'banned' (got ${jerr.code})`);
}

// 7) Clear + close
{
  const cleared = await json(`/rooms/${created.id}/clear`, { body: {} });
  assert(cleared.status === 200, "clear room ok");

  const closed = await json(`/rooms/${created.id}/close`, { body: {} });
  assert(closed.status === 200, "close room ok");

  const gone = await json(`/rooms/${created.id}`);
  assert(gone.status === 404, "room gone after close (404)");
}

alice.disconnect();
bob.disconnect();
console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
process.exit(process.exitCode ?? 0);

function array(x) {
  return Array.isArray(x) ? x : [];
}