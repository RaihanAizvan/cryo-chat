import { beforeEach, describe, expect, it } from "vitest";
import {
  resetForTest,
  storeMedia,
  getMedia,
  hasMedia,
  getMediaFor,
  consumeViewOnce,
  pruneMedia,
  mediaStats,
  storeRemoteMedia,
  getRemoteFor,
  consumeRemoteViewOnce,
  MAX_MEDIA_BYTES,
  MIN_MEDIA_BYTES,
} from "./media";
import { updateSettings } from "./settings";

/** Tiny valid PNG signature + IHDR-ish buffer (>= 24 bytes) that readDimensions accepts. */
function pngBuffer(width = 2, height = 2): Buffer {
  const buf = Buffer.alloc(24);
  // Real PNG signature: 89 50 4E 47 0D 0A 1A 0A
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  // Width/height land at offsets 16/20 (after sig + len + "IHDR").
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function audioBuffer(): Buffer {
  return Buffer.alloc(64, 0x61); // arbitrary audio bytes (>= 16)
}

function tooSmall(): Buffer {
  return Buffer.alloc(4, 0x61);
}

beforeEach(() => {
  resetForTest();
  updateSettings({ messageTtlMinutes: 1440 });
});

describe("storeMedia validation", () => {
  it("rejects payloads outside the size bounds", () => {
    expect(storeMedia(tooSmall(), "image/png", "s1")).toBeNull();
    const huge = Buffer.alloc(MAX_MEDIA_BYTES + 1, 0x61);
    expect(storeMedia(huge, "image/png", "s1")).toBeNull();
  });

  it("rejects non-accepted mime types", () => {
    expect(storeMedia(pngBuffer(), "text/html", "s1")).toBeNull();
    expect(storeMedia(audioBuffer(), "application/pdf", "s1")).toBeNull();
  });

  it("rejects image bytes that fail the signature check", () => {
    expect(storeMedia(Buffer.alloc(32, 0x61), "image/png", "s1")).toBeNull();
  });

  it("accepts valid images and records dimensions", () => {
    const meta = storeMedia(pngBuffer(10, 20), "image/png", "s1");
    expect(meta).not.toBeNull();
    expect(meta!.width).toBe(10);
    expect(meta!.height).toBe(20);
    expect(meta!.kind).toBe("image");
  });
});

describe("getMedia / hasMedia / TTL expiry", () => {
  it("returns the stored media and tracks presence", () => {
    const meta = storeMedia(pngBuffer(), "image/png", "s1");
    expect(meta).not.toBeNull();
    expect(hasMedia(meta!.id)).toBe(true);
    expect(getMedia(meta!.id)).toBeDefined();
    expect(hasMedia("missing")).toBe(false);
  });

  it("drops media after messageTtlMs elapses", () => {
    const meta = storeMedia(pngBuffer(), "image/png", "s1");
    updateSettings({ messageTtlMinutes: 1 });
    const now = Date.now();
    const realNow = Date.now;
    Date.now = () => now + 60_001;
    try {
      expect(hasMedia(meta!.id)).toBe(false);
      pruneMedia(Date.now());
    } finally {
      Date.now = realNow;
    }
  });
});

describe("view-once flow", () => {
  it("allows the uploader to view before anyone else", () => {
    const meta = storeMedia(pngBuffer(), "image/png", "uploader", { viewOnce: true });
    expect(meta!.viewOnce).toBe(true);
    expect(getMediaFor(meta!.id, "uploader")).not.toBeNull();
  });

  it("blocks a second viewer after the first non-uploader views", () => {
    const meta = storeMedia(pngBuffer(), "image/png", "uploader", { viewOnce: true });
    const first = consumeViewOnce(meta!.id, "viewer1");
    expect(first).not.toBeNull();
    // Bytes dropped => uploader can no longer pull it back either.
    expect(getMediaFor(meta!.id, "uploader")).toBeNull();
    expect(hasMedia(meta!.id)).toBe(false);
  });

  it("uploader cannot consume their own view-once media", () => {
    const meta = storeMedia(pngBuffer(), "image/png", "uploader", { viewOnce: true });
    expect(consumeViewOnce(meta!.id, "uploader")).toBeNull();
    expect(hasMedia(meta!.id)).toBe(true);
  });

  it("consumeViewOnce on non-view-once media is a no-op", () => {
    const meta = storeMedia(pngBuffer(), "image/png", "uploader");
    expect(consumeViewOnce(meta!.id, "viewer")).toBeNull();
    expect(hasMedia(meta!.id)).toBe(true);
  });
});

describe("voice notes + naming", () => {
  it("classifies audio as voice and clamps duration", () => {
    const meta = storeMedia(audioBuffer(), "audio/webm", "s1", { duration: 5000, name: "../evil/note.webm" });
    expect(meta!.kind).toBe("voice");
    expect(meta!.duration).toBe(600); // clamped to 600 max
    expect(meta!.name).toBe("note.webm"); // path stripped
  });

  it("stores stickers with force kind", () => {
    const meta = storeMedia(pngBuffer(), "image/png", "s1", { kind: "sticker" });
    expect(meta!.kind).toBe("sticker");
  });
});

describe("remote media (Cloudinary)", () => {
  it("registers and resolves a valid remote asset", () => {
    const rec = storeRemoteMedia({
      publicId: "folder/photo",
      secureUrl: "https://res.cloudinary.com/x/image/upload/v1/folder/photo.jpg",
      format: "jpg",
      width: 100,
      height: 200,
      uploadedBy: "s1",
    });
    expect(rec).not.toBeNull();
    expect(rec!.kind).toBe("image");
    const resolved = getRemoteFor(rec!.id, "anyone");
    expect(resolved).not.toBeNull();
    expect(resolved!.secureUrl).toContain("folder/photo.jpg");
  });

  it("rejects unsafe public ids and unknown formats", () => {
    expect(
      storeRemoteMedia({
        publicId: "../outside",
        secureUrl: "https://example.com/x",
        format: "jpg",
        width: 1,
        height: 1,
        uploadedBy: "s1",
      }),
    ).toBeNull();
    expect(
      storeRemoteMedia({
        publicId: "fine/id",
        secureUrl: "https://example.com/x",
        format: "heic",
        width: 1,
        height: 1,
        uploadedBy: "s1",
      }),
    ).toBeNull();
  });

  it("consumeRemoteViewOnce drops one-time media after first view", () => {
    const rec = storeRemoteMedia({
      publicId: "once",
      secureUrl: "https://res.cloudinary.com/x/once.jpg",
      format: "jpg",
      width: 1,
      height: 1,
      uploadedBy: "uploader",
      viewOnce: true,
    });
    expect(rec).not.toBeNull();
    expect(consumeRemoteViewOnce(rec!.id, "first")).not.toBeNull();
    expect(getRemoteFor(rec!.id, "uploader")).toBeNull();
  });

  it("does not let the uploader consume their own remote view-once media", () => {
    const rec = storeRemoteMedia({
      publicId: "mine",
      secureUrl: "https://res.cloudinary.com/x/mine.jpg",
      format: "jpg",
      width: 1,
      height: 1,
      uploadedBy: "uploader",
      viewOnce: true,
    });
    expect(rec).not.toBeNull();
    expect(consumeRemoteViewOnce(rec!.id, "uploader")).toBeNull();
    expect(getRemoteFor(rec!.id, "uploader")).not.toBeNull();
  });
});

describe("mediaStats", () => {
  it("reflects local store contents", () => {
    expect(mediaStats().inMemoryFiles).toBe(0);
    storeMedia(pngBuffer(), "image/png", "s1");
    storeMedia(audioBuffer(), "audio/wav", "s2");
    const stats = mediaStats();
    expect(stats.inMemoryFiles).toBe(2);
    expect(stats.inMemoryBytes).toBe(24 + 64);
  });
});