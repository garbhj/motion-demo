import { BIN_MSG_STATE, decodeStateBinary, encodeInputBinary } from "./binaryProtocol.js";

// Mirrored from server/game/tuning.go — MUST be kept in sync manually if
// those constants change. Same tradeoff already accepted for PLAYER_RADIUS
// (=25) hardcoded in Renderer.js's ctx.arc() calls.
const PLAYER_RADIUS = 25.0;
const DEADZONE = 0.08;
const ACCEL_PER_TICK = 0.7;
const BOOST_MULT = 2.5;
const PLAYER_DAMPING_DIV = 1.1;
const MAX_SPEED_NORMAL = 9.0;
const MAX_SPEED_SPRINT = 22.0;
const STAMINA_MAX = 100.0;
const STAMINA_DEPLETE_PER_TICK = 2.5;
const STAMINA_REGEN_PER_TICK = 1.2;
const MAP_WIDTH = 2000.0;
const MAP_HEIGHT = 2000.0;

function clampToMapBounds(p) {
  if (p.x < PLAYER_RADIUS) { p.x = PLAYER_RADIUS; p.vx = 0; }
  if (p.x > MAP_WIDTH - PLAYER_RADIUS) { p.x = MAP_WIDTH - PLAYER_RADIUS; p.vx = 0; }
  if (p.y < PLAYER_RADIUS) { p.y = PLAYER_RADIUS; p.vy = 0; }
  if (p.y > MAP_HEIGHT - PLAYER_RADIUS) { p.y = MAP_HEIGHT - PLAYER_RADIUS; p.vy = 0; }
}

function clampF(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// 1:1 port of server/game/obstacles.go's resolveOneObstacle.
function resolveOneObstacle(p, o) {
  const cx = clampF(p.x, o.x, o.x + o.width);
  const cy = clampF(p.y, o.y, o.y + o.height);
  const dx = p.x - cx, dy = p.y - cy;
  const distSq = dx * dx + dy * dy;
  if (distSq > PLAYER_RADIUS * PLAYER_RADIUS) return;

  if (distSq > 1e-9) {
    const dist = Math.sqrt(distSq);
    const nx = dx / dist, ny = dy / dist;
    const penetration = PLAYER_RADIUS - dist;
    p.x += nx * penetration;
    p.y += ny * penetration;
    const vn = p.vx * nx + p.vy * ny;
    if (vn < 0) { p.vx -= vn * nx; p.vy -= vn * ny; }
    return;
  }

  const distLeft = p.x - o.x;
  const distRight = (o.x + o.width) - p.x;
  const distTop = p.y - o.y;
  const distBottom = (o.y + o.height) - p.y;
  let minDist = distLeft, side = 0;
  if (distRight < minDist) { minDist = distRight; side = 1; }
  if (distTop < minDist) { minDist = distTop; side = 2; }
  if (distBottom < minDist) { side = 3; }
  switch (side) {
    case 0: p.x = o.x - PLAYER_RADIUS; if (p.vx > 0) p.vx = 0; break;
    case 1: p.x = o.x + o.width + PLAYER_RADIUS; if (p.vx < 0) p.vx = 0; break;
    case 2: p.y = o.y - PLAYER_RADIUS; if (p.vy > 0) p.vy = 0; break;
    case 3: p.y = o.y + o.height + PLAYER_RADIUS; if (p.vy < 0) p.vy = 0; break;
  }
}

function resolveObstacleCollisions(p, obstacles) {
  for (const o of obstacles) resolveOneObstacle(p, o);
}

export class NetworkManager {
  constructor() {
    this.myId = null;

    // Absolute Map Config
    this.mapConfig = { width: 2000, height: 2000 };

    // Static obstacles — populated from the server's "welcome" payload
    // (see the "welcome" case below). Empty until then; Renderer.js's
    // forEach over an empty array is a harmless no-op.
    this.obstacles = [];

    this.ws = null;
    this.latestServerState = null;
    this.pendingInput = { ax: 0, ay: 0, boost: false };
    this.serverTickHz = null;
    this.debug = false;
    // Render this many ms behind the newest snapshot. Must be >= the
    // broadcast interval (50ms @ 20Hz) so the lerp "now" always falls
    // between two received snapshots.
    this.interpDelayMs = 60;
    this.snapA = null;
    this.snapB = null;
    this.predicted = null;

    // Set VITE_WS_URL in Vercel (e.g. wss://xxx.ngrok-free.app/ws).
    const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};
    this.serverUrl = env.VITE_WS_URL || "ws://localhost:8080/ws";
    this.roomCode = null; // null until the server confirms which room we joined
    this.httpBase = this.serverUrl.replace(/^ws/, "http").replace(/\/ws\/?$/, "");

    // Set by main.js
    this.onError = null;   // (code, message) => void
    this.onWelcome = null; // (playerId, roomCode) => void
    this.onKill = null;    // (killerName, victimName) => void, fired once per kill event
  }

  encode(t, p) {
    return JSON.stringify({ t, p });
  }

  joinGame(name, roomCode = null) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(this.encode("hello", { v: 1, name }));
      }
      return true;
    }

    this.predicted = null;

    let url = this.serverUrl;
    if (roomCode) {
      const sep = this.serverUrl.includes("?") ? "&" : "?";
      url = `${this.serverUrl}${sep}room=${encodeURIComponent(roomCode)}`;
    }
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.addEventListener("open", () => {
      this.ws.send(this.encode("hello", { v: 1, name }));
    });

    this.ws.addEventListener("message", (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        this.handleBinaryMessage(evt.data);
        return;
      }

      let env;
      try {
        env = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (!env || !env.t) return;

      switch (env.t) {
        case "welcome": {
          const p = env.p || {};
          this.myId = p.playerId;
          this.serverTickHz = p.tickHz;
          this.roomCode = p.roomCode || this.roomCode;
          if (Array.isArray(p.obstacles)) {
            this.obstacles = p.obstacles;
          }
          if (typeof this.onWelcome === "function") this.onWelcome(this.myId, this.roomCode);
          break;
        }
        case "error": {
          const p = env.p || {};
          if (this.ws) {
            this.ws.close();
            this.ws = null;
          }
          if (typeof this.onError === "function") this.onError(p.code, p.message);
          break;
        }
        default:
          break; // "state" no longer arrives as JSON — see handleBinaryMessage
      }
    });

    this.ws.addEventListener("close", () => {
      console.warn("WebSocket closed");
    });

    this.ws.addEventListener("error", (err) => {
      console.warn("WebSocket error:", err);
    });
    return true;
  }

  handleBinaryMessage(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 1 || view.getUint8(0) !== BIN_MSG_STATE) return;
    const state = decodeStateBinary(view);
    this.snapA = this.snapB;
    this.snapB = { t: performance.now(), state };
    this.latestServerState = state;
    this.reconcile(state);
    if (state.kills.length && typeof this.onKill === "function") {
      for (const k of state.kills) {
        this.onKill(k.killerName || "Someone", k.victimName || "someone");
      }
    }
    if (this.debug) {
      console.log("state players:", state.players.length, "orbs:", state.orbs.length, state.orbs[0]);
    }
  }

  async createPrivateRoom() {
    const res = await fetch(`${this.httpBase}/rooms`, { method: "POST" });
    if (!res.ok) throw new Error(`create room failed: ${res.status}`);
    const data = await res.json();
    return data.code;
  }

  sendPlayerInput(inputVector) {
    const input = {
      ax: Math.max(-1, Math.min(1, inputVector.ax)),
      ay: Math.max(-1, Math.min(1, inputVector.ay)),
      boost: !!inputVector.boost,
      shoot: !!inputVector.shoot
    };
    this.pendingInput = input; // kept for debug/inspection only, no longer polled
    this.predictStep(input);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeInputBinary(input));
    }
  }

  // 1:1 port of server/game/step.go's per-player movement block. Called
  // once per sendPlayerInput() invocation (i.e. once per 40Hz networkLoop
  // tick in main.js), matching the server's own tick cadence.
  predictStep(input) {
    const p = this.predicted;
    if (!p) return; // nothing to predict from until the first server snapshot

    const ax = input.ax, ay = input.ay;
    const mag = Math.hypot(ax, ay);
    const sprinting = input.boost && p.stamina > 0;
    let maxSpeed = MAX_SPEED_NORMAL;
    if (sprinting) {
      maxSpeed = MAX_SPEED_SPRINT;
      p.stamina = Math.max(0, p.stamina - STAMINA_DEPLETE_PER_TICK);
    } else {
      p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN_PER_TICK);
    }
    if (mag > DEADZONE) {
      const nx = ax / mag, ny = ay / mag;
      let accel = ACCEL_PER_TICK;
      if (sprinting) accel *= BOOST_MULT;
      p.vx += nx * accel;
      p.vy += ny * accel;
    }
    p.vx /= PLAYER_DAMPING_DIV;
    p.vy /= PLAYER_DAMPING_DIV;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > maxSpeed) {
      const s = maxSpeed / speed;
      p.vx *= s;
      p.vy *= s;
    }
    p.x += p.vx;
    p.y += p.vy;
    clampToMapBounds(p);
    resolveObstacleCollisions(p, this.obstacles);
    clampToMapBounds(p);
  }

  // Reconciles the predicted local player against the authoritative
  // server snapshot. Snaps on a large divergence (respawn/teleport/packet
  // loss); otherwise blends smoothly so small, normal drift never pops.
  reconcile(state) {
    if (!state || !this.myId) return;
    const me = (state.players || []).find(p => String(p.id) === String(this.myId));
    if (!me) return;

    if (!this.predicted) {
      this.predicted = { x: me.x, y: me.y, vx: 0, vy: 0, stamina: me.stamina ?? STAMINA_MAX };
      return;
    }

    if (me.alive === false) {
      // Don't predict through death/respawn — mirror server exactly.
      this.predicted.x = me.x;
      this.predicted.y = me.y;
      this.predicted.vx = 0;
      this.predicted.vy = 0;
      this.predicted.stamina = me.stamina ?? this.predicted.stamina;
      return;
    }

    const dx = me.x - this.predicted.x;
    const dy = me.y - this.predicted.y;
    const dist = Math.hypot(dx, dy);
    const SNAP_THRESHOLD = 130; // px — see plan doc for derivation
    const BLEND_RATE = 0.25;

    if (dist > SNAP_THRESHOLD) {
      this.predicted.x = me.x;
      this.predicted.y = me.y;
      this.predicted.vx = 0;
      this.predicted.vy = 0;
    } else if (dist > 0.01) {
      this.predicted.x += dx * BLEND_RATE;
      this.predicted.y += dy * BLEND_RATE;
    }
    this.predicted.stamina = me.stamina ?? this.predicted.stamina;
  }

  getLatestWorldState() {
    const A = this.snapA;
    const B = this.snapB;
    let world;
    if (!B || !B.state) {
      world = {
        mapConfig: this.mapConfig,
        obstacles: this.obstacles,
        players: [],
        orbs: [],
        tick: 0,
        myId: this.myId ? String(this.myId) : null
      };
    } else if (!A || !A.state) {
      world = this.buildWorldFromSnapshot(B.state);
    } else {
      const target = performance.now() - this.interpDelayMs;
      const dt = (B.t - A.t) || 1;
      let alpha = (target - A.t) / dt;
      if (alpha < 0) alpha = 0;
      if (alpha > 1) alpha = 1;
      console.log(alpha.toFixed(2));
      world = this.interpolateWorld(A.state, B.state, alpha);
    }
    this.applyPredictionOverride(world);
    return world;
  }

  // Overwrites the local player's entry with the locally-predicted
  // position so your own movement never waits on the network round trip
  // + interpolation buffer. Remote players are untouched (can't predict
  // someone else's input).
  applyPredictionOverride(world) {
    // Temporarily disabled: the local `predicted` is advanced by the 40Hz
    // accumulator in main.js while interpolation runs at 60Hz per rAF, and
    // the two clocks rarely align — so the local player and its own orb
    // (whose position is lerp-driven) move at different rates, producing
    // a visible 3-frame stagger pattern. With this disabled, the local
    // player interpolates like everyone else, at the cost of ~interpDelayMs
    // of added input latency. Re-enable by deleting this return.
    return;
    if (!this.predicted || !this.myId) return;
    const i = world.players.findIndex(p => String(p.id) === String(this.myId));
    if (i === -1) return;
    const me = world.players[i];
    if (me.alive === false) return; // reconcile() already mirrors server exactly

    const offsetX = this.predicted.x - me.x;
    const offsetY = this.predicted.y - me.y;
    world.players[i] = { ...me, x: this.predicted.x, y: this.predicted.y, vx: this.predicted.vx, vy: this.predicted.vy };

    // Keep the local player's own orb visually glued to the now-instant
    // predicted avatar instead of trailing it by the interpolation delay.
    // Translating by the same correction is exact while orbiting (the orb
    // is a fixed offset from the player, so shifting the anchor point
    // preserves that offset exactly) and a harmless approximation while
    // independently in flight (shot/return), where the offset is already
    // large and this correction is a negligible fraction of it.
    const orbIdx = world.orbs.findIndex(o => String(o.ownerId) === String(this.myId));
    if (orbIdx !== -1) {
      const orb = world.orbs[orbIdx];
      world.orbs[orbIdx] = { ...orb, x: orb.x + offsetX, y: orb.y + offsetY };
    }
  }

  buildWorldFromSnapshot(st) {
    const players = this.normalizePlayers(st?.players);
    const orbs = this.normalizeOrbs(st?.orbs);

    return {
      mapConfig: this.mapConfig,
      obstacles: this.obstacles,
      players: Object.values(players),
      orbs: Object.values(orbs),
      tick: st?.tick ?? 0,
      myId: this.myId ? String(this.myId) : null
    };
  }

  interpolateWorld(aState, bState, alpha) {
    const aPlayers = this.normalizePlayers(aState?.players);
    const bPlayers = this.normalizePlayers(bState?.players);
    const aOrbs = this.normalizeOrbs(aState?.orbs);
    const bOrbs = this.normalizeOrbs(bState?.orbs);

    const players = this.mergeAndInterpolate(aPlayers, bPlayers, alpha);
    const orbs = this.mergeAndInterpolate(aOrbs, bOrbs, alpha, true);

    return {
      mapConfig: this.mapConfig,
      obstacles: this.obstacles,
      players,
      orbs,
      tick: bState?.tick ?? 0,
      myId: this.myId ? String(this.myId) : null
    };
  }

  normalizePlayers(players) {
    const out = {};
    if (!players) return out;
    for (const p of players) {
      const id = String(p.id);
      out[id] = {
        id,
        name: p.name ?? "",
        score: p.score ?? 0,
        x: p.x,
        y: p.y,
        vx: p.vx ?? 0,
        vy: p.vy ?? 0,
        radius: p.radius ?? 25,
        stamina: p.stamina ?? 100,
        alive: p.alive !== false,
        respawnInMs: p.respawnInMs ?? 0
      };
    }
    return out;
  }

  normalizeOrbs(orbs) {
    const out = {};
    if (!orbs) return out;
    for (const o of orbs) {
      const id = String(o.id);
      out[id] = {
        id,
        ownerId: String(o.ownerId),
        x: o.x,
        y: o.y,
        size: o.size ?? 1,
        a: o.a ?? 0,
        mode: o.mode ?? 0
      };
    }
    return out;
  }

  mergeAndInterpolate(aMap, bMap, alpha, isOrb = false) {
    const out = [];
    const ids = new Set([...Object.keys(aMap), ...Object.keys(bMap)]);
    for (const id of ids) {
      const a = aMap[id];
      const b = bMap[id];
      if (!a && b) {
        out.push(b);
        continue;
      }
      if (a && !b) {
        out.push(a);
        continue;
      }
      const x = this.lerp(a.x, b.x, alpha);
      const y = this.lerp(a.y, b.y, alpha);
      if (isOrb) {
        out.push({
          id,
          ownerId: b.ownerId ?? a.ownerId,
          x,
          y,
          size: b.size ?? a.size ?? 1,
          a: b.a ?? a.a ?? 0,
          mode: b.mode ?? a.mode ?? 0
        });
      } else {
        out.push({
          id,
          name: b.name ?? a.name ?? "",
          score: b.score ?? a.score ?? 0,
          x,
          y,
          vx: b.vx ?? a.vx ?? 0,
          vy: b.vy ?? a.vy ?? 0,
          radius: b.radius ?? a.radius ?? 25,
          stamina: b.stamina ?? a.stamina ?? 100,
          alive: b.alive ?? a.alive ?? true,
          respawnInMs: b.respawnInMs ?? a.respawnInMs ?? 0
        });
      }
    }
    return out;
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }
}
