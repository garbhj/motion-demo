# brutal-private Math Extraction Guide

This document reverse-engineers the math/physics in this repo so you can reproduce the same feel in a brutal.io-style clone.

## 1) Simulation cadence and update order

- Server tick rate: `40 Hz` (`Game.js:14`) so `dt = 1/40 = 0.025s` nominal.
- Per tick for each player (`Player.js:77-85`):
  1. `sendUpdate(player)` (if ping handshake complete)
  2. `physics(player)` (player movement integration)
  3. `flail.tick()`
  4. rope endpoints assignment:
     - `rope.segments[0] = player`
     - `rope.segments[last] = flail`
  5. `rope.tick()` (spring forces + chain integration)

Important consequence: state sent to client is from the previous tick, because send happens before integration.

## 2) Coordinate system and units

Internal world:
- Uses floating-point world units.
- Map size config: `8500` (`Game.js:11`).

Network/client packet space:
- Most positions are sent as `world / 10` (`sendUpdate.js:28-41`, `clientbound/mapSize.js:7-8`).
- Some incoming dimensions are decoded as `u16 * 10` (`serverbound/init.js:2-3`, `serverbound/resize.js:2-3`).

Practical interpretation:
- Internal sim runs at 10x the scale of what the client protocol often transmits.

## 3) Vector math primitives

Defined in `Vector.js`.

Core ops:
- Addition: `(x1+x2, y1+y2)`
- Subtraction: `(x1-x2, y1-y2)`
- Scalar multiply: `(x*s, y*s)`
- Magnitude: `sqrt(x^2 + y^2)`
- Direction angle: `atan2(y, x)`
- Unit vector: `(x/mag, y/mag)`, with `|| 0` fallback if mag is zero.
- Move by angle: `p + (d*cos(a), d*sin(a))`

Notes:
- `divideByVector` is buggy (`new Vector(this.x / vector.x, this.y, vector.y)`) and appears unused.

## 4) Player movement math (`physics.js`)

Per tick:
1. Build force direction from input angle:
   - `force = unit( movePointByAngle(100, angle) from origin )`
   - Since this is normalized, the magnitude is effectively `1`.
2. If moving flag is true:
   - `velocity = velocity + force`
3. Apply drag:
   - `velocity = velocity * (1/1.1)`
4. Integrate position:
   - `position = position + velocity`

Equivalent discrete equation when moving:
- `v_{t+1} = (v_t + u(angle_t)) / 1.1`
- `p_{t+1} = p_t + v_{t+1}`

When not moving:
- `v_{t+1} = v_t / 1.1`
- `p_{t+1} = p_t + v_{t+1}`

Steady-state speed (constant heading, always moving):
- Solve `v = (v + u)/1.1` => `0.1v = u` => `|v| = 10` world units/tick.
- At 40 Hz this is about `400 world units/s`.

## 5) Flail math (`Flail.js`)

State:
- `position`, `velocity`, `angle`, `size`.
- `isAffectedByRope = true`.

Per tick:
1. `ownerDelta = flail.position - owner.position`
2. `flail.angle = atan2(ownerDelta.y, ownerDelta.x)`
3. Apply drag: `velocity *= 1/1.1`
4. Integrate: `position += velocity`

No direct motor/torque is applied to flail; it is moved by rope spring impulses plus inertial carry.

Initialization quirk:
- `this.flail = new Flail(this, this.position)` (`Player.js:19`) passes the same `Vector` instance as player position initially.
- So player and flail start co-located; rope dynamics separate them as impulses accumulate.

## 6) Rope math (`Rope.js`)

Construction:
- `new Rope(segmentCount=3, restLength=80)` in `Player.js:20`.
- Creates `segmentCount` chain segment objects.
- Each tick endpoints are replaced by player and flail, so with `3` segments effective topology is:
  - index 0: Player
  - index 1: one internal ChainSegment
  - index 2: Flail

Spring parameters:
- `k = 0.1`
- `restLength = 80`

For each adjacent pair `(b = segments[i-1], a = segments[i])`:
1. `delta = a.position - b.position`
2. Extension only:
   - `x = max(0, |delta| - restLength)`
   - This is a unilateral spring (no compression force).
3. Directional spring force on `a`:
   - `F = unit(delta) * (-k * x)`
4. Apply if rope-affected:
   - `a.velocity += F` (if `a.isAffectedByRope`)
   - `b.velocity -= F` (if `b.isAffectedByRope`)

After pairwise impulses, only internal `ChainSegment` instances are integrated (`segment.tick()`), not player/flail in this stage.

Why this matters:
- Player has `isAffectedByRope = false` (`Player.js:25`) so rope cannot pull player.
- Flail and internal link are rope-affected, so the rope mostly constrains and drags the flail side, not the player body.

## 7) Chain segment math (`ChainSegment.js`)

Per tick:
- `velocity *= 1/1.1`
- `position += velocity`

Same damping/integration style as player and flail.

## 8) Angle conventions and protocol transforms

Input decode (`coder/serverbound/input.js`):
- `angle_internal = angle_from_packet - PI/2`

Entity update encode (`sendUpdate.js`):
- sends `entity.input.angle - PI/2` for player angle.

Interpretation:
- There is a `-PI/2` axis shift in both ingest and emit paths.
- Depending on client conventions, this may be compensating for sprite-forward direction and coordinate orientation.
- If cloning behavior exactly, keep this shift in both directions.

Flail angle sent as-is:
- `writer.f32(entity.flail.angle)` without extra offset.

## 9) Damping model and stability

Global damping form across dynamic objects:
- `v <- v / 1.1` each tick.

At 40 Hz, this is equivalent to exponential decay with per-second factor:
- `(1/1.1)^40 ~= 0.022`

So without input/rope impulses, velocities decay very quickly.

## 10) Reproduction pseudocode (behaviorally equivalent)

```js
for each tick:
  for each player:
    // 1) movement
    u = normalize([cos(inputAngle), sin(inputAngle)])
    if moving:
      player.v += u
    player.v /= 1.1
    player.p += player.v

    // 2) flail free integration
    flail.angle = atan2(flail.p.y - player.p.y, flail.p.x - player.p.x)
    flail.v /= 1.1
    flail.p += flail.v

    // 3) rope topology
    rope[0] = player
    rope[last] = flail

    // 4) rope impulses (adjacent pairs)
    for i in 1..last:
      a = rope[i]
      b = rope[i-1]
      d = a.p - b.p
      x = max(0, length(d) - restLength)
      F = normalize(d) * (-k * x)
      if a.affected: a.v += F
      if b.affected: b.v -= F

    // 5) integrate internal rope nodes only
    for each node in rope:
      if node is ChainSegment:
        node.v /= 1.1
        node.p += node.v
```

## 11) Constants to preserve for same feel

- Tick rate: `40`
- Player acceleration per moving tick: effectively `+1` unit vector
- Drag divisor: `1.1`
- Rope `k`: `0.1`
- Rope rest length: `80`
- Rope segment count in player ctor: `3` (=> 1 internal node)
- Flail size default: `1000` (visual/gameplay metadata)

## 12) Behavioral quirks you should decide to keep or change

If your goal is exact clone feel, keep these; if your goal is cleaner physics, fix them.

- Rope cannot pull player (`player.isAffectedByRope = false`).
- Spring is extension-only (`max(0, dist-rest)`), so links can go slack with no compression reaction.
- Player/flail are not integrated inside `rope.tick()`, only in their own earlier ticks.
- Send-before-sim order introduces one-tick stale snapshots.
- Initial flail position shares same `Vector` object as player at spawn.
- `Vector.divideByVector` is malformed but unused.

## 13) Minimal formula summary

- Movement direction: `u(a) = normalize([cos(a), sin(a)])`
- Player integration:
  - `v <- (v + moving*u(a)) / 1.1`
  - `p <- p + v`
- Rope force (pair):
  - `d = a.p - b.p`
  - `x = max(0, |d|-L)`
  - `F = -k*x*normalize(d)`
  - `a.v += F`, `b.v -= F` (if allowed)
- Flail angle: `atan2(flail.y-player.y, flail.x-player.x)`

---

This is the full math used by the repo as written today.
