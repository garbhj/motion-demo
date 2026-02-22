package game

type ChainSegment struct {
	X, Y             float64
	VX, VY           float64
	IsAffectedByRope bool
}

type Rope struct {
	RestLength float64
	K          float64
	Nodes      []*ChainSegment // internal nodes only
}
