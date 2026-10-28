export type GamePhase = "READY" | "FLYING" | "CHUTE" | "CARNAGE";

export interface CanyonSlice {
  /** World Z coordinate along the canyon */
  z: number;
  /** Distance ahead of the camera (z - playerZ) */
  relZ: number;
  /** Center X of the canyon gorge at this Z */
  centerX: number;
  /** Half-width at the canyon floor */
  floorHalfWidth: number;
  /** Half-width at the upper canyon rim */
  rimHalfWidth: number;
  /** Elevation of the canyon floor (river bed) */
  floorY: number;
  /** Elevation of the canyon upper rim */
  rimY: number;
  /** Optional rock arch or hazard pillar */
  hasArch: boolean;
  /** Color band index for rock strata */
  strataIndex: number;
}

export interface CarnageParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vRot: number;
  kind: "blood" | "gib" | "helmet" | "wing" | "rock" | "mist";
}

export interface ScreenSplat {
  /** Normalized screen coordinate 0..1 across the 4x2 grid */
  nx: number;
  ny: number;
  radius: number;
  dripLength: number;
  color: string;
  seed: number;
}

export class CanyonGameEngine {
  public phase: GamePhase = "READY";

  // Player 3D coordinates & attitude
  public playerZ = 0;
  public playerX = 0;
  public playerY = 48; // Floor is ~0, Rim is ~85

  public vx = 0;
  public vy = 0;

  /** Forward speed in MPH (Stall = 65, Base Start = 120, ramps up with distance up to 285+ MPH!) */
  public speed = 120;
  public readonly STALL_SPEED = 65;
  public readonly MIN_CHUTE_SPEED = 28;
  public readonly BASE_START_SPEED = 120;
  public readonly MAX_SPEED = 290;

  /** Distance-driven speed modifier: increases the further he flies! */
  public distanceSpeedBoost = 0;

  /** Roll / bank angle in degrees (-58 left to +58 right) controlled by Rightmost Dial */
  public roll = 0;
  public targetRoll = 0;

  /** Pitch angle in degrees (-45 dive to +45 climb) controlled by Leftmost Dial */
  public pitch = -4;
  public targetPitch = -4;

  // Scoring & Telemetry
  public distanceTraveled = 0;
  public score = 0;
  public highScore = 0;
  public isNewHighScore = false;
  public proximityMultiplier = 1.0;
  public lastCrashReason = "";
  public crashSpeed = 0;

  // Animation & timers
  public tickCount = 0;
  public phaseElapsedSec = 0;
  public chuteDeployProgress = 0; // 0..1 canopy inflation
  public chuteSwingAngle = 0;
  public screenShake = 0;

  // Carnage state
  public particles: CarnageParticle[] = [];
  public screenSplats: ScreenSplat[] = [];

  // Callback for persisting high score
  private onSaveHighScore?: (highScore: number) => void;

  constructor(onSaveHighScore?: (highScore: number) => void) {
    this.onSaveHighScore = onSaveHighScore;
    this.resetToReady();
  }

  public setHighScore(val: number): void {
    if (Number.isFinite(val) && val > this.highScore) {
      this.highScore = Math.floor(val);
    }
  }

  /**
   * Resets the birdman to the canyon launch state.
   * Scoring waits until a dial is turned!
   */
  public resetToReady(): void {
    this.phase = "READY";
    this.playerZ = 0;
    this.distanceTraveled = 0;
    const startSlice = this.sampleCanyonAt(0);
    this.playerX = startSlice.centerX;
    this.playerY = startSlice.floorY + 50;
    this.vx = 0;
    this.vy = 0;
    this.speed = this.BASE_START_SPEED;
    this.distanceSpeedBoost = 0;
    this.roll = 0;
    this.targetRoll = 0;
    this.pitch = -3;
    this.targetPitch = -3;
    this.score = 0;
    this.isNewHighScore = false;
    this.proximityMultiplier = 1.0;
    this.lastCrashReason = "";
    this.crashSpeed = 0;
    this.phaseElapsedSec = 0;
    this.chuteDeployProgress = 0;
    this.chuteSwingAngle = 0;
    this.screenShake = 0;
    this.particles = [];
    this.screenSplats = [];
  }

  /**
   * Procedural canyon generator at any world Z coordinate.
   * Deterministic and continuous; gets tighter and more winding the further you fly!
   */
  public sampleCanyonAt(z: number): CanyonSlice {
    // Difficulty ramps up steadily the further down the canyon he flies
    const difficulty = Math.min(2.6, 1.0 + Math.max(0, z) / 5500);

    // Multi-octave winding canyon centerline
    const centerX =
      Math.sin(z * 0.0044) * 72 * difficulty +
      Math.cos(z * 0.0102 + 1.3) * 38 * difficulty +
      Math.sin(z * 0.021 - 0.7) * 16 * Math.min(1.8, difficulty);

    // Undulating canyon floor & rim
    const floorY =
      Math.sin(z * 0.0055 + 0.4) * 14 +
      Math.cos(z * 0.013) * 7;

    const canyonDepth = 84 + Math.sin(z * 0.0031) * 12;
    const rimY = floorY + canyonDepth;

    // Canyon narrows as distance/difficulty increases
    const widthWave = Math.sin(z * 0.0063 + 2.1) * 8;
    const floorHalfWidth = Math.max(20, 40 - (difficulty - 1) * 9 + widthWave);
    const rimHalfWidth = floorHalfWidth + 42 + Math.cos(z * 0.004) * 8;

    const sliceIndex = Math.floor(z / 30);
    const hasArch = sliceIndex > 12 && sliceIndex % 29 === 0;

    return {
      z,
      relZ: z - this.playerZ,
      centerX,
      floorHalfWidth,
      rimHalfWidth,
      floorY,
      rimY,
      hasArch,
      strataIndex: ((sliceIndex % 6) + 6) % 6
    };
  }

  /**
   * Computes allowed horizontal half-width of the canyon at a given elevation Y.
   */
  public getHalfWidthAtY(slice: CanyonSlice, y: number): number {
    if (y <= slice.floorY) return 0;
    if (y >= slice.rimY) {
      return slice.rimHalfWidth + (y - slice.rimY) * 1.5;
    }
    const t = (y - slice.floorY) / Math.max(1, slice.rimY - slice.floorY);
    const steppedT = Math.pow(t, 0.82);
    return slice.floorHalfWidth + (slice.rimHalfWidth - slice.floorHalfWidth) * steppedT;
  }

  /**
   * Handles rotation of the Leftmost Dial (Pitch / Up-Down motion).
   * @param ticks Positive = Up (Climb & Slow down -> Chute if too slow), Negative = Down (Dive & Speed up -> Carnage if hit ground)
   */
  public onPitchDialRotate(ticks: number): void {
    if (this.phase === "CHUTE" || this.phase === "CARNAGE") {
      if (this.phaseElapsedSec > 1.2) {
        this.resetToReady();
      } else {
        return;
      }
    }

    if (this.phase === "READY") {
      this.startFlying();
    }

    // Adjust target pitch: positive ticks = pitch UP (lift out of canyon, slows down), negative = pitch DOWN (dive into canyon)
    this.targetPitch = Math.max(-48, Math.min(48, this.targetPitch + ticks * 5.5));
    this.playerY += ticks * 1.7;
    // Turning UP slows him down as he lifts out of the canyon; turning DOWN accelerates him
    this.speed = Math.max(
      this.STALL_SPEED - 2,
      Math.min(this.MAX_SPEED, this.speed - ticks * 4.5)
    );
  }

  /**
   * Handles rotation of the Rightmost Dial (Steering Left/Right).
   * @param ticks Negative = Bank Left, Positive = Bank Right
   */
  public onSteerDialRotate(ticks: number): void {
    if (this.phase === "CHUTE" || this.phase === "CARNAGE") {
      if (this.phaseElapsedSec > 1.2) {
        this.resetToReady();
      } else {
        return;
      }
    }

    if (this.phase === "READY") {
      this.startFlying();
    }

    // Adjust roll/bank angle for steering; the birdman stays centered while the canyon shifts around him
    this.targetRoll = Math.max(-58, Math.min(58, this.targetRoll + ticks * 7.0));
    this.playerX += ticks * 2.4;
  }

  private startFlying(): void {
    this.phase = "FLYING";
    this.phaseElapsedSec = 0;
    this.playerZ = 0;
    this.distanceTraveled = 0;
    const startSlice = this.sampleCanyonAt(0);
    this.playerX = startSlice.centerX;
    this.playerY = startSlice.floorY + 50;
    this.speed = this.BASE_START_SPEED;
    this.distanceSpeedBoost = 0;
    this.score = 0;
  }

  /**
   * Advances simulation by dt seconds.
   */
  public step(dt: number): void {
    this.tickCount++;
    this.phaseElapsedSec += dt;

    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt * 18);
    }

    if (this.phase === "READY") {
      // Preview flight down the canyon centerline before dial is turned (score & distance stay 0)
      this.playerZ += this.BASE_START_SPEED * 1.1 * dt;
      this.distanceTraveled = 0;
      const slice = this.sampleCanyonAt(this.playerZ);
      const lookAhead = this.sampleCanyonAt(this.playerZ + 90);
      const desiredX = slice.centerX;
      const dx = lookAhead.centerX - slice.centerX;
      this.playerX += (desiredX - this.playerX) * Math.min(1, dt * 6);
      this.playerY = slice.floorY + 48 + Math.sin(this.tickCount * 0.12) * 3.5;
      this.roll = Math.max(-32, Math.min(32, dx * 0.6));
      this.pitch = -4 + Math.cos(this.tickCount * 0.1) * 2;
      this.targetRoll = 0;
      this.targetPitch = -4;
      this.speed = this.BASE_START_SPEED;
      return;
    }

    if (this.phase === "FLYING") {
      // Smoothly interpolate roll and pitch toward dial targets
      this.roll += (this.targetRoll - this.roll) * Math.min(1, dt * 10);
      this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 10);

      // Gentle aerodynamic self-leveling so you can hold a bank or carve smoothly
      this.targetRoll *= Math.pow(0.84, dt);

      // Distance speed boost: the further he flies, the faster the natural canyon tailwind/grade pushes him!
      this.distanceSpeedBoost = Math.min(145, (this.playerZ / 1000) * 18.5);
      const naturalTargetSpeed = this.BASE_START_SPEED + this.distanceSpeedBoost;

      // Pitch physics:
      // Positive pitch (climbing out of canyon) slows him down strongly;
      // Negative pitch (diving into canyon) accelerates him even faster;
      // When near neutral pitch, speed gravitates toward the ever-increasing naturalTargetSpeed!
      if (this.pitch > 2) {
        // Climbing bleeds airspeed (so pulling up too much/too long pops the parachute)
        const climbBrake = (this.pitch - 2) * 1.95;
        this.speed -= climbBrake * dt;
      } else {
        // Diving or gliding accelerates with distance + dive angle
        const diveBoost = Math.max(0, -this.pitch - 4) * 2.1;
        const targetSpd = Math.min(this.MAX_SPEED, naturalTargetSpeed + diveBoost * 1.4);
        const accelRate = this.speed < targetSpd ? 18 + diveBoost : 8;
        this.speed += Math.sign(targetSpd - this.speed) * Math.min(Math.abs(targetSpd - this.speed), accelRate * dt);
      }

      this.speed = Math.min(this.MAX_SPEED, this.speed);

      // Vertical velocity from pitch + lift
      const liftFactor = Math.max(0.35, this.speed / this.BASE_START_SPEED);
      this.vy = this.pitch * 1.35 * liftFactor - 4.0;
      this.playerY += this.vy * dt;

      // Lateral velocity from roll/steering (scales slightly with speed so steering stays crisp at high speeds)
      const speedSteerScale = 0.75 + 0.35 * (this.speed / this.BASE_START_SPEED);
      this.vx = this.roll * 1.85 * speedSteerScale;
      this.playerX += this.vx * dt;

      // Forward movement down the canyon (faster and faster as distance increases!)
      const forwardStep = this.speed * 1.42 * dt;
      this.playerZ += forwardStep;
      this.distanceTraveled = Math.max(0, this.playerZ);

      // Check if speed dropped too low -> POP PARACHUTE!
      if (this.speed <= this.STALL_SPEED) {
        this.triggerChuteDeploy();
        return;
      }

      // Check collision with canyon floor or walls
      const slice = this.sampleCanyonAt(this.playerZ);
      const agl = this.playerY - slice.floorY; // Altitude above ground level
      const halfWidth = this.getHalfWidthAtY(slice, this.playerY);
      const offsetFromCenter = this.playerX - slice.centerX;
      const wallClearance = halfWidth - Math.abs(offsetFromCenter);

      // Check rock arch collision
      const archHit =
        slice.hasArch &&
        Math.abs(this.playerY - (slice.rimY - 10)) < 7 &&
        Math.abs(offsetFromCenter) < halfWidth;

      if (agl <= 3.5) {
        this.triggerCarnage("SPLATTERED ON CANYON FLOOR!");
        return;
      }
      if (this.playerY < slice.rimY && wallClearance <= 4.0) {
        this.triggerCarnage(offsetFromCenter < 0 ? "SLAMMED LEFT CLIFF WALL!" : "SLAMMED RIGHT CLIFF WALL!");
        return;
      }
      if (archHit) {
        this.triggerCarnage("SMASHED INTO CANYON ARCH!");
        return;
      }

      // Calculate proximity & speed score multiplier!
      let prox = 1.0;
      if (agl < 22) {
        prox += (22 - agl) / 10;
      }
      if (this.playerY < slice.rimY && wallClearance < 16) {
        prox += (16 - wallClearance) / 8;
      }
      if (this.playerY > slice.rimY + 6) {
        // Above the canyon rim: strong headwind drag slows you down toward chute deployment!
        prox = 0.5;
        this.speed -= (this.playerY - slice.rimY) * 0.55 * dt;
        if (this.speed <= this.STALL_SPEED) {
          this.triggerChuteDeploy();
          return;
        }
      }
      this.proximityMultiplier = Math.round(Math.min(5.0, prox) * 10) / 10;

      const speedFactor = Math.pow(this.speed / this.BASE_START_SPEED, 1.45);
      const pointsEarned = forwardStep * 0.45 * speedFactor * this.proximityMultiplier;
      this.score += pointsEarned;

      if (Math.floor(this.score) > this.highScore) {
        this.highScore = Math.floor(this.score);
        this.isNewHighScore = true;
      }
      return;
    }

    if (this.phase === "CHUTE") {
      // Parachute popped! Scoring has ended. Float gently down to the canyon floor.
      this.chuteDeployProgress = Math.min(1, this.chuteDeployProgress + dt * 3.2);
      this.chuteSwingAngle =
        Math.sin(this.phaseElapsedSec * 3.5) * 14 * (1 - Math.min(0.7, this.phaseElapsedSec * 0.12));
      this.speed += (this.MIN_CHUTE_SPEED - this.speed) * Math.min(1, dt * 4);
      this.roll += (this.chuteSwingAngle - this.roll) * Math.min(1, dt * 6);
      this.pitch += (6 - this.pitch) * Math.min(1, dt * 5);

      const slice = this.sampleCanyonAt(this.playerZ);
      const targetGroundY = slice.floorY + 6;
      if (this.playerY > targetGroundY) {
        this.playerZ += this.speed * 0.65 * dt;
        this.distanceTraveled = Math.max(0, this.playerZ);
        this.playerY = Math.max(targetGroundY, this.playerY - 14 * dt);
        this.playerX += (slice.centerX - this.playerX) * Math.min(1, dt * 1.8);
      } else {
        this.playerY = targetGroundY;
        this.speed = 0;
      }
      return;
    }

    if (this.phase === "CARNAGE") {
      // Update explosive carnage particles & blood drips
      for (const p of this.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 190 * dt;
        p.rotation += p.vRot * dt;
      }
      for (const s of this.screenSplats) {
        s.dripLength = Math.min(55, s.dripLength + dt * (12 + (s.seed % 18)));
      }
    }
  }

  private triggerChuteDeploy(): void {
    this.phase = "CHUTE";
    this.phaseElapsedSec = 0;
    this.chuteDeployProgress = 0.15;
    this.score = Math.floor(this.score);
    this.commitHighScore();
  }

  private triggerCarnage(reason: string): void {
    this.phase = "CARNAGE";
    this.phaseElapsedSec = 0;
    this.lastCrashReason = reason;
    this.crashSpeed = Math.round(this.speed);
    this.speed = 0;
    this.screenShake = 14;
    this.score = Math.floor(this.score);
    this.commitHighScore();

    // Generate visceral 3rd-person carnage particles & lens blood splatters
    this.particles = [];
    const colors = ["#d90429", "#ef233c", "#8d0801", "#ff4d6d", "#ffba08", "#e5e5e5"];
    for (let i = 0; i < 42; i++) {
      const angle = (Math.PI * 2 * i) / 42 + (Math.random() - 0.5) * 0.3;
      const spd = 45 + Math.random() * 240;
      const kinds: CarnageParticle["kind"][] = ["blood", "blood", "gib", "wing", "rock", "mist"];
      const kind = i === 0 ? "helmet" : kinds[i % kinds.length];
      this.particles.push({
        x: 0,
        y: 0,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 65,
        size: kind === "helmet" ? 11 : 4 + Math.random() * 10,
        color: colors[i % colors.length],
        rotation: Math.random() * 360,
        vRot: (Math.random() - 0.5) * 540,
        kind
      });
    }

    this.screenSplats = [];
    for (let i = 0; i < 14; i++) {
      this.screenSplats.push({
        nx: 0.12 + Math.random() * 0.76,
        ny: 0.15 + Math.random() * 0.7,
        radius: 10 + Math.random() * 26,
        dripLength: 2,
        color: i % 2 === 0 ? "#b8001f" : "#ec1c24",
        seed: i * 17 + 5
      });
    }
  }

  private commitHighScore(): void {
    if (this.score >= this.highScore && this.score > 0) {
      this.highScore = Math.floor(this.score);
      this.isNewHighScore = true;
    }
    if (this.onSaveHighScore) {
      this.onSaveHighScore(this.highScore);
    }
  }
}
