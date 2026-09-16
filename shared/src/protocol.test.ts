import { describe, expect, it } from "vitest";
import {
  AVATAR_COLORS,
  hash,
  avatarColor,
  ROOM_CODE_SIZE,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
} from "./protocol";

describe("hash", () => {
  it("is deterministic for the same input", () => {
    expect(hash("Coral Wren")).toBe(hash("Coral Wren"));
  });

  it("produces a 32-bit unsigned value", () => {
    for (const input of ["", "a", "zzz", "X".repeat(100)]) {
      const h = hash(input);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(h)).toBe(true);
    }
  });

  it("distinguishes different inputs", () => {
    const set = new Set(["a", "b", "c", "A", "ab", "ba"].map(hash));
    expect(set.size).toBeGreaterThan(1);
  });

  it("handles unicode input", () => {
    expect(typeof hash("😀emoji")).toBe("number");
  });
});

describe("avatarColor", () => {
  it("returns one of the palette colors", () => {
    for (let i = 0; i < 100; i++) {
      const c = avatarColor(i);
      expect(AVATAR_COLORS as readonly string[]).toContain(c);
    }
  });

  it("is deterministic for the same name", () => {
    expect(avatarColor("Coral Wren")).toBe(avatarColor("Coral Wren"));
  });

  it("wraps negative indices (no negative array access)", () => {
    const value = avatarColor(5);
    expect(avatarColor(-5)).toBeTypeOf("string");
    expect(avatarColor(5)).toBe(value);
  });

  it("round-trips numeric indexes through a (positive) equivalent", () => {
    const value = avatarColor(7);
    const equivalent = (((7 % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length);
    expect(AVATAR_COLORS[equivalent]).toBe(value);
  });

  it("maps the same numeric index consistently with a hashed name of the same value", () => {
    const name = "Test";
    const h = hash(name);
    expect(avatarColor(name)).toBe(avatarColor(h));
  });
});

describe("constants", () => {
  it("are stable wire-protocol constants", () => {
    expect(ROOM_CODE_SIZE).toBe(4);
    expect(MAX_MESSAGE_LENGTH).toBe(2000);
    expect(MAX_NAME_LENGTH).toBe(24);
    expect(AVATAR_COLORS).toHaveLength(10);
  });
});