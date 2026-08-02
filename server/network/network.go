package network

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
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

func (w *WSConn) SendBinary(b []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.c.WriteMessage(websocket.BinaryMessage, b)
}

func (w *WSConn) Close() error {
	return w.c.Close()
}

var manager *room.Manager

// sendError encodes and sends a MsgError envelope. WebSocket handshakes
// can't carry a failure body to the browser, so errors after upgrade are
// sent as a real protocol message instead.
func sendError(ws *WSConn, code, message string) {
	b, err := protocol.Encode(protocol.MsgError, protocol.Error{Code: code, Message: message})
	if err != nil {
		return
	}
	_ = ws.Send(b)
}

// joinRoom sends a Join command to gameRoom and waits for the reply.
func joinRoom(gameRoom *room.Room, ws *WSConn, name string) (room.JoinResult, error) {
	reply := make(chan room.JoinResult, 1)
	gameRoom.Inbox <- room.Join{Conn: ws, Name: name, Reply: reply}
	res := <-reply
	if res.Full {
		return res, fmt.Errorf("room full")
	}
	return res, nil
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	roomParam := r.URL.Query().Get("room")
	isPublic := roomParam == "" || roomParam == "auto"

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}
	defer conn.Close()

	if tcpConn, ok := conn.NetConn().(*net.TCPConn); ok {
		_ = tcpConn.SetNoDelay(true)
	}

	ws := &WSConn{c: conn}

	var gameRoom *room.Room
	if isPublic {
		gameRoom = manager.FindOrCreatePublicRoom()
	} else {
		var ok bool
		gameRoom, ok = manager.GetRoom(roomParam)
		if !ok {
			sendError(ws, "room_not_found", "That room code doesn't exist or has ended.")
			return
		}
	}

	var playerID string
	joined := false

	// Msg loop per connection
	for {
		messageType, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("read:", err)
			if joined {
				gameRoom.Inbox <- room.Leave{PlayerID: playerID}
			}
			return
		}

		if messageType == websocket.BinaryMessage {
			if !joined || len(msg) == 0 || msg[0] != protocol.BinMsgInput {
				continue
			}
			inp, err := protocol.DecodeInputBinary(msg)
			if err != nil {
				log.Printf("bad binary input: %v", err)
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
			continue
		}

		// Text path: JSON control messages (hello only — input moved to binary)
		env, err := protocol.DecodeEnvelope(msg)
		if err != nil {
			log.Printf("bad envelope: %v", err)
			continue
		}

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

			res, joinErr := joinRoom(gameRoom, ws, hello.Name)
			if joinErr != nil && isPublic {
				for attempt := 0; attempt < 3 && joinErr != nil; attempt++ {
					gameRoom = manager.FindOrCreatePublicRoom()
					res, joinErr = joinRoom(gameRoom, ws, hello.Name)
				}
			}
			if joinErr != nil {
				msg := "That room is full."
				if isPublic {
					msg = "Couldn't find an open arena, please try again."
				}
				sendError(ws, "room_full", msg)
				return
			}
			playerID = res.PlayerID
			joined = true

			obstacleSnapshots := make([]protocol.ObstacleSnapshot, 0, len(game.Obstacles))
			for _, o := range game.Obstacles {
				obstacleSnapshots = append(obstacleSnapshots, protocol.ObstacleSnapshot{
					X: o.X, Y: o.Y, Width: o.Width, Height: o.Height,
				})
			}

			b, err := protocol.Encode(protocol.MsgWelcome, protocol.Welcome{
				PlayerID:  playerID,
				TickHz:    protocol.SimTickHz,
				RoomCode:  gameRoom.Code,
				Obstacles: obstacleSnapshots,
			})
			if err != nil {
				log.Printf("encode welcome: %v", err)
				continue
			}
			if err := ws.Send(b); err != nil {
				log.Printf("write welcome: %v", err)
				return
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
