package protocol

import "testing"

func f64eq(a, b float64) bool {
	// Compare through the float32 precision cliff the wire format imposes.
	return float32(a) == float32(b)
}

func TestEncodeDecodeStateBinary_RoundTripBasic(t *testing.T) {
	s := State{
		Tick: 12345,
		Players: []PlayerSnapshot{
			{ID: "p1", Name: "Alice", X: 100.5, Y: 200.25, Stamina: 80, Score: 42.5, Alive: true},
			{ID: "p2", Name: "Bob", X: 300, Y: 400, Stamina: 0, Score: 10, Alive: false, RespawnInMs: 1500},
		},
		Orbs: []OrbSnapshot{
			{ID: "p1_o", OwnerID: "p1", X: 150, Y: 250, Size: 1, Mode: 0},
			{ID: "p2_o", OwnerID: "p2", X: 0, Y: 0, Size: 1, Mode: 2},
		},
		Kills: []KillSnapshot{
			{KillerID: "p1", KillerName: "Alice", VictimID: "p2", VictimName: "Bob"},
		},
	}

	b := EncodeStateBinary(s)
	got, err := DecodeStateBinary(b)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	if got.Tick != s.Tick {
		t.Fatalf("tick mismatch: got %d want %d", got.Tick, s.Tick)
	}
	if len(got.Players) != 2 {
		t.Fatalf("expected 2 players, got %d", len(got.Players))
	}
	for i, want := range s.Players {
		g := got.Players[i]
		if g.ID != want.ID || g.Name != want.Name || g.Alive != want.Alive || g.RespawnInMs != want.RespawnInMs {
			t.Fatalf("player %d mismatch: got %+v want %+v", i, g, want)
		}
		if !f64eq(g.X, want.X) || !f64eq(g.Y, want.Y) || !f64eq(g.Stamina, want.Stamina) || !f64eq(g.Score, want.Score) {
			t.Fatalf("player %d float mismatch: got %+v want %+v", i, g, want)
		}
	}
	if len(got.Orbs) != 2 {
		t.Fatalf("expected 2 orbs, got %d", len(got.Orbs))
	}
	for i, want := range s.Orbs {
		g := got.Orbs[i]
		if g.OwnerID != want.OwnerID || g.ID != want.OwnerID+"_o" || g.Mode != want.Mode {
			t.Fatalf("orb %d mismatch: got %+v want %+v", i, g, want)
		}
		if !f64eq(g.X, want.X) || !f64eq(g.Y, want.Y) || !f64eq(g.Size, want.Size) {
			t.Fatalf("orb %d float mismatch: got %+v want %+v", i, g, want)
		}
	}
	if len(got.Kills) != 1 || got.Kills[0].KillerName != "Alice" || got.Kills[0].VictimName != "Bob" {
		t.Fatalf("kill mismatch: got %+v", got.Kills)
	}
}

func TestEncodeDecodeStateBinary_Empty(t *testing.T) {
	s := State{Tick: 1}
	b := EncodeStateBinary(s)
	if len(b) != stateHeaderBytes {
		t.Fatalf("expected encoded length %d, got %d", stateHeaderBytes, len(b))
	}
	got, err := DecodeStateBinary(b)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Players) != 0 || len(got.Orbs) != 0 || len(got.Kills) != 0 {
		t.Fatalf("expected all-empty slices, got %+v", got)
	}
}

func TestEncodeStateBinary_NameExactly12Bytes(t *testing.T) {
	name := "123456789012" // exactly 12 ASCII bytes
	if len(name) != 12 {
		t.Fatalf("test setup error: name is %d bytes", len(name))
	}
	s := State{Players: []PlayerSnapshot{{ID: "p1", Name: name, Alive: true}}}
	b := EncodeStateBinary(s)
	got, err := DecodeStateBinary(b)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Players[0].Name != name {
		t.Fatalf("name mismatch: got %q want %q", got.Players[0].Name, name)
	}
}

func TestTruncateNameUTF8_EmojiBoundary(t *testing.T) {
	name := "Player😀😀" // 6 ASCII + two 4-byte emoji = 14 bytes
	if len(name) != 14 {
		t.Fatalf("test setup error: name is %d bytes, want 14", len(name))
	}
	got := truncateNameUTF8(name, 12)
	want := "Player😀"
	if got != want {
		t.Fatalf("got %q (%d bytes), want %q (%d bytes)", got, len(got), want, len(want))
	}
}

func TestTruncateNameUTF8_CJKBoundary(t *testing.T) {
	name := "日本語ABCDEFGH" // three 3-byte CJK + 8 ASCII = 17 bytes
	if len(name) != 17 {
		t.Fatalf("test setup error: name is %d bytes, want 17", len(name))
	}
	got := truncateNameUTF8(name, 12)
	want := "日本語ABC"
	if got != want {
		t.Fatalf("got %q (%d bytes), want %q (%d bytes)", got, len(got), want, len(want))
	}
}

func TestEncodeStateBinary_FullCapacity(t *testing.T) {
	s := State{Tick: 1}
	for i := 0; i < 16; i++ {
		s.Players = append(s.Players, PlayerSnapshot{ID: numToID(uint16(i)), Name: "P", Alive: true})
		s.Orbs = append(s.Orbs, OrbSnapshot{ID: numToID(uint16(i)) + "_o", OwnerID: numToID(uint16(i))})
	}
	for i := 0; i < 5; i++ {
		s.Kills = append(s.Kills, KillSnapshot{KillerID: "p0", KillerName: "K", VictimID: "p1", VictimName: "V"})
	}

	b := EncodeStateBinary(s)
	wantLen := stateHeaderBytes + 16*playerRecordBytes + 16*orbRecordBytes + 5*killRecordBytes
	if len(b) != wantLen {
		t.Fatalf("expected length %d, got %d", wantLen, len(b))
	}
	got, err := DecodeStateBinary(b)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Players) != 16 || len(got.Orbs) != 16 || len(got.Kills) != 5 {
		t.Fatalf("unexpected counts: players=%d orbs=%d kills=%d", len(got.Players), len(got.Orbs), len(got.Kills))
	}
}

func TestEncodeStateBinary_KillCountOverflowClamp(t *testing.T) {
	s := State{Tick: 1}
	for i := 0; i < 300; i++ {
		s.Kills = append(s.Kills, KillSnapshot{KillerID: "p0", KillerName: "K", VictimID: "p1", VictimName: "V"})
	}
	b := EncodeStateBinary(s)
	if b[9] != 255 {
		t.Fatalf("expected clamped kill count byte 255, got %d", b[9])
	}
	got, err := DecodeStateBinary(b)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Kills) != 255 {
		t.Fatalf("expected 255 decoded kill records, got %d", len(got.Kills))
	}
}

func TestDecodeStateBinary_TruncatedBuffer(t *testing.T) {
	s := State{Players: []PlayerSnapshot{{ID: "p1", Alive: true}}}
	b := EncodeStateBinary(s)
	truncated := b[:len(b)-1]
	if _, err := DecodeStateBinary(truncated); err == nil {
		t.Fatalf("expected an error decoding a truncated buffer, got nil")
	}

	tooShortHeader := []byte{BinMsgState, 0, 0}
	if _, err := DecodeStateBinary(tooShortHeader); err == nil {
		t.Fatalf("expected an error decoding a too-short header, got nil")
	}
}

func TestEncodeDecodeInputBinary_RoundTrip(t *testing.T) {
	cases := []Input{
		{Ax: -1, Ay: 1, Boost: false, Shoot: false},
		{Ax: 0, Ay: 0, Boost: true, Shoot: false},
		{Ax: 1, Ay: -1, Boost: false, Shoot: true},
		{Ax: 0.5, Ay: -0.5, Boost: true, Shoot: true},
	}
	for _, want := range cases {
		b := EncodeInputBinary(want)
		got, err := DecodeInputBinary(b)
		if err != nil {
			t.Fatalf("decode: %v", err)
		}
		if got.Ax != want.Ax || got.Ay != want.Ay || got.Boost != want.Boost || got.Shoot != want.Shoot {
			t.Fatalf("got %+v want %+v", got, want)
		}
	}
}

func TestDecodeInputBinary_WrongKind(t *testing.T) {
	b := EncodeInputBinary(Input{})
	b[0] = BinMsgState // wrong kind
	if _, err := DecodeInputBinary(b); err == nil {
		t.Fatalf("expected an error decoding wrong message kind, got nil")
	}
}

func TestDecodeInputBinary_ShortBuffer(t *testing.T) {
	if _, err := DecodeInputBinary([]byte{BinMsgInput, 0, 0}); err == nil {
		t.Fatalf("expected an error decoding a short input buffer, got nil")
	}
}
