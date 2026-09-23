/**
 * Entry point: creates the HTTP server, wires Socket.IO, applies connection
 * limits, and starts the expiry sweep. Keeps bootstrapping thin.
 */

import http from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { createHttpApp, attachClientStatic } from "./http.js";
import { socketIoCors } from "./cors.js";
import { attachHandlers, startSweeper } from "./handlers.js";
import { destroy, loadFromStore as loadSessions } from "./sessions.js";
import { loadFromStore as loadBans } from "./bans.js";
import { getSettings, loadFromStore as loadSettings } from "./settings.js";
import { mountAdminRoutes } from "./admin.js";
import { store } from "./store.js";

const app = createHttpApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: socketIoCors,
  serveClient: false,
  // Phones/backgrounds drop connections for seconds at a time. Ride out brief
  // gaps: the server restores a returning client's rooms and replay-misses,
  // so switching apps no longer feels like a hard reconnect.
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
  },
});

// Admin console first (guarded by X-Admin-Key) so the SPA catch-all never
// shadows it, then the built client in production.
mountAdminRoutes(app, io);
attachClientStatic(app);

// Per-IP socket limit tracked here (close to connection lifecycle).
const ipCounter = new Map<string, number>();

io.use((socket, next) => {
  const ip = socket.handshake.address;
  const count = ipCounter.get(ip) ?? 0;
  if (count >= getSettings().maxSocketsPerIp) {
    next(new Error("connection_limit"));
    return;
  }
  ipCounter.set(ip, count + 1);
  next();
});

io.on("connection", (socket) => {
  attachHandlers(io, socket);

  const ip = socket.handshake.address;

  socket.on("disconnect", () => {
    // Release per-IP slot, then reap session memory.
    const count = ipCounter.get(ip);
    if (count && count > 0) {
      if (count === 1) {
        ipCounter.delete(ip);
      } else {
        ipCounter.set(ip, count - 1);
      }
    }
    destroy(socket);
  });
});

startSweeper(io);

/** Boot: connect the shared store, seed caches from it, then listen. */
async function main(): Promise<void> {
  await store.init();
  await Promise.all([loadSessions(), loadBans(), loadSettings()]);
  server.listen(config.port, () => {
    console.log(`[cryo] server listening on http://localhost:${config.port}`);
  });
}

void main();