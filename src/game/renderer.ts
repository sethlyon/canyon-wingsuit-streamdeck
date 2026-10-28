import { CanyonGameEngine, CanyonSlice } from "./engine.js";
import { renderBirdmanSprite } from "./birdman-sprite.js";

/**
 * Unified Master Scene Coordinate Space (800 x 460):
 * - Columns 0..3 each span 200px horizontally (Total Width = 800px).
 * - Row 0 (Top 4 LCD Keys):      x = col * 200 + 20, y = 0,   w = 160, h = 160 (HUD + Sky + Mountain Peaks)
 * - Row 1 (Bottom 4 LCD Keys):   x = col * 200 + 20, y = 180, w = 160, h = 160 (Towering Canyon Walls & Mountains)
 * - Touch Strip (4 x 200x100):   x = col * 200,      y = 360, w = 200, h = 100 (Seamless 800x100 Gorge + Centered Wingman!)
 */
export const MASTER_W = 800;
export const MASTER_H = 460;
export const KEY_SIZE = 144;
export const KEY_VIEW_SIZE = 160;
export const STRIP_W = 200;
export const STRIP_H = 100;
export const STRIP_Y = 360;

interface ProjectedSlice {
  slice: CanyonSlice;
  scale: number;
  floorLeftX: number;
  floorRightX: number;
  floorY: number;
  midLeftX: number;
  midRightX: number;
  midY: number;
  rimLeftX: number;
  rimRightX: number;
  rimY: number;
  peakLeftX: number;
  peakRightX: number;
  peakLeftY: number;
  peakRightY: number;
  riverLeftX: number;
  riverRightX: number;
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/**
 * Builds the unified 800x460 3D scene SVG body where:
 * - The 3rd-person Wingman flies on the wide Touch Strip (y = 360..460, centered at x = 400, y = 416)
 * - The 3D canyon walls and jagged mountains extend continuously upward from the Touch Strip (y = 460)
 *   through the lower row of buttons (y = 180..340) and into the upper row of buttons (y = 0..160)!
 * - The HUD instruments & scoreboard sit in the top row of buttons (y = 0..160).
 */
export function buildMasterSceneSvgBody(engine: CanyonGameEngine): string {
  const W = MASTER_W;
  const H = MASTER_H;

  // Screen shake during carnage
  const shakeX =
    engine.screenShake > 0
      ? Math.round(Math.sin(engine.tickCount * 2.7) * engine.screenShake)
      : 0;
  const shakeY =
    engine.screenShake > 0
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

  const parts: string[] = [];

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
  parts.push(
    `<rect x="-240" y="-240" width="${W + 480}" height="${clampedHorizon + 260}" fill="url(#skyG)"/>`
  );

  const farSlice = engine.sampleCanyonAt(engine.playerZ + 520);
  const sunX = Math.round(W * 0.5 + (farSlice.centerX - camX) * 0.9 + bankYawShift);
  const sunY = Math.round(clampedHorizon - 28);
  parts.push(
    `<circle cx="${sunX}" cy="${sunY}" r="72" fill="#ff9f1c" opacity="0.26"/>`,
    `<circle cx="${sunX}" cy="${sunY}" r="44" fill="#ffd166" opacity="0.85"/>`
  );

  // Distant mountain range silhouette along the horizon (extends up into Row 0/Row 1 buttons)
  const bgMtnPts: string[] = [`-200,${clampedHorizon + 4}`];
  for (let mx = -160; mx <= W + 160; mx += 40) {
    const wave =
      Math.abs(Math.sin((mx - bankYawShift * 0.6) * 0.012 + 0.5)) * 58 +
      Math.abs(Math.cos((mx - bankYawShift * 0.6) * 0.027)) * 28;
    bgMtnPts.push(`${mx},${Math.round(clampedHorizon - 14 - wave)}`);
  }
  bgMtnPts.push(`${W + 200},${clampedHorizon + 4}`);
  parts.push(`<polygon points="${bgMtnPts.join(" ")}" fill="#381236" opacity="0.88"/>`);

  // Ground plane below horizon
  parts.push(
    `<rect x="-240" y="${clampedHorizon}" width="${W + 480}" height="${H - clampedHorizon + 260}" fill="url(#plateauG)"/>`
  );

  // 2. Sample & project 3D canyon & towering mountain slices from far horizon down to Touch Strip foreground
  const numSlices = 20;
  const stepZ = 26;
  const baseZ = Math.floor(engine.playerZ / stepZ) * stepZ;
  const projected: ProjectedSlice[] = [];
  const fov = 340;

  for (let i = numSlices; i >= 1; i--) {
    const worldZ = baseZ + i * stepZ;
    const relZ = Math.max(10, worldZ - engine.playerZ);
    const slice = engine.sampleCanyonAt(worldZ);
    const scale = fov / (relZ + 20);

    const depthBankShift = bankYawShift * (relZ / 160);
    const projectX = (wx: number) => Math.round(W * 0.5 + (wx - camX) * scale + depthBankShift);
    // Shift vertical projection so near canyon floor sits right in the Touch Strip (y ~ 380..455)
    // while the canyon walls & mountain peaks tower up through Row 1 (180..340) and Row 0 (0..160)!
    const projectY = (wy: number) => Math.round(clampedHorizon + 58 - (wy - camY) * scale * 1.38);

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
    parts.push(
      `<polygon points="-240,${far.floorY} ${far.peakLeftX},${far.peakLeftY} ${near.peakLeftX},${near.peakLeftY} -240,${near.floorY}" fill="${leftPeakColors[sIdx]}"/>`,
      `<polygon points="${far.peakRightX},${far.peakRightY} ${W + 240},${far.floorY} ${W + 240},${near.floorY} ${near.peakRightX},${near.peakRightY}" fill="${rightPeakColors[sIdx]}"/>`
    );

    // Towering Left & Right Mountain Ridges above the Canyon Rim (extending up into the LCD keys!)
    parts.push(
      `<polygon points="${far.peakLeftX},${far.peakLeftY} ${near.peakLeftX},${near.peakLeftY} ${near.rimLeftX},${near.rimY} ${far.rimLeftX},${far.rimY}" fill="${leftPeakColors[sIdx]}" stroke="#2a0810" stroke-width="0.7"/>`,
      `<polygon points="${far.rimRightX},${far.rimY} ${near.rimRightX},${near.rimY} ${near.peakRightX},${near.peakRightY} ${far.peakRightX},${far.peakRightY}" fill="${rightPeakColors[sIdx]}" stroke="#1f050b" stroke-width="0.7"/>`
    );

    // Canyon Floor quad (sweeps down into the Touch Strip!)
    parts.push(
      `<polygon points="${far.floorLeftX},${far.floorY} ${far.floorRightX},${far.floorY} ${near.floorRightX},${near.floorY} ${near.floorLeftX},${near.floorY}" fill="${floorColors[sIdx]}"/>`
    );

    // Winding River on Canyon Floor
    const riverCol = sIdx % 2 === 0 ? "#1982c4" : "#2ec4b6";
    parts.push(
      `<polygon points="${far.riverLeftX},${far.floorY} ${far.riverRightX},${far.floorY} ${near.riverRightX},${near.floorY} ${near.riverLeftX},${near.floorY}" fill="${riverCol}" opacity="0.8"/>`
    );

    // Left Cliff Wall (connects Touch Strip floor up to the LCD buttons!)
    parts.push(
      `<polygon points="${far.rimLeftX},${far.rimY} ${near.rimLeftX},${near.rimY} ${near.midLeftX},${near.midY} ${far.midLeftX},${far.midY}" fill="${leftUpperColors[sIdx]}" stroke="#2a0810" stroke-width="0.7"/>`,
      `<polygon points="${far.midLeftX},${far.midY} ${near.midLeftX},${near.midY} ${near.floorLeftX},${near.floorY} ${far.floorLeftX},${far.floorY}" fill="${leftLowerColors[sIdx]}" stroke="#2a0810" stroke-width="0.7"/>`
    );

    // Right Cliff Wall (connects Touch Strip floor up to the LCD buttons!)
    parts.push(
      `<polygon points="${far.rimRightX},${far.rimY} ${near.rimRightX},${near.rimY} ${near.midRightX},${near.midY} ${far.midRightX},${far.midY}" fill="${rightUpperColors[sIdx]}" stroke="#1f050b" stroke-width="0.7"/>`,
      `<polygon points="${far.midRightX},${far.midY} ${near.midRightX},${near.midY} ${near.floorRightX},${near.floorY} ${far.floorRightX},${far.floorY}" fill="${rightLowerColors[sIdx]}" stroke="#1f050b" stroke-width="0.7"/>`
    );

    // Natural rock arch spanning the canyon across the buttons
    if (near.slice.hasArch) {
      const archTopY = near.rimY + Math.round(8 * near.scale);
      const archBotY = near.rimY + Math.round(24 * near.scale);
      parts.push(
        `<polygon points="${near.rimLeftX},${archTopY} ${near.rimRightX},${archTopY} ${near.midRightX},${archBotY} ${near.midLeftX},${archBotY}" fill="#8f2d24" stroke="#ff9f1c" stroke-width="1.2"/>`
      );
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
      parts.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="${(1.2 + intensity * 1.8).toFixed(1)}" opacity="${(0.25 + intensity * 0.5).toFixed(2)}" stroke-linecap="round"/>`
      );
    }
  }

  // 4. THE WINGMAN ON THE TOUCH STRIP (y = 360..460, centered at x = 400)
  const birdX = 400;
  // Subtle vertical shift within the Touch Strip (394..432) based on pitch so he stays on the Touch Strip
  const birdY = Math.round(
    416 - Math.max(-18, Math.min(22, engine.pitch * 0.45))
  );

  // Shadow on the Touch Strip canyon floor
  const agl = Math.max(0, engine.playerY - currentSlice.floorY);
  if (agl < 65 && engine.phase !== "CARNAGE") {
    const shadowY = Math.min(454, Math.round(birdY + 14 + agl * 0.4));
    const shadowScale = Math.max(0.3, 1 - agl / 75);
    parts.push(
      `<ellipse cx="${birdX}" cy="${shadowY}" rx="${Math.round(38 * shadowScale)}" ry="${Math.round(7 * shadowScale)}" fill="#090206" opacity="${(0.6 * shadowScale).toFixed(2)}"/>`
    );
  }

  if (engine.phase === "CARNAGE") {
    // Carnage erupts on the Touch Strip and splatters upward across the 8 LCD keys!
    parts.push(`<g transform="translate(${birdX},${birdY})">`);
    const shockR = Math.min(340, Math.round(28 + engine.phaseElapsedSec * 240));
    const shockOpacity = Math.max(0, 0.9 - engine.phaseElapsedSec * 0.5);
    if (shockOpacity > 0.04) {
      parts.push(
        `<circle cx="0" cy="0" r="${shockR}" fill="none" stroke="#ff2a2a" stroke-width="6" opacity="${shockOpacity.toFixed(2)}"/>`,
        `<circle cx="0" cy="0" r="${Math.round(shockR * 0.65)}" fill="#8d0801" opacity="${(shockOpacity * 0.7).toFixed(2)}"/>`
      );
    }

    for (const p of engine.particles) {
      const px = Math.round(p.x * 1.35);
      const py = Math.round(p.y * 1.35 - 40); // Launch debris upward into the buttons too!
      if (p.kind === "helmet") {
        parts.push(
          `<g transform="translate(${px},${py}) rotate(${Math.round(p.rotation)})">`,
          `<circle cx="0" cy="0" r="11" fill="#ffffff" stroke="#111" stroke-width="2"/>`,
          `<path d="M-7 -3 Q0 -8 7 -3 L5 3 Q0 5 -5 3 Z" fill="#00f5d4"/>`,
          `<path d="M-4 -8 L3 8" stroke="#d90429" stroke-width="2.5"/>`,
          `</g>`
        );
      } else if (p.kind === "wing" || p.kind === "gib") {
        parts.push(
          `<polygon points="${px},${py - p.size} ${px + p.size},${py + p.size * 0.6} ${px - p.size * 0.8},${py + p.size}" fill="${p.color}" stroke="#3b0000" stroke-width="1"/>`
        );
      } else {
        parts.push(
          `<circle cx="${px}" cy="${py}" r="${Math.round(p.size)}" fill="${p.color}" opacity="0.9"/>`
        );
      }
    }
    parts.push(`</g>`);

    // Visceral blood splatters across both the LCD buttons AND Touch Strip
    for (const s of engine.screenSplats) {
      const sx = Math.round(s.nx * W);
      const sy = Math.round(s.ny * H);
      const r = Math.round(s.radius * 1.2);
      const drip = Math.round(s.dripLength * 1.2);
      parts.push(
        `<circle cx="${sx}" cy="${sy}" r="${r}" fill="${s.color}" opacity="0.84"/>`,
        `<circle cx="${sx + Math.round(r * 0.7)}" cy="${sy - Math.round(r * 0.5)}" r="${Math.round(r * 0.4)}" fill="${s.color}" opacity="0.85"/>`,
        `<rect x="${sx - 3}" y="${sy}" width="6" height="${r + drip}" rx="3" fill="${s.color}" opacity="0.85"/>`
      );
    }

    // Big Carnage Banner across Row 1 Buttons (y = 205..315)
    parts.push(
      `<rect x="190" y="206" width="420" height="110" rx="14" fill="#140206" opacity="0.92" stroke="#ff1e27" stroke-width="3"/>`,
      `<text x="400" y="246" text-anchor="middle" fill="#ff2a2a" font-family="Arial, sans-serif" font-weight="900" font-size="32" letter-spacing="2">CARNAGE! SPLAT!</text>`,
      `<text x="400" y="274" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="700" font-size="16">${engine.lastCrashReason} (${engine.crashSpeed} MPH)</text>`,
      `<text x="400" y="302" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="19">SCORE: ${Math.floor(engine.score)}   |   BEST: ${engine.highScore}</text>`
    );
  } else {
    // Wingtip vortex trails on the Touch Strip
    const pitchSquash = Math.max(0.65, Math.min(1.25, 1.0 + engine.pitch * 0.008));
    const rad = (engine.roll * Math.PI) / 180;
    const wingSpan = 56;
    const leftTipX = Math.round(birdX - Math.cos(rad) * wingSpan);
    const leftTipY = Math.round(birdY - Math.sin(rad) * wingSpan);
    const rightTipX = Math.round(birdX + Math.cos(rad) * wingSpan);
    const rightTipY = Math.round(birdY + Math.sin(rad) * wingSpan);

    parts.push(
      `<path d="M ${leftTipX} ${leftTipY} Q ${leftTipX - 24} ${leftTipY + 18} ${leftTipX - 42} ${leftTipY + 38}" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.5" stroke-dasharray="6 4"/>`,
      `<path d="M ${rightTipX} ${rightTipY} Q ${rightTipX + 24} ${rightTipY + 18} ${rightTipX + 42} ${rightTipY + 38}" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.5" stroke-dasharray="6 4"/>`
    );

    // Draw the 3rd-person Wingman centered on the Touch Strip!
    parts.push(
      `<g transform="translate(${birdX},${birdY}) rotate(${engine.roll.toFixed(1)}) scale(1.05,${(pitchSquash * 0.92).toFixed(2)})">`,
      renderBirdmanSprite(engine),
      `</g>`
    );

    // Subtle left & right dial quick-prompts on the far edges of the Touch Strip (col 0 and col 3)
    const pitchSign = engine.pitch >= 0 ? `+${Math.round(engine.pitch)}° UP` : `${Math.round(engine.pitch)}° DN`;
    const rollText =
      Math.abs(engine.roll) < 2
        ? "LEVEL"
        : engine.roll < 0
        ? `${Math.round(Math.abs(engine.roll))}° L`
        : `${Math.round(engine.roll)}° R`;

    parts.push(
      // Leftmost Touch Strip edge (Dial 1 Pitch telemetry)
      `<rect x="10" y="370" width="135" height="80" rx="8" fill="#080b16" opacity="0.68" stroke="#00f5d4" stroke-width="1.2"/>`,
      `<text x="20" y="390" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="11">◀ DIAL 1: PITCH</text>`,
      `<text x="20" y="414" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="18">${pitchSign}</text>`,
      `<text x="20" y="436" fill="#ffd166" font-family="Arial, sans-serif" font-weight="700" font-size="11">${Math.round(engine.speed)} MPH (STALL ${engine.STALL_SPEED})</text>`,

      // Rightmost Touch Strip edge (Dial 4 Steer telemetry)
      `<rect x="655" y="370" width="135" height="80" rx="8" fill="#080b16" opacity="0.68" stroke="#00f5d4" stroke-width="1.2"/>`,
      `<text x="780" y="390" text-anchor="end" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="11">DIAL 4: STEER ▶</text>`,
      `<text x="780" y="414" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="18">${rollText}</text>`,
      `<text x="780" y="436" text-anchor="end" fill="#ffd166" font-family="Arial, sans-serif" font-weight="700" font-size="11">PROX x${engine.proximityMultiplier.toFixed(1)}</text>`
    );

    // Status Banners across Row 1 Buttons (y = 220..290) when READY, CHUTE, or Warning
    if (engine.phase === "READY") {
      parts.push(
        `<rect x="210" y="226" width="380" height="62" rx="12" fill="#0d0628" opacity="0.84" stroke="#00f5d4" stroke-width="2"/>`,
        `<text x="400" y="252" text-anchor="middle" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="19" letter-spacing="1">TURN ANY DIAL TO DROP IN!</text>`,
        `<text x="400" y="274" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="700" font-size="13">LEFT DIAL: PITCH UP/DOWN   |   RIGHT DIAL: STEER L/R</text>`
      );
    } else if (engine.phase === "CHUTE") {
      const landed = engine.speed === 0;
      parts.push(
        `<rect x="200" y="222" width="400" height="68" rx="12" fill="#081c24" opacity="0.88" stroke="#00f5d4" stroke-width="2.5"/>`,
        `<text x="400" y="248" text-anchor="middle" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="20">${
          landed ? "SAFE LANDING! RUN COMPLETE" : "CHUTE DEPLOYED! (TOO SLOW)"
        }</text>`,
        `<text x="400" y="276" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="18">FINAL SCORE: ${Math.floor(engine.score)}   |   HIGH: ${engine.highScore}</text>`
      );
    } else if (engine.phase === "FLYING" && engine.speed < engine.STALL_SPEED + 16) {
      if (engine.tickCount % 2 === 0) {
        parts.push(
          `<rect x="250" y="236" width="300" height="36" rx="8" fill="#00bbf9" opacity="0.9"/>`,
          `<text x="400" y="260" text-anchor="middle" fill="#060614" font-family="Arial, sans-serif" font-weight="900" font-size="16">SLOW SPEED! CHUTE ABOUT TO POP!</text>`
        );
      }
    } else if (engine.phase === "FLYING" && agl < 16) {
      if (engine.tickCount % 2 === 0) {
        parts.push(
          `<rect x="260" y="236" width="280" height="36" rx="8" fill="#ff2a2a" opacity="0.9"/>`,
          `<text x="400" y="260" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="16">PULL UP! TERRAIN PROXIMITY!</text>`
        );
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
function renderTopRowHudOverlays(engine: CanyonGameEngine, slice: CanyonSlice, agl: number): string {
  const scoreInt = Math.floor(engine.score);
  const hudParts: string[] = [];

  // --- KEY (0, 0) [x = 20..180, y = 0..160]: SPEED, STALL BAR & PITCH ---
  const speedRatio = Math.max(
    0,
    Math.min(1, (engine.speed - engine.STALL_SPEED) / (engine.MAX_SPEED - engine.STALL_SPEED))
  );
  const speedBarW = Math.round(speedRatio * 128);
  const speedCol =
    engine.speed < engine.STALL_SPEED + 18
      ? "#00f5d4"
      : engine.speed > 195
      ? "#ff2a2a"
      : "#ffbe0b";
  hudParts.push(
    `<rect x="28" y="8" width="144" height="86" rx="10" fill="#090c1a" opacity="0.76" stroke="#2b3558" stroke-width="1.5"/>`,
    `<text x="38" y="26" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="11">AIRSPEED / STALL</text>`,
    `<text x="38" y="52" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="24">${Math.round(engine.speed)} <tspan font-size="12" fill="#ffd166">MPH</tspan></text>`,
    `<rect x="36" y="60" width="128" height="10" rx="4" fill="#1b2238" stroke="#3d4b73" stroke-width="1"/>`,
    `<rect x="36" y="60" width="${speedBarW}" height="10" rx="4" fill="${speedCol}"/>`,
    `<text x="38" y="85" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="800" font-size="11">CHUTE AT ${engine.STALL_SPEED} MPH</text>`
  );

  // --- KEY (1, 0) [x = 220..380, y = 0..160]: TOP-DOWN CANYON RADAR & ALTITUDE ---
  const radarLeft: string[] = [];
  const radarRight: string[] = [];
  for (let r = 0; r <= 4; r++) {
    const s = engine.sampleCanyonAt(engine.playerZ + r * 50);
    const ry = 82 - r * 15;
    const rxC = 266 + (s.centerX - engine.playerX) * 0.28;
    const rw = s.floorHalfWidth * 0.28;
    radarLeft.push(`${Math.round(rxC - rw)},${ry}`);
    radarRight.push(`${Math.round(rxC + rw)},${ry}`);
  }
  const distKm = (Math.max(0, engine.playerZ) / 1000).toFixed(1);
  hudParts.push(
    `<rect x="228" y="8" width="144" height="86" rx="10" fill="#090c1a" opacity="0.76" stroke="#2b3558" stroke-width="1.5"/>`,
    `<rect x="236" y="16" width="60" height="70" rx="6" fill="#05101a" stroke="#1982c4" stroke-width="1.2"/>`,
    `<polyline points="${radarLeft.join(" ")}" fill="none" stroke="#ff595e" stroke-width="2"/>`,
    `<polyline points="${radarRight.join(" ")}" fill="none" stroke="#ff595e" stroke-width="2"/>`,
    `<polygon points="266,74 261,83 266,80 271,83" fill="#00f5d4"/>`,
    `<text x="304" y="30" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="10">ALTITUDE</text>`,
    `<text x="304" y="48" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="16">${agl} FT</text>`,
    `<text x="304" y="67" fill="#ffbe0b" font-family="Arial, sans-serif" font-weight="900" font-size="13">PROX x${engine.proximityMultiplier.toFixed(1)}</text>`,
    `<text x="304" y="84" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="700" font-size="11">${distKm} KM</text>`
  );

  // --- KEY (2, 0) [x = 420..580, y = 0..160]: SCORE & HIGH SCORE ---
  const statusCol =
    engine.phase === "CARNAGE"
      ? "#ff2a2a"
      : engine.isNewHighScore
      ? "#ffbe0b"
      : "#00f5d4";
  const statusLabel =
    engine.phase === "READY"
      ? "READY TO FLY"
      : engine.isNewHighScore
      ? "NEW RECORD!"
      : "SCORE";
  hudParts.push(
    `<rect x="428" y="8" width="144" height="86" rx="10" fill="#090c1a" opacity="0.76" stroke="#2b3558" stroke-width="1.5"/>`,
    `<text x="500" y="26" text-anchor="middle" fill="${statusCol}" font-family="Arial, sans-serif" font-weight="900" font-size="11">${statusLabel}</text>`,
    `<text x="500" y="58" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="28">${scoreInt}</text>`,
    `<text x="500" y="84" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="13">BEST: ${engine.highScore}</text>`
  );

  // --- KEY (3, 0) [x = 620..780, y = 0..160]: STEERING & CANYON GATE ALIGNMENT ---
  const canyonShift = slice.centerX - engine.playerX;
  const normOffset = Math.max(-1, Math.min(1, canyonShift / Math.max(1, slice.floorHalfWidth)));
  const gateX = Math.round(700 + normOffset * 46);
  hudParts.push(
    `<rect x="628" y="8" width="144" height="86" rx="10" fill="#090c1a" opacity="0.76" stroke="#2b3558" stroke-width="1.5"/>`,
    `<text x="700" y="25" text-anchor="middle" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="11">CANYON ALIGNMENT</text>`,
    `<g transform="translate(700, 46) rotate(${engine.roll.toFixed(1)})">`,
    `<polygon points="-28,0 0,-5 28,0 12,7 0,3 -12,7" fill="#ff2a2a" stroke="#ffffff" stroke-width="1.4"/>`,
    `</g>`,
    `<rect x="640" y="66" width="120" height="10" rx="5" fill="#1b2238" stroke="#3d4b73" stroke-width="1"/>`,
    `<rect x="${gateX - 14}" y="65" width="28" height="12" rx="4" fill="none" stroke="#00f5d4" stroke-width="2"/>`,
    `<circle cx="700" cy="71" r="4.5" fill="#ffbe0b" stroke="#ffffff" stroke-width="1.2"/>`
  );

  return hudParts.join("");
}

/**
 * Slices out a single 144x144 key image at (col, row) from the unified 800x460 master scene.
 * - Row 0: y = 0..160   (Sky, Mountain Peaks, HUD)
 * - Row 1: y = 180..340 (Towering Canyon Walls extending up from the Touch Strip)
 */
export function renderKeyTileSvg(masterBody: string, col: number, row: number): string {
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
export function renderTouchStripSlotSvg(
  col: number,
  engine: CanyonGameEngine,
  masterBody?: string
): string {
  const body = masterBody ?? buildMasterSceneSvgBody(engine);
  const clampedCol = Math.max(0, Math.min(3, col));
  const vx = clampedCol * STRIP_W;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STRIP_W}" height="${STRIP_H}" viewBox="${vx} ${STRIP_Y} ${STRIP_W} ${STRIP_H}">${body}</svg>`;
}
