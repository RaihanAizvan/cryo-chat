import { beforeEach, describe, expect, it } from "vitest";
import { EMOJI_CATEGORIES, getRecentEmojis, recordEmoji } from "./emoji";

beforeEach(() => {
  localStorage.clear();
});

describe("EMOJI_CATEGORIES", () => {
  it("has a stable set of categories with non-empty emoji lists", () => {
    const ids = EMOJI_CATEGORIES.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of EMOJI_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.emojis.length).toBeGreaterThan(0);
    }
  });

  it("only contains valid emoji strings", () => {
    for (const c of EMOJI_CATEGORIES) {
      for (const e of c.emojis) {
        expect(typeof e).toBe("string");
        expect(e.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("recent emojis", () => {
  it("starts empty", () => {
    expect(getRecentEmojis()).toEqual([]);
  });

  it("records emojis newest-first, de-duplicated", () => {
    recordEmoji("😀");
    recordEmoji("🎉");
    recordEmoji("😀"); // moves to front, no duplicate
    expect(getRecentEmojis()).toEqual(["😀", "🎉"]);
  });

  it("persists across module accesses via localStorage", () => {
    recordEmoji("🔥");
    const again = getRecentEmojis();
    expect(again).toEqual(["🔥"]);
  });

  it("ignores broken stored data", () => {
    localStorage.setItem("cryo_emoji_recent", "{not json");
    expect(getRecentEmojis()).toEqual([]);
  });
});