import { HandTracker } from "./handTracker.js";
import { processHandData, GESTURES } from "./handHeuristics.js";
import { NetworkManager } from "./networkManager.js";
import { GameRenderer } from "./renderer.js";

// DOM Elements
const gameCanvas = document.getElementById("game_canvas");
const debugCanvas = document.getElementById("debug_canvas");
const debugCtx = debugCanvas.getContext("2d");
const video = document.getElementById("webcam");
const pipContainer = document.getElementById("pip_container");

const mainMenu = document.getElementById("menu_screen");
const inGameUi = document.getElementById("game_ui_layer");
const enableCameraBtn = document.getElementById("enableCameraBtn");
const playBtn = document.getElementById("playBtn");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinCodeGroup = document.getElementById("joinCodeGroup");
const joinCodeInput = document.getElementById("joinCodeInput");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomCodeLabel = document.getElementById("roomCodeLabel");
const killFeedEl = document.getElementById("killFeed");
const playerNameInput = document.getElementById("playerName");

const infoBtn = document.getElementById("infoBtn");
const infoModal = document.getElementById("infoModal");
const closeInfoBtn = document.getElementById("closeInfoBtn");

// DEBUG: Recorder
const recordBtn = document.createElement("button");
recordBtn.textContent = "Rec";
recordBtn.style = "position:fixed;top:10px;right:10px;z-index:10000";
document.body.appendChild(recordBtn);
recordBtn.onclick = () => {
  const stream = gameCanvas.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "canvas.webm"; a.click();
  };
  rec.start();
  setTimeout(() => rec.stop(), 5000);
};

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

network.onError = (code, message) => {
  alert(message || "Connection error, please try again.");
  exitGame();
};
network.onWelcome = (playerId, roomCode) => {
  if (roomCodeLabel) roomCodeLabel.textContent = roomCode ? `Room ${roomCode}` : "";
};
network.onKill = (killerName, victimName) => {
  pushKillFeedEntry(killerName, victimName);
};

function pushKillFeedEntry(killerName, victimName) {
  if (!killFeedEl) return;
  const entry = document.createElement("div");
  entry.className = "kill-feed-entry";
  entry.textContent = `${killerName} popped ${victimName}`;
  killFeedEl.appendChild(entry);
  while (killFeedEl.children.length > 5) {
    killFeedEl.removeChild(killFeedEl.firstChild);
  }
  setTimeout(() => entry.classList.add("fade-out"), 2000);
  setTimeout(() => entry.remove(), 2400);
}

// State
let localInput = { x: 0.5, y: 0.5, gesture: GESTURES.OPEN }; 
let trackingCenter = { x: 0.5, y: 0.5 }; // Screen center ratio (0-1)
let worldState = null; 

let lastVideoTime = -1;
let isCameraActive = false;
let isPlaying = false;
let renderFrameId = null;

// Single-rAF scheduler state. Drives fixed-timestep input/prediction
// (40Hz, matching the server tick) and renders every frame. Replaces the
// old setInterval(networkLoop, 25) which fought vsync and caused jitter.
const NET_STEP_MS = 1000 / 40;
let lastRafTime = null;
let netAccumulatorMs = 0;

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

// Handle window resizing (high-DPI: buffer at devicePixelRatio for sharp rendering)
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = window.innerWidth;
  const h = window.innerHeight;
  gameCanvas.width = w * dpr;
  gameCanvas.height = h * dpr;
  gameCanvas.style.width = w + "px";
  gameCanvas.style.height = h + "px";
}
window.addEventListener("resize", resizeCanvas);
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
  if (playBtn) playBtn.addEventListener("click", onPlay);
  if (createRoomBtn) createRoomBtn.addEventListener("click", onCreateRoom);
  if (joinRoomBtn) joinRoomBtn.addEventListener("click", onJoinCode);
  const togglePipBtn = document.getElementById("togglePipBtn");
  if (togglePipBtn) {
    togglePipBtn.addEventListener("click", () => pipContainer.classList.toggle("minimized"));
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
  tracker.startInference(stream);

  video.addEventListener("loadeddata", () => {
    debugCanvas.width = video.videoWidth;
    debugCanvas.height = video.videoHeight;
    isCameraActive = true;

    pipContainer.classList.remove("hidden");

    enableCameraBtn.innerHTML = `<span class="btn-text">Camera Active</span><span class="btn-sub">Click to Disable</span>`;
    enableCameraBtn.classList.add("active-state");
    enableCameraBtn.disabled = false;
    if (playBtn) playBtn.classList.remove("hidden");
    if (createRoomBtn) createRoomBtn.classList.remove("hidden");
    if (joinCodeGroup) joinCodeGroup.classList.remove("hidden");
    if (joinRoomBtn) joinRoomBtn.classList.remove("hidden");
    trackCameraLoop();
  });
}

async function stopCamera() {
  isCameraActive = false;
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  tracker.stopInference();

  enableCameraBtn.disabled = false;
  enableCameraBtn.innerHTML = `<span class="btn-text">Initialize Camera</span><span class="btn-sub">Required to play</span>`;
  enableCameraBtn.classList.remove("active-state");
  if (playBtn) playBtn.classList.add("hidden");
  if (createRoomBtn) createRoomBtn.classList.add("hidden");
  if (joinCodeGroup) joinCodeGroup.classList.add("hidden");
  if (joinRoomBtn) joinRoomBtn.classList.add("hidden");

  pipContainer.classList.add("hidden");
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
}

function startGame(name, roomCode) {
  if (!network.joinGame(name, roomCode)) return;

  mainMenu.classList.add("hidden");
  inGameUi.classList.remove("hidden");
  isPlaying = true;
  trackingCenter = { x: 0.5, y: 0.5 };

  lastRafTime = null;
  netAccumulatorMs = 0;
  renderFrameId = requestAnimationFrame(renderLoop);
}

function onPlay() {
  if (!isCameraActive) {
    alert("Please initialize the camera first to play.");
    return;
  }
  startGame(playerNameInput.value.trim() || "Anonymous", null);
}

async function onCreateRoom() {
  if (!isCameraActive) {
    alert("Please initialize the camera first to play.");
    return;
  }
  const name = playerNameInput.value.trim() || "Anonymous";
  try {
    const code = await network.createPrivateRoom();
    startGame(name, code);
  } catch (err) {
    console.error("Create room failed:", err);
    alert("Couldn't create a room right now, please try again.");
  }
}

function onJoinCode() {
  if (!isCameraActive) {
    alert("Please initialize the camera first to play.");
    return;
  }
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!code) {
    alert("Enter a room code to join.");
    return;
  }
  startGame(playerNameInput.value.trim() || "Anonymous", code);
}

function exitGame() {
  isPlaying = false;
  if (renderFrameId) cancelAnimationFrame(renderFrameId);
  renderFrameId = null;

  mainMenu.classList.remove("hidden");
  inGameUi.classList.add("hidden");
  if (roomCodeLabel) roomCodeLabel.textContent = "";
  if (killFeedEl) killFeedEl.innerHTML = "";

  const ctx = gameCanvas.getContext("2d");
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
}

// --- LOOP 1: Input Processing (Runs on camera frames) ---
function trackCameraLoop() {
  if (!isCameraActive) return;
  const rawHand = tracker.getLatestLandmarks();
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  
  if (rawHand) {
    const handState = processHandData(rawHand);
    
    // NOT mirrored here
    localInput.x = handState.position.x;
    localInput.y = handState.position.y;
    localInput.gesture = handState.gesture;

    // Draw overlay
    tracker.drawDebugMesh(rawHand); 
    drawPiPOverlay(debugCtx, handState, trackingCenter, debugCanvas.width, debugCanvas.height);
  }
  // Use requestVideoFrameCallback if available, otherwise fallback to rAF
  if ('requestVideoFrameCallback' in video) {
    video.requestVideoFrameCallback(trackCameraLoop);
  } else {
    requestAnimationFrame(trackCameraLoop);
  }
}

// Network Sync (40Hz), now called from the main renderLoop.
function networkTick() {
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

// --- LOOP 3: Game Rendering + Fixed-Timestep Network Drive (per rAF) ---
// One rAF callback drives both the 40Hz input/prediction tick (via an
// accumulator) and a render every frame. Keeping input sampling on the
// same rAF as rendering lets the browser batch the work for the next
// vsync instead of letting a separate setInterval (or the interpolation
// allocators in getLatestWorldState) steal mid-frame CPU and cause the
// browser to miss a refresh — which was the source of the 30ms jitter.
function renderLoop(now) {
  if (!isPlaying) return; // Stop render loop if not playing

  if (lastRafTime == null) lastRafTime = now;
  const dtMs = Math.min(now - lastRafTime, 200); // clamp tab-switch gaps
  lastRafTime = now;
  netAccumulatorMs += dtMs;

  // Fixed 40Hz input/prediction step(s). Usually 0 or 1; cap at 5 to avoid
  // the spiral-of-death after a stall, then drop the residual.
  let steps = 0;
  while (netAccumulatorMs >= NET_STEP_MS && steps < 5) {
    networkTick();
    netAccumulatorMs -= NET_STEP_MS;
    steps++;
  }
  if (steps === 5) netAccumulatorMs = 0;

  worldState = network.getLatestWorldState();
  const t0 = performance.now();
  if (worldState) {
    renderer.render(worldState, network.myId, localInput, trackingCenter);
  }
  console.log(`frame=${dtMs.toFixed(1)} render=${(performance.now()-t0).toFixed(1)}`);
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
