package protocol

import "testing"

func TestMessageConstants(t *testing.T) {
	if MsgHello != "hello" {
		t.Fatalf("MsgHello = %q, want %q", MsgHello, "hello")
	}
	if MsgInput != "input" {
		t.Fatalf("MsgInput = %q, want %q", MsgInput, "input")
	}
	if MsgWelcome != "welcome" {
		t.Fatalf("MsgWelcome = %q, want %q", MsgWelcome, "welcome")
	}
	if MsgState != "state" {
		t.Fatalf("MsgState = %q, want %q", MsgState, "state")
	}
}

func TestTimingConstants(t *testing.T) {
	if SimTickHz != 40 {
		t.Fatalf("SimTickHz = %d, want %d", SimTickHz, 40)
	}
	if ClientInputHz != 40 {
		t.Fatalf("ClientInputHz = %d, want %d", ClientInputHz, 40)
	}
	if BroadcastHz != 20 {
		t.Fatalf("BroadcastHz = %d, want %d", BroadcastHz, 20)
	}
}

func TestTimingSanity(t *testing.T) {
	if SimTickHz <= 0 || ClientInputHz <= 0 || BroadcastHz <= 0 {
		t.Fatalf("timing constants must be > 0")
	}
	if SimTickHz%BroadcastHz != 0 {
		t.Fatalf("SimTickHz %% BroadcastHz != 0 (%d %% %d)", SimTickHz, BroadcastHz)
	}
}
