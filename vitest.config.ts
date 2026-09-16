import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Single Vitest runner across all three workspaces.
 *
 * Projects:
 *  - shared: pure protocol helpers, node environment.
 *  - server: domain logic + full socket integration (blanket/happy path), node.
 *  - client: browser-side pure logic + React store tests, jsdom.
 *
 * Server integration spawns the real compiled bundle (server/dist/index.mjs)
 * exactly like production boots, so it validates the shipped artifact too.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "shared",
          environment: "node",
          include: ["shared/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "server",
          environment: "node",
          include: ["server/src/**/*.test.ts"],
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: "client",
          environment: "jsdom",
          include: ["client/src/**/*.test.ts"],
          // Client tests only exercise pure helpers + the store; none of the
          // lib files touch import.meta.env/VITE at runtime except store.ts,
          // which we give stable defaults below.
          setupFiles: [fileURLToPath(new URL("./vitest.client.setup.ts", import.meta.url))],
        },
      },
    ],
  },
});