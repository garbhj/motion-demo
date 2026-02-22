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

    const envUrl = import.meta?.env?.VITE_WS_URL;
    if (envUrl) {
      this.serverUrl = envUrl;
    } else {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      this.serverUrl = `${proto}://localhost:8080/ws`;
    }
  }

  encode(t, p) {
    return JSON.stringify({ t, p });
  }

  joinGame(name) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(this.encode("hello", { v: 1, name }));
      }
      return;
    }

    this.ws = new WebSocket(this.serverUrl);

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
              "flails:",
              env.p?.flails?.length,
              env.p?.flails?.[0]
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
      boost: !!inputVector.boost
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
        flails: [],
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
    const flails = this.normalizeFlails(st?.flails);

    return {
      mapConfig: this.mapConfig,
      obstacles: this.obstacles,
      players: Object.values(players),
      flails: Object.values(flails),
      tick: st?.tick ?? 0,
      myId: this.myId ? String(this.myId) : null
    };
  }

  interpolateWorld(aState, bState, alpha) {
    const aPlayers = this.normalizePlayers(aState?.players);
    const bPlayers = this.normalizePlayers(bState?.players);
    const aFlails = this.normalizeFlails(aState?.flails);
    const bFlails = this.normalizeFlails(bState?.flails);

    const players = this.mergeAndInterpolate(aPlayers, bPlayers, alpha);
    const flails = this.mergeAndInterpolate(aFlails, bFlails, alpha, true);

    return {
      mapConfig: this.mapConfig,
      obstacles: this.obstacles,
      players,
      flails,
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
        radius: p.radius ?? 25
      };
    }
    return out;
  }

  normalizeFlails(flails) {
    const out = {};
    if (!flails) return out;
    for (const f of flails) {
      const id = String(f.id);
      out[id] = {
        id,
        ownerId: String(f.ownerId),
        x: f.x,
        y: f.y,
        isDetached: !!f.isDetached,
        a: f.a ?? 0
      };
    }
    return out;
  }

  mergeAndInterpolate(aMap, bMap, alpha, isFlail = false) {
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
      if (isFlail) {
        out.push({
          id,
          ownerId: b.ownerId ?? a.ownerId,
          x,
          y,
          isDetached: b.isDetached ?? a.isDetached,
          a: b.a ?? a.a ?? 0
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
          radius: b.radius ?? a.radius ?? 25
        });
      }
    }
    return out;
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }
}
