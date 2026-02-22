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

  // Called every frame by main.js
  render(worldState, localPlayerId, localInput, trackingCenter) {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // 1. Clear Screen
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#111"; // Deep background color
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

    // 5. Draw Orbs (Behind players)
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
      
      ctx.fillStyle = orbColor;
      ctx.beginPath();
      ctx.arc(o.x, o.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.stroke();
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

      // Names
      ctx.fillStyle = "white";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.name || `Player ${p.id} \n Score ${p.score}`, p.x, p.y - 35);
    });

    // --- RESTORE CAMERA ---
    ctx.restore();

    // 7. Leaderboard (top of screen)
    this.drawLeaderboard(worldState.players, worldState.eliminated || [], localPlayerId, width);

    // 8. Draw HUD (Heads Up Display - Drawn fixed to the screen)
    this.drawJoystickHUD(localInput, trackingCenter, width, height);
  }

  drawLeaderboard(players, eliminated, localPlayerId, width) {
    const ctx = this.ctx;
    const padding = 12;
    const rowHeight = 22;
    const fontSize = 14;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "left";

    const entries = [
      ...players.map(p => ({ id: p.id, name: p.name || `Player ${p.id}`, alive: true })),
      ...eliminated.map(e => ({ id: e.id, name: e.name || `Player ${e.id}`, alive: false }))
    ];
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

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText("Leaderboard", x + padding, y + padding + fontSize);

    entries.forEach((entry, i) => {
      const yy = y + padding + titleRow + i * rowHeight;
      const isMe = entry.id === localPlayerId;
      if (entry.alive) {
        ctx.fillStyle = isMe ? "#00bcd4" : "rgba(255, 255, 255, 0.95)";
      } else {
        ctx.fillStyle = isMe ? "rgba(255, 100, 100, 0.9)" : "rgba(160, 160, 160, 0.9)";
      }
      const label = entry.alive ? entry.name : `${entry.name} (out)`;
      ctx.fillText(label, x + padding, yy + fontSize - 2);
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
