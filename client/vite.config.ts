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
      // Admin console API.
      "/admin": {
        target: "http://localhost:4000",
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
