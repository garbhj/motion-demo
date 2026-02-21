// NetworkManager.js

export class NetworkManager {
  constructor() {
    this.mockPlayerPos = { x: 500, y: 500 };
    this.mockFlailPos = { x: 500, y: 450 };
    this.latestInput = null;
  }

  sendPlayerInput(input) {
    this.latestInput = input;
    // In real life: socket.send(JSON.stringify(input));
  }

  getLatestWorldState() {
    // MOCK SERVER PHYSICS:
    // Move the player slowly towards the intended hand/mouse input
    if (this.latestInput) {
      // Convert normalized input (0-1) to mocked world coordinates (0-1000)
      const targetX = this.latestInput.x * window.innerWidth; 
      const targetY = this.latestInput.y * window.innerHeight;

      // Simple Lerp to simulate server-side movement tracking the mouse
      this.mockPlayerPos.x += (targetX - this.mockPlayerPos.x) * 0.05;
      this.mockPlayerPos.y += (targetY - this.mockPlayerPos.y) * 0.05;

      // Mock Flail Physics based on gesture
      let isDetached = false;
      if (this.latestInput.gesture === 0) { // OPEN: Swing standard
        this.mockFlailPos.x += (this.mockPlayerPos.x - this.mockFlailPos.x) * 0.2;
        this.mockFlailPos.y += ((this.mockPlayerPos.y - 60) - this.mockFlailPos.y) * 0.2;
      } else if (this.latestInput.gesture === 1 || this.latestInput.gesture === 3) { // CLOSED: Retract tight
        this.mockFlailPos.x += (this.mockPlayerPos.x - this.mockFlailPos.x) * 0.8;
        this.mockFlailPos.y += (this.mockPlayerPos.y - this.mockFlailPos.y) * 0.8;
      } else if (this.latestInput.gesture === 2) { // POINT: Attack (detach)
        isDetached = true;
        // Mock it shooting off slightly
        this.mockFlailPos.y -= 5;
      }
    }

    // Return mocked snapshot of the world
    return {
      players: [
        { id: 1, x: this.mockPlayerPos.x, y: this.mockPlayerPos.y, color: "#007f8b" }
      ],
      flails: [
        { id: 101, ownerId: 1, x: this.mockFlailPos.x, y: this.mockFlailPos.y, isDetached: this.latestInput?.gesture === 2 }
      ]
    };
  }
}