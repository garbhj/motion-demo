package protocol

import ()

//input structs coming in from the client.

type Hello struct {
	V    int    `json:"v"`
	Name string `json:"name,omitempty"`
}

type Input struct {
	Ax    float32 `json:"ax"` // -1..1
	Ay    float32 `json:"ay"` // -1..1
	Boost bool    `json:"boost,omitempty"`
}
