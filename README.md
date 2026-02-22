# Motion.io

**Play with your hands. Pop your rivals.**

A real-time multiplayer arena game controlled entirely by hand gestures in the browser. No controller, no keyboard—just your camera and your hands. Move, sprint, and shoot orbs to eliminate other players in a shared lobby. All gesture processing runs locally on your device; only game state is synced over the network.

---

## Features

- **Hand-based controls** — MediaPipe hand tracking in the browser (no video sent to servers)
- **Single shared lobby** — One global room; everyone who hits “Play” joins the same arena
- **Real-time multiplayer** — WebSocket sync with a Go game server (movement, orbs, eliminations)
- **Scoring** — Passive points for staying alive, bonus for kills, and extra for taking out high-score players
- **Sprint & stamina** — Pinch to sprint; stamina depletes while sprinting and regens when you ease off
- **Orb combat** — Fist to launch your orb; hits eliminate other players

---

## How to play

| Action    | Gesture / Input              |
|----------|------------------------------|
| **Move** | Open hand, offset from center (joystick-style) |
| **Sprint** | Pinch (faster movement, uses stamina) |
| **Attack** | Fist (shoots orb along its orbit) |
| **Normal move** | Point (no sprint) |
| **Recenter** | Press **C** or click “Recenter” to reset joystick center |

The game runs in a fixed arena. Stay alive, dodge orbs, and knock out others to climb the leaderboard.

---

## Project structure

```
motion-demo/
├── client/                 # Browser frontend (Vite + JS)
│   ├── src/client/         # Entry point and game code
│   │   ├── main.js         # Boot, camera, menu, play/exit, input loops
│   │   ├── NetworkManager.js  # WebSocket, world state, single-lobby join
│   │   ├── Renderer.js     # Canvas render (map, players, orbs, HUD, leaderboard)
│   │   ├── HandTracker.js  # MediaPipe hand detection
│   │   ├── HandHeuristics.js # Gesture logic (point, pinch, fist, etc.)
│   │   ├── index.html
│   │   └── style.css
│   ├── vite.config.js      # Root: src/client, build outDir: ../../dist
│   └── package.json
├── server/                 # Game backend (Go)
│   ├── main.go             # Entry; calls network.Start()
│   ├── network/            # HTTP + WebSocket server, /ws handler
│   ├── room/               # Room lifecycle, join/leave, game loop
│   ├── game/               # State, step (movement, stamina, orbs, hits, scoring)
│   ├── protocol/           # Message encoding (welcome, state, input)
│   ├── config/             # Env loading (.env, NETWORK_ADDR)
│   ├── go.mod / go.sum
│   └── .env                # NETWORK_ADDR (required)
├── scripts/
│   └── ngrok-env.sh        # Writes client/.env and server/.env from ngrok tunnel
└── README.md
```

---

## Requirements

- **Node.js** (e.g. 18+) — for the client (Vite, MediaPipe)
- **Go** (1.21+) — for the game server
- **Camera** — for hand tracking (used only in the browser, not streamed)
- **HTTPS in production** — required for camera; use ngrok or similar for local WSS

---

## Quick start (local)

### 1. Server

The server reads `NETWORK_ADDR` from `server/.env` (e.g. `:8080`). Create the file if it doesn’t exist:

```bash
cd server
echo 'NETWORK_ADDR=:8080' > .env
go run .
```

You should see a log like: `listening on :8080 (ws: /ws, api: /rooms)`.

### 2. Client

The client needs the WebSocket URL. For local use, it defaults to `ws://localhost:8080/ws` if no env is set.

```bash
cd client
npm install
npm run dev
```

Vite will serve the app (e.g. http://localhost:3000). Open it, allow the camera, then click **Initialize Camera** → **Play**. You’ll join the single lobby over WebSocket (no HTTP room list).

### 3. Optional: ngrok for a public URL

To play over the internet (e.g. from a phone or another network), expose the server with ngrok and point the client at the tunnel:

```bash
# Terminal 1: start Go server
cd server && go run .

# Terminal 2: start ngrok (e.g. to port 8080)
ngrok http 8080
# Use the reported https URL, e.g. https://abc123.ngrok-free.app

# Terminal 3: client with WebSocket URL (use wss://.../ws)
cd client
echo 'VITE_WS_URL=wss://YOUR-NGROK-URL.ngrok-free.app/ws' > .env
npm run dev
```

Or use the script (writes both client and server `.env` from ngrok’s API):

```bash
./scripts/ngrok-env.sh
# Then start server and client as above
```

---

## Environment variables

### Server (`server/.env`)

| Variable        | Required | Description |
|----------------|----------|-------------|
| `NETWORK_ADDR` | Yes      | Listen address, e.g. `:8080` |

Loaded via `config.InitConfig()` (godotenv). Server will exit if `.env` is missing or `NETWORK_ADDR` is empty.

### Client (build-time)

| Variable       | Required | Description |
|----------------|----------|-------------|
| `VITE_WS_URL`  | No (has default) | WebSocket URL, e.g. `wss://your-ngrok.ngrok-free.app/ws`. Default: `ws://localhost:8080/ws`. |

Used only at **build time** by Vite. For production (e.g. Vercel), set `VITE_WS_URL` in the hosting env and redeploy so the built JS uses your server URL.

---

## Deployment

### Frontend (e.g. Vercel)

1. Build from the **client** directory (or set root to `client` and run `npm run build`).
2. Set **VITE_WS_URL** in the hosting environment to your game server’s WebSocket URL (e.g. `wss://your-ngrok.ngrok-free.app/ws`).
3. Deploy; the output is the static site (Vite’s `outDir` may be `dist` or as in `vite.config.js`).
4. No HTTP room API is used; the client only opens a WebSocket to the single lobby.

### Backend

Run the Go server on a host that can accept WebSocket connections (e.g. a VPS, or behind ngrok). Ensure `NETWORK_ADDR` is set and the server is reachable at the URL you put in `VITE_WS_URL`.

---

## Architecture (high level)

- **Client**  
  - Loads MediaPipe hand model, starts camera, draws a PiP with hand overlay.  
  - Sends normalized input (movement vector, boost, shoot) over WebSocket at a fixed rate.  
  - Receives state snapshots, interpolates, and renders players, orbs, leaderboard, and sprint meter.  
  - Single lobby: one “Play” action → one WebSocket connection with `room=default`.

- **Server**  
  - Listens on `NETWORK_ADDR`; WebSocket path `/ws` with query `room=...` (e.g. `room=default`).  
  - One room per code; game loop runs in that room (step: movement, stamina, orbs, collisions, scoring).  
  - Broadcasts state to all clients in the room.  
  - Optional HTTP `/rooms` exists but is not used by the current client (no room list, no create-room HTTP calls).

- **Scoring**  
  - Passive: points per tick while alive.  
  - On kill: base points + a fraction of the victim’s score.  
  - Leaderboard sorts by score (alive first, then eliminated).

---

## Tech stack

- **Client:** Vite, vanilla JS, MediaPipe Tasks Vision (hand landmarks), Canvas 2D, WebSocket
- **Server:** Go, gorilla/websocket, godotenv
- **Protocol:** JSON envelopes (`t`: type, `p`: payload) for welcome, state, and input

---

## License

See repository license (e.g. ISC in client package.json). MediaPipe and other dependencies have their own licenses.
