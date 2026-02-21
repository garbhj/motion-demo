package protocol

import (
	"encoding/json"
)

const (
	MsgHello   = "hello"
	MsgInput   = "input"
	MsgWelcome = "Welcome"
	MsgState   = "state"
)

type Envelope struct {
	T string          `json:"t"`
	P json.RawMessage `json:"p"` // raw payload bytes
}
