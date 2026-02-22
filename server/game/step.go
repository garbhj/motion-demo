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

		sprinting := inp.Boost && p.Stamina > 0
		maxSpeed := MaxSpeedNormal
		if sprinting {
			maxSpeed = MaxSpeedSprint
			p.Stamina -= StaminaDepletePerTick
			if p.Stamina < 0 {
				p.Stamina = 0
			}
		} else {
			p.Stamina += StaminaRegenPerTick
			if p.Stamina > StaminaMax {
				p.Stamina = StaminaMax
			}
		}

		if mag > Deadzone {
			nx := ax / mag
			ny := ay / mag
			accel := AccelPerTick
			if sprinting {
				accel *= BoostMult
			}
			p.VX += nx * accel
			p.VY += ny * accel
		}

		p.VX /= PlayerDampingDiv
		p.VY /= PlayerDampingDiv

		speed := math.Hypot(p.VX, p.VY)
		if speed > maxSpeed {
			scale := maxSpeed / speed
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
		// Passive: points for staying alive in the lobby
		p.Score += PointsPerTickAlive
	}

	// Orb tick: check for orb hitting other players (elimination)
	type kill struct{ victimID, killerID string }
	var kills []kill
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
				kills = append(kills, kill{victimID: otherID, killerID: ownerID})
			}
		}
	}
	for _, k := range kills {
		victim, vOk := s.Players[k.victimID]
		killer, kOk := s.Players[k.killerID]
		if vOk {
			s.Eliminated = append(s.Eliminated, EliminatedEntry{ID: k.victimID, Name: victim.Name, Score: victim.Score})
		}
		if kOk && killer != nil && vOk {
			// Active: base kill reward. Very active: bonus from victim's score
			killer.Score += PointsPerKill + victim.Score*PointsStealFraction
		}
		delete(s.Players, k.victimID)
		delete(s.Orbs, k.victimID)
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
			// Don't damp on the first tick so launch feels instant and smooth
			if orb.ShotTicksLeft < OrbShotDurationTicks {
				orb.VX /= OrbDampingDiv
				orb.VY /= OrbDampingDiv
			}
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
			orb.Angle += OrbAngularSpeedPerTick
			orbitX := player.X + math.Cos(orb.Angle)*OrbOrbitRadius
			orbitY := player.Y + math.Sin(orb.Angle)*OrbOrbitRadius

			// Move toward orbit point at constant speed for smooth fly-back
			toX := orbitX - orb.X
			toY := orbitY - orb.Y
			distToTarget := math.Hypot(toX, toY)
			if distToTarget > 0.1 {
				move := OrbReturnMaxSpeed
				if distToTarget < move {
					move = distToTarget
				}
				orb.X += toX / distToTarget * move
				orb.Y += toY / distToTarget * move
			}

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
