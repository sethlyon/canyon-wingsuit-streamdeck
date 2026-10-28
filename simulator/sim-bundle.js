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
     * Unified Master Scene Coordinate Space (800 x 460):
     * - Columns 0..3 each span 200px horizontally (Total Width = 800px).
     * - Row 0 (Top 4 LCD Keys):      x = col * 200 + 20, y = 0,   w = 160, h = 160 (HUD + Sky + Mountain Peaks)
     * - Row 1 (Bottom 4 LCD Keys):   x = col * 200 + 20, y = 180, w = 160, h = 160 (Towering Canyon Walls & Mountains)
     * - Touch Strip (4 x 200x100):   x = col * 200,      y = 360, w = 200, h = 100 (Seamless 800x100 Gorge + Centered Wingman!)
     */
    const MASTER_W = 800;
    const MASTER_H = 460;
    const KEY_SIZE = 144;
    const KEY_VIEW_SIZE = 160;
    const STRIP_W = 200;
    const STRIP_H = 100;
    const STRIP_Y = 360;
    /**
     * Builds the unified 800x460 3D scene SVG body where:
     * - The 3rd-person Wingman flies on the wide Touch Strip (y = 360..460, centered at x = 400, y = 416)
     * - The 3D canyon walls and jagged mountains extend continuously upward from the Touch Strip (y = 460)
     *   through the lower row of buttons (y = 180..340) and into the upper row of buttons (y = 0..160)!
     * - The HUD instruments & scoreboard sit in the top row of buttons (y = 0..160).
     */
    function buildMasterSceneSvgBody(engine) {
        const W = MASTER_W;
        const H = MASTER_H;
        // Screen shake during carnage
        const shakeX = engine.screenShake > 0
            ? Math.round(Math.sin(engine.tickCount * 2.7) * engine.screenShake)
            : 0;
        const shakeY = engine.screenShake > 0
            ? Math.round(Math.cos(engine.tickCount * 3.3) * engine.screenShake)
            : 0;
        const currentSlice = engine.sampleCanyonAt(engine.playerZ);
        // Camera locked to player X; horizon sits in the upper keys so mountains & canyon walls
        // sweep continuously from the Touch Strip (y=460) up into Row 1 and Row 0 keys!
        const camX = engine.playerX;
        const camY = engine.playerY + 10 - engine.pitch * 0.35;
        const horizonY = Math.round(215 + engine.pitch * 2.4);
        const worldTiltDeg = -engine.roll * 0.38;
        const bankYawShift = -engine.roll * 2.1;
        const parts = [];
        parts.push(`<defs>
    <linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#090418"/>
      <stop offset="38%" stop-color="#2b0f4c"/>
      <stop offset="72%" stop-color="#9e2a47"/>
      <stop offset="100%" stop-color="#ff9248"/>
    </linearGradient>
    <linearGradient id="plateauG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5c1b29"/>
      <stop offset="100%" stop-color="#1e060d"/>
    </linearGradient>
  </defs>`);
        if (shakeX !== 0 || shakeY !== 0) {
            parts.push(`<g transform="translate(${shakeX},${shakeY})">`);
        }
        // Rotate the 3D canyon & mountain world around the Wingman on the Touch Strip (400, 414)
        parts.push(`<g transform="rotate(${worldTiltDeg.toFixed(1)}, 400, 414)">`);
        // 1. Sky & Sunset Sun
        const clampedHorizon = Math.max(60, Math.min(H - 40, horizonY));
        parts.push(`<rect x="-240" y="-240" width="${W + 480}" height="${clampedHorizon + 260}" fill="url(#skyG)"/>`);
        const farSlice = engine.sampleCanyonAt(engine.playerZ + 520);
        const sunX = Math.round(W * 0.5 + (farSlice.centerX - camX) * 0.9 + bankYawShift);
        const sunY = Math.round(clampedHorizon - 28);
        parts.push(`<circle cx="${sunX}" cy="${sunY}" r="72" fill="#ff9f1c" opacity="0.26"/>`, `<circle cx="${sunX}" cy="${sunY}" r="44" fill="#ffd166" opacity="0.85"/>`);
        // Distant mountain range silhouette along the horizon (extends up into Row 0/Row 1 buttons)
        const bgMtnPts = [`-200,${clampedHorizon + 4}`];
        for (let mx = -160; mx <= W + 160; mx += 40) {
            const wave = Math.abs(Math.sin((mx - bankYawShift * 0.6) * 0.012 + 0.5)) * 58 +
                Math.abs(Math.cos((mx - bankYawShift * 0.6) * 0.027)) * 28;
            bgMtnPts.push(`${mx},${Math.round(clampedHorizon - 14 - wave)}`);
        }
        bgMtnPts.push(`${W + 200},${clampedHorizon + 4}`);
        parts.push(`<polygon points="${bgMtnPts.join(" ")}" fill="#381236" opacity="0.88"/>`);
        // Ground plane below horizon
        parts.push(`<rect x="-240" y="${clampedHorizon}" width="${W + 480}" height="${H - clampedHorizon + 260}" fill="url(#plateauG)"/>`);
        // 2. Sample & project 3D canyon & towering mountain slices from far horizon down to Touch Strip foreground
        const numSlices = 20;
        const stepZ = 26;
        const baseZ = Math.floor(engine.playerZ / stepZ) * stepZ;
        const projected = [];
        const fov = 340;
        for (let i = numSlices; i >= 1; i--) {
            const worldZ = baseZ + i * stepZ;
            const relZ = Math.max(10, worldZ - engine.playerZ);
            const slice = engine.sampleCanyonAt(worldZ);
            const scale = fov / (relZ + 20);
            const depthBankShift = bankYawShift * (relZ / 160);
            const projectX = (wx) => Math.round(W * 0.5 + (wx - camX) * scale + depthBankShift);
            // Shift vertical projection so near canyon floor sits right in the Touch Strip (y ~ 380..455)
            // while the canyon walls & mountain peaks tower up through Row 1 (180..340) and Row 0 (0..160)!
            const projectY = (wy) => Math.round(clampedHorizon + 58 - (wy - camY) * scale * 1.38);
            const midHalfW = slice.floorHalfWidth + (slice.rimHalfWidth - slice.floorHalfWidth) * 0.52;
            const midWorldY = slice.floorY + (slice.rimY - slice.floorY) * 0.52;
            // Towering mountain peaks rising high above the canyon rim so they extend from the Touch Strip up into the buttons!
            const leftPeakHeight = 46 + Math.abs(Math.sin(slice.z * 0.0085)) * 48;
            const rightPeakHeight = 46 + Math.abs(Math.cos(slice.z * 0.0079 + 1.1)) * 48;
            const peakOuterHalfW = slice.rimHalfWidth + 48;
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
                peakLeftX: projectX(slice.centerX - peakOuterHalfW),
                peakRightX: projectX(slice.centerX + peakOuterHalfW),
                peakLeftY: projectY(slice.rimY + leftPeakHeight),
                peakRightY: projectY(slice.rimY + rightPeakHeight),
                riverLeftX: projectX(slice.centerX - slice.floorHalfWidth * 0.38),
                riverRightX: projectX(slice.centerX + slice.floorHalfWidth * 0.38)
            });
        }
        const leftPeakColors = ["#8f2837", "#9e303c", "#7d2030", "#a83843", "#701b2b", "#942b38"];
        const rightPeakColors = ["#541322", "#611827", "#470f1c", "#6b1c2c", "#3d0b17", "#591524"];
        const leftUpperColors = ["#c84b31", "#d96b43", "#b83b2b", "#e07a5f", "#a63429", "#cf5c36"];
        const leftLowerColors = ["#9e3321", "#b04128", "#8c281c", "#b84a32", "#7d2218", "#993622"];
        const rightUpperColors = ["#781d2a", "#8a2432", "#691723", "#942b38", "#5c131f", "#7d202d"];
        const rightLowerColors = ["#54111c", "#631622", "#470d17", "#6e1b27", "#3d0a13", "#59131e"];
        const floorColors = ["#2e0d17", "#38111c", "#260a13", "#330f19", "#2b0c15", "#36101b"];
        for (let i = 0; i < projected.length - 1; i++) {
            const far = projected[i];
            const near = projected[i + 1];
            const sIdx = near.slice.strataIndex;
            // Outer mountain slopes extending off screen edges
            parts.push(`<polygon points="-240,${far.floorY} ${far.peakLeftX},${far.peakLeftY} ${near.peakLeftX},${near.peakLeftY} -240,${near.floorY}" fill="${leftPeakColors[sIdx]}"/>`, `<polygon points="${far.peakRightX},${far.peakRightY} ${W + 240},${far.floorY} ${W + 240},${near.floorY} ${near.peakRightX},${near.peakRightY}" fill="${rightPeakColors[sIdx]}"/>`);
            // Towering Left & Right Mountain Ridges above the Canyon Rim (extending up into the LCD keys!)
            parts.push(`<polygon points="${far.peakLeftX},${far.peakLeftY} ${near.peakLeftX},${near.peakLeftY} ${near.rimLeftX},${near.rimY} ${far.rimLeftX},${far.rimY}" fill="${leftPeakColors[sIdx]}" stroke="#2a0810" stroke-width="0.7"/>`, `<polygon points="${far.rimRightX},${far.rimY} ${near.rimRightX},${near.rimY} ${near.peakRightX},${near.peakRightY} ${far.peakRightX},${far.peakRightY}" fill="${rightPeakColors[sIdx]}" stroke="#1f050b" stroke-width="0.7"/>`);
            // Canyon Floor quad (sweeps down into the Touch Strip!)
            parts.push(`<polygon points="${far.floorLeftX},${far.floorY} ${far.floorRightX},${far.floorY} ${near.floorRightX},${near.floorY} ${near.floorLeftX},${near.floorY}" fill="${floorColors[sIdx]}"/>`);
            // Winding River on Canyon Floor
            const riverCol = sIdx % 2 === 0 ? "#1982c4" : "#2ec4b6";
            parts.push(`<polygon points="${far.riverLeftX},${far.floorY} ${far.riverRightX},${far.floorY} ${near.riverRightX},${near.floorY} ${near.riverLeftX},${near.floorY}" fill="${riverCol}" opacity="0.8"/>`);
            // Left Cliff Wall (connects Touch Strip floor up to the LCD buttons!)
            parts.push(`<polygon points="${far.rimLeftX},${far.rimY} ${near.rimLeftX},${near.rimY} ${near.midLeftX},${near.midY} ${far.midLeftX},${far.midY}" fill="${leftUpperColors[sIdx]}" stroke="#2a0810" stroke-width="0.7"/>`, `<polygon points="${far.midLeftX},${far.midY} ${near.midLeftX},${near.midY} ${near.floorLeftX},${near.floorY} ${far.floorLeftX},${far.floorY}" fill="${leftLowerColors[sIdx]}" stroke="#2a0810" stroke-width="0.7"/>`);
            // Right Cliff Wall (connects Touch Strip floor up to the LCD buttons!)
            parts.push(`<polygon points="${far.rimRightX},${far.rimY} ${near.rimRightX},${near.rimY} ${near.midRightX},${near.midY} ${far.midRightX},${far.midY}" fill="${rightUpperColors[sIdx]}" stroke="#1f050b" stroke-width="0.7"/>`, `<polygon points="${far.midRightX},${far.midY} ${near.midRightX},${near.midY} ${near.floorRightX},${near.floorY} ${far.floorRightX},${far.floorY}" fill="${rightLowerColors[sIdx]}" stroke="#1f050b" stroke-width="0.7"/>`);
            // Natural rock arch spanning the canyon across the buttons
            if (near.slice.hasArch) {
                const archTopY = near.rimY + Math.round(8 * near.scale);
                const archBotY = near.rimY + Math.round(24 * near.scale);
                parts.push(`<polygon points="${near.rimLeftX},${archTopY} ${near.rimRightX},${archTopY} ${near.midRightX},${archBotY} ${near.midLeftX},${archBotY}" fill="#8f2d24" stroke="#ff9f1c" stroke-width="1.2"/>`);
            }
        }
        parts.push(`</g>`);
        // 3. High-speed wind lines radiating from the canyon into the Touch Strip & Keys
        if (engine.phase === "FLYING" && engine.speed > 140) {
            const intensity = Math.min(1, (engine.speed - 140) / 110);
            const numStreaks = Math.round(8 + intensity * 8);
            for (let w = 0; w < numStreaks; w++) {
                const angle = (w * Math.PI * 2) / numStreaks + (engine.tickCount * 0.19) % 0.7;
                const r1 = 80 + ((engine.tickCount * 29 + w * 41) % 130);
                const r2 = r1 + 45 + intensity * 75;
                const x1 = Math.round(W * 0.5 + Math.cos(angle) * r1 * 1.2);
                const y1 = Math.round(330 + Math.sin(angle) * r1 * 0.65);
                const x2 = Math.round(W * 0.5 + Math.cos(angle) * r2 * 1.2);
                const y2 = Math.round(330 + Math.sin(angle) * r2 * 0.65);
                parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="${(1.2 + intensity * 1.8).toFixed(1)}" opacity="${(0.25 + intensity * 0.5).toFixed(2)}" stroke-linecap="round"/>`);
            }
        }
        // 4. THE WINGMAN ON THE TOUCH STRIP (y = 360..460, centered at x = 400)
        const birdX = 400;
        // Subtle vertical shift within the Touch Strip (394..432) based on pitch so he stays on the Touch Strip
        const birdY = Math.round(416 - Math.max(-18, Math.min(22, engine.pitch * 0.45)));
        // Shadow on the Touch Strip canyon floor
        const agl = Math.max(0, engine.playerY - currentSlice.floorY);
        if (agl < 65 && engine.phase !== "CARNAGE") {
            const shadowY = Math.min(454, Math.round(birdY + 14 + agl * 0.4));
            const shadowScale = Math.max(0.3, 1 - agl / 75);
            parts.push(`<ellipse cx="${birdX}" cy="${shadowY}" rx="${Math.round(38 * shadowScale)}" ry="${Math.round(7 * shadowScale)}" fill="#090206" opacity="${(0.6 * shadowScale).toFixed(2)}"/>`);
        }
        if (engine.phase === "CARNAGE") {
            // Carnage erupts on the Touch Strip and splatters upward across the 8 LCD keys!
            parts.push(`<g transform="translate(${birdX},${birdY})">`);
            const shockR = Math.min(340, Math.round(28 + engine.phaseElapsedSec * 240));
            const shockOpacity = Math.max(0, 0.9 - engine.phaseElapsedSec * 0.5);
            if (shockOpacity > 0.04) {
                parts.push(`<circle cx="0" cy="0" r="${shockR}" fill="none" stroke="#ff2a2a" stroke-width="6" opacity="${shockOpacity.toFixed(2)}"/>`, `<circle cx="0" cy="0" r="${Math.round(shockR * 0.65)}" fill="#8d0801" opacity="${(shockOpacity * 0.7).toFixed(2)}"/>`);
            }
            for (const p of engine.particles) {
                const px = Math.round(p.x * 1.35);
                const py = Math.round(p.y * 1.35 - 40); // Launch debris upward into the buttons too!
                if (p.kind === "helmet") {
                    parts.push(`<g transform="translate(${px},${py}) rotate(${Math.round(p.rotation)})">`, `<circle cx="0" cy="0" r="11" fill="#ffffff" stroke="#111" stroke-width="2"/>`, `<path d="M-7 -3 Q0 -8 7 -3 L5 3 Q0 5 -5 3 Z" fill="#00f5d4"/>`, `<path d="M-4 -8 L3 8" stroke="#d90429" stroke-width="2.5"/>`, `</g>`);
                }
                else if (p.kind === "wing" || p.kind === "gib") {
                    parts.push(`<polygon points="${px},${py - p.size} ${px + p.size},${py + p.size * 0.6} ${px - p.size * 0.8},${py + p.size}" fill="${p.color}" stroke="#3b0000" stroke-width="1"/>`);
                }
                else {
                    parts.push(`<circle cx="${px}" cy="${py}" r="${Math.round(p.size)}" fill="${p.color}" opacity="0.9"/>`);
                }
            }
            parts.push(`</g>`);
            // Visceral blood splatters across both the LCD buttons AND Touch Strip
            for (const s of engine.screenSplats) {
                const sx = Math.round(s.nx * W);
                const sy = Math.round(s.ny * H);
                const r = Math.round(s.radius * 1.2);
                const drip = Math.round(s.dripLength * 1.2);
                parts.push(`<circle cx="${sx}" cy="${sy}" r="${r}" fill="${s.color}" opacity="0.84"/>`, `<circle cx="${sx + Math.round(r * 0.7)}" cy="${sy - Math.round(r * 0.5)}" r="${Math.round(r * 0.4)}" fill="${s.color}" opacity="0.85"/>`, `<rect x="${sx - 3}" y="${sy}" width="6" height="${r + drip}" rx="3" fill="${s.color}" opacity="0.85"/>`);
            }
            // Big Carnage Banner across Row 1 Buttons (y = 205..315)
            parts.push(`<rect x="190" y="206" width="420" height="110" rx="14" fill="#140206" opacity="0.92" stroke="#ff1e27" stroke-width="3"/>`, `<text x="400" y="246" text-anchor="middle" fill="#ff2a2a" font-family="Arial, sans-serif" font-weight="900" font-size="32" letter-spacing="2">CARNAGE! SPLAT!</text>`, `<text x="400" y="274" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="700" font-size="16">${engine.lastCrashReason} (${engine.crashSpeed} MPH)</text>`, `<text x="400" y="302" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="19">SCORE: ${Math.floor(engine.score)}   |   BEST: ${engine.highScore}</text>`);
        }
        else {
            // Wingtip vortex trails on the Touch Strip
            const pitchSquash = Math.max(0.65, Math.min(1.25, 1.0 + engine.pitch * 0.008));
            const rad = (engine.roll * Math.PI) / 180;
            const wingSpan = 56;
            const leftTipX = Math.round(birdX - Math.cos(rad) * wingSpan);
            const leftTipY = Math.round(birdY - Math.sin(rad) * wingSpan);
            const rightTipX = Math.round(birdX + Math.cos(rad) * wingSpan);
            const rightTipY = Math.round(birdY + Math.sin(rad) * wingSpan);
            parts.push(`<path d="M ${leftTipX} ${leftTipY} Q ${leftTipX - 24} ${leftTipY + 18} ${leftTipX - 42} ${leftTipY + 38}" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.5" stroke-dasharray="6 4"/>`, `<path d="M ${rightTipX} ${rightTipY} Q ${rightTipX + 24} ${rightTipY + 18} ${rightTipX + 42} ${rightTipY + 38}" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.5" stroke-dasharray="6 4"/>`);
            // Draw the 3rd-person Wingman centered on the Touch Strip!
            parts.push(`<g transform="translate(${birdX},${birdY}) rotate(${engine.roll.toFixed(1)}) scale(1.05,${(pitchSquash * 0.92).toFixed(2)})">`, renderBirdmanSprite(engine), `</g>`);
            // Subtle left & right dial quick-prompts on the far edges of the Touch Strip (col 0 and col 3)
            const pitchSign = engine.pitch >= 0 ? `+${Math.round(engine.pitch)}° UP` : `${Math.round(engine.pitch)}° DN`;
            const rollText = Math.abs(engine.roll) < 2
                ? "LEVEL"
                : engine.roll < 0
                    ? `${Math.round(Math.abs(engine.roll))}° L`
                    : `${Math.round(engine.roll)}° R`;
            parts.push(
            // Leftmost Touch Strip edge (Dial 1 Pitch telemetry)
            `<rect x="10" y="370" width="135" height="80" rx="8" fill="#080b16" opacity="0.68" stroke="#00f5d4" stroke-width="1.2"/>`, `<text x="20" y="390" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="11">◀ DIAL 1: PITCH</text>`, `<text x="20" y="414" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="18">${pitchSign}</text>`, `<text x="20" y="436" fill="#ffd166" font-family="Arial, sans-serif" font-weight="700" font-size="11">${Math.round(engine.speed)} MPH (STALL ${engine.STALL_SPEED})</text>`, 
            // Rightmost Touch Strip edge (Dial 4 Steer telemetry)
            `<rect x="655" y="370" width="135" height="80" rx="8" fill="#080b16" opacity="0.68" stroke="#00f5d4" stroke-width="1.2"/>`, `<text x="780" y="390" text-anchor="end" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="11">DIAL 4: STEER ▶</text>`, `<text x="780" y="414" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="18">${rollText}</text>`, `<text x="780" y="436" text-anchor="end" fill="#ffd166" font-family="Arial, sans-serif" font-weight="700" font-size="11">PROX x${engine.proximityMultiplier.toFixed(1)}</text>`);
            // Status Banners across Row 1 Buttons (y = 220..290) when READY, CHUTE, or Warning
            if (engine.phase === "READY") {
                parts.push(`<rect x="210" y="226" width="380" height="62" rx="12" fill="#0d0628" opacity="0.84" stroke="#00f5d4" stroke-width="2"/>`, `<text x="400" y="252" text-anchor="middle" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="19" letter-spacing="1">TURN ANY DIAL TO DROP IN!</text>`, `<text x="400" y="274" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="700" font-size="13">LEFT DIAL: PITCH UP/DOWN   |   RIGHT DIAL: STEER L/R</text>`);
            }
            else if (engine.phase === "CHUTE") {
                const landed = engine.speed === 0;
                parts.push(`<rect x="200" y="222" width="400" height="68" rx="12" fill="#081c24" opacity="0.88" stroke="#00f5d4" stroke-width="2.5"/>`, `<text x="400" y="248" text-anchor="middle" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="20">${landed ? "SAFE LANDING! RUN COMPLETE" : "CHUTE DEPLOYED! (TOO SLOW)"}</text>`, `<text x="400" y="276" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="18">FINAL SCORE: ${Math.floor(engine.score)}   |   HIGH: ${engine.highScore}</text>`);
            }
            else if (engine.phase === "FLYING" && engine.speed < engine.STALL_SPEED + 16) {
                if (engine.tickCount % 2 === 0) {
                    parts.push(`<rect x="250" y="236" width="300" height="36" rx="8" fill="#00bbf9" opacity="0.9"/>`, `<text x="400" y="260" text-anchor="middle" fill="#060614" font-family="Arial, sans-serif" font-weight="900" font-size="16">SLOW SPEED! CHUTE ABOUT TO POP!</text>`);
                }
            }
            else if (engine.phase === "FLYING" && agl < 16) {
                if (engine.tickCount % 2 === 0) {
                    parts.push(`<rect x="260" y="236" width="280" height="36" rx="8" fill="#ff2a2a" opacity="0.9"/>`, `<text x="400" y="260" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="16">PULL UP! TERRAIN PROXIMITY!</text>`);
                }
            }
        }
        // 5. TOP ROW BUTTON HUD OVERLAYS (Row 0 Keys: col 0..3, y = 0..160)
        // Translucent cockpit HUD panels at the top of Row 0 so the mountain peaks & sunset sky shine through!
        parts.push(renderTopRowHudOverlays(engine, currentSlice, agl));
        if (shakeX !== 0 || shakeY !== 0) {
            parts.push(`</g>`);
        }
        return parts.join("");
    }
    /**
     * Renders the 4 HUD panels onto the Top Row of LCD Keys (Row 0, Col 0..3):
     * - Key (0,0): AIRSPEED & STALL / PITCH HUD
     * - Key (1,0): CANYON RADAR & ALTITUDE HUD
     * - Key (2,0): SCORE & HIGH SCORE ARCADE HUD
     * - Key (3,0): STEERING / ROLL & CANYON ALIGNMENT HUD
     */
    function renderTopRowHudOverlays(engine, slice, agl) {
        const scoreInt = Math.floor(engine.score);
        const hudParts = [];
        // --- KEY (0, 0) [x = 20..180, y = 0..160]: SPEED, STALL BAR & PITCH ---
        const speedRatio = Math.max(0, Math.min(1, (engine.speed - engine.STALL_SPEED) / (engine.MAX_SPEED - engine.STALL_SPEED)));
        const speedBarW = Math.round(speedRatio * 128);
        const speedCol = engine.speed < engine.STALL_SPEED + 18
            ? "#00f5d4"
            : engine.speed > 195
                ? "#ff2a2a"
                : "#ffbe0b";
        hudParts.push(`<rect x="28" y="8" width="144" height="86" rx="10" fill="#090c1a" opacity="0.76" stroke="#2b3558" stroke-width="1.5"/>`, `<text x="38" y="26" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="11">AIRSPEED / STALL</text>`, `<text x="38" y="52" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="24">${Math.round(engine.speed)} <tspan font-size="12" fill="#ffd166">MPH</tspan></text>`, `<rect x="36" y="60" width="128" height="10" rx="4" fill="#1b2238" stroke="#3d4b73" stroke-width="1"/>`, `<rect x="36" y="60" width="${speedBarW}" height="10" rx="4" fill="${speedCol}"/>`, `<text x="38" y="85" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="800" font-size="11">CHUTE AT ${engine.STALL_SPEED} MPH</text>`);
        // --- KEY (1, 0) [x = 220..380, y = 0..160]: TOP-DOWN CANYON RADAR & ALTITUDE ---
        const radarLeft = [];
        const radarRight = [];
        for (let r = 0; r <= 4; r++) {
            const s = engine.sampleCanyonAt(engine.playerZ + r * 50);
            const ry = 82 - r * 15;
            const rxC = 266 + (s.centerX - engine.playerX) * 0.28;
            const rw = s.floorHalfWidth * 0.28;
            radarLeft.push(`${Math.round(rxC - rw)},${ry}`);
            radarRight.push(`${Math.round(rxC + rw)},${ry}`);
        }
        const distKm = (Math.max(0, engine.playerZ) / 1000).toFixed(1);
        hudParts.push(`<rect x="228" y="8" width="144" height="86" rx="10" fill="#090c1a" opacity="0.76" stroke="#2b3558" stroke-width="1.5"/>`, `<rect x="236" y="16" width="60" height="70" rx="6" fill="#05101a" stroke="#1982c4" stroke-width="1.2"/>`, `<polyline points="${radarLeft.join(" ")}" fill="none" stroke="#ff595e" stroke-width="2"/>`, `<polyline points="${radarRight.join(" ")}" fill="none" stroke="#ff595e" stroke-width="2"/>`, `<polygon points="266,74 261,83 266,80 271,83" fill="#00f5d4"/>`, `<text x="304" y="30" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="10">ALTITUDE</text>`, `<text x="304" y="48" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="16">${agl} FT</text>`, `<text x="304" y="67" fill="#ffbe0b" font-family="Arial, sans-serif" font-weight="900" font-size="13">PROX x${engine.proximityMultiplier.toFixed(1)}</text>`, `<text x="304" y="84" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="700" font-size="11">${distKm} KM</text>`);
        // --- KEY (2, 0) [x = 420..580, y = 0..160]: SCORE & HIGH SCORE ---
        const statusCol = engine.phase === "CARNAGE"
            ? "#ff2a2a"
            : engine.isNewHighScore
                ? "#ffbe0b"
                : "#00f5d4";
        const statusLabel = engine.phase === "READY"
            ? "READY TO FLY"
            : engine.isNewHighScore
                ? "NEW RECORD!"
                : "SCORE";
        hudParts.push(`<rect x="428" y="8" width="144" height="86" rx="10" fill="#090c1a" opacity="0.76" stroke="#2b3558" stroke-width="1.5"/>`, `<text x="500" y="26" text-anchor="middle" fill="${statusCol}" font-family="Arial, sans-serif" font-weight="900" font-size="11">${statusLabel}</text>`, `<text x="500" y="58" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="28">${scoreInt}</text>`, `<text x="500" y="84" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="13">BEST: ${engine.highScore}</text>`);
        // --- KEY (3, 0) [x = 620..780, y = 0..160]: STEERING & CANYON GATE ALIGNMENT ---
        const canyonShift = slice.centerX - engine.playerX;
        const normOffset = Math.max(-1, Math.min(1, canyonShift / Math.max(1, slice.floorHalfWidth)));
        const gateX = Math.round(700 + normOffset * 46);
        hudParts.push(`<rect x="628" y="8" width="144" height="86" rx="10" fill="#090c1a" opacity="0.76" stroke="#2b3558" stroke-width="1.5"/>`, `<text x="700" y="25" text-anchor="middle" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="11">CANYON ALIGNMENT</text>`, `<g transform="translate(700, 46) rotate(${engine.roll.toFixed(1)})">`, `<polygon points="-28,0 0,-5 28,0 12,7 0,3 -12,7" fill="#ff2a2a" stroke="#ffffff" stroke-width="1.4"/>`, `</g>`, `<rect x="640" y="66" width="120" height="10" rx="5" fill="#1b2238" stroke="#3d4b73" stroke-width="1"/>`, `<rect x="${gateX - 14}" y="65" width="28" height="12" rx="4" fill="none" stroke="#00f5d4" stroke-width="2"/>`, `<circle cx="700" cy="71" r="4.5" fill="#ffbe0b" stroke="#ffffff" stroke-width="1.2"/>`);
        return hudParts.join("");
    }
    /**
     * Slices out a single 144x144 key image at (col, row) from the unified 800x460 master scene.
     * - Row 0: y = 0..160   (Sky, Mountain Peaks, HUD)
     * - Row 1: y = 180..340 (Towering Canyon Walls extending up from the Touch Strip)
     */
    function renderKeyTileSvg(masterBody, col, row) {
        const clampedCol = Math.max(0, Math.min(3, col));
        const clampedRow = Math.max(0, Math.min(1, row));
        const vx = clampedCol * 200 + 20;
        const vy = clampedRow * 180;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${KEY_SIZE}" height="${KEY_SIZE}" viewBox="${vx} ${vy} ${KEY_VIEW_SIZE} ${KEY_VIEW_SIZE}">${masterBody}</svg>`;
    }
    /**
     * Slices out the 200x100 Stream Deck + Touch Strip segment for dial column `col` (0..3)
     * from the bottom of the unified 800x460 master scene (y = 360..460), where the Wingman flies!
     */
    function renderTouchStripSlotSvg(col, engine, masterBody) {
        const body = masterBody ?? buildMasterSceneSvgBody(engine);
        const clampedCol = Math.max(0, Math.min(3, col));
        const vx = clampedCol * STRIP_W;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${STRIP_W}" height="${STRIP_H}" viewBox="${vx} ${STRIP_Y} ${STRIP_W} ${STRIP_H}">${body}</svg>`;
    }

    exports.CanyonGameEngine = CanyonGameEngine;
    exports.buildMasterSceneSvgBody = buildMasterSceneSvgBody;
    exports.renderKeyTileSvg = renderKeyTileSvg;
    exports.renderTouchStripSlotSvg = renderTouchStripSlotSvg;

    return exports;

})({});
