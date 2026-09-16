import { describe, expect, it } from "vitest";
import {
  formatTime,
  sameMinute,
  formatLeftover,
  timeAgo,
  formatRemaining,
  formatCountdown,
  initials,
} from "./format";

describe("formatTime", () => {
  it("formats a timestamp as 12-hour time", () => {
    expect(formatTime(new Date(2024, 0, 1, 9, 41).getTime())).toBe("9:41 AM");
    expect(formatTime(new Date(2024, 0, 1, 13, 5).getTime())).toBe("1:05 PM");
    expect(formatTime(new Date(2024, 0, 1, 0, 0).getTime())).toBe("12:00 AM");
    expect(formatTime(new Date(2024, 0, 1, 12, 30).getTime())).toBe("12:30 PM");
  });
});

describe("sameMinute", () => {
  it("is true for identical timestamps", () => {
    const t = Date.UTC(2024, 0, 1, 10, 30, 0);
    expect(sameMinute(t, t + 30_000)).toBe(true);
  });

  it("is false across a minute boundary / different days", () => {
    expect(sameMinute(Date.UTC(2024, 0, 1, 10, 30, 0), Date.UTC(2024, 0, 1, 10, 31, 0))).toBe(false);
  });

  it("is false across days", () => {
    expect(sameMinute(Date.UTC(2024, 0, 1, 23, 59, 0), Date.UTC(2024, 0, 2, 0, 0, 0))).toBe(false);
  });
});

describe("formatLeftover", () => {
  it("formats sub-hour and multi-hour durations", () => {
    expect(formatLeftover(30 * 60_000)).toBe("30 min");
    expect(formatLeftover(45 * 60_000 + 10_000)).toBe("46 min");
    expect(formatLeftover(2 * 3_600_000)).toBe("2h");
    expect(formatLeftover(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
  });

  it("never returns negative", () => {
    expect(formatLeftover(-1)).toBe("0 min");
  });
});

describe("timeAgo", () => {
  const now = 1_700_000_000_000;

  it("labels recent, minute, hour, and day ranges", () => {
    expect(timeAgo(now - 5_000, now)).toBe("just now");
    expect(timeAgo(now - 30_000, now)).toBe("30s");
    expect(timeAgo(now - 3 * 60_000, now)).toBe("3m ago");
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe("2h ago");
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe("3d ago");
  });

  it("treats future timestamps as just now", () => {
    expect(timeAgo(now + 1_000, now)).toBe("just now");
  });
});

describe("formatRemaining", () => {
  it("describes time left or expiry", () => {
    const now = 1_700_000_000_000;
    expect(formatRemaining(now + 45 * 60_000, now)).toBe("ends in 45 min");
    expect(formatRemaining(now - 1, now)).toBe("expired");
  });
});

describe("formatCountdown", () => {
  it("formats MM:SS under an hour and H:MM:SS above", () => {
    const now = 1_700_000_000_000;
    expect(formatCountdown(now + 84_000, now)).toBe("01:24");
    expect(formatCountdown(now + 3_600_000 + 24_000, now)).toBe("1:00:24");
    expect(formatCountdown(now, now)).toBe("00:00");
  });
});

describe("initials", () => {
  it("produces initials from a display name", () => {
    expect(initials("Coral Wren")).toBe("CW");
    expect(initials("Ada")).toBe("A");
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });

  it("handles names with multiple middle parts", () => {
    expect(initials("  John  Van   Der   Berg  ")).toBe("JB");
  });
});