# AGENTS.md

## Repo layout

```
motion-demo/
├── client/          # Vanilla JS (Vite), MediaPipe hand tracking, Canvas 2D
│   └── src/client/  # main.js (boot), HandTracker.js, HandHeuristics.js, NetworkManager.js, Renderer.js
├── server/          # Go game server
│   ├── main.go
│   ├── network/     # WebSocket + HTTP
│   ├── room/        # Room lifecycle, join/leave, game loop ticker
│   ├── game/        # State, Step(), orb logic, tuning constants
│   └── protocol/    # JSON envelope codec (MsgHello, MsgState, MsgInput, MsgWelcome)
└── scripts/ngrok-env.sh
```

## Commands

**Server:**
```bash
cd server && echo 'NETWORK_ADDR=:8080' > .env && go run .
```

**Client dev:**
```bash
cd client && npm install && npm run dev   # serves on :3000
```

**Client build:**
```bash
cd client && npm run build   # outDir: ../../dist (relative to client/)
```

**Tests (server only):**
```bash
cd server && go test ./...
```
No client tests exist.

## Gotchas

- **Server always requires `server/.env`** with `NETWORK_ADDR`. Missing it → server exits.
- **Client `.env` (`VITE_WS_URL`) is build-time only.** Change it → rebuild.
- **Single global lobby only.** The `/rooms` HTTP API exists but is unused by the client.
- **Vite root is `src/client/`**, not the client/ directory. Source files live under `client/src/client/`.
- **Build output goes to `../../dist`** (repo root `dist/`), not `client/dist/`.
- **Public/deployed clients need `VITE_WS_URL`** set in the hosting env (Vercel etc.) and a redeploy — it's baked into the build.
- **Camera requires HTTPS** in production. Use ngrok or similar for local WSS.
- **`scripts/ngrok-env.sh`** writes both `client/.env` and `server/.env` from the ngrok API (requires ngrok running on port 8080, accessible at `127.0.0.1:4040`).

## Architecture notes

- Client runs MediaPipe hand detection locally; only game state is sent to the server.
- Client sends normalized input (ax, ay, boost, shoot) at 40 Hz over WebSocket.
- Server game loop ticks at 40 Hz; broadcasts state snapshots at 20 Hz.
- Protocol uses JSON envelopes: `{ "t": "<type>", "p": <payload> }`.
- All players share one room (`room=default`).
- Go module name is `motion` (used in imports like `"motion/network"`, `"motion/game"`).
- Tuning constants (map size, speeds, stamina, scoring) are in `server/game/tuning.go`.
