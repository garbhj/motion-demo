import { HandTracker } from "./HandTracker.js";
import { processHandData, GESTURES } from "./HandHeuristics.js";
import { NetworkManager } from "./NetworkManager.js";
import { GameRenderer } from "./Renderer.js";

// DOM Elements
const gameCanvas = document.getElementById("game_canvas");
// const gameCtx = gameCanvas.getContext("2d");
const debugCanvas = document.getElementById("debug_canvas");
const debugCtx = debugCanvas.getContext("2d");
const video = document.getElementById("webcam");
const pipContainer = document.getElementById("pip_container");

// Modules
const tracker = new HandTracker();
const network = new NetworkManager();
const renderer = new GameRenderer(gameCanvas);

// State
let localInput = { x: 0.5, y: 0.5, gesture: GESTURES.OPEN }; 
let trackingCenter = { x: 0.5, y: 0.5 }; // Screen center ratio (0-1)
let worldState = null; 

let lastVideoTime = -1;
let isPlaying = false;

// To recenter joystick, click button and or key "c"
document.getElementById("recenterBtn").addEventListener("click", recenterJoystick);
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === 'c') recenterJoystick();
});

function recenterJoystick() {
  trackingCenter.x = localInput.x;
  trackingCenter.y = localInput.y;
}

// Handle window resizing
function resizeCanvas() {
  gameCanvas.width = window.innerWidth;
  gameCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

async function boot() {
  await tracker.initialize();
  tracker.setCanvas(debugCtx); // Tracker only draws to the PiP debug canvas now!
  
  document.getElementById("startGameBtn").addEventListener("click", startCamera);
  document.getElementById("togglePipBtn").addEventListener("click", () => {
    pipContainer.classList.toggle("minimized");
  });
}

async function startCamera() {
  document.getElementById("ui_layer").style.display = "none";
  pipContainer.classList.remove("hidden");
  
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  
  // Wait for video to start playing before kicking off loops
  video.addEventListener("loadeddata", () => {
    debugCanvas.width = video.videoWidth;
    debugCanvas.height = video.videoHeight;
    isPlaying = true;

    // Start independent loops
    requestAnimationFrame(renderLoop);   // Render as fast as possible (60fps)
    setInterval(networkLoop, 1000 / 20); // Network 20 times a second
    trackCameraLoop();                   // Input tied to camera frame rate
  });
}

// --- LOOP 1: Input Processing (Runs on camera frames) ---
function trackCameraLoop() {
  if (!isPlaying) return;

  if (video.currentTime !== lastVideoTime) {  // Note: using explicit variable
    lastVideoTime = video.currentTime; 

    const results = tracker.detect(video, performance.now());

    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    
    if (results?.landmarks?.length > 0) {
      const rawHand = results.landmarks[0];
      const handState = processHandData(rawHand);
      
      // Update local logical state (Un-mirrored, used for game logic)
      localInput.x = handState.position.x;
      localInput.y = handState.position.y;
      localInput.gesture = handState.gesture;

      // 1. Draw raw AI skeleton
      tracker.drawDebugMesh(rawHand); 

      // 2. Draw PiP Overlay (Tracking Center & Arrow)
      drawPiPOverlay(debugCtx, handState, trackingCenter, debugCanvas.width, debugCanvas.height);
    }
  }  
  // Use requestVideoFrameCallback if available, otherwise fallback to rAF
  if ('requestVideoFrameCallback' in video) {
    video.requestVideoFrameCallback(trackCameraLoop);
  } else {
    requestAnimationFrame(trackCameraLoop);
  }
}

// --- LOOP 2: Network Syncing (Fixed 20 FPS) ---
function networkLoop() {
  // Calculate Joystick Vector (Difference between hand and tracking center)
  let dx = localInput.x - trackingCenter.x;
  let dy = localInput.y - trackingCenter.y;

  // Optional: Create a "deadzone" so slight hand jitters don't move you
  const distance = Math.hypot(dx, dy);
  const deadzone = 0.02; // Proportion of screen
  const maxRadius = 0.25; // Max 

  let moveVector = { moveX: 0, moveY: 0, gesture: localInput.gesture };

  if (distance > deadzone) {
    // Cap at maxRadius and normalize to -1.0 to 1.0
    const clampedDist = Math.min(distance, maxRadius);
    moveVector.moveX = (dx / distance) * (clampedDist / maxRadius);
    moveVector.moveY = (dy / distance) * (clampedDist / maxRadius);
  }

  // Send Analog Vector to server
  network.sendPlayerInput(moveVector);

  // Fetch world state
  worldState = network.getLatestWorldState(); 
}

// --- LOOP 3: Game Rendering (60+ FPS) ---
function renderLoop() {
  if (worldState) {
    // Offload all rendering to the new Renderer module
    renderer.render(worldState, network.myId, localInput, trackingCenter);
  }
  requestAnimationFrame(renderLoop);
}

boot();

// --- PiP Drawing Function ---
function drawPiPOverlay(ctx, handState, centerPos, width, height) {
  // 1. Calculate Visual Coordinates 
  // We use (1 - X) because the canvas CSS is mirrored (scaleX(-1)). 
  // If we don't invert X here, the overlay will move opposite to the video!
  const visualHandX = (1 - handState.position.x) * width;
  const visualHandY = handState.position.y * height;
  
  const visualCenterX = (1 - centerPos.x) * width;
  const visualCenterY = centerPos.y * height;

  // 2. Draw Tracking Center (Anchor Point)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 2;
  
  ctx.beginPath();
  ctx.arc(visualCenterX, visualCenterY, 30, 0, Math.PI * 2); // Outer deadzone ring
  ctx.fill();
  ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(visualCenterX, visualCenterY, 4, 0, Math.PI * 2);  // Center dot
  ctx.fillStyle = "white";
  ctx.fill();

  // 3. Draw Connecting Line (The "Joystick" shaft)
  ctx.beginPath();
  ctx.moveTo(visualCenterX, visualCenterY);
  ctx.lineTo(visualHandX, visualHandY);
  ctx.strokeStyle = "rgba(255, 255, 0, 0.8)"; // Yellow line
  ctx.lineWidth = 4;
  ctx.stroke();

  // 4. Determine Hand Color based on Gesture
  let color = "white";
  let label = "UNKNOWN";
  switch (handState.gesture) {
    case GESTURES.OPEN: color = "#00FF00"; label = "OPEN"; break;
    case GESTURES.CLOSED: color = "#FF0000"; label = "CLOSED"; break;
    case GESTURES.PINCH: color = "#FFFF00"; label = "PINCH"; break;
    case GESTURES.POINT: color = "#00FFFF"; label = "POINT"; break;
  }

  // 5. Draw Hand Dot
  ctx.beginPath();
  ctx.arc(visualHandX, visualHandY, 12, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 6. Draw Un-mirrored Text
  // We must temporarily flip the canvas context so the text doesn't render backwards
  ctx.save();
  ctx.scale(-1, 1); 

  ctx.font = "bold 18px Arial";
  ctx.fillStyle = color;
  ctx.shadowColor = "black";
  ctx.shadowBlur = 4;
  ctx.lineWidth = 3;
  
  // Note: Because we used scale(-1, 1), we MUST use negative X to draw in the correct place!
  const textString = `${label} (${Math.round((handState.position.x - centerPos.x)*100)}, ${Math.round((handState.position.y - centerPos.y)*100)})`;
  
  ctx.strokeText(textString, -visualHandX + 20, visualHandY + 5);
  ctx.fillText(textString, -visualHandX + 20, visualHandY + 5);
  
  ctx.restore();
}
