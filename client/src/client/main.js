import { HandTracker } from "./HandTracker.js";
import { processHandData, GESTURES } from "./HandHeuristics.js";
import { NetworkManager } from "./NetworkManager.js";

// DOM Elements
const gameCanvas = document.getElementById("game_canvas");
const gameCtx = gameCanvas.getContext("2d");
const debugCanvas = document.getElementById("debug_canvas");
const debugCtx = debugCanvas.getContext("2d");
const video = document.getElementById("webcam");
const pipContainer = document.getElementById("pip_container");

// Modules
const tracker = new HandTracker();
const network = new NetworkManager();

// --- STATE ---
// 1. Current intended input from camera
let localInput = { x: 0.5, y: 0.5, gesture: GESTURES.OPEN }; 
// 2. The authoritative state from the server
let worldState = { players: [], flails: [] }; 

let lastVideoTime = -1;
let isPlaying = false;

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

  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    const results = tracker.detect(video, performance.now());

    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    
    if (results?.landmarks?.length > 0) {
      const rawHand = results.landmarks[0];
      
      // Update our decoupled local input state
      const handState = processHandData(rawHand);
      localInput.x = handState.position.x;
      localInput.y = handState.position.y;
      localInput.gesture = handState.gesture;

      // Draw skeleton to PiP
      tracker.drawDebugMesh(rawHand); 
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
  // 1. Send our current input (mouse/hand intent) to server
  network.sendPlayerInput(localInput);

  // 2. Fetch the latest true state of the world from the server
  // (In reality, this is handled asynchronously via WebSocket `onmessage`)
  worldState = network.getLatestWorldState(); 
}

// --- LOOP 3: Game Rendering (60+ FPS) ---
function renderLoop() {
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

  // Example: Draw the world based on SERVER state, NOT local input
  // (Though you might draw a subtle reticle showing the localInput so the player knows where their hand is aiming)

  // 1. Draw Player target reticle (Local Input)
  const targetX = localInput.x * gameCanvas.width;
  const targetY = localInput.y * gameCanvas.height;
  gameCtx.strokeStyle = "rgba(255,255,255,0.5)";
  gameCtx.beginPath();
  gameCtx.arc(targetX, targetY, 15, 0, Math.PI * 2);
  gameCtx.stroke();

  // 2. Draw actual players from server state
  worldState.players.forEach(p => {
    gameCtx.fillStyle = p.color;
    gameCtx.beginPath();
    gameCtx.arc(p.x, p.y, 25, 0, Math.PI * 2);
    gameCtx.fill();
  });

  // 3. Draw flails from server state
  worldState.flails.forEach(f => {
    gameCtx.fillStyle = f.isDetached ? "red" : "gray";
    gameCtx.beginPath();
    gameCtx.arc(f.x, f.y, 12, 0, Math.PI * 2);
    gameCtx.fill();
    
    // Draw chain if attached
    if (!f.isDetached) {
      const owner = worldState.players.find(p => p.id === f.ownerId);
      if (owner) {
        gameCtx.strokeStyle = "gray";
        gameCtx.beginPath();
        gameCtx.moveTo(owner.x, owner.y);
        gameCtx.lineTo(f.x, f.y);
        gameCtx.stroke();
      }
    }
  });

  requestAnimationFrame(renderLoop);
}

boot();