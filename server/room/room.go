package room

import (
	"fmt"
	"math"
	"time"

	"motion/game"
	"motion/protocol"
)

type Room struct {
	Inbox          chan any
	tickHz         int
	broadcastEvery int
	state          game.State
	clients        map[string]Conn
	latestInputs   map[string]game.Input
	nextID         int
	quit           chan struct{}

	Code    string             // room code (e.g. "ABC123")
	OnEmpty func(code string)   // called when last player leaves
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
	}
}

func (r *Room) Stop() {
	close(r.quit)
}

// NumPlayers returns the current number of connected clients.
func (r *Room) NumPlayers() int {
	return len(r.clients)
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
			}
		}
	}
}

func (r *Room) handleCommand(cmd any) {
	switch c := cmd.(type) {
	case Join:
		idNum := r.nextID
		playerID := fmt.Sprintf("p%d", idNum)
		r.nextID++
		r.clients[playerID] = c.Conn
		r.latestInputs[playerID] = game.Input{}
		if _, ok := r.state.Players[playerID]; !ok {
			spawn := float64(100 * idNum)
			name := c.Name
			if name == "" {
				name = fmt.Sprintf("Player %d", idNum)
			}
			r.state.Players[playerID] = &game.Player{ID: playerID, Name: name, X: spawn, Y: spawn}
		}
		if _, ok := r.state.Orbs[playerID]; !ok {
			px := r.state.Players[playerID].X
			py := r.state.Players[playerID].Y
			angle := 0.0
			ox := px + math.Cos(angle)*game.OrbOrbitRadius
			oy := py + math.Sin(angle)*game.OrbOrbitRadius
			r.state.Orbs[playerID] = &game.Orb{
				ID:            playerID + "_o",
				OwnerID:       playerID,
				X:             ox,
				Y:             oy,
				Angle:         angle,
				Size:          game.OrbBaseSize,
				Mode:          game.OrbOrbit,
				ShotTicksLeft: 0,
				CooldownTicks: 0,
			}
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
	}
	if len(r.clients) == 0 && r.OnEmpty != nil && r.Code != "" {
		r.OnEmpty(r.Code)
	}
}

func (r *Room) removePlayer(playerID string) {
	if c, ok := r.clients[playerID]; ok {
		_ = c.Close()
	}
	delete(r.clients, playerID)
	delete(r.latestInputs, playerID)
	delete(r.state.Players, playerID)
	delete(r.state.Orbs, playerID)
}

func (r *Room) broadcastState() {
	snapshot := r.buildSnapshot()
	b, err := protocol.Encode(protocol.MsgState, snapshot)
	if err != nil {
		return
	}

	var failed []string
	for id, c := range r.clients {
		if err := c.Send(b); err != nil {
			failed = append(failed, id)
		}
	}
	for _, id := range failed {
		r.removePlayer(id)
	}
}

func (r *Room) sendStateTo(c Conn) {
	snapshot := r.buildSnapshot()
	b, err := protocol.Encode(protocol.MsgState, snapshot)
	if err != nil {
		return
	}
	_ = c.Send(b)
}

func (r *Room) buildSnapshot() protocol.State {
	snapshot := protocol.State{
		Tick:       r.state.Tick,
		Players:    make([]protocol.PlayerSnapshot, 0, len(r.state.Players)),
		Orbs:       make([]protocol.OrbSnapshot, 0, len(r.state.Orbs)),
		Eliminated: make([]protocol.EliminatedSnapshot, 0, len(r.state.Eliminated)),
	}
	for id, p := range r.state.Players {
		snapshot.Players = append(snapshot.Players, protocol.PlayerSnapshot{
			ID:   id,
			Name: p.Name,
			X:    p.X,
			Y:    p.Y,
		})
	}
	for _, e := range r.state.Eliminated {
		snapshot.Eliminated = append(snapshot.Eliminated, protocol.EliminatedSnapshot{ID: e.ID, Name: e.Name})
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
