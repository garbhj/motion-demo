import { HandLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

export class HandTracker {
  constructor() {
    this.handLandmarker = null;
    this.drawingUtils = null;
  }

  // 1. Download and initialize the AI Model
  async initialize() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    
    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        delegate: "GPU" // Use hardware acceleration
      },
      runningMode: "VIDEO",
      numHands: 1 // Only track 1 hand for game simplicity
    });
  }

  // 2. Setup the Canvas drawing utilities
  setCanvas(canvasCtx) {
    this.drawingUtils = new DrawingUtils(canvasCtx);
  }

  // 3. Process a single frame of video
  detect(videoElement, timestampMs) {
    if (!this.handLandmarker) return null;
    return this.handLandmarker.detectForVideo(videoElement, timestampMs);
  }

  // 4. Draw the raw AI skeleton (Good for debugging)
  drawDebugMesh(landmarks) {
    if (!this.drawingUtils) return;
    this.drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color: "#00FF00",
      lineWidth: 2
    });
    this.drawingUtils.drawLandmarks(landmarks, { 
      color: "#FF0000", 
      lineWidth: 1, 
      radius: 2 
    });
  }
}