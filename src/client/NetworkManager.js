export class NetworkManager {
  constructor() {
    this.lastSentTime = 0;
    this.sendRateMs = 1000 / 20; // Send data 20 times per second (Tick rate)
  }

  // Called every frame, but only actually sends data based on the tick rate
  sendPlayerState(handState) {
    const now = performance.now();
    if (now - this.lastSentTime > this.sendRateMs) {
      
      // In the future: socket.emit('update', handState);
      console.log("Sending to server:", handState);
      
      this.lastSentTime = now;
    }
  }
}