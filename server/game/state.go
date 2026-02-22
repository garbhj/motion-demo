package game

// Internal truth authoritative game state

type State struct {
	Tick       int
	Players    map[string]*Player
	Orbs       map[string]*Orb
	Eliminated []EliminatedEntry
}

type EliminatedEntry struct {
	ID   string
	Name string
}

type Player struct {
	ID           string
	Name         string
	X, Y, VX, VY float64
	PrevPinch    bool
}
