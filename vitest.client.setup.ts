/**
 * jsdom test setup for the client workspace.
 * Fills the few browser globals store.ts touches at import time so tests can
 * load modules without a real socket/VITE server URL.
 */

import { afterEach } from "vitest";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// store.ts reads `import.meta.env.VITE_SERVER_URL` — unset in tests.
// getStoredSessionId/getStoredDisplayName live off localStorage; jsdom covers it.