package protocol

type Welcome struct {
	PlayerID string `json:"playerId"`
	TickHz   int    `json:"tickHz"`
}

type State struct {
	Tick       int                 `json:"tick"`
	Players    []PlayerSnapshot    `json:"players"`
	Orbs       []OrbSnapshot       `json:"orbs,omitempty"`
	Eliminated []EliminatedSnapshot `json:"eliminated,omitempty"`
}

type PlayerSnapshot struct {
	ID   string  `json:"id"`
	Name string  `json:"name,omitempty"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	A    float64 `json:"a,omitempty"`
}

type EliminatedSnapshot struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type OrbSnapshot struct {
	ID      string  `json:"id"`
	OwnerID string  `json:"ownerId"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Size    float64 `json:"size"`
	A       float64 `json:"a,omitempty"`
	Mode    uint8   `json:"mode"`
}

type Error struct {
}
