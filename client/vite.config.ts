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
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
