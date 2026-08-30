/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public URL of the Socket.IO backend, e.g. https://cryo-api.onrender.com */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
