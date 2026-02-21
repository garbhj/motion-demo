package protocol

import (
	"encoding/json"
)

const MsgHello = "Hello!"

type Envelope struct {
	T string          `json:"t"`
	P json.RawMessage `json:"p"` // raw payload bytes
}
