import { describe, expect, it } from "vitest";
import {
  randomRoomId,
  randomRoomCode,
  randomDisplayName,
  normalizeName,
  normalizeCode,
  colorFor,
  AVATAR_COLOR_COUNT,
} from "./util";

describe("randomRoomId", () => {
  it("produces a string of ROOM_ID_SIZE alphanumerics", () => {
    const id = randomRoomId();
    expect(id).toMatch(/^[A-Za-z0-9]{12}$/);
  });

  it("is unique across many calls", () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomRoomId()));
    expect(seen.size).toBe(500);
  });
});

describe("randomRoomCode", () => {
  it("produces a 4-digit numeric code", () => {
    for (let i = 0; i < 100; i++) {
      expect(randomRoomCode()).toMatch(/^\d{4}$/);
    }
  });

  it("never starts with zero (1000–9999 range)", () => {
    for (let i = 0; i < 200; i++) {
      const code = randomRoomCode();
      expect(code[0]).not.toBe("0");
    }
  });

  it("is unique across many calls", () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomRoomCode()));
    expect(seen.size).toBeGreaterThan(100);
  });
});

describe("randomDisplayName", () => {
  it("always yields an Adjective Noun pair", () => {
    for (let i = 0; i < 100; i++) {
      expect(randomDisplayName()).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    }
  });
});

describe("normalizeName", () => {
  it("returns null for non-strings and empty input", () => {
    expect(normalizeName(undefined)).toBeNull();
    expect(normalizeName(42)).toBeNull();
    expect(normalizeName("")).toBeNull();
    expect(normalizeName("   ")).toBeNull();
  });

  it("trims and collapses internal whitespace", () => {
    expect(normalizeName("  Coral   Wren  ")).toBe("Coral Wren");
  });

  it("caps length at MAX_NAME_LENGTH", () => {
    const long = "x".repeat(50);
    expect(normalizeName(long)!.length).toBe(24);
  });

  it("rejects control characters (but collapses whitespace incl. newlines)", () => {
    expect(normalizeName("bad\u0000name")).toBeNull();
    expect(normalizeName("bad\u0007name")).toBeNull();
    // Newlines are collapsed to a single space, not rejected.
    expect(normalizeName("bad\nname")).toBe("bad name");
    expect(normalizeName("bad\r\nname")).toBe("bad name");
  });
});

describe("normalizeCode", () => {
  it("uppercases letters and strips separators/dashes", () => {
    expect(normalizeCode("ab12")).toBe("AB12");
    expect(normalizeCode("ab-12")).toBe("AB12");
    expect(normalizeCode(" ab 12 ")).toBe("AB12");
  });

  it("returns null for non-string, wrong-length, or invalid input", () => {
    expect(normalizeCode(1234)).toBeNull();
    expect(normalizeCode("AB")).toBeNull();
    expect(normalizeCode("AB123")).toBeNull();
    expect(normalizeCode(null)).toBeNull();
  });
});

describe("colorFor", () => {
  it("returns a deterministic index in range", () => {
    expect(colorFor("Coral Wren")).toBe(colorFor("Coral Wren"));
    for (let i = 0; i < 20; i++) {
      const c = colorFor(`name-${i}`);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(AVATAR_COLOR_COUNT);
    }
  });

  it("is stable across calls (module has no per-name randomness)", () => {
    expect(colorFor("same")).toBe(colorFor("same"));
  });
});