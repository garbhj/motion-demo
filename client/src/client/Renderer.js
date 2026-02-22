import { GESTURES } from "./HandHeuristics.js";

// Helpers
// Generates a distinct color for any given ID using the Golden Ratio
function getColorForId(id) {
  // 1. Handle missing IDs
  if (id === null || id === undefined) return "#aaa"; // Default grey

  // 2. Ensure ID is a number (handle string IDs from real server)
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

// Draws a spikey polygon (Mace/Morningstar shape)
function drawSpikeyFlail(ctx, x, y, baseRadius, fillStyle, strokeStyle, time) {
  // Scale the number of spikes based on how big the flail is
  const numSpikes = Math.max(6, Math.floor(baseRadius / 2)); 
  const innerRadius = baseRadius;
  const outerRadius = baseRadius * 1.35; // Spikes stick out 35% further
  const rotation = time / 500; // Slow continuous rotation

  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1;
  
  ctx.beginPath();
  for (let i = 0; i < numSpikes * 2; i++) {
    // Alternate between outer (spike tip) and inner (base) radius
    const currentRadius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (Math.PI * 2 / (numSpikes * 2)) * i + rotation;
    
    const ptX = x + Math.cos(angle) * currentRadius;
    const ptY = y + Math.sin(angle) * currentRadius;
    
    if (i === 0) ctx.moveTo(ptX, ptY);
    else ctx.lineTo(ptX, ptY);
  }
  ctx.closePath();
  
  // Add a drop shadow for depth
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  
  ctx.fill();
  
  ctx.shadowColor = "transparent"; // Reset shadow for stroke
  ctx.stroke();
}

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  // Called every frame by main.js
  render(worldState, localPlayerId, localInput, trackingCenter, maxRadius) {
    // console.log("LocalInput" + localInput.x + localInput.y + "\nLocalPlayerId:" + localPlayerId + "\nMaxRadius:" + maxRadius);

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

          ctx.setLineDash([ctx.lineWidth * 2, ctx.lineWidth]); // Dashed line
          ctx.beginPath();
          ctx.moveTo(owner.x, owner.y);
          ctx.lineTo(f.x, f.y);
          ctx.stroke();
          ctx.setLineDash([]); // Reset line dash
        }
      }

      // If detached, color it brighter with red outline to indicate danger. Otherwise, match player color.
      const fillColor = f.isDetached ? ColorLuminance(playerColor, 0.3) : playerColor;
      const strokeColor = f.isDetached ? "#ff0000" : "rgba(0,0,0,0.8)";
      // Draw the spikey shape!
      drawSpikeyFlail(ctx, f.x, f.y, radius, fillColor, strokeColor, Date.now());

      // ctx.fillStyle = f.isDetached ? ColorLuminance(playerColor, 0.3) : playerColor;
      // ctx.beginPath();
      // ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
      // ctx.fill();
      // ctx.lineWidth = 2;
      // ctx.strokeStyle = "rgba(0,0,0,0.5)";
      // ctx.stroke();
    });

    // 6. Draw Players
    worldState.players.forEach(p => {
      const playerColor = getColorForId(p.id);

      ctx.fillStyle = playerColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 25, 0, Math.PI * 2);
      ctx.fill();
      
      // Outline, highlight this player
      ctx.strokeStyle = p.id === localPlayerId ? "rgba(200,200,255,0.8)" : "rgba(200,0,0,0.8)";
      ctx.lineWidth = p.id === localPlayerId ? 4 : 4;
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
    this.drawJoystickHUD(localInput, trackingCenter, width, height, maxRadius);
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
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
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


    //   // Draw Tracking Center
    // ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    // ctx.beginPath();
    // ctx.arc(centerX, centerY, 50, 0, Math.PI * 2); // Deadzone visual
    // ctx.stroke();


drawJoystickHUD(localInput, trackingCenter, width, height, maxRadius) {
    const ctx = this.ctx;
    const centerX = trackingCenter.x * width;
    const centerY = trackingCenter.y * height;
    const handX = localInput.x * width;
    const handY = localInput.y * height;

    // The logic in main.js uses normalized screen ratios (0 to 1).
    // Because the screen is a rectangle, a uniform radius in ratio-space 
    // forms an ellipse in pixel-space.
    const maxRadiusPxX = maxRadius * width;
    const maxRadiusPxY = maxRadius * height;
    // const deadzonePxX = 0.02 * width;
    // const deadzonePxY = 0.02 * height;

    const dx = localInput.x - trackingCenter.x;
    const dy = localInput.y - trackingCenter.y;
    const distance = Math.hypot(dx, dy);

    // // Draw Max Boundary Ellipse (Dashed)
    // ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    // ctx.lineWidth = 2;
    // ctx.setLineDash([10, 10]);
    // ctx.beginPath();
    // ctx.ellipse(centerX, centerY, maxRadiusPxX, maxRadiusPxY, 0, 0, Math.PI * 2);
    // ctx.stroke();
    // ctx.setLineDash([]); // Reset dashes

    // // 2. Draw Deadzone (Inner Solid Ring)
    // ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    // ctx.beginPath();
    // ctx.ellipse(centerX, centerY, deadzonePxX, deadzonePxY, 0, 0, Math.PI * 2);
    // ctx.stroke();

    // Draw Tracking Center as a circle because I prefer it like this
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, 50, 0, Math.PI * 2);
    ctx.stroke();

    // 3. Draw Connecting Line
    if (distance > maxRadius) {
      // Find the exact pixel coordinate where the line crosses the max boundary
      const limitRatio = maxRadius / distance;
      const limitPxX = centerX + (handX - centerX) * limitRatio;
      const limitPxY = centerY + (handY - centerY) * limitRatio;

      // Solid inner line (up to max speed)
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(limitPxX, limitPxY);
      ctx.strokeStyle = "rgba(0, 188, 212, 0.9)"; // Cyan for active power
      ctx.lineWidth = 4;
      ctx.stroke();

      // Faded outer line (wasted movement beyond max speed)
      ctx.beginPath();
      ctx.moveTo(limitPxX, limitPxY);
      ctx.lineTo(handX, handY);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // Hand is inside the boundary, entire line is solid
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(handX, handY);
      ctx.strokeStyle = "rgba(0, 188, 212, 0.9)";
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    // 4. Draw Hand Cursor
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    if (localInput.gesture === GESTURES.PINCH || localInput.gesture === GESTURES.CLOSED) {
      ctx.fillStyle = "rgba(255, 0, 0, 0.4)"; // Red for retract
    }
    if (localInput.gesture == GESTURES.POINT) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.4)"; // Green for attack
    }
    
    ctx.beginPath();
    ctx.arc(handX, handY, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}