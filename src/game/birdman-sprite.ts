import { CanyonGameEngine } from "./engine.js";

export interface BirdmanPose {
  /** Overall scale in the frame: larger when slow (closer to camera), smaller when fast (further away) */
  scale: number;
  /** 0 = fully spread wide, 1 = fully tucked in against ribcage */
  leftTuck: number;
  /** 0 = fully spread wide, 1 = fully tucked in against ribcage */
  rightTuck: number;
  /** 0 = slow/flared, 1 = max speed dive */
  speedNorm: number;
  /** 3D pitch foreshortening along the camera's line of sight */
  foreshortenY: number;
  /** Left hand / wrist coordinate */
  leftHandX: number;
  leftHandY: number;
  /** Right hand / wrist coordinate */
  rightHandX: number;
  rightHandY: number;
  /** Left foreground boot coordinate */
  leftFootX: number;
  leftFootY: number;
  /** Right foreground boot coordinate */
  rightFootX: number;
  rightFootY: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Computes the 3rd-person follow-cam wingsuit pose (flying AWAY from the camera into the canyon):
 * - Slowing down -> gets BIGGER in the frame (1.38x) with arms & legs flared wide open.
 * - Speeding up -> gets SMALLER in the frame (0.45x, further away) with both arms tucked tight to his sides.
 * - Navigating left -> tucks LEFT arm (elbow bends in, forearm & glove tuck against ribs) while right wing stays wide.
 * - Navigating right -> tucks RIGHT arm (elbow bends in, forearm & glove tuck against ribs) while left wing stays wide.
 */
export function computeBirdmanPose(engine: CanyonGameEngine): BirdmanPose {
  const speedSpan = Math.max(1, engine.MAX_SPEED - engine.STALL_SPEED);
  const speedNorm = clamp((engine.speed - engine.STALL_SPEED) / speedSpan, 0, 1);

  const scale =
    engine.phase === "CHUTE"
      ? 0.92
      : Number(lerp(1.38, 0.45, Math.pow(speedNorm, 0.88)).toFixed(3));

  const speedTuck =
    engine.phase === "CHUTE"
      ? 0.15
      : clamp(Math.pow(speedNorm, 1.05) * 0.86, 0, 0.88);

  const effectiveRoll = engine.roll * 0.65 + engine.targetRoll * 0.35;
  const steerLeft = clamp(-effectiveRoll / 34, 0, 1);
  const steerRight = clamp(effectiveRoll / 34, 0, 1);

  const leftTuck =
    engine.phase === "CHUTE"
      ? 0.15
      : clamp(
          speedTuck * (1 - steerRight * 0.65) + steerLeft * (1 - speedTuck * 0.25),
          0,
          1
        );

  const rightTuck =
    engine.phase === "CHUTE"
      ? 0.15
      : clamp(
          speedTuck * (1 - steerLeft * 0.65) + steerRight * (1 - speedTuck * 0.25),
          0,
          1
        );

  const pitchFactor = clamp((engine.pitch + 25) / 50, 0, 1);
  const foreshortenY =
    engine.phase === "CHUTE"
      ? 0.92
      : Number(lerp(0.55, 0.92, (1 - speedNorm) * 0.65 + pitchFactor * 0.35).toFixed(2));

  const flutterFreq = 0.55 + speedNorm * 0.75;
  const armWaveL = Math.sin(engine.tickCount * flutterFreq) * (0.9 - leftTuck * 0.5);
  const armWaveR = Math.cos(engine.tickCount * flutterFreq + 0.9) * (0.9 - rightTuck * 0.5);

  const leftHandX = Math.round(lerp(-74, -22, leftTuck));
  const leftHandY = Math.round(
    engine.phase === "CHUTE"
      ? -24
      : lerp(-8, 12, leftTuck) * foreshortenY + armWaveL
  );

  const rightHandX = Math.round(lerp(74, 22, rightTuck));
  const rightHandY = Math.round(
    engine.phase === "CHUTE"
      ? -24
      : lerp(-8, 12, rightTuck) * foreshortenY + armWaveR
  );

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
function buildVolumetricLimbPath(
  x0: number,
  y0: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number,
  x2: number,
  y2: number,
  r2: number
): string {
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
export function renderBirdmanSprite(engine: CanyonGameEngine): string {
  const parts: string[] = [];
  const pose = computeBirdmanPose(engine);

  const {
    leftTuck,
    rightTuck,
    speedNorm,
    foreshortenY,
    leftHandX,
    leftHandY,
    rightHandX,
    rightHandY,
    leftFootX,
    leftFootY,
    rightFootX,
    rightFootY
  } = pose;

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
  const leftElbowY = Math.round(
    engine.phase === "CHUTE"
      ? shoulderY - 10
      : lerp(shoulderY - 4, waistY + 3, leftTuck)
  );
  const rightElbowX = Math.round(lerp(46, 24, rightTuck) + yawShiftX * 0.3);
  const rightElbowY = Math.round(
    engine.phase === "CHUTE"
      ? shoulderY - 10
      : lerp(shoulderY - 4, waistY + 3, rightTuck)
  );

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
      parts.push(
        `<line x1="${sx}" y1="${shoulderY}" x2="${cx}" y2="${canopyY + 6}" stroke="#cbd5e1" stroke-width="1.3" opacity="0.85"/>`
      );
    }

    parts.push(
      `<path d="M ${-canopyW} ${canopyY + canopyH * 0.4} Q 0 ${canopyY - canopyH} ${canopyW} ${canopyY + canopyH * 0.4} Q 0 ${canopyY + canopyH * 0.1} ${-canopyW} ${canopyY + canopyH * 0.4} Z" fill="#00f5d4" stroke="#ffffff" stroke-width="2.2"/>`,
      `<path d="M ${-Math.round(canopyW * 0.55)} ${canopyY + canopyH * 0.22} Q 0 ${canopyY - canopyH * 0.85} ${Math.round(canopyW * 0.55)} ${canopyY + canopyH * 0.22} Z" fill="#ffbe0b" opacity="0.92"/>`,
      `<path d="M ${-Math.round(canopyW * 0.22)} ${canopyY + canopyH * 0.12} Q 0 ${canopyY - canopyH * 0.75} ${Math.round(canopyW * 0.22)} ${canopyY + canopyH * 0.12} Z" fill="#ff006e" opacity="0.95"/>`
    );
  }

  // =========================================================================
  // 1. 3D PERSPECTIVE SLIPSTREAM RIBBONS (streaming back toward foreground camera)
  // =========================================================================
  if (engine.phase !== "CARNAGE" && engine.phase !== "CHUTE") {
    const wakeLen = Math.round(22 + speedNorm * 36);
    const wakeAlpha = (0.38 + speedNorm * 0.45).toFixed(2);
    const leftWakeEndX = leftHandX - Math.round((1 - leftTuck) * 14 + 5);
    const rightWakeEndX = rightHandX + Math.round((1 - rightTuck) * 14 + 5);

    parts.push(
      `<path d="M ${leftHandX} ${leftHandY} Q ${leftHandX - 5} ${leftHandY + Math.round(wakeLen * 0.5)} ${leftWakeEndX} ${leftHandY + wakeLen}" fill="none" stroke="#ffffff" stroke-width="${(1.5 + (1 - leftTuck) * 1.2).toFixed(1)}" opacity="${wakeAlpha}" stroke-dasharray="7 4" stroke-linecap="round"/>`,
      `<path d="M ${rightHandX} ${rightHandY} Q ${rightHandX + 5} ${rightHandY + Math.round(wakeLen * 0.5)} ${rightWakeEndX} ${rightHandY + wakeLen}" fill="none" stroke="#ffffff" stroke-width="${(1.5 + (1 - rightTuck) * 1.2).toFixed(1)}" opacity="${wakeAlpha}" stroke-dasharray="7 4" stroke-linecap="round"/>`
    );

    if (speedNorm > 0.52) {
      const machAlpha = ((speedNorm - 0.52) * 0.95).toFixed(2);
      parts.push(
        `<path d="M ${leftHandX - 6} ${leftHandY + 4} Q ${headX} ${headY - 14} ${rightHandX + 6} ${rightHandY + 4}" fill="none" stroke="#00f5d4" stroke-width="1.8" opacity="${machAlpha}" stroke-dasharray="5 3"/>`
      );
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
  const leftTrailY = Math.round(
    lerp(leftHandY + 10, leftAnkleY - 4, 0.48) - (1 - leftTuck) * 5 + leftFlutter
  );
  const rightTrailX = Math.round(lerp(48, 19, rightTuck));
  const rightTrailY = Math.round(
    lerp(rightHandY + 10, rightAnkleY - 4, 0.48) - (1 - rightTuck) * 5 + rightFlutter
  );
  const tailArchY = Math.round(leftFootY - 5 + tailFlutter);

  // Dark 3D underside air-pocket openings along the trailing edges facing the follow-cam
  parts.push(
    `<path d="M ${leftHandX} ${leftHandY + 3} Q ${leftTrailX} ${leftTrailY + 5} ${leftAnkleX} ${leftAnkleY} Z" fill="#05070c" opacity="0.9"/>`,
    `<path d="M ${rightHandX} ${rightHandY + 3} Q ${rightTrailX} ${rightTrailY + 5} ${rightAnkleX} ${rightAnkleY} Z" fill="#05070c" opacity="0.9"/>`,
    `<path d="M ${leftAnkleX} ${leftAnkleY} Q 0 ${tailArchY + 5} ${rightAnkleX} ${rightAnkleY} Z" fill="#05070c" opacity="0.9"/>`
  );

  // Left Wing Membrane
  parts.push(
    `<path d="M ${leftShoulderX} ${shoulderY} L ${leftElbowX} ${leftElbowY} L ${leftHandX} ${leftHandY + 2} Q ${leftTrailX} ${leftTrailY} ${leftAnkleX} ${leftAnkleY} L ${leftHipX} ${hipY} Z" fill="url(#wsMembraneL)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`,
    // High-Vis Flame/Gold Racing Panel on Left Wing
    `<polygon points="${Math.round(lerp(leftShoulderX, leftHandX, 0.45))},${Math.round(lerp(shoulderY, leftHandY, 0.45) + 3)} ${Math.round(lerp(leftHandX, leftShoulderX, 0.15))},${leftHandY + 3} ${leftTrailX},${leftTrailY} ${Math.round(lerp(leftHipX, leftAnkleX, 0.52))},${Math.round(lerp(hipY, leftAnkleY, 0.52))}" fill="#ffbe0b" opacity="${(0.88 - leftTuck * 0.35).toFixed(2)}"/>`,
    // Inflated 3D Air-Cell Ribs & Fold Creases
    `<path d="M ${Math.round(lerp(leftShoulderX, leftHandX, 0.36))} ${Math.round(lerp(shoulderY, leftHandY, 0.36))} Q ${Math.round(leftTrailX * 0.75)} ${Math.round((shoulderY + leftAnkleY) * 0.45)} ${Math.round(lerp(leftHipX, leftAnkleX, 0.52))} ${Math.round(lerp(hipY, leftAnkleY, 0.52))}" fill="none" stroke="#091122" stroke-width="1.6"/>`,
    `<path d="M ${Math.round(lerp(leftShoulderX, leftHandX, 0.68))} ${Math.round(lerp(shoulderY, leftHandY, 0.68))} Q ${leftTrailX - 3} ${Math.round((leftHandY + leftTrailY) * 0.5)} ${leftTrailX} ${leftTrailY}" fill="none" stroke="#091122" stroke-width="1.6"/>`,
    `<path d="M ${leftHandX} ${leftHandY + 2} Q ${leftTrailX} ${leftTrailY} ${leftAnkleX} ${leftAnkleY}" fill="none" stroke="#00f5d4" stroke-width="1.6"/>`
  );

  // Right Wing Membrane
  parts.push(
    `<path d="M ${rightShoulderX} ${shoulderY} L ${rightElbowX} ${rightElbowY} L ${rightHandX} ${rightHandY + 2} Q ${rightTrailX} ${rightTrailY} ${rightAnkleX} ${rightAnkleY} L ${rightHipX} ${hipY} Z" fill="url(#wsMembraneR)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`,
    // High-Vis Flame/Gold Racing Panel on Right Wing
    `<polygon points="${Math.round(lerp(rightShoulderX, rightHandX, 0.45))},${Math.round(lerp(shoulderY, rightHandY, 0.45) + 3)} ${Math.round(lerp(rightHandX, rightShoulderX, 0.15))},${rightHandY + 3} ${rightTrailX},${rightTrailY} ${Math.round(lerp(rightHipX, rightAnkleX, 0.52))},${Math.round(lerp(hipY, rightAnkleY, 0.52))}" fill="#ffbe0b" opacity="${(0.88 - rightTuck * 0.35).toFixed(2)}"/>`,
    // Inflated 3D Air-Cell Ribs & Fold Creases
    `<path d="M ${Math.round(lerp(rightShoulderX, rightHandX, 0.36))} ${Math.round(lerp(shoulderY, rightHandY, 0.36))} Q ${Math.round(rightTrailX * 0.75)} ${Math.round((shoulderY + rightAnkleY) * 0.45)} ${Math.round(lerp(rightHipX, rightAnkleX, 0.52))} ${Math.round(lerp(hipY, rightAnkleY, 0.52))}" fill="none" stroke="#091122" stroke-width="1.6"/>`,
    `<path d="M ${Math.round(lerp(rightShoulderX, rightHandX, 0.68))} ${Math.round(lerp(shoulderY, rightHandY, 0.68))} Q ${rightTrailX + 3} ${Math.round((rightHandY + rightTrailY) * 0.5)} ${rightTrailX} ${rightTrailY}" fill="none" stroke="#091122" stroke-width="1.6"/>`,
    `<path d="M ${rightHandX} ${rightHandY + 2} Q ${rightTrailX} ${rightTrailY} ${rightAnkleX} ${rightAnkleY}" fill="none" stroke="#00f5d4" stroke-width="1.6"/>`
  );

  // Tail-Wing Membrane between the legs
  parts.push(
    `<path d="M ${leftHipX} ${hipY} L ${rightHipX} ${hipY} L ${rightAnkleX} ${rightAnkleY} Q 0 ${tailArchY} ${leftAnkleX} ${leftAnkleY} Z" fill="url(#wsMembraneL)" stroke="#070a10" stroke-width="1.3" stroke-linejoin="round"/>`,
    `<path d="M ${leftAnkleX} ${leftAnkleY} Q 0 ${tailArchY} ${rightAnkleX} ${rightAnkleY}" fill="none" stroke="#ffbe0b" stroke-width="1.5"/>`,
    `<line x1="0" y1="${hipY + 3}" x2="0" y2="${tailArchY}" stroke="#091122" stroke-width="1.5"/>`
  );

  // =========================================================================
  // 3. DISTANT HELMET & PADDED NECK ROLL (tucked forward ahead of the shoulders)
  // =========================================================================
  const helmetRx = 10.5;
  const helmetRy = Math.max(7.5, Math.round(9.5 * foreshortenY));
  parts.push(
    // Full-face aerodynamic skydiving helmet seen from behind/above
    `<ellipse cx="${headX}" cy="${headY}" rx="${helmetRx}" ry="${helmetRy}" fill="url(#wsHelmet3D)" stroke="#070a10" stroke-width="1.6"/>`,
    // Dual sculpted aero shell seams curving forward over the crown of the helmet
    `<path d="M ${headX - 5} ${headY + 3} Q ${headX - 3} ${headY - helmetRy + 1} ${headX - 1.5} ${headY - helmetRy + 1}" fill="none" stroke="#94a3b8" stroke-width="1.2" stroke-linecap="round"/>`,
    `<path d="M ${headX + 5} ${headY + 3} Q ${headX + 3} ${headY - helmetRy + 1} ${headX + 1.5} ${headY - helmetRy + 1}" fill="none" stroke="#94a3b8" stroke-width="1.2" stroke-linecap="round"/>`,
    // Acoustic / camera-mount side fairing on left side of helmet
    `<path d="M ${headX - helmetRx} ${headY - 1} L ${headX - helmetRx - 1.5} ${headY + 2} L ${headX - helmetRx + 1} ${headY + 3} Z" fill="#ffbe0b"/>`
  );

  // =========================================================================
  // 4. FULL-BODIED HUMAN ANATOMY: MUSCULAR LEGS, GLUTES, TORSO & ARMS
  // Rendered with true anatomical thickness & 3D cylindrical highlights (NO stick limbs!)
  // =========================================================================
  // Left & Right Volumetric Legs (Hip r=7.5 -> Knee r=6.5 -> Ankle r=5.5)
  const leftLegPath = buildVolumetricLimbPath(
    leftHipX,
    hipY,
    7.2,
    leftKneeX,
    leftKneeY,
    6.4,
    leftFootX,
    leftFootY - 2,
    5.4
  );
  const rightLegPath = buildVolumetricLimbPath(
    rightHipX,
    hipY,
    7.2,
    rightKneeX,
    rightKneeY,
    6.4,
    rightFootX,
    rightFootY - 2,
    5.4
  );

  // Left & Right Volumetric Arms (Shoulder Deltoid r=7.5 -> Elbow r=6.0 -> Wrist r=4.5)
  const leftArmPath = buildVolumetricLimbPath(
    leftShoulderX,
    shoulderY + 2,
    7.4,
    leftElbowX,
    leftElbowY,
    5.8,
    leftHandX,
    leftHandY,
    4.2
  );
  const rightArmPath = buildVolumetricLimbPath(
    rightShoulderX,
    shoulderY + 2,
    7.4,
    rightElbowX,
    rightElbowY,
    5.8,
    rightHandX,
    rightHandY,
    4.2
  );

  parts.push(
    // Thick Muscular Legs in Pressurized Flight Suit
    `<path d="${leftLegPath}" fill="url(#wsBodySuit)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`,
    `<path d="${rightLegPath}" fill="url(#wsBodySuit)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`,
    // 3D Cylindrical Muscle Highlights along Calves/Hamstrings
    `<path d="M ${leftHipX - 1} ${hipY + 2} Q ${leftKneeX} ${leftKneeY} ${leftFootX} ${leftFootY - 4}" fill="none" stroke="#475569" stroke-width="3" stroke-linecap="round" opacity="0.65"/>`,
    `<path d="M ${rightHipX + 1} ${hipY + 2} Q ${rightKneeX} ${rightKneeY} ${rightFootX} ${rightFootY - 4}" fill="none" stroke="#475569" stroke-width="3" stroke-linecap="round" opacity="0.65"/>`,

    // Sculpted Athletic Torso (Broad Traps/Deltoids -> Tapered Waist -> Glutes/Pelvis)
    `<path d="M ${leftShoulderX - 4} ${shoulderY} Q ${headX} ${shoulderY - 5} ${rightShoulderX + 4} ${shoulderY} Q ${rightShoulderX + 2} ${waistY} ${rightHipX + 6} ${hipY + 2} Q 0 ${hipY + 7} ${leftHipX - 6} ${hipY + 2} Q ${leftShoulderX - 2} ${waistY} ${leftShoulderX - 4} ${shoulderY} Z" fill="url(#wsBodySuit)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`,
    // Sculpted Glute / Pelvis Suit Seam & Leg-Strap Harness Webbing
    `<path d="M ${leftHipX - 5} ${hipY + 1} Q -5 ${hipY + 6} 0 ${hipY + 3} Q 5 ${hipY + 6} ${rightHipX + 5} ${hipY + 1}" fill="none" stroke="#090d14" stroke-width="1.8" stroke-linecap="round"/>`,
    `<path d="M ${leftHipX - 5} ${hipY + 3} L ${leftHipX + 3} ${hipY + 6} M ${rightHipX + 5} ${hipY + 3} L ${rightHipX - 3} ${hipY + 6}" stroke="#94a3b8" stroke-width="2.2" stroke-linecap="round"/>`,

    // Thick Muscular Arms (Deltoids -> Biceps -> Elbows -> Forearms)
    `<path d="${leftArmPath}" fill="url(#wsLimbHighlight)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`,
    `<path d="${rightArmPath}" fill="url(#wsLimbHighlight)" stroke="#070a10" stroke-width="1.4" stroke-linejoin="round"/>`,
    // 3D Upper-Surface Specular Muscle Highlights & Articulated Elbow Pads
    `<path d="M ${leftShoulderX} ${shoulderY + 1} Q ${leftElbowX} ${leftElbowY - 1} ${leftHandX} ${leftHandY}" fill="none" stroke="#94a3b8" stroke-width="2.2" stroke-linecap="round" opacity="0.55"/>`,
    `<path d="M ${rightShoulderX} ${shoulderY + 1} Q ${rightElbowX} ${rightElbowY - 1} ${rightHandX} ${rightHandY}" fill="none" stroke="#94a3b8" stroke-width="2.2" stroke-linecap="round" opacity="0.55"/>`,
    // Molded Kevlar Elbow Reinforcement Pads
    `<ellipse cx="${leftElbowX}" cy="${leftElbowY}" rx="4.2" ry="3.2" fill="#0f172a" stroke="#38bdf8" stroke-width="0.9"/>`,
    `<ellipse cx="${rightElbowX}" cy="${rightElbowY}" rx="4.2" ry="3.2" fill="#0f172a" stroke="#38bdf8" stroke-width="0.9"/>`,

    // Sculpted Flight Gloves Gripping Wing Leading-Edge Handles
    `<g transform="translate(${leftHandX}, ${leftHandY}) rotate(${Math.round(lerp(-15, -65, leftTuck))})">`,
    `<rect x="-5.5" y="-4" width="10" height="8" rx="3.5" fill="#ffbe0b" stroke="#070a10" stroke-width="1.3"/>`,
    `<rect x="-2" y="-3" width="4" height="6" rx="1.5" fill="#0f172a"/>`,
    `</g>`,
    `<g transform="translate(${rightHandX}, ${rightHandY}) rotate(${Math.round(lerp(15, 65, rightTuck))})">`,
    `<rect x="-4.5" y="-4" width="10" height="8" rx="3.5" fill="#ffbe0b" stroke="#070a10" stroke-width="1.3"/>`,
    `<rect x="-2" y="-3" width="4" height="6" rx="1.5" fill="#0f172a"/>`,
    `</g>`
  );

  // =========================================================================
  // 5. 3D CONTOURED SKYDIVING / BASE RIG & HARNESS ON UPPER BACK
  // =========================================================================
  const rigTopY = shoulderY - 1;
  const rigBotY = waistY + 4;
  const rigMidX = Math.round(yawShiftX * 0.35);

  parts.push(
    // Padded 3D Shoulder Yoke Straps wrapping over his traps onto his back
    `<path d="M ${leftShoulderX + 5} ${shoulderY - 2} Q ${rigMidX - 9} ${rigTopY + 2} ${rigMidX - 7} ${rigTopY + 6}" fill="none" stroke="#cbd5e1" stroke-width="3.2" stroke-linecap="round"/>`,
    `<path d="M ${rightShoulderX - 5} ${shoulderY - 2} Q ${rigMidX + 9} ${rigTopY + 2} ${rigMidX + 7} ${rigTopY + 6}" fill="none" stroke="#cbd5e1" stroke-width="3.2" stroke-linecap="round"/>`,
    // Hip-ring harness webbing connecting bottom corners of rig to hips
    `<line x1="${rigMidX - 8}" y1="${rigBotY - 1}" x2="${leftHipX - 2}" y2="${hipY + 2}" stroke="#94a3b8" stroke-width="2.2"/>`,
    `<line x1="${rigMidX + 8}" y1="${rigBotY - 1}" x2="${rightHipX + 2}" y2="${hipY + 2}" stroke="#94a3b8" stroke-width="2.2"/>`,

    // 3D Sculpted Parachute Container (rounded ergonomic hardshell pack)
    `<path d="M ${rigMidX - 8.5} ${rigTopY + 2} Q ${rigMidX} ${rigTopY - 2} ${rigMidX + 8.5} ${rigTopY + 2} L ${rigMidX + 9.5} ${rigBotY - 2} Q ${rigMidX} ${rigBotY + 3} ${rigMidX - 9.5} ${rigBotY - 2} Z" fill="url(#wsRig3D)" stroke="#070a10" stroke-width="1.5"/>`,
    // 3D Top Bevel Highlight catching sky light (overlaps lower neck of helmet)
    `<path d="M ${rigMidX - 7.5} ${rigTopY + 2} Q ${rigMidX} ${rigTopY - 1} ${rigMidX + 7.5} ${rigTopY + 2} Q ${rigMidX} ${rigTopY + 4.5} ${rigMidX - 7.5} ${rigTopY + 2} Z" fill="#94a3b8" opacity="0.75"/>`,
    // 4-Flap Container Seams & Bridle Cover
    `<path d="M ${rigMidX - 7.5} ${rigTopY + 3} L ${rigMidX} ${Math.round((rigTopY + rigBotY) * 0.5)} L ${rigMidX + 7.5} ${rigTopY + 3}" fill="none" stroke="#090d16" stroke-width="1.3"/>`,
    `<path d="M ${rigMidX - 8.5} ${rigBotY - 2} L ${rigMidX} ${Math.round((rigTopY + rigBotY) * 0.5)} L ${rigMidX + 8.5} ${rigBotY - 2}" fill="none" stroke="#090d16" stroke-width="1.3"/>`,
    `<rect x="${rigMidX - 2.2}" y="${rigTopY + 3}" width="4.4" height="${Math.max(5, rigBotY - rigTopY - 5)}" rx="1.8" fill="#00f5d4" stroke="#070a10" stroke-width="0.9"/>`,
    // BOC Throw-Out Pilot Chute Handle at bottom-right of pack
    `<circle cx="${rigMidX + 8}" cy="${rigBotY}" r="2.8" fill="#ffbe0b" stroke="#070a10" stroke-width="1.1"/>`
  );

  // =========================================================================
  // 6. FOREGROUND 3D SKYDIVING BOOTS (Full Boot Volume + Angled Soles Facing Camera)
  // =========================================================================
  parts.push(
    // Left Boot
    `<g transform="translate(${leftFootX}, ${leftFootY}) rotate(-16)">`,
    `<path d="M -5.5 -6.5 Q 0 -9 5.5 -6.5 L 6.2 4 Q 0 7.5 -6.2 4 Z" fill="#1e293b" stroke="#070a10" stroke-width="1.5"/>`,
    `<rect x="-4.5" y="-5" width="9" height="9.5" rx="3.5" fill="#090d14" stroke="#64748b" stroke-width="1"/>`,
    `<line x1="-3" y1="-2.2" x2="3" y2="-2.2" stroke="#334155" stroke-width="1.6"/>`,
    `<line x1="-3" y1="0.4" x2="3" y2="0.4" stroke="#334155" stroke-width="1.6"/>`,
    `<rect x="-3.2" y="2.2" width="6.4" height="2.6" rx="1.2" fill="#00f5d4"/>`,
    `</g>`,
    // Right Boot
    `<g transform="translate(${rightFootX}, ${rightFootY}) rotate(16)">`,
    `<path d="M -5.5 -6.5 Q 0 -9 5.5 -6.5 L 6.2 4 Q 0 7.5 -6.2 4 Z" fill="#1e293b" stroke="#070a10" stroke-width="1.5"/>`,
    `<rect x="-4.5" y="-5" width="9" height="9.5" rx="3.5" fill="#090d14" stroke="#64748b" stroke-width="1"/>`,
    `<line x1="-3" y1="-2.2" x2="3" y2="-2.2" stroke="#334155" stroke-width="1.6"/>`,
    `<line x1="-3" y1="0.4" x2="3" y2="0.4" stroke="#334155" stroke-width="1.6"/>`,
    `<rect x="-3.2" y="2.2" width="6.4" height="2.6" rx="1.2" fill="#00f5d4"/>`,
    `</g>`
  );

  const s = pose.scale.toFixed(2);
  return `<g transform="scale(${s})">${parts.join("")}</g>`;
}
