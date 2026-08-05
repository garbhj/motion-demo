import { HandLandmarker } from "@mediapipe/tasks-vision";

let landmarker = null;

// Inline minimum-valid WASM module with a SIMD instruction (v8shr).
// Used to probe SIMD support and pick the right wasm loader variant.
const SIMD_PROBE = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);

async function loadModuleFactory(wasmUrl) {
  // tasks-vision's loader shim ($h) assumes a classic worker: it calls
  // importScripts() and expects the script to self-register self.ModuleFactory.
  // Module workers don't allow importScripts, and dynamic import() of the UMD
  // wrapper won't pollute the worker global scope. Force classic-style global
  // registration by fetching the loader source and running it via new Function.
  const simd = await WebAssembly.instantiate(SIMD_PROBE).then(() => true).catch(() => false);
  const suffix = simd ? "wasm_internal" : "wasm_nosimd_internal";
  const loaderPath = `${wasmUrl}/vision_${suffix}.js`;
  const resp = await fetch(loaderPath);
  const src = await resp.text();
  // The loader declares `var ModuleFactory` and exports it via UMD. In a module
  // worker none of the UMD branches fire (no `exports`/`module`/`define`), so
  // the factory stays scoped to the eval scope. Run it via new Function and
  // hoist the returned factory onto the worker global so tasks-vision's
  // `self.ModuleFactory` check passes.
  const factory = new Function(`${src}\nreturn ModuleFactory;`)();
  self.ModuleFactory = factory;
  if (typeof self.ModuleFactory !== "function") {
    throw new Error(`ModuleFactory not registered after loading ${loaderPath}`);
  }
  return {
    wasmLoaderPath: loaderPath,
    wasmBinaryPath: `${wasmUrl}/vision_${suffix}.wasm`,
  };
}

self.onmessage = async (e) => {
  const msg = e.data;

  // Download and initialize the Model, then report back
  if (msg.type === "init") {
    try {
      const wasmUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
      const fileset = await loadModuleFactory(wasmUrl);
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
      });
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: `Init failed: ${err.message}` });
    }
    return;
  }

  // Process a single frame of video
  if (msg.type === "frame") {
    if (!landmarker) {
      msg.frame.close();
      return;
    }
    try {
      const timestampMs = Math.round(msg.frame.timestamp / 1000);
      const results = landmarker.detectForVideo(msg.frame, timestampMs);
      msg.frame.close();
      self.postMessage({
        type: "result",
        session: msg.session,
        landmarks: results?.landmarks || [],
        timestamp: timestampMs
      });
    } catch (err) {
      msg.frame.close();
      self.postMessage({ type: "result", session: msg.session, landmarks: [], timestamp: 0 });
      self.postMessage({ type: "error", message: String(err) });
    }
    return;
  }
};
