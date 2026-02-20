// Export an Enum for our Gestures to keep network payloads tiny (just sending 0, 1, 2, or 3)
export const GESTURES = {
  OPEN: 0,
  CLOSED: 1,
  PINCH: 2,
  POINT: 3
};

// --- Math Helpers ---
function getDistance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
}

// Get vector from point A to point B
function getVector(pA, pB) {
  return { x: pB.x - pA.x, y: pB.y - pA.y, z: pB.z - pA.z };
}

// Normalize a vector (make its length 1)
function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

// Dot product returns 1 if vectors point the exact same way, 0 if perpendicular, -1 if opposite
function dotProduct(v1, v2) {
  return (v1.x * v2.x) + (v1.y * v2.y) + (v1.z * v2.z);
}

export function processHandData(landmarks) {
// 1. Calculate Average Position (Center of mass)
  let sumX = 0, sumY = 0, sumZ = 0;
  for (const lm of landmarks) {
    sumX += lm.x; sumY += lm.y; sumZ += lm.z;
  }
  const count = landmarks.length;
  
  const position = {
    x: 1 - (sumX / count),
    y: sumY / count,
    z: sumZ / count
  };

  // 2. Identify Key Landmarks
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexMCP = landmarks[5]; // Knuckle
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];

  // 3. Folded Fingers Check
  const fingers = [
    { tip: 8, mcp: 5 },   // Index
    { tip: 12, mcp: 9 },  // Middle
    { tip: 16, mcp: 13 }, // Ring
    { tip: 20, mcp: 17 }  // Pinky
  ];

  let foldedCount = 0;
  let isIndexFolded = false;

  for (let i = 0; i < fingers.length; i++) {
    const tipDist = getDistance(landmarks[fingers[i].tip], wrist);
    const knuckleDist = getDistance(landmarks[fingers[i].mcp], wrist);
    if (tipDist < knuckleDist) {
      foldedCount++;
      if (i === 0) isIndexFolded = true; // Track index specifically
    }
  }

  // 4. Evaluate Heuristics (Order of Priority matters!)
  let detectedGesture = GESTURES.OPEN; // Default state

  // A. Check for PINCH
  // Since landmarks are normalized (0 to 1), a distance of 0.06 is quite close.
  const pinchThreshold = 0.0; 
  const distThumbIndex = getDistance(thumbTip, indexTip);
  const distThumbMiddle = getDistance(thumbTip, middleTip);

  if (distThumbIndex < pinchThreshold || distThumbMiddle < pinchThreshold) {
    detectedGesture = GESTURES.PINCH;
  } 
  
  // B. Check for POINT
  // Conditions: Index is NOT folded, Middle/Ring/Pinky ARE folded.
  else if (!isIndexFolded && foldedCount >= 2) {
    // Advanced Linearity Check: Vector from Wrist(0) to Knuckle(5) vs Knuckle(5) to Tip(8)
    const vec1 = normalize(getVector(wrist, indexMCP));
    const vec2 = normalize(getVector(indexMCP, indexTip));
    
    const straightness = dotProduct(vec1, vec2);
    
    // If dot product is close to 1, the finger is pointing straight out from the palm line
    if (straightness > 0.85) { 
      detectedGesture = GESTURES.POINT;
    }
  }
  
  // C. Check for CLOSED (Fist)
  // If 3 or 4 fingers are folded down, it's a fist.
  else if (foldedCount >= 3) {
    detectedGesture = GESTURES.CLOSED;
  }

  // Return the new data structure
  return {
    position,
    gesture: detectedGesture 
  };
}