/**
 * Shared CORS policy used by both Express (HTTP) and Socket.IO (WebSocket).
 *
 * A single source of truth keeps the allowlist consistent across transport
 * layers. Critical behaviour:
 *  - Requests with no `Origin` header (non-browser clients) are always allowed.
 *  - Same-origin requests (Origin matches Host) are always allowed — this is
 *    what lets the app serve its own static assets/CSS/JS on the production
 *    domain even when the browser sends an `Origin` header.
 *  - Cross-origin requests are allowed only when their origin is on the
 *    allowlist. Disallowed origins get NO `Access-Control-Allow-Origin` header
 *    (so the browser blocks them) but are NOT crashed with a 500.
 */

import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

const COMMON_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
];

/** Allowed origins: env allowlist (if any) merged with common dev origins. */
function allowedOrigins(): string[] {
  const set = new Set<string>(COMMON_DEV_ORIGINS);
  for (const o of config.corsOrigin) set.add(o);
  return [...set];
}

function normalize(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/** Whether a request origin is allowed given the request's own Host header. */
function isOriginAllowed(origin: string | undefined, host: string): boolean {
  if (!origin) return true; // non-browser clients send no Origin
  const o = normalize(origin);
  if (allowedOrigins().includes(o)) return true;
  // Same-origin: compare against the Host the app is served from.
  const scheme = o.startsWith("https") ? "https" : "http";
  if (o === `${scheme}://${host}`) return true;
  return false;
}

/**
 * Minimal CORS middleware for Express.
 *
 * Applies `Access-Control-Allow-Origin` on matching requests and handles CORS
 * preflight (OPTIONS). Disallowed origins simply get no CORS header instead of
 * an error response, so static assets are never 500'd.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin as string | undefined;
  const host = req.headers.host ?? "";
  const allowed = isOriginAllowed(origin, host);

  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] ?? "Content-Type");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

/**
 * CORS options passed to Socket.IO. Returns `false` (no CORS header, browser
 * blocks) rather than throwing, and Same-origin requests always pass.
 */
export const socketIoCors = {
  origin: (
    origin: string | undefined,
    cb: (err: Error | null, allow?: boolean) => void,
  ) => {
    // Socket.IO passes no Host, so same-origin can't be checked here; rely on
    // the allowlist. The frontend connects cross-origin via VITE_SERVER_URL.
    if (!origin) {
      cb(null, true);
    } else {
      cb(null, allowedOrigins().includes(normalize(origin)));
    }
  },
  methods: ["GET", "POST"],
};
