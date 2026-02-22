package protocol

type Welcome struct {
	PlayerID string `json:"playerId"`
	TickHz   int    `json:"tickHz"`
}

type State struct {
	Tick    int              `json:"tick"`
	Players []PlayerSnapshot `json:"players"`
}

type PlayerSnapshot struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	A  float64 `json:"a,omitempty"` // optional angle
}

type Error struct {
}
