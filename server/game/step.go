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

		p.VX /= PlayerDampingDiv
		p.VY /= PlayerDampingDiv

		speed := math.Hypot(p.VX, p.VY)
		if speed > MaxSpeed {
			scale := MaxSpeed / speed
			p.VX *= scale
			p.VY *= scale
		}

		p.X += p.VX
		p.Y += p.VY
	}

	// Flail tick: update angle + integrate with damping
	for ownerID, flail := range s.Flails {
		player, ok := s.Players[ownerID]
		if !ok || flail == nil || player == nil {
			continue
		}
		dx := flail.X - player.X
		dy := flail.Y - player.Y
		flail.A = math.Atan2(dy, dx)

		flail.VX /= RopeDampingDiv
		flail.VY /= RopeDampingDiv

		flail.X += flail.VX
		flail.Y += flail.VY
	}

	// Rope impulses + integrate internal nodes
	for ownerID, rope := range s.Ropes {
		if rope == nil || len(rope.Nodes) == 0 {
			continue
		}
		player, okPlayer := s.Players[ownerID]
		flail, okFlail := s.Flails[ownerID]
		if !okPlayer || !okFlail || player == nil || flail == nil {
			continue
		}

		// Build chain: player endpoint -> internal nodes -> flail endpoint
		chain := make([]ropeBody, 0, len(rope.Nodes)+2)
		chain = append(chain, playerBody{X: player.X, Y: player.Y})
		for _, n := range rope.Nodes {
			chain = append(chain, n)
		}
		chain = append(chain, flail)

		// Apply impulses along adjacent pairs (player not affected)
		for i := 0; i < len(chain)-1; i++ {
			b := chain[i]
			a := chain[i+1]
			bAffected := false
			aAffected := true
			if i > 0 {
				bAffected = true
			}
			if i == len(chain)-2 {
				if f, ok := a.(*Flail); ok {
					aAffected = f.IsAffectedByRope
				}
			}
			applyRopePair(b, bAffected, a, aAffected, rope.RestLength, rope.K)
		}

		// integrate internal nodes only
		for _, n := range rope.Nodes {
			n.VX /= RopeDampingDiv
			n.VY /= RopeDampingDiv
			n.X += n.VX
			n.Y += n.VY
		}
	}
}

type ropeBody interface {
	Pos() (float64, float64)
	Vel() (float64, float64)
	SetVel(vx, vy float64)
}

type playerBody struct {
	X, Y float64
}

func (p playerBody) Pos() (float64, float64) { return p.X, p.Y }
func (p playerBody) Vel() (float64, float64) { return 0, 0 }
func (p playerBody) SetVel(vx, vy float64)   {}

func (c *ChainSegment) Pos() (float64, float64) { return c.X, c.Y }
func (c *ChainSegment) Vel() (float64, float64) { return c.VX, c.VY }
func (c *ChainSegment) SetVel(vx, vy float64)   { c.VX, c.VY = vx, vy }

func (f *Flail) Pos() (float64, float64) { return f.X, f.Y }
func (f *Flail) Vel() (float64, float64) { return f.VX, f.VY }
func (f *Flail) SetVel(vx, vy float64)   { f.VX, f.VY = vx, vy }

func applyRopePair(b ropeBody, bAffected bool, a ropeBody, aAffected bool, restLen, k float64) {
	bx, by := b.Pos()
	ax, ay := a.Pos()
	dx := ax - bx
	dy := ay - by
	dist := math.Hypot(dx, dy)
	if dist == 0 {
		return
	}
	ext := dist - restLen
	nx := dx / dist
	ny := dy / dist
	fx := -k * ext * nx
	fy := -k * ext * ny

	if bAffected {
		bvx, bvy := b.Vel()
		b.SetVel(bvx-fx, bvy-fy)
	}
	if aAffected {
		avx, avy := a.Vel()
		a.SetVel(avx+fx, avy+fy)
	}
}
