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

		// Keep player inside map bounds
		if p.X < PlayerRadius {
			p.X = PlayerRadius
			p.VX = 0
		}
		if p.X > MapWidth-PlayerRadius {
			p.X = MapWidth - PlayerRadius
			p.VX = 0
		}
		if p.Y < PlayerRadius {
			p.Y = PlayerRadius
			p.VY = 0
		}
		if p.Y > MapHeight-PlayerRadius {
			p.Y = MapHeight - PlayerRadius
			p.VY = 0
		}
	}

	// Orb tick: check for orb hitting other players (elimination)
	var toEliminate []string
	for ownerID, orb := range s.Orbs {
		if orb.Mode != OrbShot {
			continue
		}
		_, ownerOk := s.Players[ownerID]
		if !ownerOk {
			continue
		}
		for otherID, other := range s.Players {
			if otherID == ownerID {
				continue
			}
			dx := orb.X - other.X
			dy := orb.Y - other.Y
			dist := math.Hypot(dx, dy)
			if dist < PlayerRadius+OrbHitRadius {
				toEliminate = append(toEliminate, otherID)
			}
		}
	}
	for _, id := range toEliminate {
		if p, ok := s.Players[id]; ok {
			s.Eliminated = append(s.Eliminated, EliminatedEntry{ID: id, Name: p.Name})
		}
		delete(s.Players, id)
		delete(s.Orbs, id)
	}

	// Orb tick
	for ownerID, orb := range s.Orbs {
		player, ok := s.Players[ownerID]
		if !ok || orb == nil || player == nil {
			continue
		}

		inp, okInp := inputs[ownerID]
		if !okInp {
			inp = Input{}
		}
		shootPressed := inpIsShootPressed(player, inp)

		switch orb.Mode {
		case OrbOrbit:
			orb.Angle += OrbAngularSpeedPerTick
			orb.X = player.X + math.Cos(orb.Angle)*OrbOrbitRadius
			orb.Y = player.Y + math.Sin(orb.Angle)*OrbOrbitRadius
			orb.VX = 0
			orb.VY = 0

			if orb.CooldownTicks > 0 {
				orb.CooldownTicks--
			}
			if shootPressed && orb.CooldownTicks == 0 {
				// Shoot in the direction the orb was orbiting (tangent), like releasing from a sling
				tangentX := -math.Sin(orb.Angle)
				tangentY := math.Cos(orb.Angle)
				orb.VX = tangentX * OrbShotSpeed
				orb.VY = tangentY * OrbShotSpeed
				orb.Mode = OrbShot
				orb.ShotTicksLeft = OrbShotDurationTicks
				orb.CooldownTicks = OrbCooldownTicks
			}

		case OrbShot:
			orb.VX /= OrbDampingDiv
			orb.VY /= OrbDampingDiv
			orb.X += orb.VX
			orb.Y += orb.VY
			orb.ShotTicksLeft--

			dx := orb.X - player.X
			dy := orb.Y - player.Y
			dist := math.Hypot(dx, dy)
			if orb.ShotTicksLeft <= 0 || dist > OrbMaxShotDistance {
				orb.Mode = OrbReturn
			}

		case OrbReturn:
			// Keep orbit angle advancing so when we snap back we're in sync
			orb.Angle += OrbAngularSpeedPerTick
			orbitX := player.X + math.Cos(orb.Angle)*OrbOrbitRadius
			orbitY := player.Y + math.Sin(orb.Angle)*OrbOrbitRadius

			// Pull orb straight back to orbit circle (fixed radius), no wire
			orb.X += (orbitX - orb.X) * 0.18
			orb.Y += (orbitY - orb.Y) * 0.18

			dist := math.Hypot(orb.X-player.X, orb.Y-player.Y)
			if math.Abs(dist-OrbOrbitRadius) < OrbReturnSnapDist {
				orb.Mode = OrbOrbit
				orb.X = orbitX
				orb.Y = orbitY
				orb.VX = 0
				orb.VY = 0
			}
			if orb.CooldownTicks > 0 {
				orb.CooldownTicks--
			}
		}
	}
}

func inpIsShootPressed(p *Player, inp Input) bool {
	shootPressed := inp.Shoot && !p.PrevPinch
	p.PrevPinch = inp.Shoot
	return shootPressed
}
