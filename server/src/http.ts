/**
 * Express app (HTTP layer).
 * Serves the built client in production and sets up CORS.
 */

import express from "express";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { corsMiddleware } from "./cors.js";
import {
  storeMedia,
  getMediaFor,
  consumeViewOnce,
  storeRemoteMedia,
  getRemoteFor,
  consumeRemoteViewOnce,
  MAX_MEDIA_BYTES,
} from "./media.js";
import {
  cloudinaryUploadInfo,
  fetchRemoteDetails,
  remoteSecureUrl,
} from "./cloudinary.js";

/** Per-IP upload limiter state (media byte blobs are cheap to flood). */
const uploadLimits = new Map<string, { count: number; resetAt: number }>();
const UPLOAD_WINDOW_MS = 60_000;
const UPLOAD_MAX_PER_WINDOW = 20;

/** Per-IP Giphy search limiter (the proxy now hides the key, so guard it). */
const giphyLimits = new Map<string, { count: number; resetAt: number }>();
const GIPHY_WINDOW_MS = 60_000;
const GIPHY_MAX_PER_WINDOW = 60;

function allowUpload(ip: string): boolean {
  const now = Date.now();
  const bucket = uploadLimits.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    uploadLimits.set(ip, { count: 1, resetAt: now + UPLOAD_WINDOW_MS });
    return true;
  }
  if (bucket.count >= UPLOAD_MAX_PER_WINDOW) return false;
  bucket.count += 1;
  return true;
}

function allowGiphySearch(ip: string): boolean {
  const now = Date.now();
  const bucket = giphyLimits.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    giphyLimits.set(ip, { count: 1, resetAt: now + GIPHY_WINDOW_MS });
    return true;
  }
  if (bucket.count >= GIPHY_MAX_PER_WINDOW) return false;
  bucket.count += 1;
  return true;
}

interface GiphyImage {
  url?: string;
}
interface GiphyImageSet {
  fixed_width_small?: GiphyImage;
  fixed_width?: GiphyImage;
  fixed_height?: GiphyImage;
  downsized?: GiphyImage;
  original?: GiphyImage;
}
interface GiphyResult {
  id: string;
  title: string;
  images?: GiphyImageSet;
}

/** Compact, client-ready shape: small preview + one full (download) URL. */
function toGiphyEntry(r: GiphyResult) {
  const images = r.images;
  const preview = images?.fixed_width_small?.url ?? "";
  const full =
    images?.fixed_width?.url ??
    images?.fixed_height?.url ??
    images?.downsized?.url ??
    images?.original?.url ??
    preview;
  return { id: r.id, title: r.title, preview, full };
}

function headerSessionId(req: express.Request): string {
  const v = req.headers["x-session-id"];
  return typeof v === "string" ? v : "";
}

export function createHttpApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(corsMiddleware);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Raw body only for media uploads (avoids a global body parser / JSON limit).
  app.post(
    "/api/media",
    express.raw({ type: () => true, limit: `${MAX_MEDIA_BYTES}` }),
    (req, res) => {
      const ip = (req.ip ?? req.socket.remoteAddress) || "unknown";
      if (!allowUpload(ip)) {
        res.status(429).json({ error: "too_many_uploads" });
        return;
      }
      const bytes = Buffer.isBuffer(req.body) ? req.body : undefined;
      if (!bytes || bytes.length === 0) {
        res.status(400).json({ error: "empty_upload" });
        return;
      }
      const mime = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const sessionId = headerSessionId(req);
      if (!sessionId) {
        res.status(400).json({ error: "missing_session" });
        return;
      }
      const viewOnce = req.headers["x-view-once"] === "1" || req.headers["x-view-once"] === "true";
      const name = req.headers["x-media-name"];
      const kindHeader = req.headers["x-media-kind"];
      const durationHeader = req.headers["x-media-duration"];

      const stored = storeMedia(bytes, mime, sessionId, {
        viewOnce,
        name: typeof name === "string" ? name : undefined,
        kind:
          kindHeader === "sticker"
            ? "sticker"
            : kindHeader === "voice"
              ? "voice"
              : undefined,
        duration:
          typeof durationHeader === "string" && durationHeader.trim() !== ""
            ? Number.parseFloat(durationHeader)
            : undefined,
      });
      if (!stored) {
        // Distinguish "rejected payload" from "at capacity" without leaking.
        res.status(400).json({ error: "invalid_media" });
        return;
      }
      res.status(201).json({
        mediaId: stored.id,
        type: stored.kind,
        width: stored.width,
        height: stored.height,
        duration: stored.duration,
        name: stored.name ?? null,
        viewOnce: stored.viewOnce,
      });
    },
  );

  // Media bytes. View-once uploads disappear for everyone once opened. Remote
  // (Cloudinary) records redirect to the CDN URL instead of streaming bytes.
  app.get("/api/media/:id", (req, res) => {
    const sessionId =
      typeof req.query.session === "string" ? req.query.session : "";
    if (!sessionId) {
      res.status(400).json({ error: "missing_session" });
      return;
    }
    const m = getMediaFor(req.params.id, sessionId);
    if (m) {
      res.setHeader("Content-Type", m.mime);
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.send(m.buffer);
      return;
    }
    const r = getRemoteFor(req.params.id, sessionId);
    if (r) {
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.redirect(302, r.secureUrl);
      return;
    }
    res.status(404).json({ error: "not_found" });
  });

  // Recipient confirms they opened a view-once upload → bytes are deleted.
  app.post("/api/media/:id/view", (req, res) => {
    const sessionId = headerSessionId(req);
    if (!sessionId) {
      res.status(400).json({ error: "missing_session" });
      return;
    }
    const consumed =
      consumeViewOnce(req.params.id, sessionId) ??
      consumeRemoteViewOnce(req.params.id, sessionId);
    res.json({ ok: Boolean(consumed) });
  });

  // Cloudinary is optional: the client asks here for the direct-upload preset,
  // and 404s mean "use the in-memory upload path" (unconfigured OR out of
  // credits). No API key leaks — unsigned presets need only the (public) cloud
  // name and preset name.
  app.get("/api/cloudinary/preset", async (_req, res) => {
    const info = await cloudinaryUploadInfo();
    if (!info) {
      res.status(404).json({ error: "no_cloudinary" });
      return;
    }
    res.json(info);
  });

  // Register a file the browser already uploaded to Cloudinary (unsigned
  // preset), returning a normal mediaId the message pipeline can use. The
  // public_id is re-validated against Cloudinary so clients can't register
  // arbitrary URLs, and no bytes cross our server.
  app.post(
    "/api/media/remote",
    express.json({ limit: "16kb" }),
    async (req, res) => {
      const ip = (req.ip ?? req.socket.remoteAddress) || "unknown";
      if (!allowUpload(ip)) {
        res.status(429).json({ error: "too_many_uploads" });
        return;
      }
      const sessionId = headerSessionId(req);
      if (!sessionId) {
        res.status(400).json({ error: "missing_session" });
        return;
      }
      const body = (req.body ?? {}) as {
        publicId?: unknown;
      };
      const publicId = typeof body.publicId === "string" ? body.publicId.trim() : "";
      if (!publicId) {
        res.status(400).json({ error: "invalid_remote" });
        return;
      }
      const details = await fetchRemoteDetails(publicId);
      if (!details) {
        res.status(400).json({ error: "unknown_public_id" });
        return;
      }
      const viewOnce =
        req.headers["x-view-once"] === "1" || req.headers["x-view-once"] === "true";
      const name = req.headers["x-media-name"];
      const kindHeader = req.headers["x-media-kind"];

      const stored = storeRemoteMedia({
        publicId,
        secureUrl: remoteSecureUrl(publicId),
        format: details.format,
        width: details.width,
        height: details.height,
        uploadedBy: sessionId,
        viewOnce,
        name: typeof name === "string" ? name : undefined,
        kind: kindHeader === "sticker" ? "sticker" : undefined,
      });
      if (!stored) {
        res.status(400).json({ error: "invalid_remote" });
        return;
      }
      res.status(201).json({
        mediaId: stored.id,
        type: stored.kind,
        width: stored.width,
        height: stored.height,
        name: stored.name ?? null,
        viewOnce: stored.viewOnce,
      });
    },
  );

  // GIF / sticker search. The Giphy key lives server-side (Abasthan root env),
  // so the client needs no build-time VITE_ var and the key stays out of the
  // bundle. Only result metadata is proxied; actual GIF bytes are fetched by
  // the client straight from Giphy's public CDN when one is picked.
  app.get("/api/giphy", async (req, res) => {
    if (!config.giphyApiKey) {
      res.status(503).json({ error: "no_giphy_key" });
      return;
    }
    const ip = (req.ip ?? req.socket.remoteAddress) || "unknown";
    if (!allowGiphySearch(ip)) {
      res.status(429).json({ error: "too_many_searches" });
      return;
    }
    const kind =
      req.query.kind === "stickers"
        ? "stickers"
        : req.query.kind === "gifs"
          ? "gifs"
          : "gifs";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const endpoint = q ? "search" : "trending";
    const url = new URL(`https://api.giphy.com/v1/${kind}/${endpoint}`);
    url.searchParams.set("api_key", config.giphyApiKey);
    url.searchParams.set("limit", "28");
    url.searchParams.set("rating", "g");
    if (q) url.searchParams.set("q", q);

    try {
      const upstream = await fetch(url.toString(), {
        signal: AbortSignal.timeout(8000),
        headers: { accept: "application/json" },
      });
      if (!upstream.ok) {
        res.status(502).json({ error: "giphy_upstream", status: upstream.status });
        return;
      }
      const data = (await upstream.json()) as { data?: GiphyResult[] };
      const results = (data.data ?? []).map(toGiphyEntry);
      res.json({ results });
    } catch {
      res.status(502).json({ error: "giphy_unreachable" });
    }
  });

  // Production static serving of the built client.
  if (config.clientDist) {
    const dist = path.resolve(config.clientDist);
    if (fs.existsSync(dist)) {
      app.use(express.static(dist));
      app.get("/r/:roomId", (_req, res) => {
        res.sendFile(path.join(dist, "index.html"));
      });
      app.get("*", (_req, res) => {
        res.sendFile(path.join(dist, "index.html"));
      });
    }
  }

  return app;
}
