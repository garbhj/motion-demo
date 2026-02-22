package game

type Flail struct {
	ID               string
	OwnerID          string
	X, Y             float64
	VX, VY           float64
	A                float64
	Detached         bool
	IsAffectedByRope bool
}
