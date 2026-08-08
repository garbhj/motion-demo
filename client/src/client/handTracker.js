import { HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";
import HandWorker from "./handWorker.js?worker";

// Two strategies for getting frames from the camera into the worker:
//
// 1. MediaStreamTrackProcessor (Chrome, Firefox): main-thread MSTP pulls
//    VideoFrames off a ReadableStream and transfers each frame to the worker.
//    Zero-copy, fast. Not available in Safari (only exposed in workers, and
//    transferring a MediaStreamTrack to a worker is fragile there).
//
// 2. requestVideoFrameCallback + ImageBitmap (Safari, plus any browser
//    without MSTP): rVFC fires on each decoded <video> frame; we draw it to a
//    small OffscreenCanvas and transfer the resulting ImageBitmap to the
//    worker. Heavier (~5ms/frame of main-thread work) but works in every
//    modern browser.
const HAS_MSTP = typeof MediaStreamTrackProcessor === "function";

export class HandTracker {
  constructor() {
    this.drawingUtils = null;
    this.worker = null;
    this._latestLandmarks = null;
    this._latestTimestamp = 0;
    this._session = 0;
    this.onError = null;
    this._initResolve = null;
    this._initReject = null;

    this._strategy = HAS_MSTP ? "mstp" : "rvfc";
    this._running = false;
    this._workerBusy = false;

    // Rolling counters for a per-second dropped-frame summary log.
    // Tracks how often the pump loop discarded a frame because the worker
    // hadn't returned the previous result yet, plus how many results came
    // back — together they yield an effective tracking FPS.
    this._dropsInWindow = 0;
    this._resultsInWindow = 0;
    this._windowStart = 0;

    // MSTP state
    this._track = null;
    this._processor = null;
    this._reader = null;

    // rVFC state
    this._video = null;
    this._canvas = null;
    this._ctx = null;
    this._rVFC = null;

    // Frame extraction targets. Smaller than the (potentially 1080p) camera
    // feed to keep main-thread draw + transfer cheap. hand_landmarker is
    // trained at ~224px; 480 tall is more than enough.
    this._RVFC_W = 640;
    this._RVFC_H = 480;
  }

  _markDrop() {
    this._dropsInWindow++;
    this._maybeReport();
  }

  _markResult() {
    this._resultsInWindow++;
    this._maybeReport();
  }

  // Emit a per-second summary. Scheduling via setTimeout on the *first* event
  // of a window avoids any rAF/timer cost on the hot path when idle.
  _maybeReport() {
    if (this._windowStart) return;
    this._windowStart = performance.now();
    setTimeout(() => {
      const dur = performance.now() - this._windowStart;
      const fps = (this._resultsInWindow * 1000 / dur).toFixed(1);
      const drops = this._dropsInWindow;
      if (drops > 0) {
        console.warn(`Hand tracking: ${fps} fps, ${drops} dropped frame${drops === 1 ? "" : "s"} in last ${(dur/1000).toFixed(1)}s`);
      } else {
        console.log(`Hand tracking: ${fps} fps, 0 dropped frames`);
      }
      this._dropsInWindow = 0;
      this._resultsInWindow = 0;
      this._windowStart = 0;
    }, 1000);
  }

  async initialize() {
    this.worker = new HandWorker();

    return new Promise((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;
      this.worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === "ready") {
          this._initResolve?.();
          this._initResolve = this._initReject = null;
        } else if (d.type === "error") {
          console.warn("hand worker error:", d.message);
          if (this._initReject) {
            this._initReject(new Error(d.message));
            this._initResolve = this._initReject = null;
          } else if (typeof this.onError === "function") {
            this.onError(d.message);
          }
          // Worker failed on a frame; allow the next one to be sent.
          this._workerBusy = false;
        } else if (d.type === "result") {
          if (d.session !== this._session) return;
          this._latestLandmarks = d.landmarks[0] || null;
          this._latestTimestamp = d.timestamp;
          this._workerBusy = false;
          this._markResult();
        }
      };
      this.worker.postMessage({ type: "init" });
    });
  }

  setCanvas(canvasCtx) {
    this.drawingUtils = new DrawingUtils(canvasCtx);
  }

  startInference(stream, videoEl) {
    this._session++;
    this._latestLandmarks = null;
    this._latestTimestamp = 0;
    this._workerBusy = false;
    this._running = true;

    if (this._strategy === "mstp") {
      this._startMstp(stream);
    } else {
      this._startRVFC(videoEl);
    }
  }

  // ---- MSTP path (Chrome/Firefox) ----
  _startMstp(stream) {
    this._track = stream.getVideoTracks()[0].clone();
    this._processor = new MediaStreamTrackProcessor({ track: this._track });
    this._reader = this._processor.readable.getReader();
    this._mstpPump();
  }

  async _mstpPump() {
    const session = this._session;
    while (this._running && this._session === session) {
      let reading;
      try {
        reading = await this._reader.read();
      } catch {
        break;
      }
      const { value: frame, done } = reading;
      if (done) break;
      if (this._workerBusy) {
        frame.close();
        this._markDrop();
        continue;
      }
      this._workerBusy = true;
      const ts = Math.round(frame.timestamp / 1000);
      this.worker.postMessage({ type: "frame", session, frame, ts }, [frame]);
    }
    this._releaseMstp();
  }

  _releaseMstp() {
    if (this._reader) {
      try { this._reader.cancel(); } catch {}
      try { this._reader.releaseLock(); } catch {}
      this._reader = null;
    }
    if (this._track) {
      try { this._track.stop(); } catch {}
      this._track = null;
    }
    this._processor = null;
  }

  // ---- rVFC path (Safari + fallback) ----
  _startRVFC(videoEl) {
    this._video = videoEl;
    this._canvas = new OffscreenCanvas(this._RVFC_W, this._RVFC_H);
    this._ctx = this._canvas.getContext("2d");

    const rVFC = videoEl.requestVideoFrameCallback
      ? videoEl.requestVideoFrameCallback.bind(videoEl)
      : null;
    this._rVFC = rVFC;

    if (!rVFC) {
      this.onError?.("requestVideoFrameCallback unavailable; cannot track hands in this browser.");
      this._running = false;
      return;
    }

    let session = this._session;
    const onFrame = (_now, _metadata) => {
      // stopInference() bumps _session during shutdown.
      if (!this._running || this._session !== session) return;
      if (!this._workerBusy) {
        this._workerBusy = true;
        try {
          this._ctx.drawImage(this._video, 0, 0, this._RVFC_W, this._RVFC_H);
          const bitmap = this._canvas.transferToImageBitmap();
          const ts = Math.round(performance.now());
          this.worker.postMessage({ type: "frame", session, frame: bitmap, ts }, [bitmap]);
        } catch (err) {
          this._workerBusy = false;
          console.warn("rVFC frame extraction failed:", err);
        }
      } else {
        this._markDrop();
      }
      if (this._running) rVFC(onFrame);
    };
    rVFC(onFrame);
  }

  _releaseRVFC() {
    this._video = null;
    this._canvas = null;
    this._ctx = null;
    this._rVFC = null;
  }

  stopInference() {
    this._running = false;
    this._session++;
    this._latestLandmarks = null;
    this._latestTimestamp = 0;
    this._workerBusy = false;
    this._dropsInWindow = 0;
    this._resultsInWindow = 0;
    this._windowStart = 0;

    if (this._strategy === "mstp") {
      this._releaseMstp();
    } else {
      this._releaseRVFC();
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
