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

// GetOrCreateRoom returns the room for the given code, creating it if needed.
func (m *Manager) GetOrCreateRoom(code string) *Room {
	if code == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.rooms[code]; ok {
		return r
	}
	r := New()
	r.Code = code
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

// CreateRoom generates a unique 6-char code, creates the room, and returns the code.
func (m *Manager) CreateRoom() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	for {
		code := generateCode(6)
		if _, exists := m.rooms[code]; exists {
			continue
		}
		r := New()
		r.Code = code
		r.OnEmpty = func(c string) {
			m.removeRoom(c)
		}
		m.rooms[code] = r
		go r.Run()
		return code
	}
}

// ListRooms returns all active rooms with code and player count.
func (m *Manager) ListRooms() []RoomInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]RoomInfo, 0, len(m.rooms))
	for code, r := range m.rooms {
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
