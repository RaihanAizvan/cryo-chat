import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy Socket.IO + API to the backend in development.
    proxy: {
      "/socket.io": {
        target: "http://localhost:4000",
        ws: true,
      },
      "/health": {
        target: "http://localhost:4000",
      },
      // Media uploads/fetches go to the backend over plain HTTP.
      "/api": {
        target: "http://localhost:4000",
      },
      // Admin console API. The bare /admin route is the admin SPA itself,
      // which Vite must serve as the dev index.html (so /src/main.tsx + react
      // refresh boot the app). Only API sub-paths (e.g. /admin/stats) proxy to
      // the backend; proxying the bare route returns the production dist HTML,
      // whose hashed /assets/* do not exist under the dev server.
      "/admin": {
        target: "http://localhost:4000",
        bypass(req) {
          if (req.url === "/admin" || req.url === "/admin/") return req.url;
        },
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
