# Deployment

Cryo Chat is a monorepo with a React frontend and a Node+Socket.IO backend.

It can be hosted two ways:

1. **One Abasthan app** (recommended) — the server serves the built frontend and
   the real-time backend on a single origin.
2. **Split hosting** — frontend on Vercel, backend on a persistent Node host.

> The Socket.IO backend cannot run on serverless (e.g. Vercel functions): it holds
> all room/message state in memory and keeps WebSocket connections alive.

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

The server serves the built frontend from `client/dist` (built by the build
command) and handles `/socket.io` WebSockets on the same domain — no CORS needed.

## Option 2 — Backend on Abasthan, frontend on Vercel

- **Abasthan (backend):** Web Service as above. Add
  `CORS_ORIGIN=https://<your-app>.vercel.app`.
- **Vercel (frontend):** set the dashboard root directory to `client`, then add
  env var `VITE_SERVER_URL=https://<your-backend>.abasthan.app`.
  The client connects to that URL via Socket.IO.

### Local development
Vite (in `client/`) proxies `/socket.io` and `/health` and `/api` to
`localhost:4000`, so the app runs locally with `npm run dev`. No
`VITE_SERVER_URL` needed.

For GIF/sticker search locally, create a root `.env` (the server auto-loads it
via dotenv) with `GIPHY_API_KEY=<key>` and restart the server. The key is read
at runtime, so there's no rebuild — but the server process must restart once
after the file changes.
