package game

import ()

// Internal truth authoritative game state

type State struct {
	Tick    uint64
	Players map[string]*Player
}

type Player struct {
	X, Y, VX, VY float32
}
