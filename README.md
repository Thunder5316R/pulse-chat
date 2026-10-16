# Pulse — tiny real-time chat

WhatsApp-style chat with an Instagram look. Web + installable mobile app. **Zero npm dependencies.**

| | Size |
|---|---|
| Whole app shell sent to the browser (gzipped) | **~11 KB** |
| Server (`server.js`) | ~8 KB, Node built-ins only |
| `npm install` | nothing to install |

## Features
- Group chats (`#General` + create your own with **+**) and 1-to-1 direct messages
- Instagram-style "online now" story rings, online dot, "Active 5m ago"
- Typing indicator, ✓ sent / ✓✓ delivered / blue ✓✓ seen
- Reply to a message (tap to jump to the original), reactions (❤️ 😂 😮 😢 👍 🔥), double-tap to ❤️
- Photo sharing (auto-compressed in the browser to ~100–600 KB)
- Unsend your own messages, clickable links, day separators, unread badges, search
- Light / dark mode (follows the device, toggle with 🌙)
- Desktop notifications + unread count in the tab title
- **Installable app** (PWA): "Add to Home Screen" on Android & iPhone — full screen, own icon, works offline for the shell
- Auto-reconnects; shows a banner while the server wakes up

## Tech (why it's so light)
- **Server → client:** Server-Sent Events (built into every browser, works through any proxy)
- **Client → server:** plain `fetch` POST
- **Frontend:** one `index.html`, vanilla JS + CSS, no framework, system fonts
- **Storage:** in memory + `data.json` snapshot (last 200 messages per chat)
- **Identity:** each device gets a random secret key in `localStorage`; no passwords
- Runs on Windows, macOS, Linux with Node 18+; works in Chrome, Edge, Firefox, Safari (iOS 16.4+ for notifications)

## Run locally
```bash
node server.js
# open http://localhost:3000  (open a second browser / incognito to chat with yourself)
```
Test on your phone: same Wi-Fi, open `http://<your-PC-IP>:3000`.

## Deploy free (GitHub → Render) — ~3 minutes
1. Create a GitHub repo and push this folder:
   ```bash
   git init && git add . && git commit -m "Pulse chat"
   git branch -M main
   git remote add origin https://github.com/<you>/pulse-chat.git
   git push -u origin main
   ```
2. On [render.com](https://render.com) → **New → Blueprint** → pick the repo (it reads `render.yaml`).
   Or **New → Web Service**: Build command `true`, Start command `node server.js`, Plan **Free**.
3. Done — you get `https://pulse-chat-xxxx.onrender.com`. Every `git push` redeploys.

### Know the free-tier limits
- Sleeps after 15 min with no visitors; the first visit then takes ~1 min to wake (the app shows "Connecting…").
- The disk is wiped on every restart / redeploy / sleep → **chat history resets**. Fine for demos and small teams.
- Fix either one: Render Starter ($7/mo, no sleep), or move storage to a free database (see below).

## Get it on phones
- **Now (free):** open the site → Android Chrome: menu → *Install app*; iPhone Safari: Share → *Add to Home Screen*.
- **Play Store / App Store later:** wrap the same site with [Capacitor](https://capacitorjs.com) or a TWA (Android) — no rewrite.

## Next steps (when you need them)
- Permanent history: Turso / Supabase / Render Postgres instead of `data.json`
- Real login (email OTP / Google), private groups, voice notes, push notifications when the app is closed (Web Push)

## API (for reference)
`GET /events?k=KEY&n=NAME&c=COLOR` — live stream: `init, msg, room, upd, del, read, typing, user`
`POST /api/{send|typing|read|react|unsend|group|profile}` with JSON `{ k: KEY, ... }`
