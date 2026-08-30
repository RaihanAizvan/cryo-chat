# Deployment

Cryo Chat is split into two deployable parts:

- **Frontend** (React + Vite) → **Vercel**
- **Backend** (Node + Express + Socket.IO) → a **persistent** Node host (Railway or Render)

> The backend must run on a persistent host. It holds all room/message state **in
> memory** and keeps WebSocket connections alive — Vercel functions are cold-started
> and have no persistent memory, so the backend **cannot** be hosted on Vercel.

## Backend (Socket.IO server)

Host on Railway or Render (a long-lived Node process). No database is needed —
all state is held in memory.

Set these environment variables:

| Variable | Suggested value | Notes |
| --- | --- | --- |
| `PORT` | (host-provided) | Railway/Render inject this automatically |
| `CORS_ORIGIN` | `https://<your-app>.vercel.app` | Comma-separated list of allowed frontend origins |
| `RESERVED_ROOM_CODE` | `99999999` | Fixed code for the always-available room (optional) |
| `MAX_ROOM_SIZE` | `50` | Optional tuning |
| `CLIENT_DIST` | *(leave unset)* | Do NOT serve the frontend from here in a split setup |

Start command (Railway/Render): `npm start` (runs the `server` workspace).

### Render example
- Type: **Web Service** (not Static Site)
- Build command: `npm install`
- Start command: `npm start`
- Set `CORS_ORIGIN=https://<your-app>.vercel.app`

## Frontend (Vercel)

1. In the Vercel dashboard, link the repo and set the **Root Directory** to `client`.
   - The `client/vercel.json` handles the build (`npm run build` → `dist`).
2. Add the `VITE_SERVER_URL` env var pointing at your backend:
   - `VITE_SERVER_URL=https://<your-backend>.onrender.com` (or Railway URL)
   - This makes the browser connect to the backend via Socket.IO.
   - If unset, the frontend connects same-origin (useful for the all-in-one VPS setup).

### Local development
The Vite dev proxy already forwards `/socket.io` and `/health` to `localhost:4000`,
so `VITE_SERVER_URL` is optional during local dev.

## CORS

The backend only allows websocket connections listed in `CORS_ORIGIN`. Make sure it
includes your exact Vercel domain (and `http://localhost:5173` if you test against a
remote backend locally).
