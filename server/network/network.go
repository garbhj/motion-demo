package network

import (
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"motion/config"

	"motion/protocol"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}
	defer conn.Close()

	// Msg loop per connection
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("read:", err)
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
			log.Printf("hello: v=%d name=%q", hello.V, hello.Name)

			// respond with welcome
			b, err := protocol.Encode(protocol.MsgWelcome, protocol.Welcome{
				PlayerID: "p1",
				TickHz:   20,
			})
			if err != nil {
				log.Printf("encode welcome: %v", err)
				continue
			}
			if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
				log.Printf("write welcome: %v", err)
				return
			}

		case protocol.MsgInput:
			inp, err := protocol.DecodePayload[protocol.Input](env)
			if err != nil {
				log.Printf("bad input payload: %v", err)
				continue
			}
			log.Printf("input: ax=%.2f ay=%.2f boost=%v", inp.Ax, inp.Ay, inp.Boost)

		default:
			log.Printf("unknown message type: %q", env.T)
		}
	}

}

func Start() {
	http.HandleFunc("/ws", wsHandler)
	log.Println("listening on :8080 (ws endpoint: /ws)")

	config.InitConfig()
	addr, err := config.GetEnvVariable("NETWORK_ADDR")
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.ListenAndServe(addr, nil))
}
