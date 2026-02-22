package game

import (
	"math"
	"testing"
)

func TestRopeAppliesImpulseWhenStretched(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 0, Y: 0},
		},
		Flails: map[string]*Flail{
			"p1": {
				ID:               "p1_f",
				OwnerID:          "p1",
				X:                RopeRestLength * 2.2, // stretched far
				Y:                0,
				VX:               0,
				VY:               0,
				IsAffectedByRope: true,
			},
		},
		Ropes: map[string]*Rope{
			"p1": {
				RestLength: RopeRestLength,
				K:          RopeK,
				Nodes: []*ChainSegment{
					{
						X:                RopeRestLength * 0.5, // avoid symmetric cancellation
						Y:                0,
						VX:               0,
						VY:               0,
						IsAffectedByRope: true,
					},
					{
						X:                RopeRestLength * 0.9,
						Y:                0,
						VX:               0,
						VY:               0,
						IsAffectedByRope: true,
					},
				},
			},
		},
	}

	Step(s, map[string]Input{"p1": {Ax: 0, Ay: 0}})

	fl := s.Flails["p1"]
	if fl.VX >= 0 {
		t.Fatalf("expected rope impulse to pull flail back toward player (negative VX), got VX=%f", fl.VX)
	}

	nodes := s.Ropes["p1"].Nodes
	if nodes[0].VX == 0 && nodes[1].VX == 0 {
		t.Fatalf("expected at least one rope node to receive impulse when stretched, got VX0=%f VX1=%f", nodes[0].VX, nodes[1].VX)
	}
}

func TestRopeNeutralAtRestLength(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 0, Y: 0},
		},
		Flails: map[string]*Flail{
			"p1": {
				ID:               "p1_f",
				OwnerID:          "p1",
				X:                RopeRestLength,
				Y:                0,
				VX:               0,
				VY:               0,
				IsAffectedByRope: true,
			},
		},
		Ropes: map[string]*Rope{
			"p1": {
				RestLength: RopeRestLength,
				K:          RopeK,
				Nodes: []*ChainSegment{
					{
						X:                RopeRestLength * 0.5,
						Y:                0,
						VX:               0,
						VY:               0,
						IsAffectedByRope: true,
					},
				},
			},
		},
	}

	Step(s, map[string]Input{"p1": {Ax: 0, Ay: 0}})

	node := s.Ropes["p1"].Nodes[0]
	if node.VX != 0 || node.VY != 0 {
		t.Fatalf("expected rope node neutral at rest length, got VX=%f VY=%f", node.VX, node.VY)
	}
}

func TestPlayerNotAffectedByRope(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 0, Y: 0, VX: 0, VY: 0},
		},
		Flails: map[string]*Flail{
			"p1": {
				ID:               "p1_f",
				OwnerID:          "p1",
				X:                RopeRestLength * 3,
				Y:                0,
				IsAffectedByRope: true,
			},
		},
		Ropes: map[string]*Rope{
			"p1": {
				RestLength: RopeRestLength,
				K:          RopeK,
				Nodes: []*ChainSegment{
					{
						X:                RopeRestLength * 1.5,
						Y:                0,
						IsAffectedByRope: true,
					},
				},
			},
		},
	}

	vx0 := s.Players["p1"].VX
	vy0 := s.Players["p1"].VY

	Step(s, map[string]Input{"p1": {Ax: 0, Ay: 0}})

	p := s.Players["p1"]
	if p.VX != vx0 || p.VY != vy0 {
		t.Fatalf("expected player velocity unchanged by rope; got VX=%f VY=%f", p.VX, p.VY)
	}
}

func TestFlailAngleTracksOwnerDelta(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 10, Y: 10},
		},
		Flails: map[string]*Flail{
			"p1": {
				ID:               "p1_f",
				OwnerID:          "p1",
				X:                10,
				Y:                20, // directly above owner -> atan2(10,0)=pi/2
				IsAffectedByRope: true,
			},
		},
		Ropes: map[string]*Rope{
			"p1": {
				RestLength: RopeRestLength,
				K:          RopeK,
				Nodes: []*ChainSegment{
					{
						X:                10,
						Y:                15,
						IsAffectedByRope: true,
					},
				},
			},
		},
	}

	Step(s, map[string]Input{"p1": {Ax: 0, Ay: 0}})

	got := s.Flails["p1"].A
	want := math.Pi / 2
	if math.Abs(got-want) > 1e-3 {
		t.Fatalf("flail angle incorrect: got=%f want≈%f", got, want)
	}
}

func TestStepDoesNotPanicIfMissingFlailOrRope(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 0, Y: 0},
			"p2": {ID: "p2", X: 0, Y: 0},
		},
		Flails: map[string]*Flail{
			// p2 missing flail
			"p1": {ID: "p1_f", OwnerID: "p1", X: 0, Y: 0, IsAffectedByRope: true},
		},
		Ropes: map[string]*Rope{
			// p1 missing rope
			"p2": {RestLength: RopeRestLength, K: RopeK, Nodes: []*ChainSegment{{IsAffectedByRope: true}}},
		},
	}

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("Step panicked with missing flail/rope entries: %v", r)
		}
	}()

	Step(s, map[string]Input{
		"p1": {Ax: 1, Ay: 0},
		"p2": {Ax: 0, Ay: 1},
	})
}
