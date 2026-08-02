package room

import (
	"fmt"
	"sync/atomic"
	"time"

	"motion/game"
	"motion/protocol"
)

// DefaultRoomCapacity is the max players per room. Kept as a single tunable
// constant: at 2000x2000 with orb-based melee, this keeps arenas feeling
// busy without blowing up per-tick collision cost or the 20Hz state broadcast.
const DefaultRoomCapacity = 16

type Room struct {
	Inbox          chan any
	tickHz         int
	broadcastEvery int
	state          game.State
	clients        map[string]Conn
	latestInputs   map[string]game.Input
	nextID         int
	quit           chan struct{}
	numPlayers     int32 // atomic mirror of len(clients); safe to read cross-goroutine

	Code       string            // room code (e.g. "ABC123")
	Public     bool              // true = eligible for auto-matchmaking; false = private/code-only
	MaxPlayers int               // capacity; joins beyond this are rejected
	OnEmpty    func(code string) // called when last player leaves
}

func New() *Room {
	broadcastEvery := protocol.SimTickHz / protocol.BroadcastHz
	if broadcastEvery <= 0 {
		broadcastEvery = 1
	}
	return &Room{
		Inbox:          make(chan any, 256),
		tickHz:         protocol.SimTickHz,
		broadcastEvery: broadcastEvery,
		state: game.State{
			Players: make(map[string]*game.Player),
			Orbs:    make(map[string]*game.Orb),
		},
		clients:      make(map[string]Conn),
		latestInputs: make(map[string]game.Input),
		nextID:       1,
		quit:         make(chan struct{}),
		MaxPlayers:   DefaultRoomCapacity,
	}
}

func (r *Room) Stop() {
	close(r.quit)
}

// NumPlayers returns the current number of connected clients. Safe to call
// from any goroutine (e.g. the Manager, while the Room's own goroutine
// mutates clients concurrently).
func (r *Room) NumPlayers() int {
	return int(atomic.LoadInt32(&r.numPlayers))
}

func (r *Room) Run() {
	ticker := time.NewTicker(time.Second / time.Duration(r.tickHz))
	defer ticker.Stop()

	for {
		select {
		case <-r.quit:
			return
		case cmd := <-r.Inbox:
			r.handleCommand(cmd)
		case <-ticker.C:
			game.Step(&r.state, r.latestInputs)
			if r.state.Tick%r.broadcastEvery == 0 {
				r.broadcastState()
				r.state.Kills = r.state.Kills[:0]
			}
		}
	}
}

func (r *Room) handleCommand(cmd any) {
	switch c := cmd.(type) {
	case Join:
		if len(r.clients) >= r.MaxPlayers {
			c.Reply <- JoinResult{Full: true}
			return
		}
		idNum := r.nextID
		playerID := fmt.Sprintf("p%d", idNum)
		r.nextID++
		r.clients[playerID] = c.Conn
		atomic.AddInt32(&r.numPlayers, 1)
		r.latestInputs[playerID] = game.Input{}
		if _, ok := r.state.Players[playerID]; !ok {
			px, py := game.SpawnPoint()
			name := c.Name
			if name == "" {
				name = fmt.Sprintf("Player %d", idNum)
			}
			r.state.Players[playerID] = &game.Player{
				ID: playerID, Name: name, X: px, Y: py,
				Stamina: game.StaminaMax, Score: 0, Alive: true,
			}
		}
		if _, ok := r.state.Orbs[playerID]; !ok {
			r.state.Orbs[playerID] = game.NewOrb(playerID, r.state.Players[playerID])
		}
		c.Reply <- JoinResult{PlayerID: playerID}
	case Input:
		if _, ok := r.clients[c.PlayerID]; !ok {
			return
		}
		r.latestInputs[c.PlayerID] = c.Input
	case Leave:
		r.handleLeave(c.PlayerID)
	}
}

func (r *Room) handleLeave(playerID string) {
	c, ok := r.clients[playerID]
	delete(r.latestInputs, playerID)
	delete(r.state.Players, playerID)
	delete(r.state.Orbs, playerID)
	if ok {
		r.sendStateTo(c)
		_ = c.Close()
		delete(r.clients, playerID)
		atomic.AddInt32(&r.numPlayers, -1)
	}
	if len(r.clients) == 0 && r.OnEmpty != nil && r.Code != "" {
		r.OnEmpty(r.Code)
	}
}

func (r *Room) removePlayer(playerID string) {
	if c, ok := r.clients[playerID]; ok {
		_ = c.Close()
		delete(r.clients, playerID)
		atomic.AddInt32(&r.numPlayers, -1)
	}
	delete(r.latestInputs, playerID)
	delete(r.state.Players, playerID)
	delete(r.state.Orbs, playerID)
}

func (r *Room) broadcastState() {
	snapshot := r.buildSnapshot()
	b := protocol.EncodeStateBinary(snapshot)

	var failed []string
	for id, c := range r.clients {
		if err := c.SendBinary(b); err != nil {
			failed = append(failed, id)
		}
	}
	for _, id := range failed {
		r.removePlayer(id)
	}
}

func (r *Room) sendStateTo(c Conn) {
	snapshot := r.buildSnapshot()
	b := protocol.EncodeStateBinary(snapshot)
	_ = c.SendBinary(b)
}

func (r *Room) buildSnapshot() protocol.State {
	snapshot := protocol.State{
		Tick:    r.state.Tick,
		Players: make([]protocol.PlayerSnapshot, 0, len(r.state.Players)),
		Orbs:    make([]protocol.OrbSnapshot, 0, len(r.state.Orbs)),
		Kills:   make([]protocol.KillSnapshot, 0, len(r.state.Kills)),
	}
	for id, p := range r.state.Players {
		ps := protocol.PlayerSnapshot{
			ID:      id,
			Name:    p.Name,
			X:       p.X,
			Y:       p.Y,
			Stamina: p.Stamina,
			Score:   p.Score,
			Alive:   p.Alive,
		}
		if !p.Alive {
			remaining := p.RespawnAtTick - r.state.Tick
			if remaining < 0 {
				remaining = 0
			}
			ps.RespawnInMs = remaining * 1000 / protocol.SimTickHz
		}
		snapshot.Players = append(snapshot.Players, ps)
	}
	for _, k := range r.state.Kills {
		snapshot.Kills = append(snapshot.Kills, protocol.KillSnapshot{
			KillerID:   k.KillerID,
			KillerName: k.KillerName,
			VictimID:   k.VictimID,
			VictimName: k.VictimName,
		})
	}
	for _, o := range r.state.Orbs {
		snapshot.Orbs = append(snapshot.Orbs, protocol.OrbSnapshot{
			ID:      o.ID,
			OwnerID: o.OwnerID,
			X:       o.X,
			Y:       o.Y,
			Size:    o.Size,
			A:       o.Angle,
			Mode:    uint8(o.Mode),
		})
	}
	return snapshot
}
