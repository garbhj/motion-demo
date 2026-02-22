import { HandTracker } from "./HandTracker.js";
import { processHandData, GESTURES } from "./HandHeuristics.js";
import { NetworkManager } from "./NetworkManager.js";
import { GameRenderer } from "./Renderer.js";

// DOM Elements
const gameCanvas = document.getElementById("game_canvas");
const debugCanvas = document.getElementById("debug_canvas");
const debugCtx = debugCanvas.getContext("2d");
const video = document.getElementById("webcam");
const pipContainer = document.getElementById("pip_container");

const mainMenu = document.getElementById("menu_screen");
const inGameUi = document.getElementById("game_ui_layer");
const enableCameraBtn = document.getElementById("enableCameraBtn");
const playBtn = document.getElementById("startGameBtn");
const playerNameInput = document.getElementById("playerName");

// --- Info Modal Logic ---
const infoBtn = document.getElementById("infoBtn");
const infoModal = document.getElementById("infoModal");
const closeInfoBtn = document.getElementById("closeInfoBtn");

// Ensure elements exist before adding listeners
if (infoBtn && infoModal && closeInfoBtn) {
  const toggleModal = (show) => {
    if (show) infoModal.classList.remove("hidden");
    else infoModal.classList.add("hidden");
  };

  // Open modal
  infoBtn.addEventListener("click", () => toggleModal(true));
  
  // Close modal via X button
  closeInfoBtn.addEventListener("click", () => toggleModal(false));
  
  // Close modal by clicking the dark background outside the modal
  infoModal.addEventListener("click", (e) => {
    if (e.target === infoModal) toggleModal(false);
  });
}

// Modules
const tracker = new HandTracker();
const network = new NetworkManager();
const renderer = new GameRenderer(gameCanvas);

// State
let localInput = { x: 0.5, y: 0.5, gesture: GESTURES.OPEN }; 
let trackingCenter = { x: 0.5, y: 0.5 }; // Screen center ratio (0-1)
let worldState = null; 

let lastVideoTime = -1;
let isCameraActive = false;
let isPlaying = false;
let networkInterval = null;
let renderFrameId = null;  // 

// Controls
document.getElementById("exitBtn").addEventListener("click", exitGame);

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
  enableCameraBtn.innerText = "Loading AI...";
  enableCameraBtn.disabled = true;
  await tracker.initialize();
  tracker.setCanvas(debugCtx);
  
  enableCameraBtn.innerHTML = `<span class="btn-text">Initialize Camera</span><span class="btn-sub">Required to play</span>`;
  enableCameraBtn.disabled = false;

  enableCameraBtn.addEventListener("click", toggleCamera);
  playBtn.addEventListener("click", startGame);
  
  document.getElementById("togglePipBtn").addEventListener("click", () => {
    pipContainer.classList.toggle("minimized");
  });
}

// STATE 1: CAMERA START/STOP
async function toggleCamera() {
  if (isCameraActive) {
    stopCamera();
  } else {
    await startCamera();
  }
}

async function startCamera() {
  enableCameraBtn.disabled = true;
  // Update button text to look better with new CSS
  enableCameraBtn.innerHTML = `<span class="btn-text">Starting...</span><span class="btn-sub">Please wait</span>`;
  
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  
  video.addEventListener("loadeddata", () => {
    debugCanvas.width = video.videoWidth;
    debugCanvas.height = video.videoHeight;
    isCameraActive = true;

    pipContainer.classList.remove("hidden");
    
    // Update button to show "On" state
    enableCameraBtn.innerHTML = `<span class="btn-text">Camera Active</span><span class="btn-sub">Click to Disable</span>`;
    enableCameraBtn.classList.add("active-state"); // Optional: add CSS for this if you want green border
    enableCameraBtn.disabled = false;
    
    playBtn.disabled = false; // Enable the big Play button
    trackCameraLoop();
  });
}

async function stopCamera()  {
  isCameraActive = false;
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }

  enableCameraBtn.disabled = false;
  // Reset Button Text
  enableCameraBtn.innerHTML = `<span class="btn-text">Initialize Camera</span><span class="btn-sub">Required to play</span>`;

  pipContainer.classList.add("hidden");
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);  // Wipes the PiP

  playBtn.disabled = true;
}

// STATE 2: GAME START/STOP
function startGame() {
  const name = playerNameInput.value.trim() || "Anonymous";
  
  console.log("JOINING GAME!!");
  // Tell network we're joining
  network.joinGame(name);

  mainMenu.classList.add("hidden");
  inGameUi.classList.remove("hidden");
  isPlaying = true;

  trackingCenter = { x: 0.5, y: 0.5 };  // Reset the tracking center to middle upon starting

  networkInterval = setInterval(networkLoop, 1000 / 20); // 20 FPS
  renderFrameId = requestAnimationFrame(renderLoop);
}

function exitGame() {
  isPlaying = false;
  
  // Stop Loops
  clearInterval(networkInterval);
  if (renderFrameId) cancelAnimationFrame(renderFrameId);
  // stopCamera(); // Stop camera

  // Reset UI
  mainMenu.classList.remove("hidden");
  inGameUi.classList.add("hidden");
  
  // Clear *game* canvas
  const ctx = gameCanvas.getContext("2d");
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
}

// --- LOOP 1: Input Processing (Runs on camera frames) ---
function trackCameraLoop() {
  if (!isCameraActive) return;

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
      localInput.gesture = handState.gesture !== -1 ? handState.gesture : localInput.gesture;

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
  worldState = network.getLatestWorldState(); 
}

// --- LOOP 3: Game Rendering (60+ FPS) ---
function renderLoop() {
  if (!isPlaying) return; // Stop render loop if not playing

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
