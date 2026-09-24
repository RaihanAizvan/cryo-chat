# Deployment

Cryo Chat is a monorepo with a React frontend and a Node+Socket.IO backend.

It can be hosted three ways:

1. **One persistent Node app** (recommended) — the server serves the built
   frontend and the real-time backend on a single origin. Works on **Abasthan**
   or **Render** (the two supported hosts).
2. **Split hosting** — frontend on Vercel, backend on a persistent Node host.

> The Socket.IO backend cannot run on serverless (e.g. Vercel functions): it holds
> all room/message state in memory and keeps WebSocket connections alive.

The app is deployable to **both** hosts from the same repo, with the same env
var names and the same build/start commands, so migrating or running a backup
instance is a copy of config — no code differences.

## Option 1 — One Abasthan app (recommended)

Abasthan runs a persistent Node web service, so the whole app fits in one service.

- **Service type:** Web Service
- **Runtime:** Node.js 22 (or 20/18)
- **Root directory:** `./` (repo root)
- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Environment variables:**
  - `PORT` — Abasthan injects this automatically; the server listens on it.
  - `RESERVED_ROOM_CODE` — optional, default `9999`.
  - `MAX_ROOM_SIZE` — optional, default `50`.
  - `CORS_ORIGIN` — optional; same-origin requests are allowed, so you generally
    don't need this. Set it only if a separate site connects to the socket.
  - `GIPHY_API_KEY` — optional; set this to enable GIF/sticker search in the
    chat composer. It lives **server-side** (here, in root env — never in
    `client/.env`, which cannot see root vars). Requests are proxied through
    `GET /api/giphy` so the key never reaches the browser.
  - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`,
    `CLOUDINARY_UPLOAD_PRESET` — optional; enable CDN-hosted media. The
    browser uploads big files straight to Cloudinary (unsigned preset), so
    uploads are immune to the host's reverse-proxy body-size limit and consume
    **no server RAM** (media stays out of the process's memory). When these are
    unset, the app falls back to in-memory media uploads (fine for small
    images). Create the preset in the Cloudinary dashboard as *unsigned*;
    folder restriction is recommended. View-once/TTL deletion calls Cloudinary's
    signed destroy API server-side. Free tier is 25 credits/month; when the
    account is nearly out of credits the server stops offering the preset and
    the client silently falls back to in-memory uploads, so sending never
    hard-fails.
  - `STICKER_PACK_FOLDER` (default `cryo/stickers`) and
    `STICKER_PACK_REFRESH_MS` (default `300000`) — optional; enable the
    curated sticker pack (see below). They only matter when the Cloudinary
    creds above are set.

The server serves the built frontend from `client/dist` (built by the build
command) and handles `/socket.io` WebSockets on the same domain — no CORS needed.

## Sticker pack (optional)

Curated stickers live in a dedicated **Cloudinary folder** (`STICKER_PACK_FOLDER`,
default `cryo/stickers`) so the repository never grows with sticker assets. On
boot the server lists the folder once and caches only the metadata (public id,
CDN url, format, dimensions) in memory; it re-lists every
`STICKER_PACK_REFRESH_MS` so stickers you add in the Cloudinary dashboard show
up without a restart and deletions prune themselves. Image bytes stay on the
CDN and stream to viewers through a 302 redirect on fetch — access is instant
and RAM stays flat.

- **Add a sticker:** upload a PNG/WebP/GIF to the folder in the Cloudinary
  dashboard (square images look best; the client renders stickers at 96×96).
- **Picker:** the "Pack" tab lists them first, ahead of the optional Giphy
  tabs. Picking one sends it instantly by reference (no upload, no TTL).
- **Disabled automatically** when the Cloudinary creds are unset — the tab
  just disappears, and "Make a sticker"/Giphy keep working.

## Option 2 — Backend on Abasthan, frontend on Vercel

- **Abasthan (backend):** Web Service as above. Add
  `CORS_ORIGIN=https://<your-app>.vercel.app`.
- **Vercel (frontend):** set the dashboard root directory to `client`, then add
  env var `VITE_SERVER_URL=https://<your-backend>.abasthan.app`.
  The client connects to that URL via Socket.IO.

## Option 3 — Same app on Render (alongside Abasthan)

Render runs a persistent Node web service, so the whole app fits in one service
there too, exactly like Abasthan. No code changes are required — the server
serves `client/dist`, reads the injected `PORT`, and exposes `GET /health`.
The client uses WebSocket-only transport, so Render's load balancer needs no
sticky sessions (even if you later scale to multiple instances).

**Deploy (`render.yaml` in the repo root):**
- **Blueprint (recommended):** dashboard → New → Blueprint → connect this repo.
  Fill in the prompted secrets (same values you use on Abasthan), click Apply.
  The `render.yaml` sets the build/start commands, health check, Node version,
  and env vars automatically.
- **Manual:** New → Web Service → this repo, then:
  - **Build command:** `npm install && npm run build`
  - **Start command:** `npm start`
  - **Health check path:** `/health`
  - **Environment variables:** `GIPHY_API_KEY`, `CLOUDINARY_CLOUD_NAME`,
    `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_UPLOAD_PRESET`,
    `STICKER_PACK_FOLDER`, `ADMIN_KEY` — copy the values you set on Abasthan
    so both hosts behave the same. `PORT` is injected by Render automatically.

**Caveats to know:**
- **Free tier sleeps.** On the free plan Render spins the service down after
  ~15 minutes without traffic; WebSocket clients get disconnected and in-memory
  rooms are lost on wake-up. Use a paid plan (default `starter`) for a real
  chat, or accept the spin-down on a sandbox.
- **No Redis here (memory mode).** Each host keeps its own rooms/messages in
  process memory. That's fine for one instance per host and for a backup/mirror
  URL, but the two hosts do **not** share state — a room created on Abasthan
  isn't visible on Render.
- **Media uploads** behave the same as on Abasthan: in-memory fallback unless
  Cloudinary is configured, so set the Cloudinary vars to avoid losing uploads
  to a restart/deploy (Render filesystem is ephemeral except attached disks,
  which would cap you to a single instance).

### Local development
Vite (in `client/`) proxies `/socket.io` and `/health` and `/api` to
`localhost:4000`, so the app runs locally with `npm run dev`. No
`VITE_SERVER_URL` needed.

For GIF/sticker search locally, create a root `.env` (the server auto-loads it
via dotenv) with `GIPHY_API_KEY=<key>` and restart the server. The key is read
at runtime, so there's no rebuild — but the server process must restart once
after the file changes.
