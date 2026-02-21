import { GESTURES } from "./HandHeuristics.js";

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  // Called every frame by main.js
  render(worldState, localPlayerId, localInput, trackingCenter) {
    console.log("LocalInput" + localInput.x + localInput.y + "\nLocalPlayerId:" + localPlayerId);

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

    // 5. Draw Flails (Behind players)
    worldState.flails.forEach(f => {
      ctx.fillStyle = f.isDetached ? "red" : "#aaa";
      ctx.beginPath();
      ctx.arc(f.x, f.y, 12, 0, Math.PI * 2);
      ctx.fill();

      // Draw chain
      if (!f.isDetached) {
        const owner = worldState.players.find(p => p.id === f.ownerId);
        if (owner) {
          ctx.strokeStyle = "#666";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(owner.x, owner.y);
          ctx.lineTo(f.x, f.y);
          ctx.stroke();
        }
      }
    });

    // 6. Draw Players
    worldState.players.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 25, 0, Math.PI * 2);
      ctx.fill();
      
      // Highlight local player
      if (p.id === localPlayerId) {
        ctx.strokeStyle = "white";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
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