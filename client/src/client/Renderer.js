import { GESTURES } from "./HandHeuristics.js";

// Helpers
// Generates a distinct color for any given integer ID using the Golden Ratio
// Renderer.js helpers

function getColorForId(id) {
  // 1. Handle missing IDs
  if (id === null || id === undefined) return "#aaa"; // Default grey

  // 2. Ensure ID is a number (handle string IDs from server)
  // Simple hash function for strings
  let numericId = 0;
  if (typeof id === 'number') {
    numericId = id;
  } else if (typeof id === 'string') {
    for (let i = 0; i < id.length; i++) {
      numericId = id.charCodeAt(i) + ((numericId << 5) - numericId);
    }
  }

  // 3. Generate Color
  const hue = Math.abs((numericId * 137.508) % 360);
  return `hsl(${hue}, 70%, 60%)`;
}
// Brighten
function ColorLuminance(hsl, factor) {
  const parts = hsl.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return hsl;

  const [h, s, l] = parts;
  const newL = Math.max(0, Math.min(100, l * (1 + factor)));

  return `hsl(${h}, ${s}%, ${newL.toFixed(2)}%)`;
}


export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  // Called every frame by main.js (uses high-DPI scaling for sharp text and shapes)
  render(worldState, localPlayerId, localInput, trackingCenter) {
    const ctx = this.ctx;
    const dpr = this.canvas.width / this.canvas.clientWidth;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // 1. Clear Screen
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, width, height);

    // 2. Find Local Player for Camera Tracking
    const me = worldState.players.find(p => p.id === localPlayerId);

    // --- CAMERA TRANSFORM ---
    ctx.save();
    if (me) {
      // Center the camera on the player
      ctx.translate(width / 2 - me.x, height / 2 - me.y);
    } else {
      // FALLBACK: If player is undefined, center camera on the middle of the map
      console.warn("Local player not found! Id:", localPlayerId);
      ctx.translate(
        width / 2 - worldState.mapConfig.width / 2, 
        height / 2 - worldState.mapConfig.height / 2
      );
    }

    // 3. Draw Map Background & Grid
    this.drawMap(worldState.mapConfig);

    // 4. Draw Static Obstacles (Walls)
    worldState.obstacles.forEach(obs => {
      ctx.fillStyle = "#444";
      ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 2;
      ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);
    });

    // 5. Draw Orbs (Behind players) — high quality: shadow + crisp fill/stroke
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    (worldState.orbs || []).forEach(o => {
      const owner = worldState.players.find(p => p.id === o.ownerId);
      const playerColor = owner ? getColorForId(owner.id) : "#aaa";
      const radius = 10 + (o.size || 1) * 8;

      let orbColor = playerColor;
      if (o.mode === 1) {
        orbColor = ColorLuminance(playerColor, 0.3);
      } else if (o.mode === 2) {
        orbColor = ColorLuminance(playerColor, -0.1);
      }

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = orbColor;
      ctx.beginPath();
      ctx.arc(o.x, o.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.stroke();
      ctx.restore();
    });

    // 6. Draw Players
    worldState.players.forEach(p => {
      const playerColor = getColorForId(p.id);

      ctx.fillStyle = playerColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 25, 0, Math.PI * 2);
      ctx.fill();
      
      // Outline, highlight this player
      ctx.strokeStyle = p.id === localPlayerId ? "white" : "rgba(0,0,0,0.5)";
      ctx.lineWidth = p.id === localPlayerId ? 4 : 2;
      ctx.stroke();

      // Names — crisp text: rounded coordinates, system font
      ctx.fillStyle = "white";
      ctx.font = "600 14px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const nameY = Math.round(p.y - 35);
      ctx.fillText(p.name || `Player ${p.id}`, Math.round(p.x), nameY);
    });

    // --- RESTORE CAMERA ---
    ctx.restore();

    // 7. Leaderboard (top of screen)
    this.drawLeaderboard(worldState.players, worldState.eliminated || [], localPlayerId, width);

    // 8. Sprint meter (local player only)
    this.drawSprintMeter(me, width, height);

    // 9. Draw HUD (Heads Up Display - Drawn fixed to the screen)
    this.drawJoystickHUD(localInput, trackingCenter, width, height);
  }

  drawSprintMeter(localPlayer, width, height) {
    if (!localPlayer) return;
    const ctx = this.ctx;
    const stamina = Math.max(0, Math.min(100, localPlayer.stamina ?? 100));
    const barWidth = 160;
    const barHeight = 12;
    const x = 20;
    const y = height - 40;

    ctx.font = "600 11px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillText("Sprint", x, y - barHeight);

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, barWidth, barHeight, 6);
    } else {
      ctx.rect(x, y, barWidth, barHeight);
    }
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const fillWidth = (stamina / 100) * (barWidth - 4);
    if (fillWidth > 0) {
      ctx.fillStyle = stamina > 25 ? "#fbbf24" : "#f87171";
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x + 2, y + 2, fillWidth, barHeight - 4, 4);
      } else {
        ctx.rect(x + 2, y + 2, fillWidth, barHeight - 4);
      }
      ctx.fill();
    }
  }

  drawLeaderboard(players, eliminated, localPlayerId, width) {
    const ctx = this.ctx;
    const padding = 12;
    const rowHeight = 22;
    const fontSize = 14;
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = "middle";

    const aliveEntries = (players || []).map(p => ({ id: p.id, name: p.name || `Player ${p.id}`, score: p.score ?? 0, alive: true }));
    const outEntries = (eliminated || []).map(e => ({ id: e.id, name: e.name || `Player ${e.id}`, score: e.score ?? 0, alive: false }));
    aliveEntries.sort((a, b) => b.score - a.score);
    outEntries.sort((a, b) => b.score - a.score);
    const entries = [...aliveEntries, ...outEntries];
    if (entries.length === 0) return;

    const boxWidth = Math.min(320, width - 40);
    const titleRow = rowHeight;
    const boxHeight = padding * 2 + titleRow + entries.length * rowHeight;
    const x = (width - boxWidth) / 2;
    const y = 16;

    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, boxWidth, boxHeight, 8);
    } else {
      ctx.rect(x, y, boxWidth, boxHeight);
    }
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText("Leaderboard", Math.round(x + padding), Math.round(y + padding + fontSize * 0.5));

    entries.forEach((entry, i) => {
      const yy = y + padding + titleRow + i * rowHeight + fontSize * 0.5;
      const isMe = entry.id === localPlayerId;
      if (entry.alive) {
        ctx.fillStyle = isMe ? "#00bcd4" : "rgba(255, 255, 255, 0.95)";
      } else {
        ctx.fillStyle = isMe ? "rgba(255, 100, 100, 0.9)" : "rgba(160, 160, 160, 0.9)";
      }
      const label = entry.alive ? entry.name : `${entry.name} (out)`;
      const pts = Math.round(entry.score);
      ctx.textAlign = "left";
      ctx.fillText(label, Math.round(x + padding), Math.round(yy));
      ctx.textAlign = "right";
      ctx.fillText(`${pts} pts`, Math.round(x + boxWidth - padding), Math.round(yy));
    });
  }

  drawMap(config) {
    const { width, height } = config;
    
    // Draw Map Bounds
    this.ctx.fillStyle = "#222";
    this.ctx.fillRect(0, 0, width, height);
    this.ctx.strokeStyle = "red";
    this.ctx.lineWidth = 5;
    this.ctx.strokeRect(0, 0, width, height);

    // Draw Grid Pattern
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    const gridSize = 100;
    for (let x = 0; x <= width; x += gridSize) {
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += gridSize) {
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
    }
    this.ctx.stroke();
  }

  drawJoystickHUD(localInput, trackingCenter, width, height) {
    const ctx = this.ctx;
    const centerX = trackingCenter.x * width;
    const centerY = trackingCenter.y * height;
    const handX = localInput.x * width;
    const handY = localInput.y * height;

    // Draw Tracking Center
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, 50, 0, Math.PI * 2); // Deadzone visual
    ctx.stroke();

    // Draw Line connecting center to hand
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(handX, handY);
    ctx.stroke();

    // Draw Hand Cursor
    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    if (localInput.gesture === GESTURES.PINCH || localInput.gesture === GESTURES.CLOSED) {
      ctx.fillStyle = "rgba(255, 0, 0, 0.2)";
    }
    if (localInput.gesture == GESTURES.POINT) {
      ctx.fillStyle = "rgba(0, 50, 255, 0.2)";
    }
    ctx.beginPath();
    ctx.arc(handX, handY, 30, 0, Math.PI * 2);
    ctx.stroke();
  }
}
