package protocol

import (
	"encoding/binary"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// f32bits/f32 convert between the float64 values used internally and the
// float32 wire representation. Position range (0-2000) needs nowhere near
// float32's ~7 significant digits of precision, so this halves every float
// field's wire size versus float64.
func f32bits(f float64) uint32 {
	return math.Float32bits(float32(f))
}

func f32(u uint32) float64 {
	return float64(math.Float32frombits(u))
}

// Binary wire format for the hot-path messages (state broadcast, input).
// JSON stays for hello/welcome/error — rare, one-shot, not perf-critical.
// All multi-byte fields are little-endian. Player/orb/kill records are
// fixed-size for simple, fast, offset-based decoding.

const (
	BinMsgState byte = 1
	BinMsgInput byte = 2
)

const (
	nameBytes         = 12
	stateHeaderBytes  = 10
	playerRecordBytes = 33
	orbRecordBytes    = 15
	killRecordBytes   = 28
	inputMessageBytes = 10
	flagAlive         = 1 << 0
	inputFlagBoost    = 1 << 0
	inputFlagShoot    = 1 << 1
)

// idNum parses the server's "pN" id scheme (guaranteed by
// room.go's fmt.Sprintf("p%d", idNum)). Falls back to 0 on a malformed id
// rather than panicking — unreachable in practice, this is the hot
// broadcast path.
func idNum(id string) uint16 {
	s := strings.TrimPrefix(id, "p")
	n, err := strconv.ParseUint(s, 10, 16)
	if err != nil {
		return 0
	}
	return uint16(n)
}

func numToID(n uint16) string {
	return "p" + strconv.Itoa(int(n))
}

// truncateNameUTF8 returns the longest prefix of name whose UTF-8 byte
// length is <= maxBytes, never splitting a multi-byte rune.
func truncateNameUTF8(name string, maxBytes int) string {
	if len(name) <= maxBytes {
		return name
	}
	end := 0
	for i := range name { // i = byte offset of each rune's start
		if i > maxBytes {
			break
		}
		end = i
	}
	return name[:end]
}

func putName(buf []byte, name string) {
	// buf is expected to be exactly nameBytes long and zero-initialized.
	copy(buf, truncateNameUTF8(name, nameBytes))
}

func decodeName(b []byte) string {
	n := len(b)
	for n > 0 && b[n-1] == 0 {
		n--
	}
	return string(b[:n])
}

// EncodeStateBinary packs a State into the binary wire format. Production
// path, called from room.go on every broadcast.
func EncodeStateBinary(s State) []byte {
	killCount := len(s.Kills)
	if killCount > 255 {
		killCount = 255 // defensive clamp; unreachable at DefaultRoomCapacity=16
	}

	total := stateHeaderBytes + len(s.Players)*playerRecordBytes + len(s.Orbs)*orbRecordBytes + killCount*killRecordBytes
	b := make([]byte, total)

	b[0] = BinMsgState
	binary.LittleEndian.PutUint32(b[1:5], uint32(s.Tick))
	binary.LittleEndian.PutUint16(b[5:7], uint16(len(s.Players)))
	binary.LittleEndian.PutUint16(b[7:9], uint16(len(s.Orbs)))
	b[9] = byte(killCount)

	off := stateHeaderBytes
	for _, p := range s.Players {
		binary.LittleEndian.PutUint16(b[off:off+2], idNum(p.ID))
		putName(b[off+2:off+2+nameBytes], p.Name)
		binary.LittleEndian.PutUint32(b[off+14:off+18], f32bits(p.X))
		binary.LittleEndian.PutUint32(b[off+18:off+22], f32bits(p.Y))
		binary.LittleEndian.PutUint32(b[off+22:off+26], f32bits(p.Stamina))
		binary.LittleEndian.PutUint32(b[off+26:off+30], f32bits(p.Score))
		var flags byte
		if p.Alive {
			flags |= flagAlive
		}
		b[off+30] = flags
		binary.LittleEndian.PutUint16(b[off+31:off+33], uint16(p.RespawnInMs))
		off += playerRecordBytes
	}

	for _, o := range s.Orbs {
		binary.LittleEndian.PutUint16(b[off:off+2], idNum(o.OwnerID))
		binary.LittleEndian.PutUint32(b[off+2:off+6], f32bits(o.X))
		binary.LittleEndian.PutUint32(b[off+6:off+10], f32bits(o.Y))
		binary.LittleEndian.PutUint32(b[off+10:off+14], f32bits(o.Size))
		b[off+14] = o.Mode
		off += orbRecordBytes
	}

	for i := 0; i < killCount; i++ {
		k := s.Kills[i]
		binary.LittleEndian.PutUint16(b[off:off+2], idNum(k.KillerID))
		putName(b[off+2:off+2+nameBytes], k.KillerName)
		binary.LittleEndian.PutUint16(b[off+14:off+16], idNum(k.VictimID))
		putName(b[off+16:off+16+nameBytes], k.VictimName)
		off += killRecordBytes
	}

	return b
}

// DecodeStateBinary unpacks a binary state message. Test-only — production
// Go code never decodes its own binary state format, only the client does.
func DecodeStateBinary(b []byte) (State, error) {
	if len(b) < stateHeaderBytes {
		return State{}, fmt.Errorf("state buffer too short: %d bytes", len(b))
	}
	if b[0] != BinMsgState {
		return State{}, fmt.Errorf("unexpected message kind: %d", b[0])
	}
	tick := binary.LittleEndian.Uint32(b[1:5])
	playerCount := binary.LittleEndian.Uint16(b[5:7])
	orbCount := binary.LittleEndian.Uint16(b[7:9])
	killCount := b[9]

	need := stateHeaderBytes + int(playerCount)*playerRecordBytes + int(orbCount)*orbRecordBytes + int(killCount)*killRecordBytes
	if len(b) < need {
		return State{}, fmt.Errorf("state buffer too short: need %d, got %d", need, len(b))
	}

	s := State{
		Tick:    int(tick),
		Players: make([]PlayerSnapshot, 0, playerCount),
		Orbs:    make([]OrbSnapshot, 0, orbCount),
		Kills:   make([]KillSnapshot, 0, killCount),
	}

	off := stateHeaderBytes
	for i := 0; i < int(playerCount); i++ {
		id := numToID(binary.LittleEndian.Uint16(b[off : off+2]))
		name := decodeName(b[off+2 : off+2+nameBytes])
		x := f32(binary.LittleEndian.Uint32(b[off+14 : off+18]))
		y := f32(binary.LittleEndian.Uint32(b[off+18 : off+22]))
		stamina := f32(binary.LittleEndian.Uint32(b[off+22 : off+26]))
		score := f32(binary.LittleEndian.Uint32(b[off+26 : off+30]))
		flags := b[off+30]
		respawnInMs := binary.LittleEndian.Uint16(b[off+31 : off+33])
		s.Players = append(s.Players, PlayerSnapshot{
			ID: id, Name: name, X: x, Y: y, Stamina: stamina, Score: score,
			Alive: flags&flagAlive != 0, RespawnInMs: int(respawnInMs),
		})
		off += playerRecordBytes
	}

	for i := 0; i < int(orbCount); i++ {
		ownerIDNum := binary.LittleEndian.Uint16(b[off : off+2])
		ownerID := numToID(ownerIDNum)
		x := f32(binary.LittleEndian.Uint32(b[off+2 : off+6]))
		y := f32(binary.LittleEndian.Uint32(b[off+6 : off+10]))
		size := f32(binary.LittleEndian.Uint32(b[off+10 : off+14]))
		mode := b[off+14]
		s.Orbs = append(s.Orbs, OrbSnapshot{
			ID: ownerID + "_o", OwnerID: ownerID, X: x, Y: y, Size: size, Mode: mode,
		})
		off += orbRecordBytes
	}

	for i := 0; i < int(killCount); i++ {
		killerID := numToID(binary.LittleEndian.Uint16(b[off : off+2]))
		killerName := decodeName(b[off+2 : off+2+nameBytes])
		victimID := numToID(binary.LittleEndian.Uint16(b[off+14 : off+16]))
		victimName := decodeName(b[off+16 : off+16+nameBytes])
		s.Kills = append(s.Kills, KillSnapshot{
			KillerID: killerID, KillerName: killerName, VictimID: victimID, VictimName: victimName,
		})
		off += killRecordBytes
	}

	return s, nil
}

// EncodeInputBinary packs an Input into the binary wire format. Test-only —
// production input encoding happens in the client (JS).
func EncodeInputBinary(inp Input) []byte {
	b := make([]byte, inputMessageBytes)
	b[0] = BinMsgInput
	binary.LittleEndian.PutUint32(b[1:5], f32bits(float64(inp.Ax)))
	binary.LittleEndian.PutUint32(b[5:9], f32bits(float64(inp.Ay)))
	var flags byte
	if inp.Boost {
		flags |= inputFlagBoost
	}
	if inp.Shoot {
		flags |= inputFlagShoot
	}
	b[9] = flags
	return b
}

// DecodeInputBinary unpacks a binary input message. Production path, called
// from network.go's read loop.
func DecodeInputBinary(b []byte) (Input, error) {
	if len(b) < inputMessageBytes {
		return Input{}, fmt.Errorf("input buffer too short: %d bytes", len(b))
	}
	if b[0] != BinMsgInput {
		return Input{}, fmt.Errorf("unexpected message kind: %d", b[0])
	}
	ax := math.Float32frombits(binary.LittleEndian.Uint32(b[1:5]))
	ay := math.Float32frombits(binary.LittleEndian.Uint32(b[5:9]))
	flags := b[9]
	return Input{
		Ax: ax, Ay: ay,
		Boost: flags&inputFlagBoost != 0,
		Shoot: flags&inputFlagShoot != 0,
	}, nil
}
