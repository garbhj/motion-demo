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
const playerNameInput = document.getElementById("playerName");
const roomListEl = document.getElementById("roomList");
const roomListEmptyEl = document.getElementById("roomListEmpty");
const refreshRoomsBtn = document.getElementById("refreshRoomsBtn");
const createLobbyBtn = document.getElementById("createLobbyBtn");

const infoBtn = document.getElementById("infoBtn");
const infoModal = document.getElementById("infoModal");
const closeInfoBtn = document.getElementById("closeInfoBtn");

if (infoBtn && infoModal && closeInfoBtn) {
  infoBtn.addEventListener("click", () => infoModal.classList.remove("hidden"));
  closeInfoBtn.addEventListener("click", () => infoModal.classList.add("hidden"));
  infoModal.addEventListener("click", (e) => {
    if (e.target === infoModal) infoModal.classList.add("hidden");
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
const exitBtn = document.getElementById("exitBtn");
if (exitBtn) exitBtn.addEventListener("click", exitGame);

// To recenter joystick, click button and or key "c"
const recenterBtn = document.getElementById("recenterBtn");
if (recenterBtn) recenterBtn.addEventListener("click", recenterJoystick);
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
  if (!enableCameraBtn) return;
  enableCameraBtn.disabled = true;
  enableCameraBtn.innerHTML = `<span class="btn-text">Loading AI...</span><span class="btn-sub">Please wait</span>`;
  try {
    await tracker.initialize();
    tracker.setCanvas(debugCtx);
  } catch (err) {
    console.error("Tracker init failed:", err);
    enableCameraBtn.innerHTML = `<span class="btn-text">Init failed</span><span class="btn-sub">Check console</span>`;
    enableCameraBtn.disabled = false;
    return;
  }
  enableCameraBtn.innerHTML = `<span class="btn-text">Initialize Camera</span><span class="btn-sub">Required to play</span>`;
  enableCameraBtn.disabled = false;

  enableCameraBtn.addEventListener("click", toggleCamera);
  if (refreshRoomsBtn) {
    refreshRoomsBtn.addEventListener("click", refreshRoomList);
  }
  if (createLobbyBtn) {
    createLobbyBtn.disabled = true;
    createLobbyBtn.addEventListener("click", onCreateLobby);
  }
  const togglePipBtn = document.getElementById("togglePipBtn");
  if (togglePipBtn) {
    togglePipBtn.addEventListener("click", () => pipContainer.classList.toggle("minimized"));
  }

  if (roomListEl && roomListEmptyEl) {
    refreshRoomList();
  }
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
  enableCameraBtn.innerHTML = `<span class="btn-text">Starting...</span><span class="btn-sub">Please wait</span>`;

  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;

  video.addEventListener("loadeddata", () => {
    debugCanvas.width = video.videoWidth;
    debugCanvas.height = video.videoHeight;
    isCameraActive = true;

    pipContainer.classList.remove("hidden");

    enableCameraBtn.innerHTML = `<span class="btn-text">Camera Active</span><span class="btn-sub">Click to Disable</span>`;
    enableCameraBtn.classList.add("active-state");
    enableCameraBtn.disabled = false;
    if (createLobbyBtn) createLobbyBtn.disabled = false;
    trackCameraLoop();
  });
}

async function stopCamera() {
  isCameraActive = false;
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }

  enableCameraBtn.disabled = false;
  enableCameraBtn.innerHTML = `<span class="btn-text">Initialize Camera</span><span class="btn-sub">Required to play</span>`;
  enableCameraBtn.classList.remove("active-state");
  if (createLobbyBtn) createLobbyBtn.disabled = true;

  pipContainer.classList.add("hidden");
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
}

async function refreshRoomList() {
  if (!roomListEl || !roomListEmptyEl) return;
  const rooms = await network.fetchRooms();
  roomListEl.innerHTML = "";
  if (rooms.length === 0) {
    roomListEmptyEl.classList.remove("hidden");
  } else {
    roomListEmptyEl.classList.add("hidden");
    for (const room of rooms) {
      const li = document.createElement("li");
      li.className = "room-item";
      li.innerHTML = `<span class="room-code">${escapeHtml(room.code)}</span><span class="room-players">${room.players} player${room.players !== 1 ? "s" : ""}</span>`;
      li.dataset.code = room.code;
      li.addEventListener("click", () => {
        if (!isCameraActive) {
          alert("Please initialize the camera first to play.");
          return;
        }
        joinRoom(room.code);
      });
      roomListEl.appendChild(li);
    }
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function onCreateLobby() {
  if (!isCameraActive) {
    alert("Please initialize the camera first to play.");
    return;
  }
  createLobbyBtn.disabled = true;
  createLobbyBtn.textContent = "Creating…";
  const code = await network.createRoom();
  createLobbyBtn.disabled = false;
  createLobbyBtn.textContent = "+ Create lobby";
  if (code) {
    await refreshRoomList();
    joinRoom(code);
  } else {
    alert("Could not create lobby. Is the server running?");
  }
}

function joinRoom(code) {
  if (!isCameraActive) {
    alert("Please initialize the camera first to play.");
    return;
  }
  const name = playerNameInput.value.trim() || "Anonymous";
  if (!network.joinGame(name, code)) return;

  mainMenu.classList.add("hidden");
  inGameUi.classList.remove("hidden");
  isPlaying = true;
  trackingCenter = { x: 0.5, y: 0.5 };

  networkInterval = setInterval(networkLoop, 1000 / 40);
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
  refreshRoomList();

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

  let moveVector = { ax: 0, ay: 0, boost: false, shoot: false };

  if (distance > deadzone) {
    const clampedDist = Math.min(distance, maxRadius);
    moveVector.ax = (dx / distance) * (clampedDist / maxRadius);
    moveVector.ay = (dy / distance) * (clampedDist / maxRadius);
  }
  // Pinch = sprint, Fist = orb hit, Point = neither (no glitch)
  moveVector.boost = localInput.gesture === GESTURES.PINCH;
  moveVector.shoot = localInput.gesture === GESTURES.CLOSED;

  // Send Analog Vector to server
  network.sendPlayerInput(moveVector);
}

// --- LOOP 3: Game Rendering (60+ FPS) ---
function renderLoop() {
  if (!isPlaying) return; // Stop render loop if not playing

  worldState = network.getLatestWorldState();
  if (worldState) {
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
