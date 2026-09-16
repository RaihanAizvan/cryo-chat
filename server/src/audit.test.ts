import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetForTest, record, recent, query, series, splitsTotals, topRooms, totals, userStats } from "./audit";

const T = 1_700_000_000_000; // fixed epoch ms (not minute-aligned)
const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers({ now: T, shouldAdvanceTime: false });
  resetForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("record + recent", () => {
  it("records an event with a monotonic id and newest-first recent()", () => {
    record({ kind: "room:created", message: "created A", actor: "Coral" });
    record({ kind: "message:send", message: "sent", sessionId: "s1", roomId: "r1" });
    const r = recent();
    expect(r[0].kind).toBe("message:send");
    expect(r[1].kind).toBe("room:created");
    expect(r[0].id).toMatch(/^a\d+$/);
  });

  it("recent() respects the limit argument", () => {
    for (let i = 0; i < 10; i++) record({ kind: "room:created", message: `m${i}` });
    expect(recent(3)).toHaveLength(3);
  });
});

describe("query", () => {
  it("filters by kinds", () => {
    record({ kind: "room:created", message: "created" });
    record({ kind: "session:created", message: "session" });
    const onlyRooms = query({ kinds: new Set(["room:created"]), limit: 50 });
    expect(onlyRooms.map((e) => e.kind)).toEqual(["room:created"]);
  });

  it("filters by since timestamp", () => {
    record({ kind: "room:created", message: "old" });
    vi.setSystemTime(T + MINUTE);
    record({ kind: "message:send", message: "new" });
    const recentOnes = query({ since: T + 1, limit: 50 });
    expect(recentOnes.map((e) => e.message)).toEqual(["new"]);
  });
});

describe("counters + splits + userStats", () => {
  it("counts by kind and message splits", () => {
    record({ kind: "message:send", message: "t", sessionId: "s1", detail: "text" });
    record({ kind: "message:send", message: "v", sessionId: "s1", detail: "voice" });
    record({ kind: "media:upload", message: "img", sessionId: "s1", detail: "image" });
    record({ kind: "media:upload", message: "gif", sessionId: "s2", detail: "gif" });
    const t = totals();
    expect(t.messages).toBe(2);
    expect(t.uploads).toBe(2);
    // Splits only track message:send kinds; uploads bump the upload counter.
    expect(splitsTotals()).toMatchObject({ text: 1, voice: 1, image: 0, gif: 0, sticker: 0 });
    expect(userStats("s1")).toMatchObject({ messages: 2, uploads: 1 });
    expect(userStats("ghost").messages).toBe(0);
  });

  it("records room traffic and topRooms sorts by count", () => {
    record({ kind: "message:send", message: "a", roomId: "r1", roomCode: "1111" });
    record({ kind: "message:send", message: "b", roomId: "r1", roomCode: "1111" });
    record({ kind: "message:send", message: "c", roomId: "r2", roomCode: "2222" });
    const top = topRooms(10);
    expect(top[0]).toMatchObject({ roomId: "r1", code: "1111", count: 2 });
    expect(top[1]).toMatchObject({ roomId: "r2", count: 1 });
  });

  it("increments joins/leaves counters", () => {
    record({ kind: "room:joined", message: "in" });
    record({ kind: "room:left", message: "out" });
    const t = totals();
    expect(t.joins).toBe(1);
    expect(t.leaves).toBe(1);
  });
});

describe("series", () => {
  it("zero-fills gaps over the 120-minute window", () => {
    record({ kind: "message:send", message: "x" });
    const buckets = series(T);
    expect(buckets).toHaveLength(120);
    let sawMessage = 0;
    for (const b of buckets) sawMessage += b.messages;
    expect(sawMessage).toBe(1);
  });

  it("returns the current minute as the newest bucket", () => {
    record({ kind: "message:send", message: "x" });
    const buckets = series(T);
    expect(buckets[buckets.length - 1].messages).toBe(1);
  });
});