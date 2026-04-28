package protocol

import (
	"encoding/json"
)

const (
	MsgHello   = "hello"
	MsgInput   = "input"
	MsgWelcome = "welcome"
	MsgState   = "state"
)

const (
	SimTickHz     = 40
	ClientInputHz = 40
	BroadcastHz   = 20
)

type Envelope struct {
	T string          `json:"t"`
	P json.RawMessage `json:"p"` // raw payload bytes
}
