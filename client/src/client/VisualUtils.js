function drawHandState(ctx, handState, width, height) {
  // Convert normalized (0-1) coordinates to pixel coordinates for the PiP window
  const pixelX = handState.position.x * width;
  const pixelY = handState.position.y * height;
  
  let color = "white";
  let label = "UNKNOWN";

  switch (handState.gesture) {
    case GESTURES.OPEN:
      color = "#00FF00"; // Green
      label = "OPEN (Swing)";
      break;
    case GESTURES.CLOSED:
      color = "#FF0000"; // Red
      label = "CLOSED (Retract)";
      break;
    case GESTURES.PINCH:
      color = "#FFFF00"; // Yellow
      label = "PINCH (Attack)";
      break;
    case GESTURES.POINT:
      color = "#00FFFF"; // Cyan
      label = "POINT";
      break;
  }

  // 1. Draw the tracking circle
  ctx.beginPath();
  ctx.arc(pixelX, pixelY, 12, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 2. Draw the Label
  ctx.font = "bold 16px Arial";
  ctx.fillStyle = color;
  ctx.shadowColor = "black";
  ctx.shadowBlur = 4;
  
  // We mirror the text manually because the canvas is mirrored via CSS
  ctx.fillText(label, pixelX + 15, pixelY + 5);
  ctx.shadowBlur = 0; // Reset shadow
}