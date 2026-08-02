package game

// Internal truth authoritative game state

type State struct {
	Tick    int
	Players map[string]*Player
	Orbs    map[string]*Orb
	Kills   []KillEvent // transient; appended in Step, drained by room after each broadcast
}

// KillEvent records a single elimination for one-shot kill-feed delivery.
type KillEvent struct {
	KillerID   string
	KillerName string
	VictimID   string
	VictimName string
}

type Player struct {
	ID            string
	Name          string
	X, Y, VX, VY  float64
	PrevPinch     bool
	Stamina       float64 // 0–100, depletes when sprinting
	Score         float64 // passive (alive) + kill rewards (scaled by victim score)
	Alive         bool    // false while waiting to respawn after being killed
	RespawnAtTick int     // Tick at which this player respawns; 0 means not scheduled
}
