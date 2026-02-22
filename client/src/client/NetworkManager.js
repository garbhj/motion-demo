export class NetworkManager {
  constructor() {
    this.myId = null;

    // Absolute Map Config
    this.mapConfig = { width: 2000, height: 2000 };

    // Static obstacles
    this.obstacles = [
      { x: 500, y: 500, width: 200, height: 100 },
      { x: 1200, y: 1500, width: 300, height: 300 }
    ];

    this.ws = null;
    this.latestServerState = null;
    this.pendingInput = { ax: 0, ay: 0, boost: false };
    this.inputTimer = null;
    this.serverTickHz = null;
    this.debug = false;
    this.snapA = null;
    this.snapB = null;
    this.interpDelayMs = 100;

    this.serverUrl = "wss://2249-2620-101-c040-7e5-7d22-19b6-3d7e-9662.ngrok-free.app/ws";
    const u = new URL(this.serverUrl);
    this.apiBase = (u.protocol === "wss:" ? "https:" : "http:") + "//" + u.host;
  }

  async fetchRooms() {
    try {
      const res = await fetch(`${this.apiBase}/rooms`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.warn("fetch rooms failed:", e);
      return [];
    }
  }

  async createRoom() {
    try {
      const res = await fetch(`${this.apiBase}/rooms`, { method: "POST" });
      if (!res.ok) throw new Error("Create failed");
      const data = await res.json();
      return data?.code ?? null;
    } catch (e) {
      console.warn("create room failed:", e);
      return null;
    }
  }

  encode(t, p) {
    return JSON.stringify({ t, p });
  }

  joinGame(name, roomCode) {
    if (!roomCode || !roomCode.trim()) {
      console.warn("Room code required");
      return false;
    }
    const code = roomCode.trim().toUpperCase();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(this.encode("hello", { v: 1, name }));
      }
      return true;
    }

    const sep = this.serverUrl.includes("?") ? "&" : "?";
    const url = `${this.serverUrl}${sep}room=${encodeURIComponent(code)}`;
    this.ws = new WebSocket(url);

    this.ws.addEventListener("open", () => {
      this.ws.send(this.encode("hello", { v: 1, name }));
    });

    this.ws.addEventListener("message", (evt) => {
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
          this.startInputLoop();
          break;
        }
        case "state": {
          const now = performance.now();
          this.snapA = this.snapB;
          this.snapB = { t: now, state: env.p || null };
          this.latestServerState = env.p || null;
          if (this.debug) {
            console.log(
              "state players:",
              env.p?.players?.length,
              "orbs:",
              env.p?.orbs?.length,
              env.p?.orbs?.[0]
            );
          }
          break;
        }
        default:
          break;
      }
    });

    this.ws.addEventListener("close", () => {
      this.stopInputLoop();
      console.warn("WebSocket closed");
    });

    this.ws.addEventListener("error", (err) => {
      this.stopInputLoop();
      console.warn("WebSocket error:", err);
    });
    return true;
  }

  startInputLoop() {
    if (this.inputTimer) return;
    this.inputTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(this.encode("input", this.pendingInput));
    }, 25);
  }

  stopInputLoop() {
    if (this.inputTimer) {
      clearInterval(this.inputTimer);
      this.inputTimer = null;
    }
  }

  sendPlayerInput(inputVector) {
    this.pendingInput = {
      ax: Math.max(-1, Math.min(1, inputVector.ax)),
      ay: Math.max(-1, Math.min(1, inputVector.ay)),
      boost: !!inputVector.boost,
      shoot: !!inputVector.shoot
    };
  }

  getLatestWorldState() {
    const A = this.snapA;
    const B = this.snapB;
    if (!B || !B.state) {
      return {
        mapConfig: this.mapConfig,
        obstacles: this.obstacles,
        players: [],
        orbs: [],
        eliminated: [],
        tick: 0,
        myId: this.myId ? String(this.myId) : null
      };
    }

    if (!A || !A.state) {
      return this.buildWorldFromSnapshot(B.state);
    }

    const now = performance.now();
    const target = now - this.interpDelayMs;
    const dt = (B.t - A.t) || 1;
    let alpha = (target - A.t) / dt;
    if (alpha < 0) alpha = 0;
    if (alpha > 1) alpha = 1;

    return this.interpolateWorld(A.state, B.state, alpha);
  }

  buildWorldFromSnapshot(st) {
    const players = this.normalizePlayers(st?.players);
    const orbs = this.normalizeOrbs(st?.orbs);
    const eliminated = (st?.eliminated || []).map(e => ({ id: String(e.id), name: e.name || `Player ${e.id}`, score: e.score ?? 0 }));

    return {
      mapConfig: this.mapConfig,
      obstacles: this.obstacles,
      players: Object.values(players),
      orbs: Object.values(orbs),
      eliminated,
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

    const eliminated = (bState?.eliminated || []).map(e => ({ id: String(e.id), name: e.name || `Player ${e.id}`, score: e.score ?? 0 }));

    return {
      mapConfig: this.mapConfig,
      obstacles: this.obstacles,
      players,
      orbs,
      eliminated,
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
        stamina: p.stamina ?? 100
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
          stamina: b.stamina ?? a.stamina ?? 100
        });
      }
    }
    return out;
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }
}
