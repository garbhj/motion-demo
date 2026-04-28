package game

import "testing"

func TestOrbOrbitMaintainsRadius(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 100, Y: 100},
		},
		Orbs: map[string]*Orb{
			"p1": {
				ID:      "p1_o",
				OwnerID: "p1",
				Angle:   0,
				Size:    OrbBaseSize,
				Mode:    OrbOrbit,
			},
		},
	}

	Step(s, map[string]Input{"p1": {}})

	orb := s.Orbs["p1"]
	dx := orb.X - s.Players["p1"].X
	dy := orb.Y - s.Players["p1"].Y
	dist := dx*dx + dy*dy
	want := OrbOrbitRadius * OrbOrbitRadius
	if dist < want*0.9 || dist > want*1.1 {
		t.Fatalf("orbit radius off: got=%f want≈%f", dist, want)
	}
}

func TestOrbShotTriggeredOnPinchEdge(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 0, Y: 0},
		},
		Orbs: map[string]*Orb{
			"p1": {
				ID:      "p1_o",
				OwnerID: "p1",
				Angle:   0,
				Size:    OrbBaseSize,
				Mode:    OrbOrbit,
			},
		},
	}

	Step(s, map[string]Input{"p1": {Shoot: true}})
	if s.Orbs["p1"].Mode != OrbShot {
		t.Fatalf("expected orb to enter shot on pinch edge")
	}
}

func TestOrbShotIncreasesDistance(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 0, Y: 0},
		},
		Orbs: map[string]*Orb{
			"p1": {
				ID:      "p1_o",
				OwnerID: "p1",
				Angle:   0,
				Size:    OrbBaseSize,
				Mode:    OrbOrbit,
			},
		},
	}

	Step(s, map[string]Input{"p1": {Shoot: true}})
	orb := s.Orbs["p1"]
	d0 := orb.X*orb.X + orb.Y*orb.Y
	for i := 0; i < 5; i++ {
		Step(s, map[string]Input{"p1": {}})
	}
	orb = s.Orbs["p1"]
	d1 := orb.X*orb.X + orb.Y*orb.Y
	if d1 <= d0 {
		t.Fatalf("expected orb distance to increase during shot")
	}
}

func TestOrbReturnsToOrbit(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 0, Y: 0},
		},
		Orbs: map[string]*Orb{
			"p1": {
				ID:      "p1_o",
				OwnerID: "p1",
				Angle:   0,
				Size:    OrbBaseSize,
				Mode:    OrbOrbit,
			},
		},
	}

	Step(s, map[string]Input{"p1": {Shoot: true}})
	maxTicks := OrbShotDurationTicks + 2000
	for i := 0; i < maxTicks; i++ {
		Step(s, map[string]Input{"p1": {}})
		if s.Orbs["p1"].Mode == OrbOrbit {
			return
		}
	}
	t.Fatalf("expected orb to return to orbit within %d ticks", maxTicks)
}

func TestOrbCooldownPreventsImmediateRetrigger(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 0, Y: 0},
		},
		Orbs: map[string]*Orb{
			"p1": {
				ID:      "p1_o",
				OwnerID: "p1",
				Angle:   0,
				Size:    OrbBaseSize,
				Mode:    OrbOrbit,
			},
		},
	}

	Step(s, map[string]Input{"p1": {Shoot: true}})
	for i := 0; i < OrbShotDurationTicks+1; i++ {
		Step(s, map[string]Input{"p1": {}})
	}
	modeBefore := s.Orbs["p1"].Mode
	Step(s, map[string]Input{"p1": {Shoot: true}})
	if modeBefore != OrbOrbit && s.Orbs["p1"].Mode == OrbShot {
		t.Fatalf("expected cooldown to prevent immediate retrigger")
	}
}

func TestStepDoesNotPanicIfMissingOrb(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 0, Y: 0},
		},
		Orbs: map[string]*Orb{},
	}

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("Step panicked with missing orb: %v", r)
		}
	}()

	Step(s, map[string]Input{"p1": {}})
}
