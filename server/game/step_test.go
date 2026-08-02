package game

import "testing"

func killerVictimState() *State {
	return &State{
		Players: map[string]*Player{
			"killer": {ID: "killer", Name: "Killer", X: 0, Y: 0, Alive: true},
			"victim": {ID: "victim", Name: "Victim", X: 0, Y: 0, Alive: true, Score: 5},
		},
		Orbs: map[string]*Orb{
			"killer": {
				ID: "killer_o", OwnerID: "killer",
				X: 0, Y: 0, VX: 0, VY: 0,
				Mode: OrbShot, ShotTicksLeft: OrbShotDurationTicks,
			},
		},
	}
}

func TestStepKillMarksVictimDeadFreezesMovementAndDropsOrb(t *testing.T) {
	s := killerVictimState()

	Step(s, map[string]Input{})

	victim := s.Players["victim"]
	if victim.Alive {
		t.Fatalf("expected victim to be dead after kill")
	}
	if victim.RespawnAtTick != s.Tick+RespawnDelayTicks {
		t.Fatalf("expected RespawnAtTick=%d, got %d", s.Tick+RespawnDelayTicks, victim.RespawnAtTick)
	}
	if _, ok := s.Orbs["victim"]; ok {
		t.Fatalf("expected victim's orb to be removed")
	}

	x, y := victim.X, victim.Y
	Step(s, map[string]Input{"victim": {Ax: 1, Ay: 0}})
	if s.Players["victim"].X != x || s.Players["victim"].Y != y {
		t.Fatalf("expected dead player's position to stay frozen despite movement input")
	}
}

func TestStepRespawnResetsAliveScoreAndOrb(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", Alive: false, Score: 50},
		},
		Orbs: map[string]*Orb{},
	}
	s.Players["p1"].RespawnAtTick = 1 // Step() below increments Tick to 1

	Step(s, map[string]Input{})

	p := s.Players["p1"]
	if !p.Alive {
		t.Fatalf("expected player to have respawned")
	}
	// Respawn resets Score to 0, but the movement loop runs immediately
	// after in the same Step() call and grants one tick of passive score
	// to the now-alive player, so the observable result is one tick's
	// worth, not literally 0.
	if p.Score != PointsPerTickAlive {
		t.Fatalf("expected score reset to one tick of passive gain (%f), got %f", PointsPerTickAlive, p.Score)
	}
	if _, ok := s.Orbs["p1"]; !ok {
		t.Fatalf("expected a fresh orb to be created on respawn")
	}
	if p.X < 0 || p.X > MapWidth || p.Y < 0 || p.Y > MapHeight {
		t.Fatalf("expected respawn position within map bounds, got (%f, %f)", p.X, p.Y)
	}
}

func TestStepKillEventAccumulatesUntilDrained(t *testing.T) {
	s := killerVictimState()

	Step(s, map[string]Input{})
	if len(s.Kills) != 1 {
		t.Fatalf("expected 1 kill event, got %d", len(s.Kills))
	}
	k := s.Kills[0]
	if k.KillerID != "killer" || k.VictimID != "victim" || k.KillerName != "Killer" || k.VictimName != "Victim" {
		t.Fatalf("unexpected kill event contents: %+v", k)
	}

	Step(s, map[string]Input{})
	if len(s.Kills) != 1 {
		t.Fatalf("expected Kills to persist across ticks until externally drained, got %d", len(s.Kills))
	}
}

func TestStepDoubleKillSameTickResolvesOnce(t *testing.T) {
	s := &State{
		Players: map[string]*Player{
			// k1/k2 placed well inside map bounds, far from each other and
			// from the victim, so their own orbs (positioned at the
			// victim) can't accidentally register a hit on the other
			// killer. (Off-map coordinates would get pulled onto the map
			// edge by the movement loop's boundary clamp, which can put
			// two "far apart" players suspiciously close together.)
			"k1":     {ID: "k1", Name: "K1", X: 100, Y: 100, Alive: true},
			"k2":     {ID: "k2", Name: "K2", X: 1900, Y: 1900, Alive: true},
			"victim": {ID: "victim", Name: "Victim", X: 1000, Y: 1000, Alive: true, Score: 5},
		},
		Orbs: map[string]*Orb{
			"k1": {ID: "k1_o", OwnerID: "k1", X: 1000, Y: 1000, Mode: OrbShot, ShotTicksLeft: OrbShotDurationTicks},
			"k2": {ID: "k2_o", OwnerID: "k2", X: 1000, Y: 1000, Mode: OrbShot, ShotTicksLeft: OrbShotDurationTicks},
		},
	}

	Step(s, map[string]Input{})

	if len(s.Kills) != 1 {
		t.Fatalf("expected exactly 1 kill event for a same-tick double-kill, got %d", len(s.Kills))
	}
	// Both killers are alive, so both earn one tick of passive score
	// (PointsPerTickAlive = 0.05) regardless of the kill; only the
	// credited killer additionally earns PointsPerKill + steal fraction,
	// which dwarfs the passive gain — use that gap to detect which one.
	k1Credited := s.Players["k1"].Score > 1
	k2Credited := s.Players["k2"].Score > 1
	if k1Credited == k2Credited {
		t.Fatalf("expected exactly one killer credited for the kill, k1Score=%f k2Score=%f", s.Players["k1"].Score, s.Players["k2"].Score)
	}
}
