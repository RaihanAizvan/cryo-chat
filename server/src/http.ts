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
  MAX_MEDIA_BYTES,
} from "./media.js";

/** Per-IP upload limiter state (media byte blobs are cheap to flood). */
const uploadLimits = new Map<string, { count: number; resetAt: number }>();
const UPLOAD_WINDOW_MS = 60_000;
const UPLOAD_MAX_PER_WINDOW = 20;

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

      const stored = storeMedia(bytes, mime, sessionId, {
        viewOnce,
        name: typeof name === "string" ? name : undefined,
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
        name: stored.name ?? null,
        viewOnce: stored.viewOnce,
      });
    },
  );

  // Media bytes. View-once uploads disappear for everyone once opened.
  app.get("/api/media/:id", (req, res) => {
    const sessionId =
      typeof req.query.session === "string" ? req.query.session : "";
    if (!sessionId) {
      res.status(400).json({ error: "missing_session" });
      return;
    }
    const m = getMediaFor(req.params.id, sessionId);
    if (!m) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.setHeader("Content-Type", m.mime);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.send(m.buffer);
  });

  // Recipient confirms they opened a view-once upload → bytes are deleted.
  app.post("/api/media/:id/view", (req, res) => {
    const sessionId = headerSessionId(req);
    if (!sessionId) {
      res.status(400).json({ error: "missing_session" });
      return;
    }
    const consumed = consumeViewOnce(req.params.id, sessionId);
    res.json({ ok: Boolean(consumed) });
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
