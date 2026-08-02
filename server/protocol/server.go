package protocol

type Welcome struct {
	PlayerID  string             `json:"playerId"`
	TickHz    int                `json:"tickHz"`
	RoomCode  string             `json:"roomCode"`
	Obstacles []ObstacleSnapshot `json:"obstacles,omitempty"`
}

type ObstacleSnapshot struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type State struct {
	Tick    int              `json:"tick"`
	Players []PlayerSnapshot `json:"players"`
	Orbs    []OrbSnapshot    `json:"orbs,omitempty"`
	Kills   []KillSnapshot   `json:"kills,omitempty"`
}

type PlayerSnapshot struct {
	ID          string  `json:"id"`
	Name        string  `json:"name,omitempty"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	A           float64 `json:"a,omitempty"`
	Stamina     float64 `json:"stamina"`
	Score       float64 `json:"score"`
	Alive       bool    `json:"alive"` // no omitempty: false must always be transmitted
	RespawnInMs int     `json:"respawnInMs,omitempty"`
}

type KillSnapshot struct {
	KillerID   string `json:"killerId"`
	KillerName string `json:"killerName"`
	VictimID   string `json:"victimId"`
	VictimName string `json:"victimName"`
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
	Code    string `json:"code"`    // e.g. "room_full", "room_not_found"
	Message string `json:"message"` // human-readable, safe to show directly
}
