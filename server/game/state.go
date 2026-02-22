package game

// Internal truth authoritative game state

type State struct {
	Tick       int
	Players    map[string]*Player
	Orbs       map[string]*Orb
	Eliminated []EliminatedEntry
}

type EliminatedEntry struct {
	ID    string
	Name  string
	Score float64 // final score when eliminated
}

type Player struct {
	ID           string
	Name         string
	X, Y, VX, VY float64
	PrevPinch    bool
	Stamina      float64 // 0–100, depletes when sprinting
	Score        float64 // passive (alive) + kill rewards (scaled by victim score)
}
