package room

import "motion/game"

type Conn interface {
	Send([]byte) error
	SendBinary([]byte) error
	Close() error
}

// Join: issued once after hello parsed
type Join struct {
	Conn  Conn
	Name  string
	Reply chan<- JoinResult
}

type JoinResult struct {
	PlayerID string
	Full     bool // true => join rejected (room at capacity); PlayerID is empty
}

// Input: latest input for a player
type Input struct {
	PlayerID string
	Input    game.Input
}

// Leave: issued on disconnect
type Leave struct {
	PlayerID string
}
