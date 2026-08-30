/**
 * Express app (HTTP layer).
 * Serves the built client in production and sets up CORS.
 */

import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { expressCorsOptions } from "./cors.js";

export function createHttpApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(cors(expressCorsOptions));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
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
