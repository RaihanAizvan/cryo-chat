import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocked cloudinary/config seams for the sticker pack module. vi.hoisted keeps
 * the factories safe from ES import hoisting (they run before the module body).
 */
const mockConfig = vi.hoisted(() => ({
  stickerPackFolder: "cryo/stickers",
  stickerPackRefreshMs: 5 * 60_000,
  stickerPackTestJson: "",
}));

const cloud = vi.hoisted(() => ({
  isPackConfigured: vi.fn<() => boolean>(() => false),
  listPackResources: vi.fn(),
  remoteSecureUrl: vi.fn((id: string) => `https://cdn.test/${id}`),
}));

vi.mock("./config.js", () => ({ config: mockConfig }));
vi.mock("./cloudinary.js", () => cloud);

import {
  refreshStickerPack,
  getPackSticker,
  listPackStickers,
  packEnabled,
  resetPackForTest,
  MAX_PACK_STICKERS,
} from "./pack";

const VALID_ROWS = [
  { publicId: "cryo/stickers/happy", format: "webp", width: 256, height: 256 },
  { publicId: "cryo/stickers/waving", format: "gif", width: 120, height: 120 },
];

const INVALID_ROWS = [
  { publicId: "cryo/stickers/heic-shot", format: "heic", width: 1, height: 1 },
  { publicId: "../outside", format: "png", width: 1, height: 1 },
  { publicId: "cryo/stickers/zero-width", format: "png", width: 0, height: 1 },
];

beforeEach(() => {
  resetPackForTest();
  mockConfig.stickerPackTestJson = "";
  mockConfig.stickerPackFolder = "cryo/stickers";
  mockConfig.stickerPackRefreshMs = 5 * 60_000;
  cloud.isPackConfigured.mockReturnValue(false);
  cloud.listPackResources.mockReset();
  cloud.remoteSecureUrl.mockClear();
});

describe("sticker pack loading", () => {
  it("builds the cache from a folder listing, skipping invalid rows", async () => {
    cloud.isPackConfigured.mockReturnValue(true);
    cloud.listPackResources.mockResolvedValue([...VALID_ROWS, ...INVALID_ROWS]);

    const count = await refreshStickerPack();
    expect(count).toBe(2);

    const happy = getPackSticker("cryo/stickers/happy");
    expect(happy).not.toBeNull();
    expect(happy!.kind).toBe("sticker");
    expect(happy!.mime).toBe("image/webp");
    expect(happy!.secureUrl).toBe("https://cdn.test/cryo/stickers/happy");
    expect(happy!.name).toBe("happy");
    expect(happy!.width).toBe(256);

    expect(listPackStickers().map((s) => s.id)).toEqual([
      "cryo/stickers/happy",
      "cryo/stickers/waving",
    ]);
    expect(cloud.listPackResources).toHaveBeenCalledWith("cryo/stickers", MAX_PACK_STICKERS);
  });

  it("serves GIF pack assets as animated gif-backed stickers", async () => {
    cloud.isPackConfigured.mockReturnValue(true);
    cloud.listPackResources.mockResolvedValue(VALID_ROWS);
    await refreshStickerPack();
    const waving = getPackSticker("cryo/stickers/waving");
    expect(waving?.mime).toBe("image/gif");
  });

  it("keeps the previous cache when a refresh fails", async () => {
    cloud.isPackConfigured.mockReturnValue(true);
    cloud.listPackResources.mockResolvedValueOnce(VALID_ROWS);
    await refreshStickerPack();
    expect(packEnabled()).toBe(true);

    cloud.listPackResources.mockRejectedValueOnce(new Error("cloudinary down"));
    expect(await refreshStickerPack()).toBeNull();

    // A blip must never empty the pack.
    expect(getPackSticker("cryo/stickers/happy")).not.toBeNull();
    expect(listPackStickers()).toHaveLength(2);
  });

  it("caps the cache at MAX_PACK_STICKERS", async () => {
    cloud.isPackConfigured.mockReturnValue(true);
    const many = Array.from({ length: MAX_PACK_STICKERS + 100 }, (_, i) => ({
      publicId: `cryo/stickers/s-${i}`,
      format: "png",
      width: 1,
      height: 1,
    }));
    cloud.listPackResources.mockResolvedValue(many);
    expect(await refreshStickerPack()).toBe(MAX_PACK_STICKERS);
  });
});

describe("test-json seam", () => {
  it("seeds the pack without a Cloudinary account", async () => {
    mockConfig.stickerPackTestJson = JSON.stringify(VALID_ROWS);
    expect(packEnabled()).toBe(true);
    expect(await refreshStickerPack()).toBe(2);
    expect(getPackSticker("cryo/stickers/happy")?.name).toBe("happy");
    expect(cloud.listPackResources).not.toHaveBeenCalled();
  });

  it("returns null on invalid json and keeps the previous cache", async () => {
    mockConfig.stickerPackTestJson = JSON.stringify(VALID_ROWS);
    await refreshStickerPack();

    mockConfig.stickerPackTestJson = "{ not json";
    expect(await refreshStickerPack()).toBeNull();
    expect(listPackStickers()).toHaveLength(2);
  });
});

describe("disabled pack", () => {
  it("stays empty and reports not enabled without any backend", async () => {
    expect(packEnabled()).toBe(false);
    expect(await refreshStickerPack()).toBeNull();
    expect(listPackStickers()).toEqual([]);
  });
});