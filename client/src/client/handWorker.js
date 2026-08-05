import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let landmarker = null;

self.onmessage = async (e) => {
  const msg = e.data;

  // Download and initialize the Model, then report back
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

  // Process a single frame of video 
  if (msg.type === "frame") {
    if (!landmarker) return;
    try {
      const results = landmarker.detectForVideo(msg.frame, msg.frame.timestamp);
      msg.frame.close();
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
