package network

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"motion/config"
	"motion/game"
	"motion/protocol"
	"motion/room"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type WSConn struct {
	c  *websocket.Conn
	mu sync.Mutex
}

func (w *WSConn) Send(b []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.c.WriteMessage(websocket.TextMessage, b)
}

func (w *WSConn) Close() error {
	return w.c.Close()
}

var manager *room.Manager

func wsHandler(w http.ResponseWriter, r *http.Request) {
	roomCode := r.URL.Query().Get("room")
	if roomCode == "" {
		log.Printf("ws: 400 missing room code (path=%q, query=%q)", r.URL.Path, r.URL.RawQuery)
		http.Error(w, "missing room code", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}
	defer conn.Close()

	gameRoom := manager.GetOrCreateRoom(roomCode)
	if gameRoom == nil {
		return
	}

	ws := &WSConn{c: conn}
	var playerID string
	joined := false

	// Msg loop per connection
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("read:", err)
			if joined {
				gameRoom.Inbox <- room.Leave{PlayerID: playerID}
			}
			return
		}

		// 1) Decode envelope (this creates env)
		env, err := protocol.DecodeEnvelope(msg)
		if err != nil {
			log.Printf("bad envelope: %v", err)
			continue
		}

		// 2) Switch on message type
		switch env.T {

		case protocol.MsgHello:
			hello, err := protocol.DecodePayload[protocol.Hello](env)
			if err != nil {
				log.Printf("bad hello payload: %v", err)
				continue
			}
			if joined {
				continue
			}

			reply := make(chan room.JoinResult, 1)
			gameRoom.Inbox <- room.Join{Conn: ws, Name: hello.Name, Reply: reply}
			res := <-reply
			playerID = res.PlayerID
			joined = true

			b, err := protocol.Encode(protocol.MsgWelcome, protocol.Welcome{
				PlayerID: playerID,
				TickHz:   protocol.SimTickHz,
			})
			if err != nil {
				log.Printf("encode welcome: %v", err)
				continue
			}
			if err := ws.Send(b); err != nil {
				log.Printf("write welcome: %v", err)
				return
			}

		case protocol.MsgInput:
			if !joined {
				continue
			}
			inp, err := protocol.DecodePayload[protocol.Input](env)
			if err != nil {
				log.Printf("bad input payload: %v", err)
				continue
			}
			cmd := room.Input{
				PlayerID: playerID,
				Input: game.Input{
					Ax:    float64(inp.Ax),
					Ay:    float64(inp.Ay),
					Boost: inp.Boost,
					Shoot: inp.Shoot,
				},
			}
			select {
			case gameRoom.Inbox <- cmd:
			default:
			}

		default:
			log.Printf("unknown message type: %q", env.T)
		}
	}

}

func listRoomsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	rooms := manager.ListRooms()
	_ = json.NewEncoder(w).Encode(rooms)
}

func createRoomHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	code := manager.CreateRoom()
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
}

func Start() {
	config.InitConfig()
	addr, err := config.GetEnvVariable("NETWORK_ADDR")
	if err != nil {
		log.Fatal(err)
	}
	manager = room.NewManager()
	http.HandleFunc("/ws", wsHandler)
	http.HandleFunc("/rooms", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, ngrok-skip-browser-warning")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		switch r.Method {
		case http.MethodGet:
			listRoomsHandler(w, r)
		case http.MethodPost:
			createRoomHandler(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	log.Printf("listening on %s (ws: /ws, api: /rooms)", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
