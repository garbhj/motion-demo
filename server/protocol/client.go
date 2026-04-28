package protocol

import ()

//input structs coming in from the client.

type Hello struct {
	V    int    `json:"v"`              // version
	Name string `json:"name,omitempty"` // optional name
}

type Input struct {
	Ax    float32 `json:"ax"`               // -1..1 movement X
	Ay    float32 `json:"ay"`               // -1..1 movement Y
	Boost bool    `json:"boost,omitempty"`  // sprint (pinch)
	Shoot bool    `json:"shoot,omitempty"`  // orb fire edge (fist)
}
