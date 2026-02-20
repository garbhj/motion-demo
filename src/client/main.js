import { HandTracker } from "./HandTracker.js";
import { processHandData, GESTURES } from "./HandHeuristics.js"; // <-- Import Enum
import { NetworkManager } from "./NetworkManager.js";

// DOM Elements
const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const webcamButton = document.getElementById("webcamButton");
const gameUi = document.getElementById("game-ui");

// Game Modules
const tracker = new HandTracker();
const network = new NetworkManager();

// State
let isPlaying = false;
let lastVideoTime = -1;

async function boot() {
  await tracker.initialize();
  tracker.setCanvas(canvasCtx);
  document.querySelector("p").style.display = "none";
  gameUi.classList.remove("invisible");
}

webcamButton.addEventListener("click", async () => {
  isPlaying = !isPlaying;

  if (isPlaying) {
    webcamButton.innerText = "STOP GAME";
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    video.addEventListener("loadeddata", gameLoop);
  } else {
    webcamButton.innerText = "START GAME";
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  }
});

function gameLoop() {
  if (!isPlaying) return;

  if (canvasElement.width !== video.videoWidth) {
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
  }

  let now = performance.now();
  
  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    const results = tracker.detect(video, now);

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    if (results && results.landmarks && results.landmarks.length > 0) {
      const rawHand = results.landmarks[0];

      // Flip canvas temporarily draw the raw AI skeleton
      canvasCtx.save();
      canvasCtx.scale(-1, 1); // Flip horizontally
      canvasCtx.translate(-canvasElement.width, 0); // Move canvas back into view
      tracker.drawDebugMesh(rawHand);
      canvasCtx.restore(); // Revert canvas back to normal

      // Process Game Logic
      const gameState = processHandData(rawHand);

      // Draw Visuals based on the new gesture Enum
      drawGameDot(gameState);

      // Send state to server
      network.sendPlayerState(gameState);
    }
    canvasCtx.restore();
  }

  window.requestAnimationFrame(gameLoop);
}

// --- Updated Game Graphics logic ---
function drawGameDot(gameState) {
  const pixelX = gameState.position.x * canvasElement.width;
  const pixelY = gameState.position.y * canvasElement.height;
  
  let color = "white";
  let label = "UNKNOWN";

  // Map the gesture integer to colors and labels
  switch (gameState.gesture) {
    case GESTURES.OPEN:
      color = "rgba(0, 255, 0, 0.8)"; // Lime Green
      label = "OPEN";
      break;
    case GESTURES.CLOSED:
      color = "rgba(255, 0, 0, 0.8)"; // Red
      label = "CLOSED";
      break;
    case GESTURES.PINCH:
      color = "rgba(255, 255, 0, 0.8)"; // Yellow
      label = "PINCH";
      break;
    case GESTURES.POINT:
      color = "rgba(0, 255, 255, 0.8)"; // Cyan
      label = "POINT";
      break;
  }

  // Draw the tracking circle
  canvasCtx.beginPath();
  canvasCtx.arc(pixelX, pixelY, 20, 0, 2 * Math.PI);
  canvasCtx.fillStyle = color;
  canvasCtx.fill();
  canvasCtx.strokeStyle = "white";
  canvasCtx.lineWidth = 3;
  canvasCtx.stroke();

  // Draw the text label floating above the dot
  canvasCtx.font = "24px Arial";
  canvasCtx.fillStyle = color;
  canvasCtx.strokeStyle = "black";
  canvasCtx.lineWidth = 4;
  
  // Center text above the dot (y - 30px)
  canvasCtx.strokeText(label, pixelX - 30, pixelY - 30);
  canvasCtx.fillText(label, pixelX - 30, pixelY - 30);
}

boot();