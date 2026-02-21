export class NetworkManager {
  constructor() {
    this.myId = 1; // Assigning the local player an ID
    
    // Absolute Map Config
    this.mapConfig = { width: 2000, height: 2000 };
    
    // Mock Server Physics State
    this.mockPlayer = { id: 1, x: 1000, y: 1000, vx: 0, vy: 0, color: "#007f8b", radius: 25 };
    this.mockFlail = { id: 101, ownerId: 1, x: 1000, y: 950, vx: 0, vy: 0, isDetached: false };
    
    // Static obstacles
    this.obstacles = [
      { x: 500, y: 500, width: 200, height: 100 },
      { x: 1200, y: 1500, width: 300, height: 300 }
    ];

    this.latestInput = { moveX: 0, moveY: 0, gesture: 0 };
  }

  // The client now sends a normalized movement vector (-1 to 1) instead of raw screen coordinates
  sendPlayerInput(inputVector) {
    this.latestInput = inputVector;
  }

  getLatestWorldState() {
    // --- MOCK SERVER PHYSICS TICK ---

    const acceleration = 2.0;
    const friction = 0.85; // Air resistance / ground friction

    // 1. Apply Input Acceleration
    this.mockPlayer.vx += this.latestInput.moveX * acceleration;
    this.mockPlayer.vy += this.latestInput.moveY * acceleration;

    // 2. Apply Friction
    this.mockPlayer.vx *= friction;
    this.mockPlayer.vy *= friction;

    // 3. Update Position
    this.mockPlayer.x += this.mockPlayer.vx;
    this.mockPlayer.y += this.mockPlayer.vy;

    // 4. Clamp to Map Boundaries
    this.mockPlayer.x = Math.max(this.mockPlayer.radius, Math.min(this.mapConfig.width - this.mockPlayer.radius, this.mockPlayer.x));
    this.mockPlayer.y = Math.max(this.mockPlayer.radius, Math.min(this.mapConfig.height - this.mockPlayer.radius, this.mockPlayer.y));

    // 5. Flail Physics (Very basic mock)
    if (this.latestInput.gesture === 2) { // Attack / Detach
      this.mockFlail.isDetached = true;
      // Flail continues moving in its current velocity (gliding)
      this.mockFlail.x += this.mockFlail.vx * 0.98; 
      this.mockFlail.y += this.mockFlail.vy * 0.98;
    } else {
      this.mockFlail.isDetached = false;
      const retractForce = this.latestInput.gesture === 1 ? 0.3 : 0.05; // Tight vs loose spring
      
      // Flail acts like a spring pulled toward player
      this.mockFlail.vx += (this.mockPlayer.x - this.mockFlail.x) * retractForce;
      this.mockFlail.vy += (this.mockPlayer.y - this.mockFlail.y) * retractForce;
      this.mockFlail.vx *= 0.8; // Flail friction
      this.mockFlail.vy *= 0.8;
      
      this.mockFlail.x += this.mockFlail.vx;
      this.mockFlail.y += this.mockFlail.vy;
    }

    // Return Authoritative State
    return {
      mapConfig: this.mapConfig,
      obstacles: this.obstacles,
      players: [ { ...this.mockPlayer } ],
      flails: [ { ...this.mockFlail } ]
    };
  }
}