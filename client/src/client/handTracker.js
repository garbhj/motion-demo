import { HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";
import HandWorker from "./handWorker.js?worker";

// Initializes and manages a handWorker
export class HandTracker {
  constructor() {
    this.drawingUtils = null;
    this.worker = null;
    this._latestLandmarks = null;
    this._latestTimestamp = 0;
    this._processor = null;
    this._reader = null;
    this._track = null;
    this._running = false;
    this._workerBusy = false;
    // Bumped on every startInference(). Stale worker results from a prior
    // session are dropped so they can't falsely clear _workerBusy for the new
    // one — important because stopInference() can't wait for an in-flight
    // detectForVideo() that's already been posted to the worker.
    this._session = 0;
  }

  async initialize() {
    this.worker = new HandWorker();

    return new Promise((resolve, reject) => {
      // onmessage outlives the promise
      this.worker.onmessage = (e) => {
        if (e.data.type === "ready") {
          resolve();
        } else if (e.data.type === "error") {
          console.warn("hand worker error:", e.data.message);
          this._workerBusy = false;
          reject(new Error(e.data.message));
        } else if (e.data.type === "result") {
          if (e.data.session !== this._session) return;
          this._latestLandmarks = e.data.landmarks[0] || null;
          this._latestTimestamp = e.data.timestamp;
          this._workerBusy = false;
        }
      };
      this.worker.postMessage({ type: "init" })
    });
  }

  setCanvas(canvasCtx) {
    this.drawingUtils = new DrawingUtils(canvasCtx);
  }

  startInference(stream) {
    this._session++;
    this._workerBusy = false;
    this._track = stream.getVideoTracks()[0];
    this._processor = new MediaStreamTrackProcessor({ track: this._track });
    this._reader = this._processor.readable.getReader();
    this._running = true;
    this._pump();
  }

  async _pump() {
    while (this._running) {
      const { value: frame, done } = await this._reader.read();
      if (done) break;
      // Drop frames if MediaPipe worker lags.
      if (this._workerBusy) {
        console.warn("Dropped Frame");
        frame.close();
      } else {
        this._workerBusy = true;
        this.worker.postMessage({ type: "frame", session: this._session, frame }, [frame]);
      }
    }
    try { this._reader.releaseLock(); } catch {

    }
  }

  stopInference() {
    this._running = false;
    if (this._track) {
      this._track.stop();
      this._track = null;
    }
    if (this._reader) {
      try {
        this._reader.cancel();
      } catch {};
      this._reader = null;
    }
  }

  getLatestLandmarks() {
    return this._latestLandmarks;
  }

  getLatestTimestamp() {
    return this._latestTimestamp;
  }
  
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