package protocol

import (
	"encoding/json"
	"fmt"
)

func Encode(t string, payload any) ([]byte, error) {
	if t == "" {
		return nil, fmt.Errorf("trying to encode envelope type nil")
	}
	if payload == nil {
		return nil, fmt.Errorf("trying to encode nil payload")
	}
	pb, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	var e = Envelope{t, pb}

	return json.Marshal(e)

}

func DecodeEnvelope(b []byte) (Envelope, error) {
	/*
		Lol linter recommended demorgans law here. I think I had
		something like if !(len(b) > 0)
		WOW, can you not tell im tired writing this stufff............
	*/
	if len(b) == 0 {
		return Envelope{}, fmt.Errorf("Error trying to decode Envelope with byte size 0")
	}
	var e Envelope
	err := json.Unmarshal(b, &e)
	if err != nil {
		return Envelope{}, err
	}
	return e, nil
}

func DecodePayload[T any](env Envelope) (T, error) {
	// ahhh generics I see.
	// Creates zero value of wahtever type T is. say T is input then out is  Input{}
	var out T
	if len(env.P) == 0 {
		return out, fmt.Errorf("empty payload for type %q", env.T)
	}
	err := json.Unmarshal(env.P, &out)
	return out, err

}
