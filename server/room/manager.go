package room

import (
	"crypto/rand"
	"math/big"
	"sync"
)

// RoomInfo is returned by the API for the server list.
type RoomInfo struct {
	Code    string `json:"code"`
	Players int    `json:"players"`
}

// Manager holds multiple rooms by code. Rooms are created on first join or via CreateRoom,
// and removed when the last player leaves.
type Manager struct {
	mu    sync.RWMutex
	rooms map[string]*Room
}

func NewManager() *Manager {
	return &Manager{
		rooms: make(map[string]*Room),
	}
}

// GetRoom returns the room for code without creating one. Used for private
// room-code joins so a bad/expired code fails clearly instead of silently
// spawning a fresh, empty room for a typo.
func (m *Manager) GetRoom(code string) (*Room, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.rooms[code]
	return r, ok
}

// FindOrCreatePublicRoom returns an existing public room with free capacity,
// or spins up a new public room if none has space.
func (m *Manager) FindOrCreatePublicRoom() *Room {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.rooms {
		if r.Public && r.NumPlayers() < r.MaxPlayers {
			return r
		}
	}
	for {
		code := generateCode(6)
		if _, exists := m.rooms[code]; exists {
			continue
		}
		return m.newRoomLocked(code, true)
	}
}

// newRoomLocked constructs, registers, and starts a room. Callers must hold m.mu.
func (m *Manager) newRoomLocked(code string, public bool) *Room {
	r := New()
	r.Code = code
	r.Public = public
	r.OnEmpty = func(c string) {
		m.removeRoom(c)
	}
	m.rooms[code] = r
	go r.Run()
	return r
}

func (m *Manager) removeRoom(code string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.rooms[code]; ok {
		r.Stop()
		delete(m.rooms, code)
	}
}

const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// CreateRoom generates a unique 6-char code, creates a private room, and returns the code.
func (m *Manager) CreateRoom() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	for {
		code := generateCode(6)
		if _, exists := m.rooms[code]; exists {
			continue
		}
		r := m.newRoomLocked(code, false)
		return r.Code
	}
}

// ListRooms returns active public rooms with code and player count. Private
// rooms are excluded so their codes aren't discoverable via the room list.
func (m *Manager) ListRooms() []RoomInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]RoomInfo, 0, len(m.rooms))
	for code, r := range m.rooms {
		if !r.Public {
			continue
		}
		out = append(out, RoomInfo{Code: code, Players: r.NumPlayers()})
	}
	return out
}

func generateCode(n int) string {
	b := make([]byte, n)
	max := big.NewInt(int64(len(codeChars)))
	for i := range b {
		idx, _ := rand.Int(rand.Reader, max)
		b[i] = codeChars[idx.Int64()]
	}
	return string(b)
}
