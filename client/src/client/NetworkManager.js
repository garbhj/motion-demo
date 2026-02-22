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
    this.isConnected = false;
    this.latestServerState = null;
    this.pendingInputs = { ax: 0, ay: 0, boost: false };
    this.inputTimer = null;
    this.serverTickHz = null;
    this.playerName = "";

    const envUrl = import.meta?.env?.VITE_WS_URL;
    if (envUrl) {
      this.serverUrl = envUrl;
    } else {
      this.serverUrl = "ws://localhost:8080/ws";
    }
  }

  encode(t, p) {
    return JSON.stringify({ t, p });
  }

  joinGame(name) {
    this.playerName = name || "Anonymous";

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(this.encode("hello", { v: 1, name: this.playerName }));
      }
      return;
    }

    this.ws = new WebSocket(this.serverUrl);

    this.ws.addEventListener("open", () => {
      this.isConnected = true;
      this.ws.send(this.encode("hello", { v: 1, name: this.playerName }));
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
          this.myId = p.playerId || p.playerID || p.id || null;
          this.serverTickHz = p.tickHz || null;
          this.startInputLoop();
          break;
        }
        case "state": {
          this.latestServerState = env.p || null;
          break;
        }
        default:
          break;
      }
    });

    this.ws.addEventListener("close", () => {
      this.isConnected = false;
      this.stopInputLoop();
    });

    this.ws.addEventListener("error", (err) => {
      console.warn("WebSocket error:", err);
      this.isConnected = false;
      this.stopInputLoop();
    });
  }

  startInputLoop() {
    if (this.inputTimer) return;
    this.inputTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(this.encode("input", this.pendingInputs));
    }, 25);
  }

  stopInputLoop() {
    if (this.inputTimer) {
      clearInterval(this.inputTimer);
      this.inputTimer = null;
    }
  }

  sendPlayerInput(inputVector) {
    const clamp = (v) => Math.max(-1, Math.min(1, v || 0));
    this.pendingInputs = {
      ax: clamp(inputVector?.ax),
      ay: clamp(inputVector?.ay),
      boost: !!inputVector?.boost
    };
  }

  getLatestWorldState() {
    const st = this.latestServerState;
    const players = st?.players
      ? st.players.map((p) => ({
          id: p.id,
          name: p.name ?? "",
          score: p.score ?? 0,
          x: p.x,
          y: p.y,
          vx: p.vx ?? 0,
          vy: p.vy ?? 0,
          radius: p.radius ?? 25
        }))
      : [];

    return {
      mapConfig: this.mapConfig,
      obstacles: this.obstacles,
      players,
      flails: st?.flails ?? [],
      tick: st?.tick ?? 0,
      myId: this.myId
    };
  }

  disconnect() {
    this.stopInputLoop();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
    this.isConnected = false;
  }
}
