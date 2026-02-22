package room

import (
	"fmt"
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
			r.state.Players[playerID] = &game.Player{ID: playerID, X: spawn, Y: spawn}
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
	if ok {
		r.sendStateTo(c)
		_ = c.Close()
		delete(r.clients, playerID)
	}
}

func (r *Room) removePlayer(playerID string) {
	if c, ok := r.clients[playerID]; ok {
		_ = c.Close()
	}
	delete(r.clients, playerID)
	delete(r.latestInputs, playerID)
	delete(r.state.Players, playerID)
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
		Tick:    r.state.Tick,
		Players: make([]protocol.PlayerSnapshot, 0, len(r.state.Players)),
	}
	for id, p := range r.state.Players {
		snapshot.Players = append(snapshot.Players, protocol.PlayerSnapshot{
			ID: id,
			X:  p.X,
			Y:  p.Y,
		})
	}
	return snapshot
}
