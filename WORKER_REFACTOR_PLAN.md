# MediaPipe Web Worker Refactor Plan

## Problem statement

MediaPipe `HandLandmarker.detectForVideo()` runs synchronously on the main
thread for 10–25 ms per call (occasionally spiking to 30+ ms when a hand
is in frame). The main thread also hosts:

- `requestAnimationFrame` render loop (60Hz)
- WebSocket message handler (20Hz server snapshots)
- Game simulation accumulator (40Hz)

Because JS is single-threaded, a 20 ms inference call cannot be
interrupted. When it lands near a vsync edge, the rAF callback for that
frame is delayed past the vsync — sometimes past the *next* vsync too.
Result: rAF callbacks are irregularly spaced (dt 0.7ms, 11ms, 22ms, 33ms,
43ms), and the interpolation alpha in `getLatestWorldState()` jitters,
producing visible stutter.

Confirmed via instrumentation:
- `frame=` log (rAF timestamp delta) reports ~16.7ms constantly — because
  the rAF `now` argument is snapped to vsync time and hides the real delay.
- `dt_since_last` log of `performance.now()` inside `getLatestWorldState()`
  reveals the actual jitter (1ms / 11ms / 22ms / 37ms).
- 30Hz inference test reduced detect frequency but did not eliminate the
  jitter — each individual inference still pushes a rAF callback past a
  vsync.

## Goal

Move MediaPipe inference off the main thread into a Web Worker. Main
thread should never block on inference. Expected outcomes:
- rAF callbacks fire cleanly every ~16.7ms (real, not just timestamp).
- `getLatestWorldState()` alpha sweeps smoothly 0.0 → 0.33 → 0.66 → ... → 0.0.
- Visual gameplay is smooth at 60Hz even with camera active.

## Approach: `MediaStreamTrackProcessor` + `VideoFrame` transfer

This is the canonical browser pattern for off-main-thread video ML.
Zero pixel copying; the video frame is *transferred* (not serialized)
between threads.

Sketch:

```
Main thread              |  Worker thread
                         |
camera stream ──┐        |
                ▼        |
  MediaStreamTrackProcessor.readable
                │        |
                ▼        |
  reader.read() loop     |
  (AsyncIterator)        |
                │        |
                ▼ postMessage(frame, [frame])
                         │ ──────────────►  HandLandmarker.detectForVideo(frame, frame.timestamp)
                         │                  frame.close()
                         │  ◄────────────── postMessage({ landmarks })
                │        |
                ▼        |
  update localInput from landmarks
  (cheap — no ML here)
```

Browser support:
- `MediaStreamTrackProcessor`: Chrome ≥104, Safari ≥17.4, Firefox
  behind a flag as of 2024.
- `VideoFrame`: same support envelope.
- This is fine — MediaPipe itself already requires a modern browser.

## Files to create / modify

### NEW: `client/src/client/hand.worker.js`

The worker module. Responsibilities:
- Import `@mediapipe/tasks-vision` (Vite worker bundling handles this).
- On `init` message: load the wasm fileset, create `HandLandmarker` with
  `delegate: "GPU"` and `runningMode: "VIDEO"`, `numHands: 1`.
- On `frame` message: call `detectForVideo(frame, frame.timestamp)`,
  then `frame.close()` (CRITICAL — VideoFrame holds GPU memory and will
  leak if not explicitly closed), then post back `{ landmarks, timestamp }`.
- Hand errors back as `{ error }`.

Skeleton:

```js
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let landmarker = null;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 1
    });
    self.postMessage({ type: "ready" });
    return;
  }
  if (msg.type === "frame") {
    if (!landmarker) return;
    try {
      const results = landmarker.detectForVideo(msg.frame, msg.frame.timestamp);
      msg.frame.close();  // ALWAYS close to avoid GPU memory leak
      self.postMessage({
        type: "result",
        landmarks: results?.landmarks || [],
        timestamp: msg.frame.timestamp
      });
    } catch (err) {
      msg.frame.close();
      self.postMessage({ type: "error", message: String(err) });
    }
    return;
  }
};
```

Important: **do not import this worker as a regular module.** Vite uses
the `?worker` query suffix to build it as a worker bundle:
```js
import HandWorker from "./hand.worker.js?worker";
const worker = new HandWorker();
```
Vite handles `import.meta.url`/wasm paths correctly in this mode.

### MODIFIED: `client/src/client/HandTracker.js`

Transform from synchronous-call wrapper into a thin async worker manager.
Responsibilities:
- Spawn the worker, send `init`, wait for `ready`.
- Drive the camera-frame reader loop.
- Hold the most recent landmarks (set whenever worker posts back).
- Expose `getLatestLandmarks()` for synchronous read by main.
- Continue to expose `drawDebugMesh` and `setCanvas` for compatibility
  (these stay on main — drawing 21 dots is cheap; no benefit to moving
  it to a worker).

Sketch:

```js
import HandWorker from "./hand.worker.js?worker";
import { HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";

export class HandTracker {
  constructor() {
    this.worker = null;
    this.drawingUtils = null;
    this._latestLandmarks = null;
    this._latestTimestamp = 0;
    this._processor = null;
    this._reader = null;
    this._track = null;
    this._running = false;
  }

  async initialize() {
    this.worker = new HandWorker();
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (e) => {
        if (e.data.type === "ready") { resolve(); return; }
        if (e.data.type === "result") {
          this._latestLandmarks = e.data.landmarks[0] || null;
          this._latestTimestamp = e.data.timestamp;
          return;
        }
        if (e.data.type === "error") {
          console.warn("hand worker error:", e.data.message);
        }
      };
      this.worker.postMessage({ type: "init" });
    });
  }

  setCanvas(canvasCtx) {
    this.drawingUtils = new DrawingUtils(canvasCtx);
  }

  // Called by main once camera is started. Begins the frame-pump loop.
  // The original stream is kept for the <video> element (PiP), and a
  // separate track is used for the processor — they share the same
  // underlying camera via MediaStreamTrackProcessor.
  async startInference(stream) {
    // Pick a video track from the camera stream (clone it so closing
    // the processor doesn't stop the <video>).
    this._track = stream.getVideoTracks()[0];
    const cloned = this._track.clone();
    this._processor = new MediaStreamTrackProcessor({ track: cloned });
    this._reader = this._processor.readable.getReader();
    this._running = true;
    this._pump();
  }

  async _pump() {
    while (this._running) {
      const { value: frame, done } = await this._reader.read();
      if (done) break;
      // Always post the frame; if the worker is mid-inference the
      // message queues until the worker finishes, providing natural
      // backpressure. Optionally drop frames here if the worker
      // consistently lags (MediaPipe inference at 30ms > 30fps source).
      this.worker.postMessage({ type: "frame", frame }, [frame]);
    }
    try { this._reader.releaseLock(); } catch {}
  }

  stopInference() {
    this._running = false;
    if (this._track) { this._track.stop(); this._track = null; }
    if (this._reader) {
      try { this._reader.cancel(); } catch {}
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
    if (!this.drawingUtils || !landmarks) return;
    this.drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color: "#00FF00", lineWidth: 2
    });
    this.drawingUtils.drawLandmarks(landmarks, {
      color: "#FF0000", lineWidth: 1, radius: 2
    });
  }
}
```

### MODIFIED: `client/src/client/main.js`

Three changes:

1. **In `startCamera()`**, after `getUserMedia` returns a stream, also
   call `tracker.startInference(stream)` to begin the worker pump. Keep
   `video.srcObject = stream` for the PiP / mirrored camera display.

2. **Rewrite `trackCameraLoop`**. It no longer runs `tracker.detect()`.
   It just reads the latest landmarks from the worker (already updated
   asynchronously), runs `processHandData`, updates `localInput`, and
   draws the debug mesh. Could even be merged into `renderLoop` since
   there's no longer a separate clock driving it — but keeping it on
   `requestVideoFrameCallback` is fine and decouples input-processing
   cadence from rendering.

   Roughly:
   ```js
   function trackCameraLoop() {
     if (!isCameraActive) return;
     const rawHand = tracker.getLatestLandmarks();
     debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
     if (rawHand) {
       const handState = processHandData(rawHand);
       localInput.x = handState.position.x;
       localInput.y = handState.position.y;
       localInput.gesture = handState.gesture;
       tracker.drawDebugMesh(rawHand);
       drawPiPOverlay(debugCtx, handState, trackingCenter, debugCanvas.width, debugCanvas.height);
     }
     if ('requestVideoFrameCallback' in video) {
       video.requestVideoFrameCallback(trackCameraLoop);
     } else {
       requestAnimationFrame(trackCameraLoop);
     }
   }
   ```

3. **In `stopCamera()`**, also call `tracker.stopInference()`.

4. **In `toggleCamera()` / `boot()` flow**: `tracker.initialize()` now
   just spawns the worker and waits for `ready`. The camera itself is
   awaited in `startCamera` as before. Calling order should be:
   `tracker.initialize()` → enable camera button → user clicks →
   `startCamera(stream)` is called → `tracker.startInference(stream)` →
   `trackCameraLoop()` starts.

### MODIFIED: `client/src/client/main.js` (boot flow)

The MediaPipe GPU initialization is happening in the worker now. The
main-thread `tracker.initialize()` should still resolve before allowing
the user to start a game, but it's now an async-call-that-waits-for-
worker-ready instead of an inline `HandLandmarker.createFromOptions`.
The existing `enableCameraBtn.disabled` pattern already handles this.

## Defer or skip

Strip out the temporary diagnostic instrumentation once the worker
refactor lands and alpha is verified clean:

- `console.log(`detect=${dtMs.toFixed(1)}ms`)` in main.js:264
- `console.log(`frame=${dtMs.toFixed(1)} render=...`)` in main.js:364
- `console.log(`now:... dt_since_last:...`)` in NetworkManager.js:350
- `console.log(alpha.toFixed(2))` in NetworkManager.js:357

Also remove the temporary `_inferSkip` 30Hz test scaffolding.

Optional cleanup: remove `applyPredictionOverride`'s early-return (now
that alpha is smooth, re-enabling prediction should be safe and gives
local player low latency). Test this carefully — the orb glue code in
`applyPredictionOverride` needs the local player to also be smooth.
Recommendation: keep prediction disabled through verification, re-enable
as a separate change.

## Implementation order / verification

1. **Worker file scaffold** — write `hand.worker.js` with the init path
   and message handlers. Don't touch main yet. Verify it builds with
   `npm run build` (Vite picks up the `?worker` import).

2. **Wire HandTracker to spawn the worker** — replace
   `HandTracker.initialize()` with the async-spawn-worker-and-wait-for
   -ready version. Verify the menu screen still loads and the camera
   button still becomes enabled.

3. **Stream-to-worker pump** — implement `startInference` using
   `MediaStreamTrackProcessor`. Add a `console.log` in the worker
   confirming it receives frames and runs `detectForVideo`. Don't
   update main.js's camera loop yet. Verify worker logs detect
   results.

4. **Main-thread camera loop refactor** — replace the synchronous
   `tracker.detect()` call in `trackCameraLoop` with
   `tracker.getLatestLandmarks()`. Verify hand landmark dots still
   draw on the debug canvas.

5. **Alpha verification** — keep the `alpha.toFixed(2)` log in
   `getLatestWorldState`. With camera active and a hand in frame,
   confirm alpha steps are roughly even (~0.33 each) and no longer
   show the "0.24, 0.02, 0.68" stutter pattern.

6. **Frame timing verification** — keep the `dt_since_last` log.
   Confirm rAF callbacks are now spaced ~16.7ms apart consistently,
   no 30ms+ gaps coinciding with `detect=` logs.

7. **End-to-end gameplay** — confirm wizard moves smoothly while
   gesturing, no stutter. If user's hand drops out and re-enters,
   confirm worker recovers and resumes inference.

8. **Cleanup** — strip diagnostic logs, remove _inferSkip scaffolding.

## Gotchas / things to watch

- **`VideoFrame.close()` MUST be called.** VideoFrame holds GPU memory.
  If you forget to close it, memory will grow until the page crashes.
  The worker skeleton above always closes in a try/finally — keep that.

- **`detectForVideo` requires monotonically increasing timestamps.**
  `videoFrame.timestamp` (microseconds since some epoch) satisfies this.
  Do not pass `performance.now()` since the worker doesn't have access
  to the main thread's notion of time anyway.

- **GPU context in workers.** `delegate: "GPU"` should work — the worker
  has its own OffscreenCanvas / WebGL scope. If you hit GPU
  initialization issues in the worker, fall back to `delegate: "CPU"`
  (slower but functional). If CPU is too slow, try `delegate: "GPU"`
  with an explicit `OffscreenCanvas` context passed in (more advanced).

- **Don't transfer the `MediaStreamTrack` itself** — clone it via
  `track.clone()` and pass the clone to `MediaStreamTrackProcessor`,
  so that `video.srcObject = stream` (for the camera preview) doesn't
  get torn down when you stop the processor.

- **Frame-skip handling.** If the worker is mid-inference and the
  reader produces frames faster than the worker can consume them, you
  have two options:
  (a) Let them queue — messages back up; worker eventually catches up.
      Simple, but uses memory.
  (b) Drop frames in the main thread before posting — call
      `frame.close()` on the unposted frame immediately.
  Option (b) is generally preferred. A simple pattern:
  ```js
  while (this._running) {
    const { value: frame, done } = await this._reader.read();
    if (done) break;
    if (this._workerBusy) { frame.close(); continue; }
    this._workerBusy = true;
    this.worker.postMessage({ type: "frame", frame }, [frame]);
  }
  // In worker.onmessage handler:
  //   if (msg.type === "result") this._workerBusy = false;
  ```
  Note `_workerBusy` is set by the worker callback, so it's a one-flag
  hand-shake. Don't worry about this optimization initially — get a
  working version first, profile for queue buildup, then add dropping.

- **Camera frame rate.** Many webcams are 30Hz, not 60Hz. The original
  code already ran into this (we suspected it during the 30Hz test).
  That's fine — inference at 30Hz is plenty. No special handling.

- **Drawing the debug mesh on main.** `drawDebugMesh` uses
  `DrawingUtils` backed by `@mediapipe/drawing_utils`. That library is
  main-thread only (it draws to a Canvas2D context). Keep drawing on
  main, fed by the worker's landmark results. The cost is sub-
  millisecond for 21 landmarks — negligible.

- **Audio track.** `getUserMedia({ video: true })` streams sometimes
  include or don't include audio. `MediaStreamTrackProcessor` Only
  handles video tracks; make sure you call `.getVideoTracks()[0]`
  explicitly, not `getTracks()[0]`.

## Re-evaluate aggressive optimizations after landing

After the refactor is verified working and alpha is smooth:

1. **Re-enable `applyPredictionOverride`** — local player should now be
   smooth enough that 40Hz-prediction + 60Hz-interp don't desync visibly.
   Compare the feel carefully against prediction-off.

2. **Cache the `WS.send` ArrayBuffer in NetworkManager.** Currently
   `encodeInputBinary` allocates a fresh `ArrayBuffer`+`DataView` per
   send (40Hz). At 40Hz this is ~10 KB/sec of short-lived garbage —
   measurable but minor. Premature optimization; revisit only if you
   see GC stalls in the profile after the worker refactor.

3. **Re-evaluate `interpDelayMs = 60`.** Now that alpha is smooth, you
   may be able to drop `interpDelayMs` to something like 55 (still
   above the 50ms snapshot interval) for reduced input latency.

## Estimated scope

- New file `hand.worker.js`: ~40 lines.
- Modified `HandTracker.js`: ~80 lines (mostly replacing existing).
- Modified `main.js`: ~30 lines (camera loop restructured, start/stop
  calls added).
- No server changes. No protocol changes. No new dependencies.

Total: ~150 lines net, in 3 files. The riskiest piece is the
`MediaStreamTrackProcessor` wiring; once that's working, the rest is
straightforward.
