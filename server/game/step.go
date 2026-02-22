package game

import "math"

func Step(s *State, inputs map[string]Input) {
	s.Tick++

	for id, p := range s.Players {
		inp, ok := inputs[id]
		if !ok {
			inp = Input{}
		}

		ax := inp.Ax
		ay := inp.Ay
		mag := math.Hypot(ax, ay)
		if mag > Deadzone {
			nx := ax / mag
			ny := ay / mag
			accel := AccelPerTick
			if inp.Boost {
				accel *= BoostMult
			}
			p.VX += nx * accel
			p.VY += ny * accel
		}

		p.VX /= DampingDiv
		p.VY /= DampingDiv

		speed := math.Hypot(p.VX, p.VY)
		if speed > MaxSpeed {
			scale := MaxSpeed / speed
			p.VX *= scale
			p.VY *= scale
		}

		p.X += p.VX
		p.Y += p.VY
	}
}
