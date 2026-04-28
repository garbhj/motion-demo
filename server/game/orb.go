package game

type OrbMode uint8

const (
	OrbOrbit OrbMode = iota
	OrbShot
	OrbReturn
)

type Orb struct {
	ID      string
	OwnerID string

	X, Y   float64
	VX, VY float64

	Angle float64
	Size  float64

	Mode OrbMode

	ShotTicksLeft int
	CooldownTicks int
}
