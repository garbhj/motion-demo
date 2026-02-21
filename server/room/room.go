package room

type Room struct {
	inbox chan Msg
}
type Msg string

func (r *Room) Run() {
	//stubbed for now
}
