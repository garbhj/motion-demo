# Sprint notes — turning the hackathon demo into a real game

Everything below reflects one working session's worth of changes, all currently
**uncommitted** in the working tree (see `git status`). Nothing has been pushed
or merged. Files touched:

```
M  client/src/client/NetworkManager.js
M  client/src/client/Renderer.js
M  client/src/client/index.html
M  client/src/client/main.js
M  client/src/client/style.css
M  server/game/state.go
M  server/game/step.go
M  server/game/tuning.go
M  server/network/network.go
M  server/protocol/protocol.go
M  server/protocol/server.go
M  server/room/manager.go
M  server/room/messages.go
M  server/room/room.go
M  server/room/room_test.go
?? client/src/client/binaryProtocol.js
?? server/game/obstacle_test.go
?? server/game/obstacles.go
?? server/game/spawn.go
?? server/game/step_test.go
?? server/protocol/binary.go
?? server/protocol/binary_test.go
```

---

## 1. What changed

### Matchmaking — public rooms + private codes
Previously every player landed in one hardcoded global lobby (`room=default`).
Now:
- **Public auto-match**: "Play" drops you into an open arena; the server fills
  rooms up to `DefaultRoomCapacity = 16` (`server/room/room.go`) and spins up a
  new one once a room is full.
- **Private rooms**: "Create Private Room" hits the (previously dead) `POST
  /rooms` endpoint for a 6-char code; "Join Room" connects with an explicit
  code. A bad/unknown code fails cleanly (`room_not_found`) instead of
  silently creating an empty room for the typo.
- Server-side: `room.Manager.FindOrCreatePublicRoom` / `GetRoom` /
  `CreateRoom`, capacity enforced once, authoritatively, in
  `Room.handleCommand`'s `Join` case (`Full: true` reply → client retries
  against a different public room, up to 3 attempts).
- New wire messages: `MsgError` (`room_full` / `room_not_found`),
  `Welcome.RoomCode` so the client can display which arena it landed in.

### Death & respawn
Getting hit previously deleted your player permanently — no death screen, no
way back in short of a full reconnect. Now:
- Killed players are marked `Alive:false`, frozen in place, auto-respawn after
  `RespawnDelayTicks = 120` (3s), at which point score resets to 0 and a fresh
  orb spawns.
- Kill feed: a transient "X popped Y" toast broadcast to the whole room
  (`State.Kills`, drained once per broadcast so it fires exactly once).
- Client: death overlay with a live countdown, leaderboard shows a "(down)"
  tag with the frozen final score, dead players render dimmed.
- `game.SpawnPoint()` / `game.NewOrb()` extracted as shared helpers (used by
  both initial join and respawn) — also fixed a latent bug where the old
  deterministic `100*idNum` spawn formula walked players outside the map for
  `idNum > ~18`.

### Server-enforced obstacles
The two arena walls were client-only decoration — players and orbs walked
straight through them. Now:
- `server/game/obstacles.go`: authoritative `Obstacles` list, circle-vs-AABB
  collision (with a degenerate "already inside the rect" fallback), applied
  in the movement loop after the map-edge clamp, **then the edge clamp runs
  again** as a defensive re-clamp (a real bug surfaced during testing: an
  obstacle placed near the map boundary could otherwise get pushed out of
  bounds by the degenerate-case resolver).
- Shot orbs now stop (enter `OrbReturn`) on hitting a wall, so cover actually
  blocks the one projectile that can kill you. Orbiting/returning orbs are
  *not* collision-checked (cosmetic-only, no gameplay effect).
- `SpawnPoint()` is now reject-and-retry so a fresh spawn/respawn never lands
  inside a wall.
- Obstacle geometry is sent once via `Welcome.Obstacles` — client no longer
  hardcodes it, so server and client can never visually drift apart.

### Performance / netcode overhaul
Diagnosed (not guessed) three real causes of "laggy":
1. **No client-side prediction** — your own avatar's position came 100% from
   the server round-trip + a 100ms interpolation buffer, same as every
   remote player.
2. **Nagle's algorithm** was never disabled on the WebSocket's TCP socket.
3. **A redundant double-timer** on the client's input path added jitter.

Fixes:
- `TCP_NODELAY` set on every connection (`server/network/network.go`).
- Removed the redundant 25ms `setInterval` in `NetworkManager.js`; input now
  sends immediately, driven solely by `main.js`'s existing 40Hz loop.
- **Client-side prediction**: `NetworkManager.js` runs a 1:1 JS port of the
  server's movement + obstacle-collision physics, advancing the local
  player's position instantly on input, then reconciling against the
  authoritative server snapshot (snap if the divergence is large — e.g. a
  respawn — otherwise a smooth 25%-per-update blend).
- **Binary wire protocol** for the hot path (state broadcast @ 20Hz, input
  @ 40Hz) — `server/protocol/binary.go` / `client/src/client/binaryProtocol.js`.
  JSON kept for the rare `hello`/`welcome`/`error` messages. Fixed-size
  records, `float32` instead of `float64`, unused `angle` field dropped.
  Measured live: **154 bytes** for a 3-player/3-orb broadcast, vs. ~1.7KB+
  for the equivalent JSON.
- **Follow-up bug found via your own playtest**: after adding prediction, the
  local player's orbiting orb visibly detached and trailed the now-instant
  avatar, because the orb was still drawn from the old delayed
  server-interpolated pipeline. Fixed by translating the local player's own
  orb by the same correction applied to the predicted position — exact for
  orbit mode, verified live (orb sat at precisely 120px, the orbit radius,
  from the predicted position across 60 samples under sustained sprint).

### Testing
Everything above shipped with real coverage, not just code:
- New Go test files: `server/game/step_test.go`, `server/game/obstacle_test.go`,
  `server/protocol/binary_test.go`. Existing `server/room/room_test.go`
  rewritten for the binary wire format.
- `go test -race ./...` clean throughout.
- Every feature also verified **live** against the actual running server via
  scripted WebSocket clients (not mocks) — real kills, real respawns, real
  wall collisions, real matchmaking overflow, real binary payloads measured
  byte-for-byte.

---

## 2. Known issues / risks introduced by this sprint's approach

- **Client-side physics is a manually-synced duplicate.** The prediction
  physics and obstacle-collision code in `NetworkManager.js` is a hand-ported
  copy of `server/game/step.go` / `obstacles.go`. If tuning constants
  (`server/game/tuning.go`) ever change, the JS copy silently drifts out of
  sync — symptom would be rubber-banding (constant snap-corrections) or the
  local player visually clipping through walls the server still blocks. No
  automated check enforces the two stay identical; a future refactor could
  generate the JS constants from the Go source (or vice versa) to remove this
  foot-gun.
- **No reconnect/session recovery.** If a tab refreshes or the WebSocket
  drops, the player gets a brand-new connection = a brand-new player ID =
  score reset to zero, even mid-match. There's no way to resume "your" player.
- **No server-side input range validation.** The client clamps `ax`/`ay` to
  `[-1,1]` before sending, but the server trusts it as-is (a raw WebSocket
  client could send anything). Low practical exploit value today since the
  server normalizes the vector before using it, but it's not defended, and
  is exactly the kind of gap that matters more once the game is public.

---

## 3. Bigger gaps before this could be a real public `.io` game

Roughly in order of "would actually block or embarrass a public launch":

1. **Unauthenticated room creation leaks goroutines forever.** `POST /rooms`
   has no rate limiting, and a created room's `Run()` goroutine ticks forever
   until its last player leaves — but `OnEmpty` only fires from *leaving*, not
   from *never having anyone join*. Spamming `POST /rooms` (or just opening
   and abandoning raw WebSocket connections to `/ws`, which also
   eagerly creates a public room before any `hello` arrives) creates rooms
   that never get cleaned up. This is a real, unbounded resource leak and
   the most concrete "would fall over under any real traffic" issue in the
   current design. Needs either an idle-room reaper (TTL on rooms with zero
   players that were never joined) or gating room creation behind some
   minimal rate limit / proof of intent to actually join.
2. **No accounts or persistence.** Every session is anonymous and ephemeral —
   no stats across matches, no all-time leaderboard, nothing survives a
   server restart. Popular `.io` games live and die on "come back and beat
   your score" — this is currently impossible.
3. **No production deployment story.** Everything assumes `go run .` +
   `ngrok`/localhost. No containerization, no TLS termination plan, no host
   picked, no horizontal scaling story (rooms are all in-process, in one
   Go binary's memory — fine for one box, doesn't scale past it).
4. **Camera-only input is a real reach/accessibility ceiling.** MediaPipe
   hand tracking is the whole hook, but it's CPU/GPU-intensive, requires
   camera permission, doesn't work for anyone without a webcam or who's
   camera-shy, and has zero fallback (no keyboard/mouse mode). Most
   successful `.io` games (agar.io, slither.io, diep.io) deliberately use
   the lowest-friction input possible (mouse only) specifically to maximize
   reach. Worth deciding early whether hand-tracking stays the *only* input
   method or gets a fallback — this is a product decision, not just an
   engineering one.
5. **No moderation / abuse controls.** Player names are freeform (only
   defensively truncated to 12 bytes at the wire layer, never content-checked),
   no profanity filter, no report/mute/kick mechanism, no anti-cheat beyond
   basic server authority over position.
6. **CORS is wide open.** `CheckOrigin` always returns `true` on the WS
   upgrader and `Access-Control-Allow-Origin: *` on `/rooms` — fine for a
   dev demo, should be locked to the real deployed frontend origin before
   going public.
7. **No monitoring/observability.** No metrics (concurrent players, room
   count, tick timing, error rates), no structured logging, no alerting.
   Flying blind on whether the thing is healthy under real load.
8. **Zero client-side test coverage.** All new tests this sprint are Go;
   `NetworkManager.js`, `Renderer.js`, `HandHeuristics.js` have none. The
   client is now carrying real logic (prediction, reconciliation, binary
   decode) that deserves unit tests, not just live-server smoke checks.
9. **One map, two static obstacles.** Long-term engagement needs map variety,
   more interesting terrain, maybe multiple arena layouts or procedural
   elements.
10. **Mobile is untested.** Hand tracking might work in a mobile browser in
    principle, but the UI (PiP camera view, buttons, layout) was never
    designed or tested for small touch screens — a meaningful chunk of any
    `.io` game's traffic is mobile.
11. **Leftover hackathon cruft.** `client/package.json` is still named
    `wand-duel` with unused `express`/`socket.io`/`socket.io-client`
    dependencies from an earlier iteration that don't match the actual
    raw-WebSocket architecture — cheap, low-risk cleanup whenever convenient.

---

## Suggested next priorities

If the goal is genuinely "popular `.io` game," the highest-leverage next
steps are probably: **(1)** fix the room-leak/rate-limiting gap before any
public traffic touches it, **(2)** decide the input-method question (hand
tracking as the whole identity vs. a broader-reach fallback), then
**(3)** basic persistence (even just an all-time leaderboard) — that's the
combination that turns "cool demo" into "thing people come back to and can't
be trivially knocked over."
