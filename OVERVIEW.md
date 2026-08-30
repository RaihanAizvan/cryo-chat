# Cryo Chat — Overview

Anonymous, ephemeral, real-time chat. No accounts. Rooms appear on demand, live a
short while, then vanish. Like a chat that self-destructs.

## Architecture

```
┌───────────────┐    Socket.IO (WebSocket)    ┌───────────────┐
│  Frontend     │ ───────────────────────────▶ │  Backend      │
│  React + Vite │                             │  Node + Socket.IO
│  (serverless) │                             │  (persistent) │
└───────────────┘                             └───────────────┘
                                                     │
                                             all state in memory
                                         (rooms, messages, presence)
```

- **Frontend** — React + Vite + Tailwind.
- **Backend** — Node + Express + **Socket.IO**, holds everything **in memory**.
  Runs on a **persistent** host (new: **Abasthan**) because WebSocket rooms and
  state can't survive serverless cold starts. The server also serves the built
  frontend, so the whole app runs from a single Abasthan app.
- **Shared** — one small `@cryo/shared` package with the message/room protocol
  types used by both sides.
- Live via WebSocket: messages, who's online, join/leave, read receipts.

## Key features
- No login, ephemeral invite links (short room codes).
- Rooms auto-expire after a while (longer while people are in them).
- Live "seen" ticks, online participant count.
- Instagram-style emoji picker + WhatsApp-style large emoji messages.

## Workspaces
- `client/` — React app (builds to `client/dist`, served by the backend).
- `server/` — Socket.IO server (the one Abasthan web service, `npm start`).
- `shared/` — shared protocol types.
