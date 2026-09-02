# Cryo Chat 

  

An anonymous chat app. No accounts, no history.  You hop in, talk, bounce. The chats literally melts away after a while.

Basically a chat that's built to vanish. 

we value our privacy

---

  

![Home screen](docs/screenshots/home.png)

  

![Chat with emoji picker](docs/screenshots/chat.png)


---

  

##  What it can do

  

- **No login, ever.** Open the link (or type code), type a name (or don't), and you're in.

- **Rooms self-destruct.** Chats and rooms expire on their own and get wiped. Nothing is saved to a database. infact there is no database

- **Share by code or link.** Every room has a short code. Send it to a friend, they're in.

- **Real-time everything.** WebSockets (Socket.IO) — messages, who's online, join/leave. All live.

- **Read receipts.** A ✓ = sent. A ✓✓ = someone else is in the room and saw it.

- **See who's around.** Live participant count right in the header.

- **Recent rooms.** Jump back into places you visited, with a live "expires in…" countdown.

- **Emoji picker.** Instagram-style, with categories and your recent emoji.

- **Big emoji messages.** Send just an emoji and it shows up big, no bubble — WhatsApp style.

  


  

---



  

---

  

##  Deployment

  

The full guide is in [`DEPLOYMENT.md`](DEPLOYMENT.md). Quick version:

  

- **Easiest:** one **Abasthan** app serving both frontend + backend. Root `./`, build `npm install && npm run build`, start `npm start`.

- **Alternative:** frontend on **Vercel** (`client/` folder), backend on **Abasthan**, connected with `VITE_SERVER_URL` + `CORS_ORIGIN`.

The backend holds everything **in memory** — there's no database. That's what makes it fast, simple, and truly temporary.

  

Because sockets + in-memory rooms need a **persistent** process, the backend runs on **Abasthan** (not serverless). In the usual setup, the backend also serves the built frontend, so the whole thing lives on one URL. Details in [`DEPLOYMENT.md`](DEPLOYMENT.md).
  

Both already work out of the box.

  

---

  

##   Privacy matters

  

- No accounts, no email, no tracking. Your name is just something you type in your browser — not stored anywhere.

- Everything lives in server memory and gets swept away by a timer. No database, nothing to leak.

- Rooms and messages auto-expire. Old chats don't hang around.

  
The trade-off, honestly: it's not for stuff you need to keep. It's for the here-and-now.

  

---

  

##  Stack

  

- **Frontend:** React 18, Vite 6, TypeScript, Tailwind

- **Backend:** Node, Express 4, Socket.IO 4

- **Tooling:** npm workspaces, tsx, concurrently

- **Hosting:** Abasthan (and Vercel if you split it)

  

---

  

## ❓ Quick FAQ

  

**Will you save my messages?**

Nope. In-memory only, pruned by a timer. Nothing hits a disk database.

  

**Why did my room vanish?**

Rooms expire after being quiet for a bit (longer while people are in them). That's the whole point — it's ephemeral.

  

**What do the ticks mean?**

✓ = sent. ✓✓ = someone else is around and has seen it.

  