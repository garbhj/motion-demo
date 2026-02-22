package game

import ()

// Internal truth authoritative game state

type State struct {
	Tick    int
	Players map[string]*Player
	Flails  map[string]*Flail
	Ropes   map[string]*Rope
}

type Player struct {
	ID           string
	X, Y, VX, VY float64
}
