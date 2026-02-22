package game

const (
	MapWidth               = 2000.0
	MapHeight              = 2000.0
	PlayerRadius           = 25.0
	OrbHitRadius           = 22.0
	Deadzone               = 0.08
	AccelPerTick           = 0.7   // base (normal) acceleration
	BoostMult              = 2.5   // sprint = this × base
	PlayerDampingDiv       = 1.1
	MaxSpeedNormal         = 9.0   // cap when not sprinting
	MaxSpeedSprint         = 22.0  // fast enough to dodge orb strikes
	StaminaMax             = 100.0
	StaminaDepletePerTick  = 2.5   // per tick while sprinting
	StaminaRegenPerTick    = 1.2   // per tick when not sprinting
	PointsPerTickAlive     = 0.05  // passive: points per tick while in lobby
	PointsPerKill          = 10.0  // active: base points for any kill
	PointsStealFraction    = 0.4   // very active: fraction of victim's score added to killer
	OrbOrbitRadius         = 120.0
	OrbAngularSpeedPerTick = 0.05  // slower orbit
	OrbBaseSize            = 1.0
	OrbShotSpeed           = 28.0 // goes out a decent amount to attack
	OrbShotDurationTicks   = 24
	OrbMaxShotDistance     = 450.0
	OrbReturnAccel         = 2.2
	OrbReturnMaxSpeed      = 18.0  // smooth fly-back speed
	OrbReturnSnapDist      = 20.0  // snap when close so return→orbit transition is smooth
	OrbDampingDiv          = 1.025 // gentler so shot trail feels smoother
	OrbCooldownTicks       = 20
)
