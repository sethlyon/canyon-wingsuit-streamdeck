var CanyonSim = (function (exports) {
    'use strict';

    class CanyonGameEngine {
        phase = "READY";
        // Player 3D coordinates & attitude
        playerZ = 0;
        playerX = 0;
        playerY = 48; // Floor is ~0, Rim is ~85
        vx = 0;
        vy = 0;
        /** Forward speed in MPH (Stall = 65, Base Start = 120, ramps up with distance up to 285+ MPH!) */
        speed = 120;
        STALL_SPEED = 65;
        MIN_CHUTE_SPEED = 28;
        BASE_START_SPEED = 120;
        MAX_SPEED = 290;
        /** Distance-driven speed modifier: increases the further he flies! */
        distanceSpeedBoost = 0;
        /** Roll / bank angle in degrees (-58 left to +58 right) controlled by Rightmost Dial */
        roll = 0;
        targetRoll = 0;
        /** Pitch angle in degrees (-45 dive to +45 climb) controlled by Leftmost Dial */
        pitch = -4;
        targetPitch = -4;
        // Scoring & Telemetry
        distanceTraveled = 0;
        score = 0;
        highScore = 0;
        isNewHighScore = false;
        proximityMultiplier = 1.0;
        lastCrashReason = "";
        crashSpeed = 0;
        // Animation & timers
        tickCount = 0;
        phaseElapsedSec = 0;
        chuteDeployProgress = 0; // 0..1 canopy inflation
        chuteSwingAngle = 0;
        screenShake = 0;
        // Carnage state
        particles = [];
        screenSplats = [];
        // Callback for persisting high score
        onSaveHighScore;
        constructor(onSaveHighScore) {
            this.onSaveHighScore = onSaveHighScore;
            this.resetToReady();
        }
        setHighScore(val) {
            if (Number.isFinite(val) && val > this.highScore) {
                this.highScore = Math.floor(val);
            }
        }
        /**
         * Resets the birdman to the canyon launch state.
         * Scoring waits until a dial is turned!
         */
        resetToReady() {
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
        sampleCanyonAt(z) {
            // Difficulty ramps up steadily the further down the canyon he flies
            const difficulty = Math.min(2.6, 1.0 + Math.max(0, z) / 5500);
            // Multi-octave winding canyon centerline
            const centerX = Math.sin(z * 0.0044) * 72 * difficulty +
                Math.cos(z * 0.0102 + 1.3) * 38 * difficulty +
                Math.sin(z * 0.021 - 0.7) * 16 * Math.min(1.8, difficulty);
            // Undulating canyon floor & rim
            const floorY = Math.sin(z * 0.0055 + 0.4) * 14 +
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
        getHalfWidthAtY(slice, y) {
            if (y <= slice.floorY)
                return 0;
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
        onPitchDialRotate(ticks) {
            if (this.phase === "CHUTE" || this.phase === "CARNAGE") {
                if (this.phaseElapsedSec > 1.2) {
                    this.resetToReady();
                }
                else {
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
            this.speed = Math.max(this.STALL_SPEED - 2, Math.min(this.MAX_SPEED, this.speed - ticks * 4.5));
        }
        /**
         * Handles rotation of the Rightmost Dial (Steering Left/Right).
         * @param ticks Negative = Bank Left, Positive = Bank Right
         */
        onSteerDialRotate(ticks) {
            if (this.phase === "CHUTE" || this.phase === "CARNAGE") {
                if (this.phaseElapsedSec > 1.2) {
                    this.resetToReady();
                }
                else {
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
        startFlying() {
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
        step(dt) {
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
                }
                else {
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
                const archHit = slice.hasArch &&
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
                }
                else {
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
        triggerChuteDeploy() {
            this.phase = "CHUTE";
            this.phaseElapsedSec = 0;
            this.chuteDeployProgress = 0.15;
            this.score = Math.floor(this.score);
            this.commitHighScore();
        }
        triggerCarnage(reason) {
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
                const kinds = ["blood", "blood", "gib", "wing", "rock", "mist"];
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
        commitHighScore() {
            if (this.score >= this.highScore && this.score > 0) {
                this.highScore = Math.floor(this.score);
                this.isNewHighScore = true;
            }
            if (this.onSaveHighScore) {
                this.onSaveHighScore(this.highScore);
            }
        }
    }

    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }
    function lerp(a, b, t) {
        return a + (b - a) * t;
    }
    /**
     * Computes the 3rd-person follow-cam wingsuit pose (flying AWAY from the camera into the canyon):
     * - Slowing down -> gets BIGGER in the frame (1.38x) with arms & legs flared wide open.
     * - Speeding up -> gets SMALLER in the frame (0.45x, further away) with both arms tucked tight to his sides.
     * - Navigating left -> tucks LEFT arm (elbow bends in, forearm & glove tuck against ribs) while right wing stays wide.
     * - Navigating right -> tucks RIGHT arm (elbow bends in, forearm & glove tuck against ribs) while left wing stays wide.
     */
    function computeBirdmanPose(engine) {
        const speedSpan = Math.max(1, engine.MAX_SPEED - engine.STALL_SPEED);
        const speedNorm = clamp((engine.speed - engine.STALL_SPEED) / speedSpan, 0, 1);
        const scale = engine.phase === "CHUTE"
            ? 0.92
            : Number(lerp(1.38, 0.45, Math.pow(speedNorm, 0.88)).toFixed(3));
        const speedTuck = engine.phase === "CHUTE"
            ? 0.15
            : clamp(Math.pow(speedNorm, 1.05) * 0.86, 0, 0.88);
        const effectiveRoll = engine.roll * 0.65 + engine.targetRoll * 0.35;
        const steerLeft = clamp(-effectiveRoll / 34, 0, 1);
        const steerRight = clamp(effectiveRoll / 34, 0, 1);
        const leftTuck = engine.phase === "CHUTE"
            ? 0.15
            : clamp(speedTuck * (1 - steerRight * 0.65) + steerLeft * (1 - speedTuck * 0.25), 0, 1);
        const rightTuck = engine.phase === "CHUTE"
            ? 0.15
            : clamp(speedTuck * (1 - steerLeft * 0.65) + steerRight * (1 - speedTuck * 0.25), 0, 1);
        const pitchFactor = clamp((engine.pitch + 25) / 50, 0, 1);
        const foreshortenY = engine.phase === "CHUTE"
            ? 0.92
            : Number(lerp(0.55, 0.92, (1 - speedNorm) * 0.65 + pitchFactor * 0.35).toFixed(2));
        const flutterFreq = 0.55 + speedNorm * 0.75;
        const armWaveL = Math.sin(engine.tickCount * flutterFreq) * (0.9 - leftTuck * 0.5);
        const armWaveR = Math.cos(engine.tickCount * flutterFreq + 0.9) * (0.9 - rightTuck * 0.5);
        const leftHandX = Math.round(lerp(-74, -22, leftTuck));
        const leftHandY = Math.round(engine.phase === "CHUTE"
            ? -24
            : lerp(-8, 12, leftTuck) * foreshortenY + armWaveL);
        const rightHandX = Math.round(lerp(74, 22, rightTuck));
        const rightHandY = Math.round(engine.phase === "CHUTE"
            ? -24
            : lerp(-8, 12, rightTuck) * foreshortenY + armWaveR);
        const legTuck = clamp(speedTuck * 0.78, 0, 1);
        const footY = Math.round(lerp(26, 42, foreshortenY));
        const leftFootX = Math.round(lerp(-32, -14, legTuck) - steerLeft * 3 + steerRight * 2);
        const rightFootX = Math.round(lerp(32, 14, legTuck) - steerLeft * 2 + steerRight * 3);
        return {
            scale,
            leftTuck,
            rightTuck,
            speedNorm,
            foreshortenY,
            leftHandX,
            leftHandY,
            rightHandX,
            rightHandY,
            leftFootX,
            leftFootY: footY,
            rightFootX,
            rightFootY: footY
        };
    }
    /**
     * Helper to build a thick, anatomically contoured limb capsule (shoulder->elbow->wrist or hip->knee->ankle)
     * so arms and legs have real human muscle volume (biceps, forearms, thighs, calves) instead of stick lines!
     */
    function buildVolumetricLimbPath(x0, y0, r0, x1, y1, r1, x2, y2, r2) {
        // Compute perpendicular normals for segment 0->1 and 1->2
        const dx0 = x1 - x0;
        const dy0 = y1 - y0;
        const len0 = Math.max(1, Math.hypot(dx0, dy0));
        const nx0 = -dy0 / len0;
        const ny0 = dx0 / len0;
        const dx1 = x2 - x1;
        const dy1 = y2 - y1;
        const len1 = Math.max(1, Math.hypot(dx1, dy1));
        const nx1 = -dy1 / len1;
        const ny1 = dx1 / len1;
        // Average normal at the middle joint (elbow or knee)
        const nmx = (nx0 + nx1) * 0.5;
        const nmy = (ny0 + ny1) * 0.5;
        const nmlen = Math.max(0.5, Math.hypot(nmx, nmy));
        const jnx = nmx / nmlen;
        const jny = nmy / nmlen;
        // Outer edge points (top/outer contour of muscle)
        const p0x = (x0 + nx0 * r0).toFixed(1);
        const p0y = (y0 + ny0 * r0).toFixed(1);
        const p1x = (x1 + jnx * r1).toFixed(1);
        const p1y = (y1 + jny * r1).toFixed(1);
        const p2x = (x2 + nx1 * r2).toFixed(1);
        const p2y = (y2 + ny1 * r2).toFixed(1);
        // Inner edge points (bottom/inner contour of muscle)
        const q2x = (x2 - nx1 * r2).toFixed(1);
        const q2y = (y2 - ny1 * r2).toFixed(1);
        const q1x = (x1 - jnx * r1).toFixed(1);
        const q1y = (y1 - jny * r1).toFixed(1);
        const q0x = (x0 - nx0 * r0).toFixed(1);
        const q0y = (y0 - ny0 * r0).toFixed(1);
        return `M ${p0x} ${p0y} Q ${p1x} ${p1y} ${p2x} ${p2y} L ${q2x} ${q2y} Q ${q1x} ${q1y} ${q0x} ${q0y} Z`;
    }
    /**
     * Full-Bodied 3rd-Person Wingsuit Pilot SVG Renderer (flying AWAY from the camera into the canyon).
     *
     * Designed with true human anatomical volume (broad deltoids, muscular biceps/forearms, wide lats,
     * sculpted glutes, thick thighs/calves, and 3D cloth shading) so he looks like a real human athlete
     * in a pressurized wingsuit—never a stick figure!
     */
    function renderBirdmanSprite(engine) {
        const parts = [];
        const pose = computeBirdmanPose(engine);
        const { leftTuck, rightTuck, speedNorm, foreshortenY, leftHandX, leftHandY, rightHandX, rightHandY, leftFootX, leftFootY, rightFootX, rightFootY } = pose;
        parts.push(`<defs>
    <!-- Pressurized Wing Canopy Gradients (Top-Lit Emerald/Cyan/Obsidian Pro Suit) -->
    <linearGradient id="wsMembraneL" x1="0.2" y1="0" x2="0.7" y2="1">
      <stop offset="0%" stop-color="#00f5d4"/>
      <stop offset="40%" stop-color="#008bf8"/>
      <stop offset="82%" stop-color="#111d38"/>
      <stop offset="100%" stop-color="#070b14"/>
    </linearGradient>
    <linearGradient id="wsMembraneR" x1="0.8" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#00f5d4"/>
      <stop offset="40%" stop-color="#008bf8"/>
      <stop offset="82%" stop-color="#111d38"/>
      <stop offset="100%" stop-color="#070b14"/>
    </linearGradient>
    <!-- Volumetric 3D Human Body Suit Shading (Lit from Sky Above, Shaded Underneath) -->
    <linearGradient id="wsBodySuit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#475569"/>
      <stop offset="28%" stop-color="#273244"/>
      <stop offset="72%" stop-color="#151c28"/>
      <stop offset="100%" stop-color="#090d14"/>
    </linearGradient>
    <linearGradient id="wsLimbHighlight" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#64748b"/>
      <stop offset="45%" stop-color="#293548"/>
      <stop offset="100%" stop-color="#0f1520"/>
    </linearGradient>
    <linearGradient id="wsRig3D" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#64748b"/>
      <stop offset="35%" stop-color="#334155"/>
      <stop offset="85%" stop-color="#161e2e"/>
      <stop offset="100%" stop-color="#090d16"/>
    </linearGradient>
    <radialGradient id="wsHelmet3D" cx="45%" cy="25%" r="72%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="25%" stop-color="#38bdf8"/>
      <stop offset="65%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#070a10"/>
    </radialGradient>
  </defs>`);
        const yawShiftX = Math.round(clamp(engine.roll / 11, -6, 6));
        // Anatomical Human Joint Coordinates (with full athletic shoulder & hip breadth!)
        const headX = yawShiftX;
        const headY = Math.round(-19 * foreshortenY - 3);
        const shoulderY = Math.round(-13 * foreshortenY - 1);
        const leftShoulderX = -17 + Math.round(yawShiftX * 0.5);
        const rightShoulderX = 17 + Math.round(yawShiftX * 0.5);
        const waistY = Math.round(4 * foreshortenY + 2);
        const hipY = Math.round(10 * foreshortenY + 3);
        const leftHipX = -11;
        const rightHipX = 11;
        // Elbows & Knees for natural human articulation
        const leftElbowX = Math.round(lerp(-46, -24, leftTuck) + yawShiftX * 0.3);
        const leftElbowY = Math.round(engine.phase === "CHUTE"
            ? shoulderY - 10
            : lerp(shoulderY - 4, waistY + 3, leftTuck));
        const rightElbowX = Math.round(lerp(46, 24, rightTuck) + yawShiftX * 0.3);
        const rightElbowY = Math.round(engine.phase === "CHUTE"
            ? shoulderY - 10
            : lerp(shoulderY - 4, waistY + 3, rightTuck));
        const leftKneeX = Math.round(lerp(leftHipX, leftFootX, 0.52) - 2);
        const leftKneeY = Math.round(lerp(hipY, leftFootY, 0.52));
        const rightKneeX = Math.round(lerp(rightHipX, rightFootX, 0.52) + 2);
        const rightKneeY = Math.round(lerp(hipY, rightFootY, 0.52));
        // Fabric flutter
        const ripplePhase = engine.tickCount * (0.75 + speedNorm * 0.85);
        const leftFlutter = Math.round(Math.sin(ripplePhase) * (1.6 - leftTuck));
        const rightFlutter = Math.round(Math.cos(ripplePhase + 1.1) * (1.6 - rightTuck));
        const tailFlutter = Math.round(Math.sin(ripplePhase * 1.4) * 1.4);
        // =========================================================================
        // PARACHUTE CANOPY (if deployed in CHUTE phase)
        // =========================================================================
        if (engine.phase === "CHUTE") {
            const p = engine.chuteDeployProgress;
            const canopyW = Math.round(94 * p);
            const canopyH = Math.round(34 * p);
            const canopyY = Math.round(-78 * p - 18);
            for (let c = -3; c <= 3; c++) {
                const cx = Math.round((c / 3) * (canopyW * 0.88));
                const sx = c < 0 ? -11 : c > 0 ? 11 : 0;
                parts.push(`<line x1="${sx}" y1="${shoulderY}" x2="${cx}" y2="${canopyY + 6}" stroke="#cbd5e1" stroke-width="1.3" opacity="0.85"/>`);
            }
            parts.push(`<path d="M ${-canopyW} ${canopyY + canopyH * 0.4} Q 0 ${canopyY - canopyH} ${canopyW} ${canopyY + canopyH * 0.4} Q 0 ${canopyY + canopyH * 0.1} ${-canopyW} ${canopyY + canopyH * 0.4} Z" fill="#00f5d4" stroke="#ffffff" stroke-width="2.2"/>`, `<path d="M ${-Math.round(canopyW * 0.55)} ${canopyY + canopyH * 0.22} Q 0 ${canopyY - canopyH * 0.85} ${Math.round(canopyW * 0.55)} ${canopyY + canopyH * 0.22} Z" fill="#ffbe0b" opacity="0.92"/>`, `<path d="M ${-Math.round(canopyW * 0.22)} ${canopyY + canopyH * 0.12} Q 0 ${canopyY - canopyH * 0.75} ${Math.round(canopyW * 0.22)} ${canopyY + canopyH * 0.12} Z" fill="#ff006e" opacity="0.95"/>`);
        }
        // =========================================================================
        // 1. 3D PERSPECTIVE SLIPSTREAM RIBBONS (streaming back toward foreground camera)
        // =========================================================================
        if (engine.phase !== "CARNAGE" && engine.phase !== "CHUTE") {
            const wakeLen = Math.round(22 + speedNorm * 36);
            const wakeAlpha = (0.38 + speedNorm * 0.45).toFixed(2);
            const leftWakeEndX = leftHandX - Math.round((1 - leftTuck) * 14 + 5);
            const rightWakeEndX = rightHandX + Math.round((1 - rightTuck) * 14 + 5);
            parts.push(`<path d="M ${leftHandX} ${leftHandY} Q ${leftHandX - 5} ${leftHandY + Math.round(wakeLen * 0.5)} ${leftWakeEndX} ${leftHandY + wakeLen}" fill="none" stroke="#ffffff" stroke-width="${(1.5 + (1 - leftTuck) * 1.2).toFixed(1)}" opacity="${wakeAlpha}" stroke-dasharray="7 4" stroke-linecap="round"/>`, `<path d="M ${rightHandX} ${rightHandY} Q ${rightHandX + 5} ${rightHandY + Math.round(wakeLen * 0.5)} ${rightWakeEndX} ${rightHandY + wakeLen}" fill="none" stroke="#ffffff" stroke-width="${(1.5 + (1 - rightTuck) * 1.2).toFixed(1)}" opacity="${wakeAlpha}" stroke-dasharray="7 4" stroke-linecap="round"/>`);
            if (speedNorm > 0.52) {
                const machAlpha = ((speedNorm - 0.52) * 0.95).toFixed(2);
                parts.push(`<path d="M ${leftHandX - 6} ${leftHandY + 4} Q ${headX} ${headY - 14} ${rightHandX + 6} ${rightHandY + 4}" fill="none" stroke="#00f5d4" stroke-width="1.8" opacity="${machAlpha}" stroke-dasharray="5 3"/>`);
            }
        }
        // =========================================================================
        // 2. PRESSURIZED ARM-WING & TAIL-WING MEMBRANES (stretched between limbs)
        // =========================================================================
        const leftAnkleX = leftFootX + 3;
        const leftAnkleY = leftFootY - 4;
        const rightAnkleX = rightFootX - 3;
        const rightAnkleY = rightFootY - 4;
        const leftTrailX = Math.round(lerp(-48, -19, leftTuck));
        const leftTrailY = Math.round(lerp(leftHandY + 10, leftAnkleY - 4, 0.48) - (1 - leftTuck) * 5 + leftFlutter);
        const rightTrailX = Math.round(lerp(48, 19, rightTuck));
        const rightTrailY = Math.round(lerp(rightHandY + 10, rightAnkleY - 4, 0.48) - (1 - rightTuck) * 5 + rightFlutter);
        const tailArchY = Math.round(leftFootY - 5 + tailFlutter);
        // Dark 3D underside air-pocket openings along the trailing edges facing the follow-cam
        parts.push(`<path d="M ${leftHandX} ${leftHandY + 3} Q ${leftTrailX} ${leftTrailY + 5} ${leftAnkleX} ${leftAnkleY} Z" fill="#05070c" opacity="0.9"/>`, `<path d="M ${rightHandX} ${rightHandY + 3} Q ${rightTrailX} ${rightTrailY + 5} ${rightAnkleX} ${rightAnkleY} Z" fill="#05070c" opacity="0.9"/>`, `<path d="M ${leftAnkleX} ${leftAnkleY} Q 0 ${tailArchY + 5} ${rightAnkleX} ${rightAnkleY} Z" fill="#05070c" opacity="0.9"/>`);
        // Left Wing Membrane
        parts.push(`<path d="M ${leftShoulderX} ${shoulderY} L ${leftElbowX} ${leftElbowY} L ${leftHandX} ${leftHandY + 2} Q ${leftTrailX} ${leftTrailY} ${leftAnkleX} ${leftAnkleY} L ${leftHipX} ${hipY} Z" fill="url(#wsMembraneL)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`, 
        // High-Vis Flame/Gold Racing Panel on Left Wing
        `<polygon points="${Math.round(lerp(leftShoulderX, leftHandX, 0.45))},${Math.round(lerp(shoulderY, leftHandY, 0.45) + 3)} ${Math.round(lerp(leftHandX, leftShoulderX, 0.15))},${leftHandY + 3} ${leftTrailX},${leftTrailY} ${Math.round(lerp(leftHipX, leftAnkleX, 0.52))},${Math.round(lerp(hipY, leftAnkleY, 0.52))}" fill="#ffbe0b" opacity="${(0.88 - leftTuck * 0.35).toFixed(2)}"/>`, 
        // Inflated 3D Air-Cell Ribs & Fold Creases
        `<path d="M ${Math.round(lerp(leftShoulderX, leftHandX, 0.36))} ${Math.round(lerp(shoulderY, leftHandY, 0.36))} Q ${Math.round(leftTrailX * 0.75)} ${Math.round((shoulderY + leftAnkleY) * 0.45)} ${Math.round(lerp(leftHipX, leftAnkleX, 0.52))} ${Math.round(lerp(hipY, leftAnkleY, 0.52))}" fill="none" stroke="#091122" stroke-width="1.6"/>`, `<path d="M ${Math.round(lerp(leftShoulderX, leftHandX, 0.68))} ${Math.round(lerp(shoulderY, leftHandY, 0.68))} Q ${leftTrailX - 3} ${Math.round((leftHandY + leftTrailY) * 0.5)} ${leftTrailX} ${leftTrailY}" fill="none" stroke="#091122" stroke-width="1.6"/>`, `<path d="M ${leftHandX} ${leftHandY + 2} Q ${leftTrailX} ${leftTrailY} ${leftAnkleX} ${leftAnkleY}" fill="none" stroke="#00f5d4" stroke-width="1.6"/>`);
        // Right Wing Membrane
        parts.push(`<path d="M ${rightShoulderX} ${shoulderY} L ${rightElbowX} ${rightElbowY} L ${rightHandX} ${rightHandY + 2} Q ${rightTrailX} ${rightTrailY} ${rightAnkleX} ${rightAnkleY} L ${rightHipX} ${hipY} Z" fill="url(#wsMembraneR)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`, 
        // High-Vis Flame/Gold Racing Panel on Right Wing
        `<polygon points="${Math.round(lerp(rightShoulderX, rightHandX, 0.45))},${Math.round(lerp(shoulderY, rightHandY, 0.45) + 3)} ${Math.round(lerp(rightHandX, rightShoulderX, 0.15))},${rightHandY + 3} ${rightTrailX},${rightTrailY} ${Math.round(lerp(rightHipX, rightAnkleX, 0.52))},${Math.round(lerp(hipY, rightAnkleY, 0.52))}" fill="#ffbe0b" opacity="${(0.88 - rightTuck * 0.35).toFixed(2)}"/>`, 
        // Inflated 3D Air-Cell Ribs & Fold Creases
        `<path d="M ${Math.round(lerp(rightShoulderX, rightHandX, 0.36))} ${Math.round(lerp(shoulderY, rightHandY, 0.36))} Q ${Math.round(rightTrailX * 0.75)} ${Math.round((shoulderY + rightAnkleY) * 0.45)} ${Math.round(lerp(rightHipX, rightAnkleX, 0.52))} ${Math.round(lerp(hipY, rightAnkleY, 0.52))}" fill="none" stroke="#091122" stroke-width="1.6"/>`, `<path d="M ${Math.round(lerp(rightShoulderX, rightHandX, 0.68))} ${Math.round(lerp(shoulderY, rightHandY, 0.68))} Q ${rightTrailX + 3} ${Math.round((rightHandY + rightTrailY) * 0.5)} ${rightTrailX} ${rightTrailY}" fill="none" stroke="#091122" stroke-width="1.6"/>`, `<path d="M ${rightHandX} ${rightHandY + 2} Q ${rightTrailX} ${rightTrailY} ${rightAnkleX} ${rightAnkleY}" fill="none" stroke="#00f5d4" stroke-width="1.6"/>`);
        // Tail-Wing Membrane between the legs
        parts.push(`<path d="M ${leftHipX} ${hipY} L ${rightHipX} ${hipY} L ${rightAnkleX} ${rightAnkleY} Q 0 ${tailArchY} ${leftAnkleX} ${leftAnkleY} Z" fill="url(#wsMembraneL)" stroke="#070a10" stroke-width="1.3" stroke-linejoin="round"/>`, `<path d="M ${leftAnkleX} ${leftAnkleY} Q 0 ${tailArchY} ${rightAnkleX} ${rightAnkleY}" fill="none" stroke="#ffbe0b" stroke-width="1.5"/>`, `<line x1="0" y1="${hipY + 3}" x2="0" y2="${tailArchY}" stroke="#091122" stroke-width="1.5"/>`);
        // =========================================================================
        // 3. DISTANT HELMET & PADDED NECK ROLL (tucked forward ahead of the shoulders)
        // =========================================================================
        const helmetRx = 10.5;
        const helmetRy = Math.max(7.5, Math.round(9.5 * foreshortenY));
        parts.push(
        // Full-face aerodynamic skydiving helmet seen from behind/above
        `<ellipse cx="${headX}" cy="${headY}" rx="${helmetRx}" ry="${helmetRy}" fill="url(#wsHelmet3D)" stroke="#070a10" stroke-width="1.6"/>`, 
        // Dual sculpted aero shell seams curving forward over the crown of the helmet
        `<path d="M ${headX - 5} ${headY + 3} Q ${headX - 3} ${headY - helmetRy + 1} ${headX - 1.5} ${headY - helmetRy + 1}" fill="none" stroke="#94a3b8" stroke-width="1.2" stroke-linecap="round"/>`, `<path d="M ${headX + 5} ${headY + 3} Q ${headX + 3} ${headY - helmetRy + 1} ${headX + 1.5} ${headY - helmetRy + 1}" fill="none" stroke="#94a3b8" stroke-width="1.2" stroke-linecap="round"/>`, 
        // Acoustic / camera-mount side fairing on left side of helmet
        `<path d="M ${headX - helmetRx} ${headY - 1} L ${headX - helmetRx - 1.5} ${headY + 2} L ${headX - helmetRx + 1} ${headY + 3} Z" fill="#ffbe0b"/>`);
        // =========================================================================
        // 4. FULL-BODIED HUMAN ANATOMY: MUSCULAR LEGS, GLUTES, TORSO & ARMS
        // Rendered with true anatomical thickness & 3D cylindrical highlights (NO stick limbs!)
        // =========================================================================
        // Left & Right Volumetric Legs (Hip r=7.5 -> Knee r=6.5 -> Ankle r=5.5)
        const leftLegPath = buildVolumetricLimbPath(leftHipX, hipY, 7.2, leftKneeX, leftKneeY, 6.4, leftFootX, leftFootY - 2, 5.4);
        const rightLegPath = buildVolumetricLimbPath(rightHipX, hipY, 7.2, rightKneeX, rightKneeY, 6.4, rightFootX, rightFootY - 2, 5.4);
        // Left & Right Volumetric Arms (Shoulder Deltoid r=7.5 -> Elbow r=6.0 -> Wrist r=4.5)
        const leftArmPath = buildVolumetricLimbPath(leftShoulderX, shoulderY + 2, 7.4, leftElbowX, leftElbowY, 5.8, leftHandX, leftHandY, 4.2);
        const rightArmPath = buildVolumetricLimbPath(rightShoulderX, shoulderY + 2, 7.4, rightElbowX, rightElbowY, 5.8, rightHandX, rightHandY, 4.2);
        parts.push(
        // Thick Muscular Legs in Pressurized Flight Suit
        `<path d="${leftLegPath}" fill="url(#wsBodySuit)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`, `<path d="${rightLegPath}" fill="url(#wsBodySuit)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`, 
        // 3D Cylindrical Muscle Highlights along Calves/Hamstrings
        `<path d="M ${leftHipX - 1} ${hipY + 2} Q ${leftKneeX} ${leftKneeY} ${leftFootX} ${leftFootY - 4}" fill="none" stroke="#475569" stroke-width="3" stroke-linecap="round" opacity="0.65"/>`, `<path d="M ${rightHipX + 1} ${hipY + 2} Q ${rightKneeX} ${rightKneeY} ${rightFootX} ${rightFootY - 4}" fill="none" stroke="#475569" stroke-width="3" stroke-linecap="round" opacity="0.65"/>`, 
        // Sculpted Athletic Torso (Broad Traps/Deltoids -> Tapered Waist -> Glutes/Pelvis)
        `<path d="M ${leftShoulderX - 4} ${shoulderY} Q ${headX} ${shoulderY - 5} ${rightShoulderX + 4} ${shoulderY} Q ${rightShoulderX + 2} ${waistY} ${rightHipX + 6} ${hipY + 2} Q 0 ${hipY + 7} ${leftHipX - 6} ${hipY + 2} Q ${leftShoulderX - 2} ${waistY} ${leftShoulderX - 4} ${shoulderY} Z" fill="url(#wsBodySuit)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`, 
        // Sculpted Glute / Pelvis Suit Seam & Leg-Strap Harness Webbing
        `<path d="M ${leftHipX - 5} ${hipY + 1} Q -5 ${hipY + 6} 0 ${hipY + 3} Q 5 ${hipY + 6} ${rightHipX + 5} ${hipY + 1}" fill="none" stroke="#090d14" stroke-width="1.8" stroke-linecap="round"/>`, `<path d="M ${leftHipX - 5} ${hipY + 3} L ${leftHipX + 3} ${hipY + 6} M ${rightHipX + 5} ${hipY + 3} L ${rightHipX - 3} ${hipY + 6}" stroke="#94a3b8" stroke-width="2.2" stroke-linecap="round"/>`, 
        // Thick Muscular Arms (Deltoids -> Biceps -> Elbows -> Forearms)
        `<path d="${leftArmPath}" fill="url(#wsLimbHighlight)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`, `<path d="${rightArmPath}" fill="url(#wsLimbHighlight)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`, 
        // 3D Upper-Surface Specular Muscle Highlights & Articulated Elbow Pads
        `<path d="M ${leftShoulderX} ${shoulderY + 1} Q ${leftElbowX} ${leftElbowY - 1} ${leftHandX} ${leftHandY}" fill="none" stroke="#94a3b8" stroke-width="2.2" stroke-linecap="round" opacity="0.55"/>`, `<path d="M ${rightShoulderX} ${shoulderY + 1} Q ${rightElbowX} ${rightElbowY - 1} ${rightHandX} ${rightHandY}" fill="none" stroke="#94a3b8" stroke-width="2.2" stroke-linecap="round" opacity="0.55"/>`, 
        // Molded Kevlar Elbow Reinforcement Pads
        `<ellipse cx="${leftElbowX}" cy="${leftElbowY}" rx="4.2" ry="3.2" fill="#0f172a" stroke="#38bdf8" stroke-width="0.9"/>`, `<ellipse cx="${rightElbowX}" cy="${rightElbowY}" rx="4.2" ry="3.2" fill="#0f172a" stroke="#38bdf8" stroke-width="0.9"/>`, 
        // Sculpted Flight Gloves Gripping Wing Leading-Edge Handles
        `<g transform="translate(${leftHandX}, ${leftHandY}) rotate(${Math.round(lerp(-15, -65, leftTuck))})">`, `<rect x="-5.5" y="-4" width="10" height="8" rx="3.5" fill="#ffbe0b" stroke="#070a10" stroke-width="1.3"/>`, `<rect x="-2" y="-3" width="4" height="6" rx="1.5" fill="#0f172a"/>`, `</g>`, `<g transform="translate(${rightHandX}, ${rightHandY}) rotate(${Math.round(lerp(15, 65, rightTuck))})">`, `<rect x="-4.5" y="-4" width="10" height="8" rx="3.5" fill="#ffbe0b" stroke="#070a10" stroke-width="1.3"/>`, `<rect x="-2" y="-3" width="4" height="6" rx="1.5" fill="#0f172a"/>`, `</g>`);
        // =========================================================================
        // 5. 3D CONTOURED SKYDIVING / BASE RIG & HARNESS ON UPPER BACK
        // =========================================================================
        const rigTopY = shoulderY - 1;
        const rigBotY = waistY + 4;
        const rigMidX = Math.round(yawShiftX * 0.35);
        parts.push(
        // Padded 3D Shoulder Yoke Straps wrapping over his traps onto his back
        `<path d="M ${leftShoulderX + 5} ${shoulderY - 2} Q ${rigMidX - 9} ${rigTopY + 2} ${rigMidX - 7} ${rigTopY + 6}" fill="none" stroke="#cbd5e1" stroke-width="3.2" stroke-linecap="round"/>`, `<path d="M ${rightShoulderX - 5} ${shoulderY - 2} Q ${rigMidX + 9} ${rigTopY + 2} ${rigMidX + 7} ${rigTopY + 6}" fill="none" stroke="#cbd5e1" stroke-width="3.2" stroke-linecap="round"/>`, 
        // Hip-ring harness webbing connecting bottom corners of rig to hips
        `<line x1="${rigMidX - 8}" y1="${rigBotY - 1}" x2="${leftHipX - 2}" y2="${hipY + 2}" stroke="#94a3b8" stroke-width="2.2"/>`, `<line x1="${rigMidX + 8}" y1="${rigBotY - 1}" x2="${rightHipX + 2}" y2="${hipY + 2}" stroke="#94a3b8" stroke-width="2.2"/>`, 
        // 3D Sculpted Parachute Container (rounded ergonomic hardshell pack)
        `<path d="M ${rigMidX - 8.5} ${rigTopY + 2} Q ${rigMidX} ${rigTopY - 2} ${rigMidX + 8.5} ${rigTopY + 2} L ${rigMidX + 9.5} ${rigBotY - 2} Q ${rigMidX} ${rigBotY + 3} ${rigMidX - 9.5} ${rigBotY - 2} Z" fill="url(#wsRig3D)" stroke="#070a10" stroke-width="1.5"/>`, 
        // 3D Top Bevel Highlight catching sky light (overlaps lower neck of helmet)
        `<path d="M ${rigMidX - 7.5} ${rigTopY + 2} Q ${rigMidX} ${rigTopY - 1} ${rigMidX + 7.5} ${rigTopY + 2} Q ${rigMidX} ${rigTopY + 4.5} ${rigMidX - 7.5} ${rigTopY + 2} Z" fill="#94a3b8" opacity="0.75"/>`, 
        // 4-Flap Container Seams & Bridle Cover
        `<path d="M ${rigMidX - 7.5} ${rigTopY + 3} L ${rigMidX} ${Math.round((rigTopY + rigBotY) * 0.5)} L ${rigMidX + 7.5} ${rigTopY + 3}" fill="none" stroke="#090d16" stroke-width="1.3"/>`, `<path d="M ${rigMidX - 8.5} ${rigBotY - 2} L ${rigMidX} ${Math.round((rigTopY + rigBotY) * 0.5)} L ${rigMidX + 8.5} ${rigBotY - 2}" fill="none" stroke="#090d16" stroke-width="1.3"/>`, `<rect x="${rigMidX - 2.2}" y="${rigTopY + 3}" width="4.4" height="${Math.max(5, rigBotY - rigTopY - 5)}" rx="1.8" fill="#00f5d4" stroke="#070a10" stroke-width="0.9"/>`, 
        // BOC Throw-Out Pilot Chute Handle at bottom-right of pack
        `<circle cx="${rigMidX + 8}" cy="${rigBotY}" r="2.8" fill="#ffbe0b" stroke="#070a10" stroke-width="1.1"/>`);
        // =========================================================================
        // 6. FOREGROUND 3D SKYDIVING BOOTS (Full Boot Volume + Angled Soles Facing Camera)
        // =========================================================================
        parts.push(
        // Left Boot
        `<g transform="translate(${leftFootX}, ${leftFootY}) rotate(-16)">`, `<path d="M -5.5 -6.5 Q 0 -9 5.5 -6.5 L 6.2 4 Q 0 7.5 -6.2 4 Z" fill="#1e293b" stroke="#070a10" stroke-width="1.5"/>`, `<rect x="-4.5" y="-5" width="9" height="9.5" rx="3.5" fill="#090d14" stroke="#64748b" stroke-width="1"/>`, `<line x1="-3" y1="-2.2" x2="3" y2="-2.2" stroke="#334155" stroke-width="1.6"/>`, `<line x1="-3" y1="0.4" x2="3" y2="0.4" stroke="#334155" stroke-width="1.6"/>`, `<rect x="-3.2" y="2.2" width="6.4" height="2.6" rx="1.2" fill="#00f5d4"/>`, `</g>`, 
        // Right Boot
        `<g transform="translate(${rightFootX}, ${rightFootY}) rotate(16)">`, `<path d="M -5.5 -6.5 Q 0 -9 5.5 -6.5 L 6.2 4 Q 0 7.5 -6.2 4 Z" fill="#1e293b" stroke="#070a10" stroke-width="1.5"/>`, `<rect x="-4.5" y="-5" width="9" height="9.5" rx="3.5" fill="#090d14" stroke="#64748b" stroke-width="1"/>`, `<line x1="-3" y1="-2.2" x2="3" y2="-2.2" stroke="#334155" stroke-width="1.6"/>`, `<line x1="-3" y1="0.4" x2="3" y2="0.4" stroke="#334155" stroke-width="1.6"/>`, `<rect x="-3.2" y="2.2" width="6.4" height="2.6" rx="1.2" fill="#00f5d4"/>`, `</g>`);
        const s = pose.scale.toFixed(2);
        return `<g transform="scale(${s})">${parts.join("")}</g>`;
    }

    /**
     * Total panoramic coordinate space across the 4x2 Stream Deck + key grid.
     * Each key is 144x144 with a 16px virtual bezel gap between adjacent keys:
     * Width = 4 * 144 + 3 * 16 = 624
     * Height = 2 * 144 + 1 * 16 = 304
     */
    const GRID_TOTAL_W = 624;
    const GRID_TOTAL_H = 304;
    const KEY_SIZE = 144;
    const KEY_STRIDE = 160; // 144 + 16 bezel gap
    /**
     * Unified panoramic coordinate space across the 4 Stream Deck + Touch Strip slots.
     * 4 slots x 200px = 800x100 continuous telemetry dashboard.
     */
    const TOUCH_STRIP_TOTAL_W = 800;
    const TOUCH_STRIP_TOTAL_H = 100;
    const TOUCH_SLOT_W = 200;
    function formatNumber(n) {
        return Math.floor(Math.max(0, n)).toLocaleString("en-US");
    }
    /**
     * Renders the Fighter-Jet / Extreme-Sports Helmet Visor HUD Overlay across the 624x304 4x2 Key Grid.
     * All primary text readouts are positioned within the 144x144 key safe-zones:
     * - Col 0: x=0..144   | Col 1: x=160..304 | Col 2: x=320..464 | Col 3: x=480..624
     * - Row 0: y=0..144   | Row 1: y=160..304
     * while structural visor arcs, reticles, and rails flow continuously across the panoramic viewport.
     */
    function buildVisorHudOverlaySvg(engine, currentSlice, birdX, birdY) {
        const W = GRID_TOTAL_W;
        const agl = Math.max(0, Math.round(engine.playerY - currentSlice.floorY));
        const rimAgl = Math.max(10, Math.round(currentSlice.rimY - currentSlice.floorY));
        const halfWidth = engine.getHalfWidthAtY(currentSlice, engine.playerY);
        const offsetFromCenter = engine.playerX - currentSlice.centerX;
        const wallClearance = Math.max(0, Math.round(halfWidth - Math.abs(offsetFromCenter)));
        const spd = Math.round(engine.speed);
        const distMeters = Math.round(engine.distanceTraveled);
        const distKm = (engine.distanceTraveled / 1000).toFixed(2);
        const mult = engine.proximityMultiplier;
        const scoreInt = Math.floor(engine.score);
        const highInt = Math.floor(engine.highScore);
        const isLowAlt = engine.phase === "FLYING" && agl < 18;
        const isNearStall = engine.phase === "FLYING" && spd < engine.STALL_SPEED + 18;
        const isNearWall = engine.phase === "FLYING" && engine.playerY < currentSlice.rimY && wallClearance < 12;
        const isDanger = isLowAlt || isNearStall || isNearWall || engine.phase === "CARNAGE";
        const hudPrimary = engine.phase === "CARNAGE"
            ? "#ff2a2a"
            : isDanger && engine.tickCount % 2 === 0
                ? "#ff2a2a"
                : mult >= 2.5
                    ? "#ffbe0b"
                    : "#00f5d4";
        const hudSecondary = "#38bdf8";
        const speedCol = spd < engine.STALL_SPEED + 18
            ? "#00bbf9"
            : spd > 220
                ? "#ff2a2a"
                : spd > 175
                    ? "#ffbe0b"
                    : "#00f5d4";
        const altCol = agl < 18
            ? "#ff2a2a"
            : agl < 30
                ? "#ffbe0b"
                : "#00f5d4";
        const multCol = mult >= 3.5
            ? "#ff2a2a"
            : mult >= 2.0
                ? "#ffbe0b"
                : "#00f5d4";
        const hud = [];
        // 1. Panoramic Visor Corner Frame & Tactical Brackets (Outer perimeter of the 4x2 grid)
        hud.push(
        // Top-left & Bottom-left visor rails (Col 0)
        `<path d="M 4 36 L 4 10 L 14 4 L 54 4" fill="none" stroke="${hudPrimary}" stroke-width="2" opacity="0.85"/>`, `<path d="M 4 268 L 4 294 L 14 300 L 54 300" fill="none" stroke="${hudPrimary}" stroke-width="2" opacity="0.85"/>`, 
        // Top-right & Bottom-right visor rails (Col 3)
        `<path d="M ${W - 4} 36 L ${W - 4} 10 L ${W - 14} 4 L ${W - 54} 4" fill="none" stroke="${hudPrimary}" stroke-width="2" opacity="0.85"/>`, `<path d="M ${W - 4} 268 L ${W - 4} 294 L ${W - 14} 300 L ${W - 54} 300" fill="none" stroke="${hudPrimary}" stroke-width="2" opacity="0.85"/>`);
        // 2. Center Visor Flight-Path Vector & Pitch/Bank Reticle (Cols 1 & 2 around Birdman)
        if (engine.phase !== "CARNAGE") {
            const reticleR = 64;
            const leftWallWarn = engine.playerY < currentSlice.rimY && offsetFromCenter < 0 && wallClearance < 16;
            const rightWallWarn = engine.playerY < currentSlice.rimY && offsetFromCenter > 0 && wallClearance < 16;
            const leftArcCol = leftWallWarn ? "#ff2a2a" : hudPrimary;
            const rightArcCol = rightWallWarn ? "#ff2a2a" : hudPrimary;
            hud.push(`<g transform="translate(${birdX},${birdY}) rotate(${(-engine.roll * 0.5).toFixed(1)})" opacity="0.72">`, 
            // Left and right tactical visor bracket arcs around the birdman
            `<path d="M ${-reticleR} -22 A ${reticleR} ${reticleR} 0 0 0 ${-reticleR} 22" fill="none" stroke="${leftArcCol}" stroke-width="${leftWallWarn ? 3 : 1.5}"/>`, `<path d="M ${reticleR} -22 A ${reticleR} ${reticleR} 0 0 1 ${reticleR} 22" fill="none" stroke="${rightArcCol}" stroke-width="${rightWallWarn ? 3 : 1.5}"/>`, `<line x1="${-reticleR - 8}" y1="0" x2="${-reticleR + 6}" y2="0" stroke="${leftArcCol}" stroke-width="2"/>`, `<line x1="${reticleR - 6}" y1="0" x2="${reticleR + 8}" y2="0" stroke="${rightArcCol}" stroke-width="2"/>`, 
            // Pitch reference bars
            `<line x1="-28" y1="-34" x2="-12" y2="-34" stroke="${hudSecondary}" stroke-width="1.2" opacity="0.7"/>`, `<line x1="12" y1="-34" x2="28" y2="-34" stroke="${hudSecondary}" stroke-width="1.2" opacity="0.7"/>`, `<line x1="-22" y1="34" x2="-10" y2="34" stroke="${hudSecondary}" stroke-width="1.2" opacity="0.7"/>`, `<line x1="10" y1="34" x2="22" y2="34" stroke="${hudSecondary}" stroke-width="1.2" opacity="0.7"/>`, `</g>`);
        }
        // =========================================================================
        // 3. LEFT VISOR COLUMN (Col 0: x = 0..144)
        //    Row 0 (y = 0..144): SPEED (MPH) & Fighter-Jet Airspeed Tape
        //    Row 1 (y = 160..304): DISTANCE TRAVELED (KM / M) & PITCH TELEMETRY
        // =========================================================================
        const speedRatio = Math.max(0, Math.min(1, (spd - engine.STALL_SPEED) / (engine.MAX_SPEED - engine.STALL_SPEED)));
        const speedBarH = Math.round(speedRatio * 84);
        const speedBarY = 128 - speedBarH;
        hud.push(
        // Row 0 Left: Airspeed Tape & Readout (x=8..136, y=10..136)
        `<path d="M 8 10 L 130 10 L 136 16 L 136 62 L 130 68 L 40 68 L 40 134 L 8 134 Z" fill="#060b16" opacity="0.78" stroke="${speedCol}" stroke-width="1.5"/>`, 
        // Vertical Airspeed Tape Bar (x=13..33, y=44..128)
        `<rect x="13" y="44" width="18" height="84" rx="2" fill="#0f172a" stroke="#1e293b" stroke-width="1"/>`, 
        // Stall danger zone at bottom of tape
        `<rect x="14" y="114" width="16" height="13" fill="#00bbf9" opacity="0.35"/>`, 
        // High-speed redline zone at top of tape
        `<rect x="14" y="45" width="16" height="16" fill="#ff2a2a" opacity="0.35"/>`, 
        // Live Speed fill
        `<rect x="14" y="${speedBarY}" width="16" height="${speedBarH}" rx="1" fill="${speedCol}" opacity="0.9"/>`, 
        // Tape tick marks
        `<line x1="27" y1="56" x2="32" y2="56" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`, `<line x1="27" y1="74" x2="32" y2="74" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`, `<line x1="27" y1="92" x2="32" y2="92" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`, `<line x1="27" y1="110" x2="32" y2="110" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`, 
        // Speed Header & Big Readout
        `<text x="14" y="24" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">AIRSPEED</text>`, `<text x="130" y="24" text-anchor="end" fill="${speedCol}" font-family="Arial, sans-serif" font-weight="900" font-size="9">MPH</text>`, `<text x="86" y="52" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="26">${spd}</text>`, `<text x="86" y="64" text-anchor="middle" fill="${speedCol}" font-family="Arial, sans-serif" font-weight="800" font-size="9">${spd <= engine.STALL_SPEED + 15 ? "STALL WARN!" : `STALL ${engine.STALL_SPEED}`}</text>`);
        // Row 1 Left: Distance Traveled & Pitch Attitude (x=8..136, y=168..294)
        const pitchDeg = Math.round(engine.pitch);
        const pitchLabel = pitchDeg >= 0 ? `+${pitchDeg}° CLIMB` : `${pitchDeg}° DIVE`;
        const boostMph = Math.round(engine.distanceSpeedBoost);
        hud.push(`<path d="M 8 170 L 130 170 L 136 176 L 136 292 L 14 292 L 8 286 Z" fill="#060b16" opacity="0.78" stroke="#38bdf8" stroke-width="1.5"/>`, `<text x="15" y="186" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">DISTANCE</text>`, `<text x="129" y="186" text-anchor="end" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="800" font-size="9">KM</text>`, `<text x="15" y="213" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="24">${distKm}</text>`, `<text x="15" y="228" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="10">${formatNumber(distMeters)} M  |  +${boostMph} MPH</text>`, `<line x1="14" y1="236" x2="130" y2="236" stroke="#1e293b" stroke-width="1.5"/>`, `<text x="15" y="252" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="800" font-size="9">PITCH ATTITUDE</text>`, `<text x="15" y="270" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="14">${pitchLabel}</text>`, `<text x="15" y="284" fill="#64748b" font-family="Arial, sans-serif" font-weight="800" font-size="8.5">DIAL 1: CLIMB / DIVE</text>`);
        // =========================================================================
        // 4. RIGHT VISOR COLUMN (Col 3: x = 480..624)
        //    Row 0 (y = 0..144): ALTITUDE (FT AGL) & Radar Altimeter Tape
        //    Row 1 (y = 160..304): MULTIPLIER, SCORE & HIGH SCORE VISOR MODULE
        // =========================================================================
        const altRatio = Math.max(0, Math.min(1, agl / Math.max(1, rimAgl)));
        const altBarH = Math.round(altRatio * 84);
        const altBarY = 128 - altBarH;
        hud.push(
        // Row 0 Right: Altimeter Tape & Readout (x=488..616, y=10..136)
        `<path d="M 494 10 L 616 10 L 616 134 L 584 134 L 584 68 L 494 68 L 488 62 L 488 16 Z" fill="#060b16" opacity="0.78" stroke="${altCol}" stroke-width="1.5"/>`, 
        // Vertical Altitude Tape Bar (x=591..611, y=44..128)
        `<rect x="591" y="44" width="18" height="84" rx="2" fill="#0f172a" stroke="#1e293b" stroke-width="1"/>`, 
        // Low-altitude terrain danger zone at bottom of tape
        `<rect x="592" y="110" width="16" height="17" fill="#ff2a2a" opacity="0.4"/>`, 
        // Live Altitude fill
        `<rect x="592" y="${altBarY}" width="16" height="${altBarH}" rx="1" fill="${altCol}" opacity="0.9"/>`, 
        // Tape tick marks
        `<line x1="591" y1="56" x2="596" y2="56" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`, `<line x1="591" y1="74" x2="596" y2="74" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`, `<line x1="591" y1="92" x2="596" y2="92" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`, `<line x1="591" y1="110" x2="596" y2="110" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`, 
        // Altitude Header & Big Readout
        `<text x="495" y="24" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">ALTITUDE</text>`, `<text x="580" y="24" text-anchor="end" fill="${altCol}" font-family="Arial, sans-serif" font-weight="900" font-size="9">FT</text>`, `<text x="538" y="52" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="26">${agl}</text>`, `<text x="538" y="64" text-anchor="middle" fill="${altCol}" font-family="Arial, sans-serif" font-weight="800" font-size="9">${agl < 18 ? "PULL UP!" : `RIM ${rimAgl} FT`}</text>`);
        // Row 1 Right: Multiplier, Score & High Score Visor Card (x=488..616, y=170..292)
        const multPct = Math.max(0, Math.min(1, (mult - 1.0) / 4.0));
        const multBarW = Math.round(multPct * 112);
        hud.push(`<path d="M 494 170 L 616 170 L 616 286 L 610 292 L 488 292 L 488 176 Z" fill="#060b16" opacity="0.80" stroke="${multCol}" stroke-width="1.5"/>`, 
        // Multiplier row
        `<text x="496" y="186" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="0.8">MULT</text>`, `<text x="608" y="188" text-anchor="end" fill="${multCol}" font-family="Arial, sans-serif" font-weight="900" font-size="16">x${mult.toFixed(1)}</text>`, `<rect x="496" y="193" width="112" height="6" rx="3" fill="#0f172a" stroke="#1e293b" stroke-width="1"/>`, `<rect x="496" y="193" width="${Math.max(8, multBarW)}" height="6" rx="3" fill="${multCol}"/>`, 
        // Score readout
        `<text x="496" y="214" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="9" letter-spacing="0.8">SCORE</text>`, `<text x="608" y="214" text-anchor="end" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="800" font-size="8.5">${engine.isNewHighScore ? "NEW BEST!" : "LIVE"}</text>`, `<text x="496" y="236" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="20">${formatNumber(scoreInt)}</text>`, `<line x1="496" y1="244" x2="608" y2="244" stroke="#1e293b" stroke-width="1.5"/>`, 
        // High Score readout
        `<text x="496" y="259" fill="#ffd166" font-family="Arial, sans-serif" font-weight="900" font-size="9" letter-spacing="0.8">HIGH SCORE</text>`, `<text x="496" y="278" fill="#ffd166" font-family="Arial, sans-serif" font-weight="900" font-size="16">${formatNumber(highInt)}</text>`, `<text x="496" y="288" fill="#64748b" font-family="Arial, sans-serif" font-weight="800" font-size="8">DIAL 4: STEER L/R</text>`);
        // =========================================================================
        // 5. TOP-CENTER VISOR TELEMETRY BAR (Col 1: x=168..298, Col 2: x=326..456)
        //    Shown during active flight when no modal banner is covering the top center
        // =========================================================================
        if (engine.phase === "FLYING" && !isLowAlt && !isNearStall) {
            hud.push(
            // Col 1 Top Visor Pill: Proximity Multiplier & Wall Clearance
            `<rect x="170" y="8" width="128" height="28" rx="6" fill="#060b16" opacity="0.76" stroke="${multCol}" stroke-width="1.2"/>`, `<text x="178" y="26" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="10">PROX</text>`, `<text x="290" y="27" text-anchor="end" fill="${multCol}" font-family="Arial, sans-serif" font-weight="900" font-size="15">x${mult.toFixed(1)}</text>`, 
            // Col 2 Top Visor Pill: Live Score & High Score
            `<rect x="326" y="8" width="128" height="28" rx="6" fill="#060b16" opacity="0.76" stroke="#00f5d4" stroke-width="1.2"/>`, `<text x="334" y="26" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="10">SCR</text>`, `<text x="446" y="27" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="14">${formatNumber(scoreInt)}</text>`);
        }
        return hud.join("");
    }
    /**
     * Builds the inner SVG elements for the entire 624x304 panoramic 3D viewport once per frame.
     * The birdman stays centered in the middle of the display while the 3D canyon path adjusts,
     * shifts, and tilts around him as he banks left/right or climbs/dives!
     */
    function buildMasterSceneSvgBody(engine) {
        const W = GRID_TOTAL_W;
        const H = GRID_TOTAL_H;
        // Screen shake during carnage
        const shakeX = engine.screenShake > 0
            ? Math.round(Math.sin(engine.tickCount * 2.7) * engine.screenShake)
            : 0;
        const shakeY = engine.screenShake > 0
            ? Math.round(Math.cos(engine.tickCount * 3.3) * engine.screenShake)
            : 0;
        const currentSlice = engine.sampleCanyonAt(engine.playerZ);
        // Camera is locked onto the birdman in the center; banking adjusts the canyon path ahead!
        const camX = engine.playerX;
        const camY = engine.playerY + 13 - engine.pitch * 0.25;
        const horizonY = Math.round(112 + engine.pitch * 1.75);
        const worldTiltDeg = -engine.roll * 0.42; // Canyon horizon tilts opposite to birdman bank
        const bankYawShift = -engine.roll * 1.65; // Banking shifts the canyon path across the viewport
        const parts = [];
        // Shared gradients
        parts.push(`<defs>
    <linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d0628"/>
      <stop offset="45%" stop-color="#3b1254"/>
      <stop offset="80%" stop-color="#a82845"/>
      <stop offset="100%" stop-color="#ff8c42"/>
    </linearGradient>
    <linearGradient id="plateauG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5c1b29"/>
      <stop offset="100%" stop-color="#2a0a14"/>
    </linearGradient>
  </defs>`);
        if (shakeX !== 0 || shakeY !== 0) {
            parts.push(`<g transform="translate(${shakeX},${shakeY})">`);
        }
        // Rotate the 3D canyon world subtly around the centered birdman as he banks left or right
        parts.push(`<g transform="rotate(${worldTiltDeg.toFixed(1)}, ${W * 0.5}, ${H * 0.6})">`);
        // 1. Sky & Sunset Sun (extra wide margin so rotating the horizon never exposes corners)
        const clampedHorizon = Math.max(-40, Math.min(H + 40, horizonY));
        parts.push(`<rect x="-180" y="-180" width="${W + 360}" height="${clampedHorizon + 200}" fill="url(#skyG)"/>`);
        // Glowing sunset sun on the horizon
        const farSlice = engine.sampleCanyonAt(engine.playerZ + 480);
        const sunX = Math.round(W * 0.5 + (farSlice.centerX - camX) * 0.8 + bankYawShift);
        const sunY = Math.round(clampedHorizon - 14);
        parts.push(`<circle cx="${sunX}" cy="${sunY}" r="54" fill="#ff9f1c" opacity="0.28"/>`, `<circle cx="${sunX}" cy="${sunY}" r="34" fill="#ffd166" opacity="0.82"/>`);
        // Upper plateau ground outside the canyon rim
        parts.push(`<rect x="-180" y="${clampedHorizon}" width="${W + 360}" height="${H - clampedHorizon + 220}" fill="url(#plateauG)"/>`);
        // 2. Sample & project 3D canyon slices from far to near
        const numSlices = 18;
        const stepZ = 28;
        const baseZ = Math.floor(engine.playerZ / stepZ) * stepZ;
        const projected = [];
        const fov = 260;
        for (let i = numSlices; i >= 1; i--) {
            const worldZ = baseZ + i * stepZ;
            const relZ = Math.max(12, worldZ - engine.playerZ);
            const slice = engine.sampleCanyonAt(worldZ);
            const scale = fov / (relZ + 22);
            // As the player banks left/right, the path of the canyon adjusts relative to the centered birdman
            const depthBankShift = bankYawShift * (relZ / 180);
            const projectX = (wx) => Math.round(W * 0.5 + (wx - camX) * scale + depthBankShift);
            const projectY = (wy) => Math.round(clampedHorizon - (wy - camY) * scale);
            const midHalfW = slice.floorHalfWidth + (slice.rimHalfWidth - slice.floorHalfWidth) * 0.52;
            const midWorldY = slice.floorY + (slice.rimY - slice.floorY) * 0.52;
            projected.push({
                slice,
                scale,
                floorLeftX: projectX(slice.centerX - slice.floorHalfWidth),
                floorRightX: projectX(slice.centerX + slice.floorHalfWidth),
                floorY: projectY(slice.floorY),
                midLeftX: projectX(slice.centerX - midHalfW),
                midRightX: projectX(slice.centerX + midHalfW),
                midY: projectY(midWorldY),
                rimLeftX: projectX(slice.centerX - slice.rimHalfWidth),
                rimRightX: projectX(slice.centerX + slice.rimHalfWidth),
                rimY: projectY(slice.rimY),
                riverLeftX: projectX(slice.centerX - slice.floorHalfWidth * 0.36),
                riverRightX: projectX(slice.centerX + slice.floorHalfWidth * 0.36)
            });
        }
        // Palette for sandstone rock strata
        const leftUpperColors = ["#c84b31", "#d96b43", "#b83b2b", "#e07a5f", "#a63429", "#cf5c36"];
        const leftLowerColors = ["#9e3321", "#b04128", "#8c281c", "#b84a32", "#7d2218", "#993622"];
        const rightUpperColors = ["#781d2a", "#8a2432", "#691723", "#942b38", "#5c131f", "#7d202d"];
        const rightLowerColors = ["#54111c", "#631622", "#470d17", "#6e1b27", "#3d0a13", "#59131e"];
        const floorColors = ["#2e0d17", "#38111c", "#260a13", "#330f19", "#2b0c15", "#36101b"];
        // Render back-to-front quads between consecutive depth slices
        for (let i = 0; i < projected.length - 1; i++) {
            const far = projected[i];
            const near = projected[i + 1];
            const sIdx = near.slice.strataIndex;
            const plateauCol = sIdx % 2 === 0 ? "#4a1522" : "#3d101b";
            parts.push(`<polygon points="-180,${far.rimY} ${far.rimLeftX},${far.rimY} ${near.rimLeftX},${near.rimY} -180,${near.rimY}" fill="${plateauCol}"/>`, `<polygon points="${far.rimRightX},${far.rimY} ${W + 180},${far.rimY} ${W + 180},${near.rimY} ${near.rimRightX},${near.rimY}" fill="${plateauCol}"/>`);
            // Canyon Floor quad
            parts.push(`<polygon points="${far.floorLeftX},${far.floorY} ${far.floorRightX},${far.floorY} ${near.floorRightX},${near.floorY} ${near.floorLeftX},${near.floorY}" fill="${floorColors[sIdx]}"/>`);
            // Winding river along the canyon floor
            const riverCol = sIdx % 2 === 0 ? "#1982c4" : "#2ec4b6";
            parts.push(`<polygon points="${far.riverLeftX},${far.floorY} ${far.riverRightX},${far.floorY} ${near.riverRightX},${near.floorY} ${near.riverLeftX},${near.floorY}" fill="${riverCol}" opacity="0.75"/>`);
            // Left Cliff Wall
            parts.push(`<polygon points="${far.rimLeftX},${far.rimY} ${near.rimLeftX},${near.rimY} ${near.midLeftX},${near.midY} ${far.midLeftX},${far.midY}" fill="${leftUpperColors[sIdx]}" stroke="#2a0810" stroke-width="0.6"/>`, `<polygon points="${far.midLeftX},${far.midY} ${near.midLeftX},${near.midY} ${near.floorLeftX},${near.floorY} ${far.floorLeftX},${far.floorY}" fill="${leftLowerColors[sIdx]}" stroke="#2a0810" stroke-width="0.6"/>`);
            // Right Cliff Wall
            parts.push(`<polygon points="${far.rimRightX},${far.rimY} ${near.rimRightX},${near.rimY} ${near.midRightX},${near.midY} ${far.midRightX},${far.midY}" fill="${rightUpperColors[sIdx]}" stroke="#1f050b" stroke-width="0.6"/>`, `<polygon points="${far.midRightX},${far.midY} ${near.midRightX},${near.midY} ${near.floorRightX},${near.floorY} ${far.floorRightX},${far.floorY}" fill="${rightLowerColors[sIdx]}" stroke="#1f050b" stroke-width="0.6"/>`);
            // Optional natural stone arch spanning the canyon
            if (near.slice.hasArch) {
                const archTopY = near.rimY + Math.round(8 * near.scale);
                const archBotY = near.rimY + Math.round(22 * near.scale);
                parts.push(`<polygon points="${near.rimLeftX},${archTopY} ${near.rimRightX},${archTopY} ${near.midRightX},${archBotY} ${near.midLeftX},${archBotY}" fill="#8f2d24" stroke="#ff9f1c" stroke-width="1"/>`);
            }
        }
        // Close rotated canyon world group
        parts.push(`</g>`);
        // 3. High-speed wind streaks (intensify as distance & speed increase!)
        if (engine.phase === "FLYING" && engine.speed > 140) {
            const intensity = Math.min(1, (engine.speed - 140) / 110);
            const numStreaks = Math.round(6 + intensity * 8);
            for (let w = 0; w < numStreaks; w++) {
                const angle = (w * Math.PI * 2) / numStreaks + (engine.tickCount * 0.19) % 0.7;
                const r1 = 95 + ((engine.tickCount * 29 + w * 41) % 95);
                const r2 = r1 + 40 + intensity * 65;
                const x1 = Math.round(W * 0.5 + Math.cos(angle) * r1);
                const y1 = Math.round(H * 0.55 + Math.sin(angle) * r1 * 0.6);
                const x2 = Math.round(W * 0.5 + Math.cos(angle) * r2);
                const y2 = Math.round(H * 0.55 + Math.sin(angle) * r2 * 0.6);
                parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="${(1 + intensity * 1.8).toFixed(1)}" opacity="${(0.22 + intensity * 0.5).toFixed(2)}" stroke-linecap="round"/>`);
            }
        }
        // 4. 3rd-Person Birdman stays horizontally centered in the middle of the 4x2 grid!
        const birdX = Math.round(W * 0.5);
        const birdY = Math.round(H * 0.6 - Math.max(-55, Math.min(65, engine.pitch * 0.95)));
        // Birdman's shadow on the canyon floor when flying low
        const agl = Math.max(0, engine.playerY - currentSlice.floorY);
        if (agl < 65 && engine.phase !== "CARNAGE") {
            const shadowY = Math.min(H - 8, Math.round(birdY + agl * 2.2));
            const shadowScale = Math.max(0.25, 1 - agl / 70);
            parts.push(`<ellipse cx="${birdX}" cy="${shadowY}" rx="${Math.round(34 * shadowScale)}" ry="${Math.round(8 * shadowScale)}" fill="#090206" opacity="${(0.55 * shadowScale).toFixed(2)}"/>`);
        }
        // 5. Render Cockpit / Visor Telemetry HUD Overlay on the 4x2 Viewport
        parts.push(buildVisorHudOverlaySvg(engine, currentSlice, birdX, birdY));
        if (engine.phase === "CARNAGE") {
            // Explosive 3rd-person carnage at impact site + blood splats across the 4x2 keys
            parts.push(`<g transform="translate(${birdX},${birdY})">`);
            const shockR = Math.min(220, Math.round(24 + engine.phaseElapsedSec * 190));
            const shockOpacity = Math.max(0, 0.85 - engine.phaseElapsedSec * 0.55);
            if (shockOpacity > 0.04) {
                parts.push(`<circle cx="0" cy="0" r="${shockR}" fill="none" stroke="#ff2a2a" stroke-width="5" opacity="${shockOpacity.toFixed(2)}"/>`, `<circle cx="0" cy="0" r="${Math.round(shockR * 0.65)}" fill="#8d0801" opacity="${(shockOpacity * 0.7).toFixed(2)}"/>`);
            }
            for (const p of engine.particles) {
                const px = Math.round(p.x);
                const py = Math.round(p.y);
                if (p.kind === "helmet") {
                    parts.push(`<g transform="translate(${px},${py}) rotate(${Math.round(p.rotation)})">`, `<circle cx="0" cy="0" r="10" fill="#ffffff" stroke="#111" stroke-width="2"/>`, `<path d="M-7 -3 Q0 -8 7 -3 L5 3 Q0 5 -5 3 Z" fill="#00f5d4"/>`, `<path d="M-4 -8 L3 8" stroke="#d90429" stroke-width="2.5"/>`, `</g>`);
                }
                else if (p.kind === "wing" || p.kind === "gib") {
                    parts.push(`<polygon points="${px},${py - p.size} ${px + p.size},${py + p.size * 0.6} ${px - p.size * 0.8},${py + p.size}" fill="${p.color}" stroke="#3b0000" stroke-width="1"/>`);
                }
                else {
                    parts.push(`<circle cx="${px}" cy="${py}" r="${Math.round(p.size)}" fill="${p.color}" opacity="0.9"/>`);
                }
            }
            parts.push(`</g>`);
            // Visceral blood splatters on the camera lens / LCD keys
            for (const s of engine.screenSplats) {
                const sx = Math.round(s.nx * W);
                const sy = Math.round(s.ny * H);
                const r = Math.round(s.radius);
                const drip = Math.round(s.dripLength);
                parts.push(`<circle cx="${sx}" cy="${sy}" r="${r}" fill="${s.color}" opacity="0.82"/>`, `<circle cx="${sx + Math.round(r * 0.7)}" cy="${sy - Math.round(r * 0.5)}" r="${Math.round(r * 0.4)}" fill="${s.color}" opacity="0.85"/>`, `<circle cx="${sx - Math.round(r * 0.65)}" cy="${sy + Math.round(r * 0.4)}" r="${Math.round(r * 0.35)}" fill="${s.color}" opacity="0.85"/>`, `<rect x="${sx - 3}" y="${sy}" width="6" height="${r + drip}" rx="3" fill="${s.color}" opacity="0.85"/>`);
            }
            // Carnage banner across the center of the 4x2 grid (Cols 1 & 2)
            parts.push(`<rect x="164" y="88" width="296" height="122" rx="12" fill="#140206" opacity="0.92" stroke="#ff1e27" stroke-width="3"/>`, `<text x="312" y="126" text-anchor="middle" fill="#ff2a2a" font-family="Arial, sans-serif" font-weight="900" font-size="28" letter-spacing="1.5">CARNAGE! SPLAT!</text>`, `<text x="312" y="152" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="13">${engine.lastCrashReason}</text>`, `<text x="312" y="172" text-anchor="middle" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="800" font-size="12">IMPACT: ${engine.crashSpeed} MPH  |  DIST: ${(engine.distanceTraveled / 1000).toFixed(2)} KM</text>`, `<text x="312" y="196" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="16">SCORE: ${formatNumber(engine.score)}  |  BEST: ${formatNumber(engine.highScore)}</text>`);
        }
        else {
            // Render 3rd-person Birdman centered in the viewport
            parts.push(`<g transform="translate(${birdX},${birdY}) rotate(${engine.roll.toFixed(1)})">`, renderBirdmanSprite(engine), `</g>`);
            // Overlay Status Banners in Center Columns (Cols 1 & 2: x=166..458) for READY, CHUTE, or DANGER states
            if (engine.phase === "READY") {
                parts.push(`<rect x="166" y="10" width="292" height="52" rx="10" fill="#060b16" opacity="0.88" stroke="#00f5d4" stroke-width="2"/>`, `<text x="312" y="33" text-anchor="middle" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="16" letter-spacing="1">TURN ANY DIAL TO DROP IN!</text>`, `<text x="312" y="52" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="700" font-size="11">DIAL 1: PITCH / SPEED   |   DIAL 4: STEER L/R</text>`);
            }
            else if (engine.phase === "CHUTE") {
                const landed = engine.speed === 0;
                parts.push(`<rect x="166" y="10" width="292" height="60" rx="10" fill="#071e26" opacity="0.90" stroke="#00f5d4" stroke-width="2.5"/>`, `<text x="312" y="32" text-anchor="middle" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="16">${landed ? "SAFE LANDING! RUN COMPLETE" : "CHUTE DEPLOYED! (STALL)"}</text>`, `<text x="312" y="56" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="900" font-size="14">SCORE: ${formatNumber(engine.score)}  |  DIST: ${(engine.distanceTraveled / 1000).toFixed(2)} KM</text>`);
            }
            else if (engine.phase === "FLYING" && engine.speed < engine.STALL_SPEED + 16) {
                if (engine.tickCount % 2 === 0) {
                    parts.push(`<rect x="176" y="10" width="272" height="32" rx="8" fill="#00bbf9" opacity="0.92"/>`, `<text x="312" y="31" text-anchor="middle" fill="#060614" font-family="Arial, sans-serif" font-weight="900" font-size="15">STALL WARNING! DIVE FOR SPEED!</text>`);
                }
            }
            else if (engine.phase === "FLYING" && agl < 16) {
                if (engine.tickCount % 2 === 0) {
                    parts.push(`<rect x="182" y="10" width="260" height="32" rx="8" fill="#ff2a2a" opacity="0.92"/>`, `<text x="312" y="31" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="15">PULL UP! TERRAIN PROXIMITY!</text>`);
                }
            }
        }
        if (shakeX !== 0 || shakeY !== 0) {
            parts.push(`</g>`);
        }
        return parts.join("");
    }
    /**
     * Slices out a single 144x144 key image at (col, row) from the master panoramic SVG body.
     */
    function renderKeyTileSvg(masterBody, col, row) {
        const clampedCol = Math.max(0, Math.min(3, col));
        const clampedRow = Math.max(0, Math.min(1, row));
        const vx = clampedCol * KEY_STRIDE;
        const vy = clampedRow * KEY_STRIDE;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${KEY_SIZE}" height="${KEY_SIZE}" viewBox="${vx} ${vy} ${KEY_SIZE} ${KEY_SIZE}">${masterBody}</svg>`;
    }
    /**
     * Builds the unified panoramic 800x100 Stream Deck + Touch Strip telemetry dashboard.
     * Flows seamlessly across all 4 dial slots (0..200, 200..400, 400..600, 600..800) with:
     * - Continuous fighter-jet carbon/neon cockpit rails & panoramic energy bar
     * - Slot 0 (0..200):   SPEED (MPH), Stall/Redline Gauge & Pitch Horizon
     * - Slot 1 (200..400): DISTANCE TRAVELED (KM & M) + ALTITUDE (FT AGL) & Canyon Radar
     * - Slot 2 (400..600): MULTIPLIER (x1.0..x5.0 Proximity Gauge) + LIVE SCORE
     * - Slot 3 (600..800): HIGH SCORE (Record Board) + STEERING / BANK ALIGNMENT
     */
    function buildMasterTouchStripSvgBody(engine) {
        const W = TOUCH_STRIP_TOTAL_W; // 800
        const H = TOUCH_STRIP_TOTAL_H; // 100
        const slice = engine.sampleCanyonAt(engine.playerZ);
        const agl = Math.max(0, Math.round(engine.playerY - slice.floorY));
        const rimAgl = Math.max(10, Math.round(slice.rimY - slice.floorY));
        const halfWidth = engine.getHalfWidthAtY(slice, engine.playerY);
        const offsetFromCenter = engine.playerX - slice.centerX;
        const wallClearance = Math.max(0, Math.round(halfWidth - Math.abs(offsetFromCenter)));
        const spd = Math.round(engine.speed);
        const distMeters = Math.round(engine.distanceTraveled);
        const distKm = (engine.distanceTraveled / 1000).toFixed(2);
        const boostMph = Math.round(engine.distanceSpeedBoost);
        const mult = engine.proximityMultiplier;
        const scoreInt = Math.floor(engine.score);
        const highInt = Math.floor(engine.highScore);
        const isLowAlt = engine.phase === "FLYING" && agl < 18;
        const isNearStall = engine.phase === "FLYING" && spd < engine.STALL_SPEED + 18;
        const isDanger = isLowAlt || isNearStall || engine.phase === "CARNAGE";
        const railColor = engine.phase === "CARNAGE"
            ? "#ff2a2a"
            : isDanger && engine.tickCount % 2 === 0
                ? "#ff2a2a"
                : engine.isNewHighScore
                    ? "#ffbe0b"
                    : "#00f5d4";
        const speedRatio = Math.max(0, Math.min(1, (spd - engine.STALL_SPEED) / (engine.MAX_SPEED - engine.STALL_SPEED)));
        const speedColor = spd < engine.STALL_SPEED + 18
            ? "#00bbf9"
            : spd > 220
                ? "#ff2a2a"
                : spd > 175
                    ? "#ffbe0b"
                    : "#00f5d4";
        const altColor = agl < 18
            ? "#ff2a2a"
            : agl < 30
                ? "#ffbe0b"
                : "#00f5d4";
        const multColor = mult >= 3.5
            ? "#ff2a2a"
            : mult >= 2.0
                ? "#ffbe0b"
                : "#00f5d4";
        // Continuous 800px bottom telemetry energy bar width (driven by speed & multiplier)
        const energyRatio = engine.phase === "CARNAGE"
            ? 1
            : Math.max(0.05, Math.min(1, speedRatio * 0.65 + ((mult - 1) / 4) * 0.35));
        const panoramicBarW = Math.round(energyRatio * 788);
        const parts = [];
        parts.push(`<defs>
    <linearGradient id="stripBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${engine.phase === "CARNAGE" ? "#260408" : "#060913"}"/>
      <stop offset="50%" stop-color="${engine.phase === "CARNAGE" ? "#3b0710" : "#0c1528"}"/>
      <stop offset="100%" stop-color="${engine.phase === "CARNAGE" ? "#1f0307" : "#060a14"}"/>
    </linearGradient>
    <linearGradient id="panoramicEnergy" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#00bbf9"/>
      <stop offset="45%" stop-color="#00f5d4"/>
      <stop offset="78%" stop-color="#ffbe0b"/>
      <stop offset="100%" stop-color="#ff2a2a"/>
    </linearGradient>
  </defs>`);
        // 1. Unified 800x100 Panoramic Chassis Background & Continuous Telemetry Rails
        parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#stripBg)"/>`, 
        // Subtle continuous horizontal telemetry grid lines across all 800px
        `<line x1="0" y1="24" x2="${W}" y2="24" stroke="#1e293b" stroke-width="1" opacity="0.55"/>`, `<line x1="0" y1="68" x2="${W}" y2="68" stroke="#1e293b" stroke-width="1" opacity="0.55"/>`, 
        // Continuous glowing top & bottom cockpit frame rails across 0..800
        `<path d="M 4 12 L 12 3 L 788 3 L 796 12" fill="none" stroke="${railColor}" stroke-width="2" opacity="0.9"/>`, 
        // Continuous 800px Panoramic Telemetry Energy Bar along bottom (y=91..97)
        `<rect x="6" y="91" width="788" height="6" rx="3" fill="#0f172a" stroke="#1e293b" stroke-width="1"/>`, `<rect x="6" y="91" width="${panoramicBarW}" height="6" rx="3" fill="url(#panoramicEnergy)"/>`, 
        // Angled fighter-jet strut dividers at slot boundaries (x=200, 400, 600)
        `<path d="M 196 4 L 204 16 L 204 82 L 196 90" fill="none" stroke="#334155" stroke-width="1.5"/>`, `<path d="M 396 4 L 404 16 L 404 82 L 396 90" fill="none" stroke="#334155" stroke-width="1.5"/>`, `<path d="M 596 4 L 604 16 L 604 82 L 596 90" fill="none" stroke="#334155" stroke-width="1.5"/>`);
        // =========================================================================
        // SLOT 0 (x = 0..200): SPEED (MPH) & PITCH CONTROL (DIAL 1)
        // =========================================================================
        const pitchSign = engine.pitch >= 0 ? `+${Math.round(engine.pitch)}° UP` : `${Math.round(engine.pitch)}° DN`;
        const spdBarW = Math.round(speedRatio * 126);
        const horizonLineY = Math.max(34, Math.min(64, Math.round(49 - engine.pitch * 0.35)));
        parts.push(
        // Header
        `<text x="12" y="18" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">SPEED // PITCH</text>`, `<text x="190" y="18" text-anchor="end" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="11">${pitchSign}</text>`, 
        // Pitch Artificial Horizon Mini-Scope (x=12..52, y=30..68)
        `<rect x="12" y="30" width="40" height="36" rx="5" fill="#091020" stroke="#334155" stroke-width="1.2"/>`, `<line x1="15" y1="${horizonLineY}" x2="49" y2="${horizonLineY}" stroke="#00f5d4" stroke-width="2.2"/>`, `<circle cx="32" cy="48" r="2.5" fill="#ffbe0b"/>`, 
        // Big Speed Readout (x=60..190)
        `<text x="60" y="50" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="25">${spd}</text>`, `<text x="108" y="49" fill="${speedColor}" font-family="Arial, sans-serif" font-weight="900" font-size="10">MPH</text>`, `<text x="190" y="48" text-anchor="end" fill="${spd <= engine.STALL_SPEED + 15 ? "#ff2a2a" : "#64748b"}" font-family="Arial, sans-serif" font-weight="800" font-size="9">STALL ${engine.STALL_SPEED}</text>`, 
        // Speed Segmented Afterburner Bar
        `<rect x="60" y="56" width="128" height="9" rx="3" fill="#0f172a" stroke="#334155" stroke-width="1"/>`, `<rect x="61" y="57" width="${spdBarW}" height="7" rx="2" fill="${speedColor}"/>`, 
        // Bottom sub-telemetry
        `<text x="12" y="83" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">DIAL 1: +CLIMB / -DIVE</text>`, `<text x="190" y="83" text-anchor="end" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">BOOST +${boostMph}</text>`);
        // =========================================================================
        // SLOT 1 (x = 200..400): DISTANCE TRAVELED (KM/M) & ALTITUDE (FT AGL)
        // =========================================================================
        const altRatio = Math.max(0, Math.min(1, agl / Math.max(1, rimAgl)));
        const altFillH = Math.round(altRatio * 48);
        const altFillY = 78 - altFillH;
        // Mini top-down canyon radar trace in center of Slot 1 (x=298..332)
        const distProgressRatio = Math.min(1, (engine.distanceTraveled % 1000) / 1000);
        const distSubBarW = Math.round(distProgressRatio * 84);
        parts.push(
        // Header across Slot 1
        `<text x="212" y="18" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">DISTANCE</text>`, `<text x="390" y="18" text-anchor="end" fill="${altColor}" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">ALTITUDE</text>`, 
        // Left Half of Slot 1 (x=212..298): Distance Traveled
        `<text x="212" y="48" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="23">${distKm}</text>`, `<text x="275" y="47" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="900" font-size="10">KM</text>`, `<rect x="212" y="55" width="84" height="7" rx="3" fill="#0f172a" stroke="#334155" stroke-width="1"/>`, `<rect x="212" y="55" width="${distSubBarW}" height="7" rx="3" fill="#38bdf8"/>`, `<text x="212" y="83" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="10">${formatNumber(distMeters)} M TRAVELED</text>`, 
        // Center Divider & Vertical Altitude Bar (x=304..318, y=30..78)
        `<rect x="306" y="30" width="12" height="48" rx="3" fill="#0f172a" stroke="#334155" stroke-width="1"/>`, `<rect x="307" y="66" width="10" height="11" fill="#ff2a2a" opacity="0.38"/>`, `<rect x="307" y="${altFillY}" width="10" height="${altFillH}" rx="2" fill="${altColor}"/>`, 
        // Right Half of Slot 1 (x=324..390): Altitude AGL & Clearance
        `<text x="390" y="48" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="23">${agl} <tspan font-size="10" fill="${altColor}">FT</tspan></text>`, `<text x="390" y="63" text-anchor="end" fill="${agl < 18 ? "#ff2a2a" : "#94a3b8"}" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">${agl < 18 ? "PULL UP!" : `RIM ${rimAgl} FT`}</text>`, `<text x="390" y="83" text-anchor="end" fill="${wallClearance < 12 ? "#ff2a2a" : "#00f5d4"}" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">WALL ${wallClearance} FT</text>`);
        // =========================================================================
        // SLOT 2 (x = 400..600): MULTIPLIER (x1..x5) & LIVE SCORE
        // =========================================================================
        const activeSegments = Math.min(5, Math.max(1, Math.round(mult)));
        const segRects = [];
        for (let s = 0; s < 5; s++) {
            const sx = 412 + s * 14;
            const isLit = s < activeSegments;
            const segCol = s >= 3 ? "#ff2a2a" : s >= 1 ? "#ffbe0b" : "#00f5d4";
            segRects.push(`<rect x="${sx}" y="58" width="11" height="8" rx="2" fill="${isLit ? segCol : "#1e293b"}"/>`);
        }
        parts.push(
        // Header across Slot 2
        `<text x="412" y="18" fill="${multColor}" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">MULTIPLIER</text>`, `<text x="590" y="18" text-anchor="end" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">LIVE SCORE</text>`, 
        // Left Module of Slot 2 (x=412..484): Proximity Multiplier Badge
        `<rect x="410" y="26" width="74" height="28" rx="6" fill="#091326" stroke="${multColor}" stroke-width="1.5"/>`, `<text x="447" y="46" text-anchor="middle" fill="${multColor}" font-family="Arial, sans-serif" font-weight="900" font-size="20">x${mult.toFixed(1)}</text>`, ...segRects, `<text x="412" y="83" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">${mult >= 2.0 ? "PROX BOOST!" : "FLY LOW/CLOSE"}</text>`, 
        // Right Module of Slot 2 (x=492..590): Live Score Counter
        `<text x="590" y="52" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="26">${formatNumber(scoreInt)}</text>`, `<text x="590" y="83" text-anchor="end" fill="${engine.isNewHighScore ? "#ffbe0b" : "#00f5d4"}" font-family="Arial, sans-serif" font-weight="900" font-size="10">${engine.phase === "READY"
        ? "READY TO LAUNCH"
        : engine.isNewHighScore
            ? "★ NEW RECORD! ★"
            : "SCORING ACTIVE"}</text>`);
        // =========================================================================
        // SLOT 3 (x = 600..800): HIGH SCORE & STEERING / BANK ALIGNMENT (DIAL 4)
        // =========================================================================
        const canyonShift = slice.centerX - engine.playerX;
        const normOffset = Math.max(-1, Math.min(1, canyonShift / Math.max(1, slice.floorHalfWidth)));
        const canyonGateX = Math.round(700 + normOffset * 62);
        const rollText = Math.abs(engine.roll) < 2
            ? "LEVEL"
            : engine.roll < 0
                ? `${Math.round(Math.abs(engine.roll))}° L`
                : `${Math.round(engine.roll)}° R`;
        parts.push(
        // Header across Slot 3
        `<text x="612" y="18" fill="#ffd166" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">HIGH SCORE</text>`, `<text x="790" y="18" text-anchor="end" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="10">BANK ${rollText}</text>`, 
        // High Score Prominent Readout (y=26..54)
        `<text x="612" y="48" fill="#ffd166" font-family="Arial, sans-serif" font-weight="900" font-size="24">${formatNumber(highInt)}</text>`, 
        // Mini rotating wingsuit flyer on right side of Slot 3 (cx=754, cy=38)
        `<g transform="translate(754, 38) rotate(${engine.roll.toFixed(1)}) scale(0.32)">`, renderBirdmanSprite(engine), `</g>`, 
        // Canyon Centerline Alignment Gauge (y=58..68, x=612..788)
        `<rect x="612" y="58" width="176" height="9" rx="4" fill="#0f172a" stroke="#334155" stroke-width="1"/>`, `<rect x="${canyonGateX - 16}" y="57" width="32" height="11" rx="3" fill="none" stroke="#00f5d4" stroke-width="1.8"/>`, `<circle cx="700" cy="62.5" r="4.5" fill="#ffbe0b" stroke="#ffffff" stroke-width="1.2"/>`, 
        // Bottom label
        `<text x="612" y="83" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">DIAL 4: STEER CANYON GATE</text>`);
        return parts.join("");
    }
    /**
     * Slices out a single 200x100 Stream Deck + Touch Strip segment for dial column `col` (0..3)
     * from the unified 800x100 panoramic Touch Strip dashboard.
     */
    function renderTouchStripSlotSvg(col, engine, masterStripBody) {
        const clampedCol = Math.max(0, Math.min(3, col));
        const body = masterStripBody ?? buildMasterTouchStripSvgBody(engine);
        const vx = clampedCol * TOUCH_SLOT_W;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${TOUCH_SLOT_W}" height="${TOUCH_STRIP_TOTAL_H}" viewBox="${vx} 0 ${TOUCH_SLOT_W} ${TOUCH_STRIP_TOTAL_H}">${body}</svg>`;
    }

    exports.CanyonGameEngine = CanyonGameEngine;
    exports.buildMasterSceneSvgBody = buildMasterSceneSvgBody;
    exports.renderKeyTileSvg = renderKeyTileSvg;
    exports.renderTouchStripSlotSvg = renderTouchStripSlotSvg;

    return exports;

})({});
