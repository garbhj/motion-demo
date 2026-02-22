package protocol

type Welcome struct {
	PlayerID string `json:"playerId"`
	TickHz   int    `json:"tickHz"`
}

type State struct {
	Tick    int              `json:"tick"`
	Players []PlayerSnapshot `json:"players"`
	Flails  []FlailSnapshot  `json:"flails,omitempty"`
}

type PlayerSnapshot struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	A  float64 `json:"a,omitempty"` // optional angle
}

type FlailSnapshot struct {
	ID         string  `json:"id"`
	OwnerID    string  `json:"ownerId"`
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	IsDetached bool    `json:"isDetached"`
	A          float64 `json:"a,omitempty"`
}

type Error struct {
}
