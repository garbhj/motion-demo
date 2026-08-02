package game

import "math"

// Obstacle is a static, axis-aligned rectangular wall in the arena.
// Occupies [X, X+Width] x [Y, Y+Height].
type Obstacle struct {
	X, Y, Width, Height float64
}

// Obstacles is the single source of truth for arena walls, sent to clients
// once via Welcome. Both rectangles are >100px from every map edge, well
// clear of PlayerRadius=25, so they can never be pinned against the map
// boundary.
var Obstacles = []Obstacle{
	{X: 500, Y: 500, Width: 200, Height: 100},
	{X: 1200, Y: 1500, Width: 300, Height: 300},
}

func closestPointOnObstacle(x, y float64, o Obstacle) (cx, cy float64) {
	return clampF(x, o.X, o.X+o.Width), clampF(y, o.Y, o.Y+o.Height)
}

func clampF(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func distSqToObstacle(x, y float64, o Obstacle) float64 {
	cx, cy := closestPointOnObstacle(x, y, o)
	dx, dy := x-cx, y-cy
	return dx*dx + dy*dy
}

// hitsAnyObstacle reports whether a circle of radius r at (x,y) overlaps
// any obstacle. Shared by shot-orb wall collision and spawn safety — both
// are the same question ("would this position collide?") with a different
// collider radius.
func hitsAnyObstacle(x, y, r float64) bool {
	for _, o := range Obstacles {
		if distSqToObstacle(x, y, o) <= r*r {
			return true
		}
	}
	return false
}

// resolvePlayerObstacleCollision pushes p fully outside any obstacle it
// currently overlaps and zeroes the velocity component driving it further
// into the wall — same "clamp position + zero velocity" style as the
// existing map-edge clamp in Step(), generalized to an arbitrary push
// direction (axis-aligned at a flat wall, diagonal at a corner).
func resolvePlayerObstacleCollision(p *Player) {
	for _, o := range Obstacles {
		resolveOneObstacle(p, o)
	}
}

func resolveOneObstacle(p *Player, o Obstacle) {
	cx, cy := closestPointOnObstacle(p.X, p.Y, o)
	dx, dy := p.X-cx, p.Y-cy
	distSq := dx*dx + dy*dy
	if distSq > PlayerRadius*PlayerRadius {
		return
	}

	const epsilon = 1e-9
	if distSq > epsilon {
		dist := math.Sqrt(distSq)
		nx, ny := dx/dist, dy/dist
		penetration := PlayerRadius - dist
		p.X += nx * penetration
		p.Y += ny * penetration
		// Zero only the into-wall velocity component; preserve tangential
		// slide, same idea as the map-edge clamp but generalized to a
		// diagonal (corner) normal.
		if vn := p.VX*nx + p.VY*ny; vn < 0 {
			p.VX -= vn * nx
			p.VY -= vn * ny
		}
		return
	}

	// Degenerate: center exactly inside the rect, no closest-point vector
	// to push along. Push out along the axis of minimum penetration
	// (nearest edge), same "pick one axis" idea as the map-edge clamp.
	distLeft := p.X - o.X
	distRight := (o.X + o.Width) - p.X
	distTop := p.Y - o.Y
	distBottom := (o.Y + o.Height) - p.Y
	minDist, side := distLeft, 0
	if distRight < minDist {
		minDist, side = distRight, 1
	}
	if distTop < minDist {
		minDist, side = distTop, 2
	}
	if distBottom < minDist {
		side = 3
	}
	switch side {
	case 0:
		p.X = o.X - PlayerRadius
		if p.VX > 0 {
			p.VX = 0
		}
	case 1:
		p.X = o.X + o.Width + PlayerRadius
		if p.VX < 0 {
			p.VX = 0
		}
	case 2:
		p.Y = o.Y - PlayerRadius
		if p.VY > 0 {
			p.VY = 0
		}
	case 3:
		p.Y = o.Y + o.Height + PlayerRadius
		if p.VY < 0 {
			p.VY = 0
		}
	}
}
