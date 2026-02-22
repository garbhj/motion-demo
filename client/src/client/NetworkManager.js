export class NetworkManager {
  constructor() {
    this.myId = null; // To be assigned by server
    
    // Absolute Map Config
    this.mapConfig = { width: 2000, height: 2000 };
    
    // Mock Server Physics State
    this.mockPlayer = null;
    this.mockFlail = null;
    
    // Static obstacles
    this.obstacles = [
      { x: 500, y: 500, width: 200, height: 100 },
      { x: 1200, y: 1500, width: 300, height: 300 }
    ];

    // Food pellets
    this.mockFood = [];
    for (let i = 0; i < 50; i++) {
      this.mockFood.push({
        id: 5000 + i, 
        x: Math.random() * this.mapConfig.width,
        y: Math.random() * this.mapConfig.height
      });
    }

    this.latestInput = { moveX: 0, moveY: 0, gesture: 0 };
  }

  // Called when the user clicks "Play Game"; gets server ID (Mocked)
  joinGame(name) {
    this.playerName = name;
    this.myId = Math.floor(Math.random() * 1000); // Server assigns this

    // Initialize mock entities
    this.mockPlayer = { 
      id: this.myId, 
      name: this.playerName, 
      score: 15, // Give yourself a starting score so the flail has some size
      x: 1000, y: 1000, vx: 0, vy: 0, radius: 25 
    };
    this.mockFlail = { id: 101, ownerId: this.myId, x: 1000, y: 950, vx: 0, vy: 0, isDetached: false };
    
    // 2. ADDED: Dummy opponents to populate the leaderboard and test flail scaling/colors
    this.mockOpponents = [
      { id: 2, name: "Slayer99", score: 85, x: 800, y: 800, radius: 25 },
      { id: 3, name: "NoobMaster", score: 5, x: 1200, y: 1100, radius: 25 },
      { id: 4, name: "FlailKing", score: 250, x: 1500, y: 900, radius: 25 }
    ];
    
    this.mockOpponentFlails = [
      { id: 102, ownerId: 2, x: 850, y: 800, isDetached: false },
      { id: 103, ownerId: 3, x: 1250, y: 1100, isDetached: false },
      { id: 104, ownerId: 4, x: 1550, y: 900, isDetached: false }
    ];

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
      const retractForce = (this.latestInput.gesture === 1 || this.latestInput.gesture === 3) ? 0.3 : 0.05; // Tight vs loose spring
      
      // Flail acts like a spring pulled toward player
      this.mockFlail.vx += (this.mockPlayer.x - this.mockFlail.x) * retractForce;
      this.mockFlail.vy += (this.mockPlayer.y - this.mockFlail.y) * retractForce;
      this.mockFlail.vx *= 0.8; // Flail friction
      this.mockFlail.vy *= 0.8;
      
      this.mockFlail.x += this.mockFlail.vx;
      this.mockFlail.y += this.mockFlail.vy;
    }

    // Return Authoritative State
    // return {
    //   mapConfig: this.mapConfig,
    //   obstacles: this.obstacles,
    //   players: [ { ...this.mockPlayer } ],
    //   flails: [ { ...this.mockFlail } ]
    // };
    return {
      mapConfig: this.mapConfig,
      obstacles: this.obstacles,
      players: [ { ...this.mockPlayer }, ...this.mockOpponents ],
      flails: [ { ...this.mockFlail }, ...this.mockOpponentFlails ],
      food: this.mockFood
    };
  }
}