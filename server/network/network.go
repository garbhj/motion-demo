package network

import (
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

var globalRoom *room.Room

func wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}
	defer conn.Close()

	if globalRoom == nil {
		log.Println("room not initialized")
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
				globalRoom.Inbox <- room.Leave{PlayerID: playerID}
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
			globalRoom.Inbox <- room.Join{Conn: ws, Name: hello.Name, Reply: reply}
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
				},
			}
			select {
			case globalRoom.Inbox <- cmd:
			default:
			}

		default:
			log.Printf("unknown message type: %q", env.T)
		}
	}

}

func Start() {
	config.InitConfig()
	addr, err := config.GetEnvVariable("NETWORK_ADDR")
	if err != nil {
		log.Fatal(err)
	}
	globalRoom = room.New()
	go globalRoom.Run()
	http.HandleFunc("/ws", wsHandler)
	log.Printf("listening on %s (ws endpoint: /ws)", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
