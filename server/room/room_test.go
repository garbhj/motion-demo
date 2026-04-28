package room

import (
	"testing"
	"time"

	"motion/game"
	"motion/protocol"
)

type fakeConn struct {
	sendCh chan []byte
}

func (f *fakeConn) Send(b []byte) error {
	cp := make([]byte, len(b))
	copy(cp, b)
	f.sendCh <- cp
	return nil
}

func (f *fakeConn) Close() error {
	return nil
}

func TestRoomJoinBroadcastIncludesPlayer(t *testing.T) {
	r := New()
	go r.Run()
	defer r.Stop()

	fc := &fakeConn{sendCh: make(chan []byte, 8)}
	reply := make(chan JoinResult, 1)
	r.Inbox <- Join{Conn: fc, Name: "test", Reply: reply}
	res := <-reply
	if res.PlayerID == "" {
		t.Fatalf("expected player id, got empty")
	}

	timeout := time.After(300 * time.Millisecond)
	for {
		select {
		case b := <-fc.sendCh:
			env, err := protocol.DecodeEnvelope(b)
			if err != nil {
				t.Fatalf("decode envelope: %v", err)
			}
			if env.T != protocol.MsgState {
				continue
			}
			state, err := protocol.DecodePayload[protocol.State](env)
			if err != nil {
				t.Fatalf("decode state: %v", err)
			}
			found := false
			for _, p := range state.Players {
				if p.ID == res.PlayerID {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("player %q not found in state snapshot", res.PlayerID)
			}
			return
		case <-timeout:
			t.Fatalf("timed out waiting for state broadcast")
		}
	}
}
func TestRoomTwoClientsSeeBothPlayers(t *testing.T) {
	r := New()
	go r.Run()
	defer r.Stop()

	fc1 := &fakeConn{sendCh: make(chan []byte, 64)}
	fc2 := &fakeConn{sendCh: make(chan []byte, 64)}

	reply1 := make(chan JoinResult, 1)
	reply2 := make(chan JoinResult, 1)

	r.Inbox <- Join{Conn: fc1, Name: "a", Reply: reply1}
	res1 := <-reply1

	r.Inbox <- Join{Conn: fc2, Name: "b", Reply: reply2}
	res2 := <-reply2

	if res1.PlayerID == "" || res2.PlayerID == "" {
		t.Fatalf("expected non-empty ids, got %q and %q", res1.PlayerID, res2.PlayerID)
	}
	if res1.PlayerID == res2.PlayerID {
		t.Fatalf("expected unique player ids, got same: %q", res1.PlayerID)
	}

	assertSnapshotHas := func(t *testing.T, fc *fakeConn, wantA, wantB string) {
		t.Helper()
		timeout := time.After(1 * time.Second)
		for {
			select {
			case b := <-fc.sendCh:
				env, err := protocol.DecodeEnvelope(b)
				if err != nil || env.T != protocol.MsgState {
					continue
				}
				st, err := protocol.DecodePayload[protocol.State](env)
				if err != nil {
					t.Fatalf("decode state: %v", err)
				}
				foundA, foundB := false, false
				for _, p := range st.Players {
					if p.ID == wantA {
						foundA = true
					}
					if p.ID == wantB {
						foundB = true
					}
				}
				if !foundA || !foundB {
					t.Fatalf("snapshot missing players: haveA=%v haveB=%v; want %q and %q",
						foundA, foundB, wantA, wantB)
				}
				return
			case <-timeout:
				t.Fatalf("timed out waiting for snapshot containing both players")
			}
		}
	}

	assertSnapshotHas(t, fc1, res1.PlayerID, res2.PlayerID)
	assertSnapshotHas(t, fc2, res1.PlayerID, res2.PlayerID)
}

func TestRoomLeaveRemovesPlayerFromSnapshots(t *testing.T) {
	r := New()
	go r.Run()
	defer r.Stop()

	fc := &fakeConn{sendCh: make(chan []byte, 128)}
	reply := make(chan JoinResult, 1)

	r.Inbox <- Join{Conn: fc, Name: "test", Reply: reply}
	res := <-reply

	// Wait until we see them at least once (sanity).
	waitForPlayer := func(wantPresent bool) {
		timeout := time.After(1 * time.Second)
		for {
			select {
			case b := <-fc.sendCh:
				env, err := protocol.DecodeEnvelope(b)
				if err != nil || env.T != protocol.MsgState {
					continue
				}
				st, err := protocol.DecodePayload[protocol.State](env)
				if err != nil {
					t.Fatalf("decode state: %v", err)
				}
				found := false
				for _, p := range st.Players {
					if p.ID == res.PlayerID {
						found = true
						break
					}
				}
				if wantPresent && found {
					return
				}
				if !wantPresent && !found {
					return
				}
			case <-timeout:
				t.Fatalf("timed out waiting for wantPresent=%v", wantPresent)
			}
		}
	}

	waitForPlayer(true)

	// Now leave.
	r.Inbox <- Leave{PlayerID: res.PlayerID}

	// And ensure eventually absent.
	waitForPlayer(false)
}

type slowConn struct {
	sendCh chan []byte
	block  chan struct{}
}

func (s *slowConn) Send(b []byte) error {
	cp := append([]byte(nil), b...)
	s.sendCh <- cp
	<-s.block // block until released
	return nil
}
func (s *slowConn) Close() error { return nil }

func TestRoomBroadcastDoesNotDeadlockOnSlowConn(t *testing.T) {
	r := New()
	go r.Run()
	defer r.Stop()

	// slow conn blocks on every Send
	sc := &slowConn{
		sendCh: make(chan []byte, 1),
		block:  make(chan struct{}),
	}
	reply := make(chan JoinResult, 1)
	r.Inbox <- Join{Conn: sc, Name: "slow", Reply: reply}
	_ = <-reply

	// If room writes synchronously to conn, it might stall here.
	// We'll just wait a bit and ensure room is still ticking by expecting at least one send.
	select {
	case <-sc.sendCh:
		// release one send so room can proceed
		close(sc.block)
	case <-time.After(1 * time.Second):
		t.Fatalf("expected at least one state send; possible deadlock")
	}
}

func TestRoomBroadcastRateRoughly20Hz(t *testing.T) {
	r := New()
	go r.Run()
	defer r.Stop()

	fc := &fakeConn{sendCh: make(chan []byte, 256)}
	reply := make(chan JoinResult, 1)
	r.Inbox <- Join{Conn: fc, Name: "rate", Reply: reply}
	_ = <-reply

	// Count state messages for ~300ms.
	deadline := time.After(300 * time.Millisecond)
	count := 0

	for {
		select {
		case b := <-fc.sendCh:
			env, err := protocol.DecodeEnvelope(b)
			if err == nil && env.T == protocol.MsgState {
				count++
			}
		case <-deadline:
			// 20Hz for 0.3s => ~6 msgs.
			// We accept a wide range to avoid flakes.
			if count < 2 || count > 12 {
				t.Fatalf("unexpected state broadcast count in 300ms: %d", count)
			}
			return
		}
	}
}

func TestRoomBroadcastShowsMovement(t *testing.T) {
	r := New()
	go r.Run()
	defer r.Stop()

	fc := &fakeConn{sendCh: make(chan []byte, 256)}
	reply := make(chan JoinResult, 1)
	r.Inbox <- Join{Conn: fc, Name: "mover", Reply: reply}
	res := <-reply

	r.Inbox <- Input{PlayerID: res.PlayerID, Input: game.Input{Ax: 1, Ay: 0}}

	var firstX, secondX float64
	seen := 0
	timeout := time.After(1 * time.Second)

	for seen < 2 {
		select {
		case b := <-fc.sendCh:
			env, err := protocol.DecodeEnvelope(b)
			if err != nil || env.T != protocol.MsgState {
				continue
			}
			st, err := protocol.DecodePayload[protocol.State](env)
			if err != nil {
				t.Fatalf("decode state: %v", err)
			}
			for _, p := range st.Players {
				if p.ID == res.PlayerID {
					if seen == 0 {
						firstX = p.X
					} else if seen == 1 {
						secondX = p.X
					}
					seen++
					break
				}
			}
		case <-timeout:
			t.Fatalf("timed out waiting for movement snapshots")
		}
	}

	if secondX <= firstX {
		t.Fatalf("expected x to increase between snapshots: first=%f second=%f", firstX, secondX)
	}
}
