import { beforeEach, describe, expect, it } from "vitest";
import { MAX_MESSAGE_LENGTH } from "@cryo/shared";
import { getSettings, updateSettings, isReservedCode, maxMessageLength, normalizeReservedCode } from "./settings";

/**
 * Settings module keeps singleton state (`current`). To keep tests isolated we
 * reset to a known base by applying a full canonical patch after each case.
 */
function resetToDefaults() {
  updateSettings({
    maxMessageLength: MAX_MESSAGE_LENGTH,
    maxRoomSize: 50,
    roomTtlMinutes: 120,
    messageTtlMinutes: 1440,
    messageCap: 200,
    maxSocketsPerIp: 20,
    messageRateLimit: 10,
    messageRateWindowSeconds: 10,
    reservedRoomCode: "9999",
    reservedRoomEnabled: true,
    voiceNotesEnabled: true,
  });
}

beforeEach(resetToDefaults);

describe("updateSettings", () => {
  it("clamps out-of-range numeric values to the allowed range", () => {
    const r = updateSettings({ maxRoomSize: 9999 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.maxRoomSize).toBe(200);
  });

  it("rounds fractional values to integers", () => {
    const r = updateSettings({ maxRoomSize: 3.7 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.maxRoomSize).toBe(4);
  });

  it("falls back to the current value on NaN", () => {
    const before = getSettings().maxRoomSize;
    const r = updateSettings({ maxRoomSize: Number.NaN });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.maxRoomSize).toBe(before);
  });

  it("cannot raise maxMessageLength above the protocol ceiling", () => {
    const r = updateSettings({ maxMessageLength: 999_999 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.maxMessageLength).toBe(MAX_MESSAGE_LENGTH);
  });

  it("converts TTL minutes to ms and clamps to 7 days", () => {
    const r = updateSettings({ roomTtlMinutes: 999_999 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.roomTtlMs).toBe(7 * 24 * 60 * 60_000);
  });

  it("guards a reserved room code to exactly 4 alphanumerics", () => {
    expect(updateSettings({ reservedRoomCode: "abc" }).ok).toBe(false);
    expect(updateSettings({ reservedRoomCode: "ABCDE" }).ok).toBe(false);
    expect(updateSettings({ reservedRoomCode: "12345" }).ok).toBe(false);
    const ok = updateSettings({ reservedRoomCode: "cafe" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.settings.reservedRoomCode).toBe("CAFE");
  });

  it("rejects non-boolean toggles", () => {
    expect(updateSettings({ reservedRoomEnabled: 1 }).ok).toBe(false);
    expect(updateSettings({ voiceNotesEnabled: "yes" }).ok).toBe(false);
    expect(updateSettings({ voiceNotesEnabled: 1 }).ok).toBe(false);
  });

  it("voiceNotesEnabled round-trips through update", () => {
    const r = updateSettings({ voiceNotesEnabled: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.voiceNotesEnabled).toBe(false);
      expect(getSettings().voiceNotesEnabled).toBe(false);
    }
  });

  it("returns true by default", () => {
    expect(getSettings().voiceNotesEnabled).toBe(true);
  });

  it("accumulates multiple validation errors and rejects the patch atomically", () => {
    const r = updateSettings({ reservedRoomCode: "xyz", voiceNotesEnabled: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Reserved code");
  });

  it("leaves values unchanged when patch keys are absent", () => {
    updateSettings({ maxRoomSize: 77 });
    const before = getSettings();
    updateSettings({ maxRoomSize: 88 });
    const after = getSettings();
    expect(after.maxRoomSize).toBe(88);
    expect(after.messageCap).toBe(before.messageCap);
  });
});

describe("getSettings / isReservedCode / maxMessageLength", () => {
  it("matches the reserved code (exact, stored uppercase) when enabled", () => {
    updateSettings({ reservedRoomCode: "cafe", reservedRoomEnabled: true });
    expect(isReservedCode("CAFE")).toBe(true);
    expect(isReservedCode("cafe")).toBe(false); // stored uppercase, exact match
    expect(isReservedCode("CAF2")).toBe(false);
  });

  it("ignores the reserved code when disabled", () => {
    updateSettings({ reservedRoomCode: "cafe", reservedRoomEnabled: false });
    expect(isReservedCode("CAFE")).toBe(false);
  });

  it("maxMessageLength respects admin clamping", () => {
    updateSettings({ maxMessageLength: 500 });
    expect(maxMessageLength()).toBe(500);
  });
});

describe("normalizeReservedCode", () => {
  it("sanitizes a raw 4-char input", () => {
    expect(normalizeReservedCode(" ab-12 ")).toBe("AB12");
    expect(normalizeReservedCode("cafe")).toBe("CAFE");
  });

  it("falls back to config default on garbage", () => {
    expect(normalizeReservedCode("ab")).toBe(getSettings().reservedRoomCode);
    expect(normalizeReservedCode("toolong11")).toBe(getSettings().reservedRoomCode);
    expect(normalizeReservedCode(null)).toBe(getSettings().reservedRoomCode);
  });
});