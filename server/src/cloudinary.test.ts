import { describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the Cloudinary sticker-pack folder listing (Search API on
 * `asset_folder`). The v2 SDK is mocked to lock in the contract: the loader
 * must match the dynamic-folder field (flat public_ids, folder as metadata)
 * rather than a public_id prefix, and must paginate with next_cursor.
 */

const searchApi = vi.hoisted(() => ({
  expression: vi.fn(),
}));

const chainMock = vi.hoisted(() => ({
  max_results: vi.fn(),
  next_cursor: vi.fn(),
  execute: vi.fn(),
}));

vi.hoisted(() => {
  const chain = chainMock;
  searchApi.expression.mockReturnValue(chain);
  chain.max_results.mockReturnValue(chain);
  chain.next_cursor.mockReturnValue(chain);
});

vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    search: searchApi,
    api: {},
    uploader: {},
  },
}));

vi.mock("./config.js", () => ({
  config: {
    cloudinaryCloudName: "testcloud",
    cloudinaryApiKey: "k",
    cloudinaryApiSecret: "s",
    cloudinaryUploadPreset: "preset",
  },
}));

import { listPackResources } from "./cloudinary";

describe("listPackResources (search on asset_folder)", () => {
  it("queries the dynamic folder and maps records to pack rows", async () => {
    chainMock.execute.mockResolvedValue({
      resources: [
        {
          public_id: "cozy-cat",
          format: "jpg",
          width: 5120,
          height: 2880,
        },
        { public_id: 42 as unknown as string, format: "png", width: 1, height: 1 },
        {
          public_id: "sticker-2",
          format: "WEBP",
          width: 120,
          height: 120,
        },
      ],
    });

    const rows = await listPackResources("cryo/stickers", 512);

    expect(searchApi.expression).toHaveBeenCalledWith('asset_folder:"cryo/stickers"');
    expect(chainMock.max_results).toHaveBeenCalledWith(500);
    expect(rows).toEqual([
      { publicId: "cozy-cat", format: "jpg", width: 5120, height: 2880 },
      { publicId: "sticker-2", format: "webp", width: 120, height: 120 },
    ]);
  });

  it("passes next_cursor and keeps paging until the cap", async () => {
    chainMock.execute
      .mockResolvedValueOnce({
        resources: [{ public_id: "a", format: "png", width: 1, height: 1 }],
        next_cursor: "cur-1",
      })
      .mockResolvedValueOnce({
        resources: [{ public_id: "b", format: "png", width: 1, height: 1 }],
      });

    const rows = await listPackResources("cryo/stickers", 10);

    expect(chainMock.next_cursor).toHaveBeenCalledWith("cur-1");
    expect(rows.map((r) => r.publicId)).toEqual(["a", "b"]);
  });

  it("returns no rows when the folder would break the expression", async () => {
    chainMock.execute.mockReset();
    const rows = await listPackResources('cryo/sti"ckers', 10);
    expect(rows).toEqual([]);
    expect(chainMock.execute).not.toHaveBeenCalled();
  });

  it("caps results at the requested max", async () => {
    chainMock.execute
      .mockResolvedValueOnce({
        resources: Array.from({ length: 5 }, (_, i) => ({
          public_id: `s-${i}`,
          format: "png",
          width: 1,
          height: 1,
        })),
        next_cursor: "more",
      })
      .mockResolvedValueOnce({
        resources: Array.from({ length: 5 }, (_, i) => ({
          public_id: `t-${i}`,
          format: "png",
          width: 1,
          height: 1,
        })),
        next_cursor: "even-more",
      });

    const rows = await listPackResources("cryo/stickers", 7);
    expect(rows).toHaveLength(7);
    expect(chainMock.max_results).toHaveBeenCalledWith(7);
  });
});