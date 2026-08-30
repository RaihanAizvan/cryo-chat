/**
 * Entry point: creates the HTTP server, wires Socket.IO, applies connection
 * limits, and starts the expiry sweep. Keeps bootstrapping thin.
 */

import http from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { createHttpApp } from "./http.js";
import { attachHandlers, startSweeper } from "./handlers.js";
import { destroy } from "./sessions.js";

const app = createHttpApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: config.corsOrigin,
    methods: ["GET", "POST"],
  },
  serveClient: false,
});

// Per-IP socket limit tracked here (close to connection lifecycle).
const ipCounter = new Map<string, number>();

io.use((socket, next) => {
  const ip = socket.handshake.address;
  const count = ipCounter.get(ip) ?? 0;
  if (count >= config.maxSocketsPerIp) {
    next(new Error("connection_limit"));
    return;
  }
  ipCounter.set(ip, count + 1);
  next();
});

io.on("connection", (socket) => {
  attachHandlers(io, socket);

  const ip = socket.handshake.address;

  socket.on("disconnect", (reason) => {
    // Release per-IP slot, then reap session memory.
    const count = ipCounter.get(ip);
    if (count && count > 0) {
      count === 1 ? ipCounter.delete(ip) : ipCounter.set(ip, count - 1);
    }
    destroy(socket);
  });
});

startSweeper(io);

server.listen(config.port, () => {
  console.log(`[cryo] server listening on http://localhost:${config.port}`);
});
