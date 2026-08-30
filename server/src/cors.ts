/**
 * Shared CORS policy used by both Express (HTTP) and Socket.IO (WebSocket).
 *
 * A single source of truth keeps the allowlist consistent across transport
 * layers and guarantees the browser sees `Access-Control-Allow-Origin`.
 */

import type { CorsOptions } from "cors";
import { config } from "./config.js";

const COMMON_DEV_ORIGINS = ["http://localhost:5173", "http://localhost:5174"];

/** Allowed origins: env allowlist (if any) merged with common dev origins. */
function allowedOrigins(): string[] {
  const set = new Set<string>(COMMON_DEV_ORIGINS);
  for (const o of config.corsOrigin) set.add(o);
  return [...set];
}

/** True when the given request origin is allowed. */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients send no Origin
  return allowedOrigins().includes(origin);
}

/** CORS options for the Express `cors` middleware. */
export const expressCorsOptions: CorsOptions = {
  origin: (origin, cb) => {
    if (isOriginAllowed(origin)) cb(null, true);
    else cb(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST"],
};

/** CORS options passed to the Socket.IO server. */
export const socketIoCors = {
  origin: (
    origin: string | undefined,
    cb: (err: Error | null, allow?: boolean) => void,
  ) => {
    cb(null, isOriginAllowed(origin));
  },
  methods: ["GET", "POST"],
};
