import { CanyonGameEngine, CanyonSlice } from "./engine.js";
import { renderBirdmanSprite } from "./birdman-sprite.js";

/**
 * Unified Master Scene Coordinate Space (800 x 460):
 * - Columns 0..3 each span 200px horizontally (Total Width = 800px).
 * - Row 0 (Top 4 LCD Keys):      x = col * 200 + 20, y = 0,   w = 160, h = 160
 * - Row 1 (Bottom 4 LCD Keys):   x = col * 200 + 20, y = 180, w = 160, h = 160
 *   -> Bottom-Middle 2 Keys (col 1 & col 2, row 1) are kept 100% OPEN for the canyon & mountains!
 *   -> The other 6 keys house all the detailed cockpit HUD instruments over the mountains!
 * - Touch Strip (4 x 200x100):   x = col * 200,      y = 360, w = 200, h = 100 (Clean 800x100 Gorge + Wingman!)
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
 * Builds the unified 800x460 3D scene SVG body:
 * - Touch Strip (y = 360..460): Uncluttered 800x100 canyon floor & centered 3rd-person Wingman.
 * - 3D Canyon & Mountains extend continuously upward from the Touch Strip through all 8 buttons!
 * - Bottom-Middle 2 Buttons ((1,1) and (2,1)) remain completely open windows into the winding canyon!
 * - The surrounding 6 Buttons ((0,0), (1,0), (2,0), (3,0), (0,1), (3,1)) display the detailed cockpit HUD!
 */
export function buildMasterSceneSvgBody(engine: CanyonGameEngine): string {
  const W = MASTER_W;
  const H = MASTER_H;

  const shakeX =
    engine.screenShake > 0
      ? Math.round(Math.sin(engine.tickCount * 2.7) * engine.screenShake)
      : 0;
  const shakeY =
    engine.screenShake > 0
      ? Math.round(Math.cos(engine.tickCount * 3.3) * engine.screenShake)
      : 0;

  const currentSlice = engine.sampleCanyonAt(engine.playerZ);

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

  // Distant mountain range silhouette along the horizon
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
    const projectY = (wy: number) => Math.round(clampedHorizon + 58 - (wy - camY) * scale * 1.38);

    const midHalfW = slice.floorHalfWidth + (slice.rimHalfWidth - slice.floorHalfWidth) * 0.52;
    const midWorldY = slice.floorY + (slice.rimY - slice.floorY) * 0.52;

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

    // Outer mountain slopes
    parts.push(
      `<polygon points="-240,${far.floorY} ${far.peakLeftX},${far.peakLeftY} ${near.peakLeftX},${near.peakLeftY} -240,${near.floorY}" fill="${leftPeakColors[sIdx]}"/>`,
      `<polygon points="${far.peakRightX},${far.peakRightY} ${W + 240},${far.floorY} ${W + 240},${near.floorY} ${near.peakRightX},${near.peakRightY}" fill="${rightPeakColors[sIdx]}"/>`
    );

    // Towering Left & Right Mountain Ridges above the Canyon Rim
    parts.push(
      `<polygon points="${far.peakLeftX},${far.peakLeftY} ${near.peakLeftX},${near.peakLeftY} ${near.rimLeftX},${near.rimY} ${far.rimLeftX},${far.rimY}" fill="${leftPeakColors[sIdx]}" stroke="#2a0810" stroke-width="0.7"/>`,
      `<polygon points="${far.rimRightX},${far.rimY} ${near.rimRightX},${near.rimY} ${near.peakRightX},${near.peakRightY} ${far.peakRightX},${far.peakRightY}" fill="${rightPeakColors[sIdx]}" stroke="#1f050b" stroke-width="0.7"/>`
    );

    // Canyon Floor quad
    parts.push(
      `<polygon points="${far.floorLeftX},${far.floorY} ${far.floorRightX},${far.floorY} ${near.floorRightX},${near.floorY} ${near.floorLeftX},${near.floorY}" fill="${floorColors[sIdx]}"/>`
    );

    // Winding River on Canyon Floor
    const riverCol = sIdx % 2 === 0 ? "#1982c4" : "#2ec4b6";
    parts.push(
      `<polygon points="${far.riverLeftX},${far.floorY} ${far.riverRightX},${far.floorY} ${near.riverRightX},${near.floorY} ${near.riverLeftX},${near.floorY}" fill="${riverCol}" opacity="0.8"/>`
    );

    // Left Cliff Wall
    parts.push(
      `<polygon points="${far.rimLeftX},${far.rimY} ${near.rimLeftX},${near.rimY} ${near.midLeftX},${near.midY} ${far.midLeftX},${far.midY}" fill="${leftUpperColors[sIdx]}" stroke="#2a0810" stroke-width="0.7"/>`,
      `<polygon points="${far.midLeftX},${far.midY} ${near.midLeftX},${near.midY} ${near.floorLeftX},${near.floorY} ${far.floorLeftX},${far.floorY}" fill="${leftLowerColors[sIdx]}" stroke="#2a0810" stroke-width="0.7"/>`
    );

    // Right Cliff Wall
    parts.push(
      `<polygon points="${far.rimRightX},${far.rimY} ${near.rimRightX},${near.rimY} ${near.midRightX},${near.midY} ${far.midRightX},${far.midY}" fill="${rightUpperColors[sIdx]}" stroke="#1f050b" stroke-width="0.7"/>`,
      `<polygon points="${far.midRightX},${far.midY} ${near.midRightX},${near.midY} ${near.floorRightX},${near.floorY} ${far.floorRightX},${far.floorY}" fill="${rightLowerColors[sIdx]}" stroke="#1f050b" stroke-width="0.7"/>`
    );

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
  const birdY = Math.round(
    416 - Math.max(-18, Math.min(22, engine.pitch * 0.45))
  );

  const agl = Math.max(0, engine.playerY - currentSlice.floorY);
  if (agl < 65 && engine.phase !== "CARNAGE") {
    const shadowY = Math.min(454, Math.round(birdY + 14 + agl * 0.4));
    const shadowScale = Math.max(0.3, 1 - agl / 75);
    parts.push(
      `<ellipse cx="${birdX}" cy="${shadowY}" rx="${Math.round(38 * shadowScale)}" ry="${Math.round(7 * shadowScale)}" fill="#090206" opacity="${(0.6 * shadowScale).toFixed(2)}"/>`
    );
  }

  if (engine.phase === "CARNAGE") {
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
      const py = Math.round(p.y * 1.35 - 40);
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

    // Carnage banner across the 2 open bottom-middle buttons ((1,1) & (2,1): x = 228..572, y = 215..305)
    parts.push(
      `<rect x="228" y="214" width="344" height="92" rx="12" fill="#140206" opacity="0.9" stroke="#ff1e27" stroke-width="2.5"/>`,
      `<text x="400" y="248" text-anchor="middle" fill="#ff2a2a" font-family="Arial, sans-serif" font-weight="900" font-size="28" letter-spacing="1.5">CARNAGE! SPLAT!</text>`,
      `<text x="400" y="273" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="700" font-size="14">${engine.lastCrashReason} (${engine.crashSpeed} MPH)</text>`,
      `<text x="400" y="296" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="16">SCORE: ${Math.floor(engine.score)}   |   BEST: ${engine.highScore}</text>`
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

    // Draw the 3rd-person Wingman centered on the Touch Strip
    parts.push(
      `<g transform="translate(${birdX},${birdY}) rotate(${engine.roll.toFixed(1)}) scale(1.05,${(pitchSquash * 0.92).toFixed(2)})">`,
      renderBirdmanSprite(engine),
      `</g>`
    );
  }

  // 5. DETAILED COCKPIT HUD INSTRUMENTS ON THE 6 SURROUNDING BUTTONS
  // (Leaving the 2 bottom-middle buttons (1,1) and (2,1) completely open for the 3D canyon & mountains!)
  parts.push(renderSixButtonCockpitHud(engine, currentSlice, Math.round(agl)));

  if (shakeX !== 0 || shakeY !== 0) {
    parts.push(`</g>`);
  }

  return parts.join("");
}

/**
 * Renders the rich, detailed Touch-Strip-style cockpit gauges onto the 6 surrounding buttons:
 * - Top Row:
 *   - Button (0, 0) [x=20..180,  y=0..160]:   AIRSPEED & CHUTE STALL METER (MPH, Stall Bar, Speed Multiplier)
 *   - Button (1, 0) [x=220..380, y=0..160]:   LIVE TOP-DOWN CANYON RADAR SCOPE & DISTANCE
 *   - Button (2, 0) [x=420..580, y=0..160]:   ARCADE SCORE & HIGH SCORE BOARD + STATUS
 *   - Button (3, 0) [x=620..780, y=0..160]:   ALTIMETER TAPE & PROXIMITY MULTIPLIER GAUGE
 * - Bottom Row Outer Buttons (while (1,1) & (2,1) stay 100% OPEN for the canyon mountains!):
 *   - Button (0, 1) [x=20..180,  y=180..340]: DIAL 1 PITCH & ARTIFICIAL HORIZON LADDER (Climb/Dive)
 *   - Button (3, 1) [x=620..780, y=180..340]: DIAL 4 STEERING / WINGSUIT ROLL & CANYON ALIGNMENT BAR
 */
function renderSixButtonCockpitHud(engine: CanyonGameEngine, slice: CanyonSlice, agl: number): string {
  const scoreInt = Math.floor(engine.score);
  const hud: string[] = [];

  const panelBg =
    engine.phase === "CARNAGE"
      ? "#2b0509"
      : engine.phase === "CHUTE"
      ? "#072227"
      : "#0a0e1c";
  const borderCol =
    engine.phase === "CARNAGE"
      ? "#ff2a2a"
      : engine.phase === "CHUTE"
      ? "#00f5d4"
      : "#2e3b63";

  // ============================================================================
  // 1. TOP-LEFT BUTTON (0, 0) [x=20..180, y=0..160]: AIRSPEED & CHUTE STALL METER
  // ============================================================================
  const speedRatio = Math.max(
    0,
    Math.min(1, (engine.speed - engine.STALL_SPEED) / (engine.MAX_SPEED - engine.STALL_SPEED))
  );
  const barW = Math.round(speedRatio * 132);
  const speedColor =
    engine.speed < engine.STALL_SPEED + 18
      ? "#00f5d4"
      : engine.speed > 190
      ? "#ff2a2a"
      : "#ffbe0b";
  const speedMult = Math.pow(Math.max(0.5, engine.speed / engine.BASE_START_SPEED), 1.45).toFixed(1);

  hud.push(
    `<rect x="26" y="6" width="148" height="148" rx="14" fill="${panelBg}" opacity="0.82" stroke="${borderCol}" stroke-width="2"/>`,
    `<text x="36" y="26" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="11">AIRSPEED &amp; STALL</text>`,
    `<text x="164" y="26" text-anchor="end" fill="#ffbe0b" font-family="Arial, sans-serif" font-weight="900" font-size="11">SPD x${speedMult}</text>`,
    `<text x="100" y="66" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="36">${Math.round(engine.speed)}<tspan font-size="13" fill="#8d99ae"> MPH</tspan></text>`,

    // Stall vs Max Speed Bar with tick marks
    `<rect x="34" y="80" width="132" height="16" rx="5" fill="#161d33" stroke="#3d4b73" stroke-width="1.2"/>`,
    `<rect x="34" y="80" width="22" height="16" rx="4" fill="#00f5d4" opacity="0.35"/>`,
    `<rect x="34" y="80" width="${barW}" height="16" rx="5" fill="${speedColor}"/>`,
    `<text x="34" y="112" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="800" font-size="11">STALL: ${engine.STALL_SPEED}</text>`,
    `<text x="166" y="112" text-anchor="end" fill="#ff595e" font-family="Arial, sans-serif" font-weight="800" font-size="11">MAX: ${engine.MAX_SPEED}</text>`,
    `<line x1="34" y1="122" x2="166" y2="122" stroke="#2b3558" stroke-width="1"/>`,
    `<text x="100" y="140" text-anchor="middle" fill="${
      engine.speed < engine.STALL_SPEED + 18 ? "#00f5d4" : "#cbd5e1"
    }" font-family="Arial, sans-serif" font-weight="800" font-size="11">${
      engine.speed < engine.STALL_SPEED + 18 ? "⚠ SLOW! CHUTE RISK!" : "TOO SLOW = CHUTE POPS"
    }</text>`
  );

  // ============================================================================
  // 2. TOP-MID-LEFT BUTTON (1, 0) [x=220..380, y=0..160]: TOP-DOWN CANYON RADAR
  // ============================================================================
  const radarPointsLeft: string[] = [];
  const radarPointsRight: string[] = [];
  const radarCenterLine: string[] = [];
  for (let r = 0; r <= 6; r++) {
    const s = engine.sampleCanyonAt(engine.playerZ + r * 42);
    const ry = 122 - r * 14;
    const rxCenter = 300 + (s.centerX - engine.playerX) * 0.42;
    const rw = s.floorHalfWidth * 0.42;
    radarPointsLeft.push(`${Math.round(rxCenter - rw)},${ry}`);
    radarPointsRight.push(`${Math.round(rxCenter + rw)},${ry}`);
    radarCenterLine.push(`${Math.round(rxCenter)},${ry}`);
  }
  const distKm = (Math.max(0, engine.playerZ) / 1000).toFixed(2);

  hud.push(
    `<rect x="226" y="6" width="148" height="148" rx="14" fill="${panelBg}" opacity="0.82" stroke="${borderCol}" stroke-width="2"/>`,
    `<text x="236" y="25" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="11">CANYON RADAR</text>`,
    `<text x="364" y="25" text-anchor="end" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="11">${distKm} KM</text>`,
    // Radar Scope Screen
    `<rect x="236" y="32" width="128" height="96" rx="8" fill="#05121c" stroke="#1982c4" stroke-width="1.5"/>`,
    `<line x1="300" y1="32" x2="300" y2="128" stroke="#11324d" stroke-width="1" stroke-dasharray="3 3"/>`,
    `<line x1="236" y1="80" x2="364" y2="80" stroke="#11324d" stroke-width="1" stroke-dasharray="3 3"/>`,
    `<polyline points="${radarCenterLine.join(" ")}" fill="none" stroke="#1982c4" stroke-width="1.2" stroke-dasharray="3 3"/>`,
    `<polyline points="${radarPointsLeft.join(" ")}" fill="none" stroke="#ff595e" stroke-width="2.5"/>`,
    `<polyline points="${radarPointsRight.join(" ")}" fill="none" stroke="#ff595e" stroke-width="2.5"/>`,
    `<polygon points="300,108 293,122 300,118 307,122" fill="#00f5d4" stroke="#ffffff" stroke-width="0.8"/>`,
    `<text x="300" y="144" text-anchor="middle" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="700" font-size="11">WINDING GORGE AHEAD</text>`
  );

  // ============================================================================
  // 3. TOP-MID-RIGHT BUTTON (2, 0) [x=420..580, y=0..160]: SCORE & HIGH SCORE
  // ============================================================================
  const statusText =
    engine.phase === "READY"
      ? "TURN DIAL TO START"
      : engine.phase === "FLYING"
      ? engine.isNewHighScore
        ? "★ NEW HIGH SCORE! ★"
        : "SCORING ACTIVE"
      : engine.phase === "CHUTE"
      ? "CHUTE POPPED (SAFE)"
      : "SPLAT! CARNAGE!";
  const statusCol =
    engine.phase === "CARNAGE"
      ? "#ff2a2a"
      : engine.isNewHighScore
      ? "#ffbe0b"
      : "#00f5d4";

  hud.push(
    `<rect x="426" y="6" width="148" height="148" rx="14" fill="${panelBg}" opacity="0.82" stroke="${borderCol}" stroke-width="2"/>`,
    `<text x="500" y="26" text-anchor="middle" fill="${statusCol}" font-family="Arial, sans-serif" font-weight="900" font-size="11" letter-spacing="0.5">${statusText}</text>`,
    `<text x="500" y="44" text-anchor="middle" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="10">CURRENT RUN SCORE</text>`,
    `<text x="500" y="82" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="36">${scoreInt}</text>`,
    `<line x1="440" y1="96" x2="560" y2="96" stroke="#2b3558" stroke-width="1.5"/>`,
    `<text x="500" y="114" text-anchor="middle" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="10">ALL-TIME HIGH SCORE</text>`,
    `<text x="500" y="140" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="900" font-size="24">${engine.highScore}</text>`
  );

  // ============================================================================
  // 4. TOP-RIGHT BUTTON (3, 0) [x=620..780, y=0..160]: ALTIMETER & PROXIMITY
  // ============================================================================
  const altRatio = Math.max(0, Math.min(1, agl / 95));
  const altMarkerY = Math.round(124 - altRatio * 84);
  const altDanger = agl < 18;

  hud.push(
    `<rect x="626" y="6" width="148" height="148" rx="14" fill="${panelBg}" opacity="0.82" stroke="${borderCol}" stroke-width="2"/>`,
    `<text x="636" y="25" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="11">ALTIMETER &amp; PROX</text>`,
    // Vertical Altimeter Tape on left side of button
    `<rect x="636" y="36" width="26" height="92" rx="5" fill="#161d33" stroke="#3d4b73" stroke-width="1.2"/>`,
    `<rect x="636" y="110" width="26" height="18" rx="3" fill="#d90429" opacity="0.65"/>`,
    `<line x1="636" y1="54" x2="662" y2="54" stroke="#00f5d4" stroke-width="1.5" stroke-dasharray="3 2"/>`,
    `<circle cx="649" cy="${altMarkerY}" r="5.5" fill="${altDanger ? "#ff2a2a" : "#00f5d4"}" stroke="#ffffff" stroke-width="1.5"/>`,
    // Digital Altitude & Proximity Readout on right side of button
    `<text x="672" y="50" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="10">ALTITUDE (AGL)</text>`,
    `<text x="672" y="76" fill="${altDanger ? "#ff2a2a" : "#ffffff"}" font-family="Arial, sans-serif" font-weight="900" font-size="24">${agl} <tspan font-size="12" fill="#8d99ae">FT</tspan></text>`,
    `<text x="672" y="98" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="10">PROXIMITY BONUS</text>`,
    `<text x="672" y="124" fill="#ffbe0b" font-family="Arial, sans-serif" font-weight="900" font-size="24">x${engine.proximityMultiplier.toFixed(1)}</text>`,
    `<text x="700" y="144" text-anchor="middle" fill="${altDanger ? "#ff2a2a" : "#94a3b8"}" font-family="Arial, sans-serif" font-weight="800" font-size="11">${
      altDanger ? "⚠ PULL UP! LOW ALT!" : "FLY LOW FOR BONUS"
    }</text>`
  );

  // ============================================================================
  // 5. BOTTOM-LEFT BUTTON (0, 1) [x=20..180, y=180..340]: DIAL 1 PITCH HORIZON
  // ============================================================================
  const pitchSign = engine.pitch >= 0 ? `+${Math.round(engine.pitch)}° UP` : `${Math.round(engine.pitch)}° DN`;
  const horizonLineY = Math.max(222, Math.min(292, Math.round(257 - engine.pitch * 1.8)));

  hud.push(
    `<rect x="26" y="186" width="148" height="148" rx="14" fill="${panelBg}" opacity="0.78" stroke="${borderCol}" stroke-width="2"/>`,
    `<text x="36" y="206" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="11">DIAL 1: PITCH</text>`,
    `<text x="164" y="206" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="13">${pitchSign}</text>`,

    // Artificial Horizon Pitch Ladder Scope
    `<rect x="36" y="214" width="128" height="86" rx="8" fill="#10182b" stroke="#3d4b73" stroke-width="1.5"/>`,
    `<line x1="65" y1="235" x2="135" y2="235" stroke="#475569" stroke-width="1" stroke-dasharray="4 4"/>`,
    `<line x1="55" y1="257" x2="145" y2="257" stroke="#64748b" stroke-width="1"/>`,
    `<line x1="65" y1="279" x2="135" y2="279" stroke="#475569" stroke-width="1" stroke-dasharray="4 4"/>`,
    `<line x1="42" y1="${horizonLineY}" x2="158" y2="${horizonLineY}" stroke="#00f5d4" stroke-width="3" stroke-linecap="round"/>`,
    `<circle cx="100" cy="257" r="4" fill="#ffbe0b" stroke="#ffffff" stroke-width="1.2"/>`,

    `<text x="100" y="315" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="11">▲ UP: CLIMB &amp; SLOW</text>`,
    `<text x="100" y="329" text-anchor="middle" fill="#ff595e" font-family="Arial, sans-serif" font-weight="800" font-size="11">▼ DN: DIVE &amp; SPEED</text>`
  );

  // ============================================================================
  // 6. BOTTOM-RIGHT BUTTON (3, 1) [x=620..780, y=180..340]: DIAL 4 STEER & ROLL
  // ============================================================================
  const canyonShift = slice.centerX - engine.playerX;
  const normOffset = Math.max(-1, Math.min(1, canyonShift / Math.max(1, slice.floorHalfWidth)));
  const canyonGateX = Math.round(700 + normOffset * 48);
  const rollText =
    Math.abs(engine.roll) < 2
      ? "LEVEL"
      : engine.roll < 0
      ? `${Math.round(Math.abs(engine.roll))}° L`
      : `${Math.round(engine.roll)}° R`;

  hud.push(
    `<rect x="626" y="186" width="148" height="148" rx="14" fill="${panelBg}" opacity="0.78" stroke="${borderCol}" stroke-width="2"/>`,
    `<text x="636" y="206" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="11">DIAL 4: STEER</text>`,
    `<text x="764" y="206" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="13">${rollText}</text>`,

    // Rotating Wingsuit Attitude Indicator
    `<rect x="636" y="214" width="128" height="58" rx="8" fill="#10182b" stroke="#3d4b73" stroke-width="1.5"/>`,
    `<g transform="translate(700, 244) rotate(${engine.roll.toFixed(1)})">`,
    `<polygon points="-38,0 0,-7 38,0 16,10 0,5 -16,10" fill="#ff2a2a" stroke="#ffffff" stroke-width="1.6"/>`,
    `<circle cx="0" cy="-6" r="4.5" fill="#ffffff"/>`,
    `</g>`,

    // Canyon Path Alignment Bar
    `<text x="700" y="286" text-anchor="middle" fill="#8d99ae" font-family="Arial, sans-serif" font-weight="800" font-size="10">CANYON PATH ALIGNMENT</text>`,
    `<rect x="636" y="294" width="128" height="12" rx="6" fill="#161d33" stroke="#3d4b73" stroke-width="1.2"/>`,
    `<rect x="636" y="294" width="12" height="12" rx="3" fill="#d90429"/>`,
    `<rect x="752" y="294" width="12" height="12" rx="3" fill="#d90429"/>`,
    `<rect x="${canyonGateX - 16}" y="292" width="32" height="16" rx="4" fill="none" stroke="#00f5d4" stroke-width="2"/>`,
    `<circle cx="700" cy="300" r="5" fill="#ffbe0b" stroke="#ffffff" stroke-width="1.5"/>`,
    `<text x="700" y="325" text-anchor="middle" fill="#cbd5e1" font-family="Arial, sans-serif" font-weight="800" font-size="11">↺ BANK L   |   BANK R ↻</text>`
  );

  // ============================================================================
  // 7. OPEN BOTTOM-MIDDLE BUTTONS ((1, 1) & (2, 1)) STATUS CALLOUTS (ONLY WHEN NEEDED)
  // ============================================================================
  if (engine.phase === "READY") {
    hud.push(
      `<rect x="236" y="302" width="328" height="32" rx="8" fill="#0d0628" opacity="0.82" stroke="#00f5d4" stroke-width="1.5"/>`,
      `<text x="400" y="323" text-anchor="middle" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="15" letter-spacing="0.8">TURN ANY DIAL TO DROP IN!</text>`
    );
  } else if (engine.phase === "CHUTE") {
    const landed = engine.speed === 0;
    hud.push(
      `<rect x="230" y="298" width="340" height="36" rx="8" fill="#081c24" opacity="0.88" stroke="#00f5d4" stroke-width="2"/>`,
      `<text x="400" y="321" text-anchor="middle" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="15">${
        landed ? "SAFE LANDING! PRESS KEY TO RESET" : "CHUTE DEPLOYED! FLOATING DOWN..."
      }</text>`
    );
  }

  return hud.join("");
}

/**
 * Slices out a single 144x144 key image at (col, row) from the unified 800x460 master scene.
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
