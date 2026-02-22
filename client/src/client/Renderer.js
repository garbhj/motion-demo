import { GESTURES } from "./HandHeuristics.js";

// Helpers
// Generates a distinct color for any given integer ID using the Golden Ratio
function getColorForId(id) {
  const hue = (id * 137.508) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

// The shared math function (Server should use this exact logic for collisions)
function getFlailRadius(score) {
  const baseRadius = 12;
  const growthFactor = 0.05; // How much it grows per point
  return baseRadius + (score * growthFactor);
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
    // console.log("LocalInput" + localInput.x + localInput.y + "\nLocalPlayerId:" + localPlayerId);

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

    // 4.5. Draw Orbs
    if (worldState.food) {
      worldState.food.forEach(f => {
        // Use ID for base color, but make it very bright (luminance + 0.6)
        const baseColor = getColorForId(f.id);
        ctx.fillStyle = ColorLuminance(baseColor, 0.6); 
        
        ctx.beginPath();
        // Give food a slight pulse effect using a sine wave based on time
        const pulse = Math.sin(Date.now() / 200 + f.id) * 1.5; 
        ctx.arc(f.x, f.y, 6 + pulse, 0, Math.PI * 2);
        
        ctx.shadowBlur = 10;
        ctx.shadowColor = ctx.fillStyle;
        ctx.fill();
        ctx.shadowBlur = 0; // reset
      });
    }

    // 5. Draw Flails (Behind players)
    worldState.flails.forEach(f => {
      // Find the owner to get their score and ID
      const owner = worldState.players.find(p => p.id === f.ownerId);
      const score = owner ? owner.score : 0;
      const radius = getFlailRadius(score);
      const playerColor = owner ? getColorForId(owner.id) : "#aaa";
      
      // Draw chain (Below both flail and player)
      if (!f.isDetached && owner) {
        const owner = worldState.players.find(p => p.id === f.ownerId);
        if (owner) {
          ctx.strokeStyle = "#666";
          ctx.lineWidth = 3 + radius / 10;
          ctx.beginPath();
          ctx.moveTo(owner.x, owner.y);
          ctx.lineTo(f.x, f.y);
          ctx.stroke();
        }
      }

      // If detached, color it red to indicate danger. Otherwise, match player color.
      ctx.fillStyle = f.isDetached ? ColorLuminance(playerColor, 0.3) : playerColor;
      
      ctx.beginPath();
      ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
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

    // 7. Draw HUD (Heads Up Display - Drawn fixed to the screen)
    this.drawJoystickHUD(localInput, trackingCenter, width, height);
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