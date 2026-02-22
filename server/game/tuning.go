package game

const (
	MapWidth               = 2000.0
	MapHeight              = 2000.0
	PlayerRadius           = 25.0
	OrbHitRadius           = 22.0
	Deadzone               = 0.08
	AccelPerTick           = 1.0
	BoostMult              = 2.5
	PlayerDampingDiv       = 1.1
	MaxSpeed               = 12.0
	OrbOrbitRadius         = 120.0
	OrbAngularSpeedPerTick = 0.05  // slower orbit
	OrbBaseSize            = 1.0
	OrbShotSpeed           = 28.0 // goes out a decent amount to attack
	OrbShotDurationTicks   = 24
	OrbMaxShotDistance     = 450.0
	OrbReturnAccel         = 2.2
	OrbReturnMaxSpeed      = 26.0
	OrbReturnSnapDist      = 14.0
	OrbDampingDiv          = 1.03
	OrbCooldownTicks       = 20
)
