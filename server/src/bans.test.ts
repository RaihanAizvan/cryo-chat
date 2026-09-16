import { beforeEach, describe, expect, it } from "vitest";
import { ban, unban, isBanned, bannedCount, allBanned } from "./bans";

beforeEach(() => {
  // Clear any state from other tests.
  for (const id of allBanned()) unban(id);
});

describe("bans", () => {
  it("starts empty", () => {
    expect(bannedCount()).toBe(0);
  });

  it("adds and detects a ban", () => {
    expect(ban("abc")).toBe(true);
    expect(isBanned("abc")).toBe(true);
  });

  it("returns false when banning an already-banned id (idempotent)", () => {
    ban("abc");
    expect(ban("abc")).toBe(false);
    expect(bannedCount()).toBe(1);
  });

  it("removes a ban with unban", () => {
    ban("abc");
    expect(unban("abc")).toBe(true);
    expect(isBanned("abc")).toBe(false);
  });

  it("returns false when unbanning an unknown id", () => {
    expect(unban("nope")).toBe(false);
  });

  it("lists all banned ids", () => {
    ban("a");
    ban("b");
    expect(allBanned().slice().sort()).toEqual(["a", "b"]);
    expect(bannedCount()).toBe(2);
  });
});