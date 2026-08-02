package game

import (
	"math"
	"testing"
)

func TestStepPlayerStopsAtObstacleEdgeMovingStraightIn(t *testing.T) {
	o := Obstacles[0]
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: o.X - 60, Y: o.Y + o.Height/2, Alive: true},
		},
		Orbs: map[string]*Orb{},
	}

	maxX := o.X - PlayerRadius
	for i := 0; i < 100; i++ {
		Step(s, map[string]Input{"p1": {Ax: 1}})
		if s.Players["p1"].X > maxX+1e-6 {
			t.Fatalf("tick %d: player.X=%f crossed into obstacle (max allowed %f)", i, s.Players["p1"].X, maxX)
		}
	}
}

func TestStepPlayerCornerApproachDoesNotGlitch(t *testing.T) {
	o := Obstacles[0]
	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: o.X - 40, Y: o.Y - 40, Alive: true},
		},
		Orbs: map[string]*Orb{},
	}

	const maxTickDisplacement = MaxSpeedSprint * 2
	prevX, prevY := s.Players["p1"].X, s.Players["p1"].Y
	for i := 0; i < 100; i++ {
		Step(s, map[string]Input{"p1": {Ax: 1, Ay: 1, Boost: true}})
		p := s.Players["p1"]
		if math.IsNaN(p.X) || math.IsNaN(p.Y) {
			t.Fatalf("tick %d: NaN position", i)
		}
		if d := math.Hypot(p.X-prevX, p.Y-prevY); d > maxTickDisplacement {
			t.Fatalf("tick %d: suspicious teleport-sized displacement %f", i, d)
		}
		if distSqToObstacle(p.X, p.Y, o) < PlayerRadius*PlayerRadius-1e-6 {
			t.Fatalf("tick %d: player penetrated obstacle (x=%f,y=%f)", i, p.X, p.Y)
		}
		prevX, prevY = p.X, p.Y
	}
}

func TestStepObstaclePinnedAgainstMapBoundaryComposesCleanly(t *testing.T) {
	orig := Obstacles
	Obstacles = []Obstacle{{X: 0, Y: 900, Width: 200, Height: 200}} // touches the left map edge
	defer func() { Obstacles = orig }()

	s := &State{
		Players: map[string]*Player{
			"p1": {ID: "p1", X: 250, Y: 1000, Alive: true},
		},
		Orbs: map[string]*Orb{},
	}

	for i := 0; i < 200; i++ {
		Step(s, map[string]Input{"p1": {Ax: -1, Boost: true}})
		p := s.Players["p1"]
		if math.IsNaN(p.X) || math.IsNaN(p.Y) {
			t.Fatalf("tick %d: NaN position", i)
		}
		if p.X < PlayerRadius-1e-6 {
			t.Fatalf("tick %d: player pushed out of map bounds, X=%f", i, p.X)
		}
	}
}

func TestStepShotOrbEntersReturnModeOnObstacleHit(t *testing.T) {
	o := Obstacles[0]
	s := &State{
		Players: map[string]*Player{
			"shooter": {ID: "shooter", X: o.X - 200, Y: o.Y + o.Height/2, Alive: true},
		},
		Orbs: map[string]*Orb{
			"shooter": {
				ID: "shooter_o", OwnerID: "shooter",
				X: o.X - OrbHitRadius - 1, Y: o.Y + o.Height/2,
				VX: OrbShotSpeed, VY: 0,
				Mode: OrbShot, ShotTicksLeft: 5,
			},
		},
	}

	Step(s, map[string]Input{})

	if s.Orbs["shooter"].Mode != OrbReturn {
		t.Fatalf("expected orb to enter OrbReturn after hitting obstacle, got mode %v", s.Orbs["shooter"].Mode)
	}
}

func TestStepShotOrbBlockedByObstacleDoesNotKillPlayerBehindWall(t *testing.T) {
	o := Obstacles[0] // {500, 500, 200, 100}
	s := &State{
		Players: map[string]*Player{
			"shooter": {ID: "shooter", X: o.X - 200, Y: o.Y + o.Height/2, Alive: true},
			"target":  {ID: "target", X: o.X + o.Width + 200, Y: o.Y + o.Height/2, Alive: true},
		},
		Orbs: map[string]*Orb{
			"shooter": {
				ID: "shooter_o", OwnerID: "shooter",
				X: o.X - OrbHitRadius - 1, Y: o.Y + o.Height/2,
				VX: OrbShotSpeed, VY: 0,
				Mode: OrbShot, ShotTicksLeft: OrbShotDurationTicks,
			},
		},
	}

	for i := 0; i < OrbShotDurationTicks+5; i++ {
		Step(s, map[string]Input{})
	}

	if !s.Players["target"].Alive {
		t.Fatalf("expected target behind the wall to survive an orb fired through it")
	}
	if len(s.Kills) != 0 {
		t.Fatalf("expected no kill events, got %d", len(s.Kills))
	}
}

func TestSpawnPointNeverLandsWithinPlayerRadiusOfAnObstacle(t *testing.T) {
	for i := 0; i < 5000; i++ {
		x, y := SpawnPoint()
		for _, o := range Obstacles {
			if distSqToObstacle(x, y, o) < PlayerRadius*PlayerRadius {
				t.Fatalf("sample %d: spawn point (%f,%f) lands within PlayerRadius of obstacle %+v", i, x, y, o)
			}
		}
	}
}
