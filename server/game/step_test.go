package game

import "testing"

func TestStepMovesPlayerAndAdvancesTick(t *testing.T) {
	s := &State{
		Tick:    0,
		Players: map[string]*Player{"p1": {ID: "p1"}},
	}
	inputs := map[string]Input{
		"p1": {Ax: 1, Ay: 0},
	}

	Step(s, inputs)
	if s.Tick != 1 {
		t.Fatalf("tick after 1 step = %d, want 1", s.Tick)
	}
	x1 := s.Players["p1"].X
	if x1 <= 0 {
		t.Fatalf("expected x to increase after 1 step, got %f", x1)
	}

	for i := 0; i < 4; i++ {
		Step(s, inputs)
	}
	if s.Tick != 5 {
		t.Fatalf("tick after 5 steps = %d, want 5", s.Tick)
	}
	x2 := s.Players["p1"].X
	if x2 <= x1 {
		t.Fatalf("expected x to keep increasing: x1=%f x2=%f", x1, x2)
	}
}
