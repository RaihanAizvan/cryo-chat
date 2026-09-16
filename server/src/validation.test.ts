import { beforeEach, describe, expect, it } from "vitest";
import { MAX_MESSAGE_LENGTH } from "@cryo/shared";
import { normalizeMessage, normalizeCaption, RateLimiter } from "./validation";
import { updateSettings } from "./settings";

beforeEach(() => {
  updateSettings({ maxMessageLength: MAX_MESSAGE_LENGTH });
});

describe("normalizeMessage", () => {
  it("returns null for non-strings and empty text", () => {
    expect(normalizeMessage(undefined)).toBeNull();
    expect(normalizeMessage(42)).toBeNull();
    expect(normalizeMessage("")).toBeNull();
    expect(normalizeMessage("   ")).toBeNull();
    expect(normalizeMessage("\n\n")).toBeNull();
  });

  it("normalizes CRLF line endings", () => {
    expect(normalizeMessage("a\r\nb")).toBe("a\nb");
    expect(normalizeMessage("a\rb")).toBe("a\nb");
  });

  it("rejects over-length messages (honors admin maxMessageLength)", () => {
    updateSettings({ maxMessageLength: 100 });
    expect(normalizeMessage("x".repeat(101))).toBeNull();
    expect(normalizeMessage("x".repeat(100))).not.toBeNull();
  });

  it("rejects control characters but allows newline and tab", () => {
    expect(normalizeMessage("bad\u0000text")).toBeNull();
    expect(normalizeMessage("bad\u001ftext")).toBeNull();
    expect(normalizeMessage("good\ntext")).toBe("good\ntext");
    expect(normalizeMessage("good\ttext")).toBe("good\ttext");
  });

  it("passes ordinary text through unchanged", () => {
    expect(normalizeMessage("  hello world  ")).toBe("  hello world  ");
  });
});

describe("normalizeCaption", () => {
  it("returns empty string for non-strings and blank input", () => {
    expect(normalizeCaption(undefined)).toBe("");
    expect(normalizeCaption(7)).toBe("");
    expect(normalizeCaption("   ")).toBe("");
  });

  it("trims surrounding whitespace on non-empty captions", () => {
    expect(normalizeCaption("  hi  ")).toBe("hi");
  });

  it("clamps (rather than rejects) over-length captions", () => {
    updateSettings({ maxMessageLength: 50 });
    const cap = normalizeCaption("x".repeat(100));
    expect(cap.length).toBe(50);
  });

  it("rejects control characters", () => {
    expect(normalizeCaption("a\u0000b")).toBe("");
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit within a window", () => {
    const rl = new RateLimiter(() => 3, () => 10_000);
    expect(rl.allow("k")).toBe(true);
    expect(rl.allow("k")).toBe(true);
    expect(rl.allow("k")).toBe(true);
    expect(rl.allow("k")).toBe(false);
  });

  it("tracks keys independently", () => {
    const rl = new RateLimiter(() => 1, () => 10_000);
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(false);
    expect(rl.allow("b")).toBe(true);
  });

  it("reads the limit live from the getter", () => {
    let limit = 1;
    const rl = new RateLimiter(() => limit, () => 10_000);
    expect(rl.allow("k")).toBe(true);
    expect(rl.allow("k")).toBe(false);
    limit = 5; // admin raises it
    expect(rl.allow("k")).toBe(true);
  });

  it("resets a bucket after the window elapses (slide forward)", () => {
    let now = 0;
    const rl = new RateLimiter(() => 1, () => 10_000);
    // Pretend time passes between calls via bucket expiry (Date.now-based).
    const realNow = Date.now;
    Date.now = () => now;
    try {
      expect(rl.allow("k")).toBe(true);
      now += 10_001;
      expect(rl.allow("k")).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("sweep removes expired buckets", () => {
    const rl = new RateLimiter(() => 1, () => 10_000);
    const realNow = Date.now;
    let now = 0;
    Date.now = () => now;
    try {
      rl.allow("k");
      expect((rl as unknown as { buckets: Map<string, unknown> }).buckets.size).toBe(1);
      now += 10_001;
      rl.sweep();
      expect((rl as unknown as { buckets: Map<string, unknown> }).buckets.size).toBe(0);
    } finally {
      Date.now = realNow;
    }
  });
});