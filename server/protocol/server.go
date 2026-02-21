package protocol

type Welcome struct {
	PlayerID string `json:"playerId"`
	TickHz   int    `json:"tickHz"`
}

type State struct {
	Tick    uint64           `json:"tick"`
	Players []PlayerSnapshot `json:"players"`
}

type PlayerSnapshot struct {
	ID string  `json:"id"`
	X  float32 `json:"x"`
	Y  float32 `json:"y"`
	A  float32 `json:"a,omitempty"` // optional angle
}

type Error struct {
}
