package game

import (
	"math"
	"math/rand"
)

// SpawnPoint returns a randomized in-bounds position, margined off the
// walls and clear of all obstacles, so a spawned/respawned player never
// starts tick one shoved out of a wall. Used for both initial join and
// post-death respawn.
func SpawnPoint() (x, y float64) {
	for i := 0; i < SpawnMaxAttempts; i++ {
		x = SpawnMargin + rand.Float64()*(MapWidth-2*SpawnMargin)
		y = SpawnMargin + rand.Float64()*(MapHeight-2*SpawnMargin)
		if !hitsAnyObstacle(x, y, PlayerRadius) {
			return x, y
		}
	}
	return x, y // pathological fallback: last sample, same as pre-fix behavior
}

// NewOrb constructs a fresh orbiting orb for the given player at angle 0.
// Used by both Join and respawn so the orbit-angle math isn't duplicated.
func NewOrb(playerID string, p *Player) *Orb {
	angle := 0.0
	return &Orb{
		ID:      playerID + "_o",
		OwnerID: playerID,
		X:       p.X + math.Cos(angle)*OrbOrbitRadius,
		Y:       p.Y + math.Sin(angle)*OrbOrbitRadius,
		Angle:   angle,
		Size:    OrbBaseSize,
		Mode:    OrbOrbit,
	}
}
