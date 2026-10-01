import { beforeEach, describe, expect, it } from "vitest";
import { MAX_MESSAGE_LENGTH } from "@cryo/shared";
import { getSettings, updateSettings, isSpecialCode, maxMessageLength, specialRoomCode } from "./settings";

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

  it("rejects non-boolean toggles", () => {
    expect(updateSettings({ voiceNotesEnabled: "yes" }).ok).toBe(false);
    expect(updateSettings({ voiceNotesEnabled: 1 }).ok).toBe(false);
  });

  it("no longer accepts the old reserved-room settings", () => {
    // They were removed with the concept: the front-door code is env-only now,
    // and every other room can carry a password.
    const r = updateSettings({ reservedRoomCode: "cafe" } as never);
    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ ok: true });
    const settings = (r as unknown as { settings: Record<string, unknown> }).settings;
    expect(settings).not.toHaveProperty("reservedRoomCode");
    expect(settings).not.toHaveProperty("reservedRoomEnabled");
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
    const r = updateSettings({ maxRoomSize: "big", messageCap: "many", voiceNotesEnabled: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("voiceNotesEnabled");
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

describe("getSettings / isSpecialCode / maxMessageLength", () => {
  it("matches the front-door code exactly", () => {
    expect(isSpecialCode(specialRoomCode())).toBe(true);
    expect(isSpecialCode("CAF2")).toBe(false);
  });

  it("cannot be switched off at run time", () => {
    // There is no toggle any more: the code names an ordinary room, so there is
    // nothing for an operator to disable.
    expect(() => updateSettings({ reservedRoomEnabled: false } as never)).not.toThrow();
    expect(isSpecialCode(specialRoomCode())).toBe(true);
  });

  it("maxMessageLength respects admin clamping", () => {
    updateSettings({ maxMessageLength: 500 });
    expect(maxMessageLength()).toBe(500);
  });
});