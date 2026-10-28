import { CanyonGameEngine, CanyonSlice } from "./engine.js";
import { renderBirdmanSprite } from "./birdman-sprite.js";

/**
 * Total panoramic coordinate space across the 4x2 Stream Deck + key grid.
 * Each key is 144x144 with a 16px virtual bezel gap between adjacent keys:
 * Width = 4 * 144 + 3 * 16 = 624
 * Height = 2 * 144 + 1 * 16 = 304
 */
export const GRID_TOTAL_W = 624;
export const GRID_TOTAL_H = 304;
export const KEY_SIZE = 144;
export const KEY_STRIDE = 160; // 144 + 16 bezel gap

/**
 * Unified panoramic coordinate space across the 4 Stream Deck + Touch Strip slots.
 * 4 slots x 200px = 800x100 continuous telemetry dashboard.
 */
export const TOUCH_STRIP_TOTAL_W = 800;
export const TOUCH_STRIP_TOTAL_H = 100;
export const TOUCH_SLOT_W = 200;

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
  riverLeftX: number;
  riverRightX: number;
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

function formatNumber(n: number): string {
  return Math.floor(Math.max(0, n)).toLocaleString("en-US");
}

/**
 * Renders the Fighter-Jet / Extreme-Sports Helmet Visor HUD Overlay across the 624x304 4x2 Key Grid.
 * All primary text readouts are positioned within the 144x144 key safe-zones:
 * - Col 0: x=0..144   | Col 1: x=160..304 | Col 2: x=320..464 | Col 3: x=480..624
 * - Row 0: y=0..144   | Row 1: y=160..304
 * while structural visor arcs, reticles, and rails flow continuously across the panoramic viewport.
 */
function buildVisorHudOverlaySvg(
  engine: CanyonGameEngine,
  currentSlice: CanyonSlice,
  birdX: number,
  birdY: number
): string {
  const W = GRID_TOTAL_W;
  const H = GRID_TOTAL_H;

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

  const hudPrimary =
    engine.phase === "CARNAGE"
      ? "#ff2a2a"
      : isDanger && engine.tickCount % 2 === 0
      ? "#ff2a2a"
      : mult >= 2.5
      ? "#ffbe0b"
      : "#00f5d4";

  const hudSecondary = "#38bdf8";
  const speedCol =
    spd < engine.STALL_SPEED + 18
      ? "#00bbf9"
      : spd > 220
      ? "#ff2a2a"
      : spd > 175
      ? "#ffbe0b"
      : "#00f5d4";
  const altCol =
    agl < 18
      ? "#ff2a2a"
      : agl < 30
      ? "#ffbe0b"
      : "#00f5d4";
  const multCol =
    mult >= 3.5
      ? "#ff2a2a"
      : mult >= 2.0
      ? "#ffbe0b"
      : "#00f5d4";

  const hud: string[] = [];

  // 1. Panoramic Visor Corner Frame & Tactical Brackets (Outer perimeter of the 4x2 grid)
  hud.push(
    // Top-left & Bottom-left visor rails (Col 0)
    `<path d="M 4 36 L 4 10 L 14 4 L 54 4" fill="none" stroke="${hudPrimary}" stroke-width="2" opacity="0.85"/>`,
    `<path d="M 4 268 L 4 294 L 14 300 L 54 300" fill="none" stroke="${hudPrimary}" stroke-width="2" opacity="0.85"/>`,
    // Top-right & Bottom-right visor rails (Col 3)
    `<path d="M ${W - 4} 36 L ${W - 4} 10 L ${W - 14} 4 L ${W - 54} 4" fill="none" stroke="${hudPrimary}" stroke-width="2" opacity="0.85"/>`,
    `<path d="M ${W - 4} 268 L ${W - 4} 294 L ${W - 14} 300 L ${W - 54} 300" fill="none" stroke="${hudPrimary}" stroke-width="2" opacity="0.85"/>`
  );

  // 2. Center Visor Flight-Path Vector & Pitch/Bank Reticle (Cols 1 & 2 around Birdman)
  if (engine.phase !== "CARNAGE") {
    const reticleR = 64;
    const leftWallWarn = engine.playerY < currentSlice.rimY && offsetFromCenter < 0 && wallClearance < 16;
    const rightWallWarn = engine.playerY < currentSlice.rimY && offsetFromCenter > 0 && wallClearance < 16;
    const leftArcCol = leftWallWarn ? "#ff2a2a" : hudPrimary;
    const rightArcCol = rightWallWarn ? "#ff2a2a" : hudPrimary;

    hud.push(
      `<g transform="translate(${birdX},${birdY}) rotate(${(-engine.roll * 0.5).toFixed(1)})" opacity="0.72">`,
      // Left and right tactical visor bracket arcs around the birdman
      `<path d="M ${-reticleR} -22 A ${reticleR} ${reticleR} 0 0 0 ${-reticleR} 22" fill="none" stroke="${leftArcCol}" stroke-width="${leftWallWarn ? 3 : 1.5}"/>`,
      `<path d="M ${reticleR} -22 A ${reticleR} ${reticleR} 0 0 1 ${reticleR} 22" fill="none" stroke="${rightArcCol}" stroke-width="${rightWallWarn ? 3 : 1.5}"/>`,
      `<line x1="${-reticleR - 8}" y1="0" x2="${-reticleR + 6}" y2="0" stroke="${leftArcCol}" stroke-width="2"/>`,
      `<line x1="${reticleR - 6}" y1="0" x2="${reticleR + 8}" y2="0" stroke="${rightArcCol}" stroke-width="2"/>`,
      // Pitch reference bars
      `<line x1="-28" y1="-34" x2="-12" y2="-34" stroke="${hudSecondary}" stroke-width="1.2" opacity="0.7"/>`,
      `<line x1="12" y1="-34" x2="28" y2="-34" stroke="${hudSecondary}" stroke-width="1.2" opacity="0.7"/>`,
      `<line x1="-22" y1="34" x2="-10" y2="34" stroke="${hudSecondary}" stroke-width="1.2" opacity="0.7"/>`,
      `<line x1="10" y1="34" x2="22" y2="34" stroke="${hudSecondary}" stroke-width="1.2" opacity="0.7"/>`,
      `</g>`
    );
  }

  // =========================================================================
  // 3. LEFT VISOR COLUMN (Col 0: x = 0..144)
  //    Row 0 (y = 0..144): SPEED (MPH) & Fighter-Jet Airspeed Tape
  //    Row 1 (y = 160..304): DISTANCE TRAVELED (KM / M) & PITCH TELEMETRY
  // =========================================================================
  const speedRatio = Math.max(
    0,
    Math.min(1, (spd - engine.STALL_SPEED) / (engine.MAX_SPEED - engine.STALL_SPEED))
  );
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
    `<line x1="27" y1="56" x2="32" y2="56" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`,
    `<line x1="27" y1="74" x2="32" y2="74" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`,
    `<line x1="27" y1="92" x2="32" y2="92" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`,
    `<line x1="27" y1="110" x2="32" y2="110" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`,
    // Speed Header & Big Readout
    `<text x="14" y="24" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">AIRSPEED</text>`,
    `<text x="130" y="24" text-anchor="end" fill="${speedCol}" font-family="Arial, sans-serif" font-weight="900" font-size="9">MPH</text>`,
    `<text x="86" y="52" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="26">${spd}</text>`,
    `<text x="86" y="64" text-anchor="middle" fill="${speedCol}" font-family="Arial, sans-serif" font-weight="800" font-size="9">${
      spd <= engine.STALL_SPEED + 15 ? "STALL WARN!" : `STALL ${engine.STALL_SPEED}`
    }</text>`
  );

  // Row 1 Left: Distance Traveled & Pitch Attitude (x=8..136, y=168..294)
  const pitchDeg = Math.round(engine.pitch);
  const pitchLabel = pitchDeg >= 0 ? `+${pitchDeg}° CLIMB` : `${pitchDeg}° DIVE`;
  const boostMph = Math.round(engine.distanceSpeedBoost);

  hud.push(
    `<path d="M 8 170 L 130 170 L 136 176 L 136 292 L 14 292 L 8 286 Z" fill="#060b16" opacity="0.78" stroke="#38bdf8" stroke-width="1.5"/>`,
    `<text x="15" y="186" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">DISTANCE</text>`,
    `<text x="129" y="186" text-anchor="end" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="800" font-size="9">KM</text>`,
    `<text x="15" y="213" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="24">${distKm}</text>`,
    `<text x="15" y="228" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="10">${formatNumber(distMeters)} M  |  +${boostMph} MPH</text>`,
    `<line x1="14" y1="236" x2="130" y2="236" stroke="#1e293b" stroke-width="1.5"/>`,
    `<text x="15" y="252" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="800" font-size="9">PITCH ATTITUDE</text>`,
    `<text x="15" y="270" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="14">${pitchLabel}</text>`,
    `<text x="15" y="284" fill="#64748b" font-family="Arial, sans-serif" font-weight="800" font-size="8.5">DIAL 1: CLIMB / DIVE</text>`
  );

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
    `<line x1="591" y1="56" x2="596" y2="56" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`,
    `<line x1="591" y1="74" x2="596" y2="74" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`,
    `<line x1="591" y1="92" x2="596" y2="92" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`,
    `<line x1="591" y1="110" x2="596" y2="110" stroke="#ffffff" stroke-width="1" opacity="0.7"/>`,
    // Altitude Header & Big Readout
    `<text x="495" y="24" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">ALTITUDE</text>`,
    `<text x="580" y="24" text-anchor="end" fill="${altCol}" font-family="Arial, sans-serif" font-weight="900" font-size="9">FT</text>`,
    `<text x="538" y="52" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="26">${agl}</text>`,
    `<text x="538" y="64" text-anchor="middle" fill="${altCol}" font-family="Arial, sans-serif" font-weight="800" font-size="9">${
      agl < 18 ? "PULL UP!" : `RIM ${rimAgl} FT`
    }</text>`
  );

  // Row 1 Right: Multiplier, Score & High Score Visor Card (x=488..616, y=170..292)
  const multPct = Math.max(0, Math.min(1, (mult - 1.0) / 4.0));
  const multBarW = Math.round(multPct * 112);

  hud.push(
    `<path d="M 494 170 L 616 170 L 616 286 L 610 292 L 488 292 L 488 176 Z" fill="#060b16" opacity="0.80" stroke="${multCol}" stroke-width="1.5"/>`,
    // Multiplier row
    `<text x="496" y="186" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="0.8">MULT</text>`,
    `<text x="608" y="188" text-anchor="end" fill="${multCol}" font-family="Arial, sans-serif" font-weight="900" font-size="16">x${mult.toFixed(1)}</text>`,
    `<rect x="496" y="193" width="112" height="6" rx="3" fill="#0f172a" stroke="#1e293b" stroke-width="1"/>`,
    `<rect x="496" y="193" width="${Math.max(8, multBarW)}" height="6" rx="3" fill="${multCol}"/>`,
    // Score readout
    `<text x="496" y="214" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="9" letter-spacing="0.8">SCORE</text>`,
    `<text x="608" y="214" text-anchor="end" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="800" font-size="8.5">${
      engine.isNewHighScore ? "NEW BEST!" : "LIVE"
    }</text>`,
    `<text x="496" y="236" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="20">${formatNumber(scoreInt)}</text>`,
    `<line x1="496" y1="244" x2="608" y2="244" stroke="#1e293b" stroke-width="1.5"/>`,
    // High Score readout
    `<text x="496" y="259" fill="#ffd166" font-family="Arial, sans-serif" font-weight="900" font-size="9" letter-spacing="0.8">HIGH SCORE</text>`,
    `<text x="496" y="278" fill="#ffd166" font-family="Arial, sans-serif" font-weight="900" font-size="16">${formatNumber(highInt)}</text>`,
    `<text x="496" y="288" fill="#64748b" font-family="Arial, sans-serif" font-weight="800" font-size="8">DIAL 4: STEER L/R</text>`
  );

  // =========================================================================
  // 5. TOP-CENTER VISOR TELEMETRY BAR (Col 1: x=168..298, Col 2: x=326..456)
  //    Shown during active flight when no modal banner is covering the top center
  // =========================================================================
  if (engine.phase === "FLYING" && !isLowAlt && !isNearStall) {
    hud.push(
      // Col 1 Top Visor Pill: Proximity Multiplier & Wall Clearance
      `<rect x="170" y="8" width="128" height="28" rx="6" fill="#060b16" opacity="0.76" stroke="${multCol}" stroke-width="1.2"/>`,
      `<text x="178" y="26" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="10">PROX</text>`,
      `<text x="290" y="27" text-anchor="end" fill="${multCol}" font-family="Arial, sans-serif" font-weight="900" font-size="15">x${mult.toFixed(1)}</text>`,

      // Col 2 Top Visor Pill: Live Score & High Score
      `<rect x="326" y="8" width="128" height="28" rx="6" fill="#060b16" opacity="0.76" stroke="#00f5d4" stroke-width="1.2"/>`,
      `<text x="334" y="26" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="900" font-size="10">SCR</text>`,
      `<text x="446" y="27" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="14">${formatNumber(scoreInt)}</text>`
    );
  }

  return hud.join("");
}

/**
 * Builds the inner SVG elements for the entire 624x304 panoramic 3D viewport once per frame.
 * The birdman stays centered in the middle of the display while the 3D canyon path adjusts,
 * shifts, and tilts around him as he banks left/right or climbs/dives!
 */
export function buildMasterSceneSvgBody(engine: CanyonGameEngine): string {
  const W = GRID_TOTAL_W;
  const H = GRID_TOTAL_H;

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

  // Camera is locked onto the birdman in the center; banking adjusts the canyon path ahead!
  const camX = engine.playerX;
  const camY = engine.playerY + 13 - engine.pitch * 0.25;
  const horizonY = Math.round(112 + engine.pitch * 1.75);
  const worldTiltDeg = -engine.roll * 0.42; // Canyon horizon tilts opposite to birdman bank
  const bankYawShift = -engine.roll * 1.65; // Banking shifts the canyon path across the viewport

  const parts: string[] = [];

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
  parts.push(
    `<rect x="-180" y="-180" width="${W + 360}" height="${clampedHorizon + 200}" fill="url(#skyG)"/>`
  );

  // Glowing sunset sun on the horizon
  const farSlice = engine.sampleCanyonAt(engine.playerZ + 480);
  const sunX = Math.round(W * 0.5 + (farSlice.centerX - camX) * 0.8 + bankYawShift);
  const sunY = Math.round(clampedHorizon - 14);
  parts.push(
    `<circle cx="${sunX}" cy="${sunY}" r="54" fill="#ff9f1c" opacity="0.28"/>`,
    `<circle cx="${sunX}" cy="${sunY}" r="34" fill="#ffd166" opacity="0.82"/>`
  );

  // Upper plateau ground outside the canyon rim
  parts.push(
    `<rect x="-180" y="${clampedHorizon}" width="${W + 360}" height="${H - clampedHorizon + 220}" fill="url(#plateauG)"/>`
  );

  // 2. Sample & project 3D canyon slices from far to near
  const numSlices = 18;
  const stepZ = 28;
  const baseZ = Math.floor(engine.playerZ / stepZ) * stepZ;
  const projected: ProjectedSlice[] = [];
  const fov = 260;

  for (let i = numSlices; i >= 1; i--) {
    const worldZ = baseZ + i * stepZ;
    const relZ = Math.max(12, worldZ - engine.playerZ);
    const slice = engine.sampleCanyonAt(worldZ);
    const scale = fov / (relZ + 22);

    // As the player banks left/right, the path of the canyon adjusts relative to the centered birdman
    const depthBankShift = bankYawShift * (relZ / 180);
    const projectX = (wx: number) => Math.round(W * 0.5 + (wx - camX) * scale + depthBankShift);
    const projectY = (wy: number) => Math.round(clampedHorizon - (wy - camY) * scale);

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
    parts.push(
      `<polygon points="-180,${far.rimY} ${far.rimLeftX},${far.rimY} ${near.rimLeftX},${near.rimY} -180,${near.rimY}" fill="${plateauCol}"/>`,
      `<polygon points="${far.rimRightX},${far.rimY} ${W + 180},${far.rimY} ${W + 180},${near.rimY} ${near.rimRightX},${near.rimY}" fill="${plateauCol}"/>`
    );

    // Canyon Floor quad
    parts.push(
      `<polygon points="${far.floorLeftX},${far.floorY} ${far.floorRightX},${far.floorY} ${near.floorRightX},${near.floorY} ${near.floorLeftX},${near.floorY}" fill="${floorColors[sIdx]}"/>`
    );

    // Winding river along the canyon floor
    const riverCol = sIdx % 2 === 0 ? "#1982c4" : "#2ec4b6";
    parts.push(
      `<polygon points="${far.riverLeftX},${far.floorY} ${far.riverRightX},${far.floorY} ${near.riverRightX},${near.floorY} ${near.riverLeftX},${near.floorY}" fill="${riverCol}" opacity="0.75"/>`
    );

    // Left Cliff Wall
    parts.push(
      `<polygon points="${far.rimLeftX},${far.rimY} ${near.rimLeftX},${near.rimY} ${near.midLeftX},${near.midY} ${far.midLeftX},${far.midY}" fill="${leftUpperColors[sIdx]}" stroke="#2a0810" stroke-width="0.6"/>`,
      `<polygon points="${far.midLeftX},${far.midY} ${near.midLeftX},${near.midY} ${near.floorLeftX},${near.floorY} ${far.floorLeftX},${far.floorY}" fill="${leftLowerColors[sIdx]}" stroke="#2a0810" stroke-width="0.6"/>`
    );

    // Right Cliff Wall
    parts.push(
      `<polygon points="${far.rimRightX},${far.rimY} ${near.rimRightX},${near.rimY} ${near.midRightX},${near.midY} ${far.midRightX},${far.midY}" fill="${rightUpperColors[sIdx]}" stroke="#1f050b" stroke-width="0.6"/>`,
      `<polygon points="${far.midRightX},${far.midY} ${near.midRightX},${near.midY} ${near.floorRightX},${near.floorY} ${far.floorRightX},${far.floorY}" fill="${rightLowerColors[sIdx]}" stroke="#1f050b" stroke-width="0.6"/>`
    );

    // Optional natural stone arch spanning the canyon
    if (near.slice.hasArch) {
      const archTopY = near.rimY + Math.round(8 * near.scale);
      const archBotY = near.rimY + Math.round(22 * near.scale);
      parts.push(
        `<polygon points="${near.rimLeftX},${archTopY} ${near.rimRightX},${archTopY} ${near.midRightX},${archBotY} ${near.midLeftX},${archBotY}" fill="#8f2d24" stroke="#ff9f1c" stroke-width="1"/>`
      );
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
      parts.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="${(1 + intensity * 1.8).toFixed(1)}" opacity="${(0.22 + intensity * 0.5).toFixed(2)}" stroke-linecap="round"/>`
      );
    }
  }

  // 4. 3rd-Person Birdman stays horizontally centered in the middle of the 4x2 grid!
  const birdX = Math.round(W * 0.5);
  const birdY = Math.round(
    H * 0.6 - Math.max(-55, Math.min(65, engine.pitch * 0.95))
  );

  // Birdman's shadow on the canyon floor when flying low
  const agl = Math.max(0, engine.playerY - currentSlice.floorY);
  if (agl < 65 && engine.phase !== "CARNAGE") {
    const shadowY = Math.min(H - 8, Math.round(birdY + agl * 2.2));
    const shadowScale = Math.max(0.25, 1 - agl / 70);
    parts.push(
      `<ellipse cx="${birdX}" cy="${shadowY}" rx="${Math.round(34 * shadowScale)}" ry="${Math.round(8 * shadowScale)}" fill="#090206" opacity="${(0.55 * shadowScale).toFixed(2)}"/>`
    );
  }

  // 5. Render Cockpit / Visor Telemetry HUD Overlay on the 4x2 Viewport
  parts.push(buildVisorHudOverlaySvg(engine, currentSlice, birdX, birdY));

  if (engine.phase === "CARNAGE") {
    // Explosive 3rd-person carnage at impact site + blood splats across the 4x2 keys
    parts.push(`<g transform="translate(${birdX},${birdY})">`);
    const shockR = Math.min(220, Math.round(24 + engine.phaseElapsedSec * 190));
    const shockOpacity = Math.max(0, 0.85 - engine.phaseElapsedSec * 0.55);
    if (shockOpacity > 0.04) {
      parts.push(
        `<circle cx="0" cy="0" r="${shockR}" fill="none" stroke="#ff2a2a" stroke-width="5" opacity="${shockOpacity.toFixed(2)}"/>`,
        `<circle cx="0" cy="0" r="${Math.round(shockR * 0.65)}" fill="#8d0801" opacity="${(shockOpacity * 0.7).toFixed(2)}"/>`
      );
    }

    for (const p of engine.particles) {
      const px = Math.round(p.x);
      const py = Math.round(p.y);
      if (p.kind === "helmet") {
        parts.push(
          `<g transform="translate(${px},${py}) rotate(${Math.round(p.rotation)})">`,
          `<circle cx="0" cy="0" r="10" fill="#ffffff" stroke="#111" stroke-width="2"/>`,
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

    // Visceral blood splatters on the camera lens / LCD keys
    for (const s of engine.screenSplats) {
      const sx = Math.round(s.nx * W);
      const sy = Math.round(s.ny * H);
      const r = Math.round(s.radius);
      const drip = Math.round(s.dripLength);
      parts.push(
        `<circle cx="${sx}" cy="${sy}" r="${r}" fill="${s.color}" opacity="0.82"/>`,
        `<circle cx="${sx + Math.round(r * 0.7)}" cy="${sy - Math.round(r * 0.5)}" r="${Math.round(r * 0.4)}" fill="${s.color}" opacity="0.85"/>`,
        `<circle cx="${sx - Math.round(r * 0.65)}" cy="${sy + Math.round(r * 0.4)}" r="${Math.round(r * 0.35)}" fill="${s.color}" opacity="0.85"/>`,
        `<rect x="${sx - 3}" y="${sy}" width="6" height="${r + drip}" rx="3" fill="${s.color}" opacity="0.85"/>`
      );
    }

    // Carnage banner across the center of the 4x2 grid (Cols 1 & 2)
    parts.push(
      `<rect x="164" y="88" width="296" height="122" rx="12" fill="#140206" opacity="0.92" stroke="#ff1e27" stroke-width="3"/>`,
      `<text x="312" y="126" text-anchor="middle" fill="#ff2a2a" font-family="Arial, sans-serif" font-weight="900" font-size="28" letter-spacing="1.5">CARNAGE! SPLAT!</text>`,
      `<text x="312" y="152" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="13">${engine.lastCrashReason}</text>`,
      `<text x="312" y="172" text-anchor="middle" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="800" font-size="12">IMPACT: ${engine.crashSpeed} MPH  |  DIST: ${(engine.distanceTraveled / 1000).toFixed(2)} KM</text>`,
      `<text x="312" y="196" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="16">SCORE: ${formatNumber(engine.score)}  |  BEST: ${formatNumber(engine.highScore)}</text>`
    );
  } else {
    // Render 3rd-person Birdman centered in the viewport
    parts.push(
      `<g transform="translate(${birdX},${birdY}) rotate(${engine.roll.toFixed(1)})">`,
      renderBirdmanSprite(engine),
      `</g>`
    );

    // Overlay Status Banners in Center Columns (Cols 1 & 2: x=166..458) for READY, CHUTE, or DANGER states
    if (engine.phase === "READY") {
      parts.push(
        `<rect x="166" y="10" width="292" height="52" rx="10" fill="#060b16" opacity="0.88" stroke="#00f5d4" stroke-width="2"/>`,
        `<text x="312" y="33" text-anchor="middle" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="16" letter-spacing="1">TURN ANY DIAL TO DROP IN!</text>`,
        `<text x="312" y="52" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="700" font-size="11">DIAL 1: PITCH / SPEED   |   DIAL 4: STEER L/R</text>`
      );
    } else if (engine.phase === "CHUTE") {
      const landed = engine.speed === 0;
      parts.push(
        `<rect x="166" y="10" width="292" height="60" rx="10" fill="#071e26" opacity="0.90" stroke="#00f5d4" stroke-width="2.5"/>`,
        `<text x="312" y="32" text-anchor="middle" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="16">${
          landed ? "SAFE LANDING! RUN COMPLETE" : "CHUTE DEPLOYED! (STALL)"
        }</text>`,
        `<text x="312" y="56" text-anchor="middle" fill="#ffd166" font-family="Arial, sans-serif" font-weight="900" font-size="14">SCORE: ${formatNumber(engine.score)}  |  DIST: ${(engine.distanceTraveled / 1000).toFixed(2)} KM</text>`
      );
    } else if (engine.phase === "FLYING" && engine.speed < engine.STALL_SPEED + 16) {
      if (engine.tickCount % 2 === 0) {
        parts.push(
          `<rect x="176" y="10" width="272" height="32" rx="8" fill="#00bbf9" opacity="0.92"/>`,
          `<text x="312" y="31" text-anchor="middle" fill="#060614" font-family="Arial, sans-serif" font-weight="900" font-size="15">STALL WARNING! DIVE FOR SPEED!</text>`
        );
      }
    } else if (engine.phase === "FLYING" && agl < 16) {
      if (engine.tickCount % 2 === 0) {
        parts.push(
          `<rect x="182" y="10" width="260" height="32" rx="8" fill="#ff2a2a" opacity="0.92"/>`,
          `<text x="312" y="31" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="15">PULL UP! TERRAIN PROXIMITY!</text>`
        );
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
export function renderKeyTileSvg(masterBody: string, col: number, row: number): string {
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
export function buildMasterTouchStripSvgBody(engine: CanyonGameEngine): string {
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

  const railColor =
    engine.phase === "CARNAGE"
      ? "#ff2a2a"
      : isDanger && engine.tickCount % 2 === 0
      ? "#ff2a2a"
      : engine.isNewHighScore
      ? "#ffbe0b"
      : "#00f5d4";

  const speedRatio = Math.max(
    0,
    Math.min(1, (spd - engine.STALL_SPEED) / (engine.MAX_SPEED - engine.STALL_SPEED))
  );
  const speedColor =
    spd < engine.STALL_SPEED + 18
      ? "#00bbf9"
      : spd > 220
      ? "#ff2a2a"
      : spd > 175
      ? "#ffbe0b"
      : "#00f5d4";

  const altColor =
    agl < 18
      ? "#ff2a2a"
      : agl < 30
      ? "#ffbe0b"
      : "#00f5d4";

  const multColor =
    mult >= 3.5
      ? "#ff2a2a"
      : mult >= 2.0
      ? "#ffbe0b"
      : "#00f5d4";

  // Continuous 800px bottom telemetry energy bar width (driven by speed & multiplier)
  const energyRatio =
    engine.phase === "CARNAGE"
      ? 1
      : Math.max(0.05, Math.min(1, speedRatio * 0.65 + ((mult - 1) / 4) * 0.35));
  const panoramicBarW = Math.round(energyRatio * 788);

  const parts: string[] = [];

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
  parts.push(
    `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#stripBg)"/>`,
    // Subtle continuous horizontal telemetry grid lines across all 800px
    `<line x1="0" y1="24" x2="${W}" y2="24" stroke="#1e293b" stroke-width="1" opacity="0.55"/>`,
    `<line x1="0" y1="68" x2="${W}" y2="68" stroke="#1e293b" stroke-width="1" opacity="0.55"/>`,
    // Continuous glowing top & bottom cockpit frame rails across 0..800
    `<path d="M 4 12 L 12 3 L 788 3 L 796 12" fill="none" stroke="${railColor}" stroke-width="2" opacity="0.9"/>`,
    // Continuous 800px Panoramic Telemetry Energy Bar along bottom (y=91..97)
    `<rect x="6" y="91" width="788" height="6" rx="3" fill="#0f172a" stroke="#1e293b" stroke-width="1"/>`,
    `<rect x="6" y="91" width="${panoramicBarW}" height="6" rx="3" fill="url(#panoramicEnergy)"/>`,
    // Angled fighter-jet strut dividers at slot boundaries (x=200, 400, 600)
    `<path d="M 196 4 L 204 16 L 204 82 L 196 90" fill="none" stroke="#334155" stroke-width="1.5"/>`,
    `<path d="M 396 4 L 404 16 L 404 82 L 396 90" fill="none" stroke="#334155" stroke-width="1.5"/>`,
    `<path d="M 596 4 L 604 16 L 604 82 L 596 90" fill="none" stroke="#334155" stroke-width="1.5"/>`
  );

  // =========================================================================
  // SLOT 0 (x = 0..200): SPEED (MPH) & PITCH CONTROL (DIAL 1)
  // =========================================================================
  const pitchSign =
    engine.pitch >= 0 ? `+${Math.round(engine.pitch)}° UP` : `${Math.round(engine.pitch)}° DN`;
  const spdBarW = Math.round(speedRatio * 126);
  const horizonLineY = Math.max(34, Math.min(64, Math.round(49 - engine.pitch * 0.35)));

  parts.push(
    // Header
    `<text x="12" y="18" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">SPEED // PITCH</text>`,
    `<text x="190" y="18" text-anchor="end" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="11">${pitchSign}</text>`,

    // Pitch Artificial Horizon Mini-Scope (x=12..52, y=30..68)
    `<rect x="12" y="30" width="40" height="36" rx="5" fill="#091020" stroke="#334155" stroke-width="1.2"/>`,
    `<line x1="15" y1="${horizonLineY}" x2="49" y2="${horizonLineY}" stroke="#00f5d4" stroke-width="2.2"/>`,
    `<circle cx="32" cy="48" r="2.5" fill="#ffbe0b"/>`,

    // Big Speed Readout (x=60..190)
    `<text x="60" y="50" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="25">${spd}</text>`,
    `<text x="108" y="49" fill="${speedColor}" font-family="Arial, sans-serif" font-weight="900" font-size="10">MPH</text>`,
    `<text x="190" y="48" text-anchor="end" fill="${
      spd <= engine.STALL_SPEED + 15 ? "#ff2a2a" : "#64748b"
    }" font-family="Arial, sans-serif" font-weight="800" font-size="9">STALL ${engine.STALL_SPEED}</text>`,

    // Speed Segmented Afterburner Bar
    `<rect x="60" y="56" width="128" height="9" rx="3" fill="#0f172a" stroke="#334155" stroke-width="1"/>`,
    `<rect x="61" y="57" width="${spdBarW}" height="7" rx="2" fill="${speedColor}"/>`,

    // Bottom sub-telemetry
    `<text x="12" y="83" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">DIAL 1: +CLIMB / -DIVE</text>`,
    `<text x="190" y="83" text-anchor="end" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">BOOST +${boostMph}</text>`
  );

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
    `<text x="212" y="18" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">DISTANCE</text>`,
    `<text x="390" y="18" text-anchor="end" fill="${altColor}" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">ALTITUDE</text>`,

    // Left Half of Slot 1 (x=212..298): Distance Traveled
    `<text x="212" y="48" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="23">${distKm}</text>`,
    `<text x="275" y="47" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="900" font-size="10">KM</text>`,
    `<rect x="212" y="55" width="84" height="7" rx="3" fill="#0f172a" stroke="#334155" stroke-width="1"/>`,
    `<rect x="212" y="55" width="${distSubBarW}" height="7" rx="3" fill="#38bdf8"/>`,
    `<text x="212" y="83" fill="#ffd166" font-family="Arial, sans-serif" font-weight="800" font-size="10">${formatNumber(distMeters)} M TRAVELED</text>`,

    // Center Divider & Vertical Altitude Bar (x=304..318, y=30..78)
    `<rect x="306" y="30" width="12" height="48" rx="3" fill="#0f172a" stroke="#334155" stroke-width="1"/>`,
    `<rect x="307" y="66" width="10" height="11" fill="#ff2a2a" opacity="0.38"/>`,
    `<rect x="307" y="${altFillY}" width="10" height="${altFillH}" rx="2" fill="${altColor}"/>`,

    // Right Half of Slot 1 (x=324..390): Altitude AGL & Clearance
    `<text x="390" y="48" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="23">${agl} <tspan font-size="10" fill="${altColor}">FT</tspan></text>`,
    `<text x="390" y="63" text-anchor="end" fill="${
      agl < 18 ? "#ff2a2a" : "#94a3b8"
    }" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">${
      agl < 18 ? "PULL UP!" : `RIM ${rimAgl} FT`
    }</text>`,
    `<text x="390" y="83" text-anchor="end" fill="${
      wallClearance < 12 ? "#ff2a2a" : "#00f5d4"
    }" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">WALL ${wallClearance} FT</text>`
  );

  // =========================================================================
  // SLOT 2 (x = 400..600): MULTIPLIER (x1..x5) & LIVE SCORE
  // =========================================================================
  const activeSegments = Math.min(5, Math.max(1, Math.round(mult)));
  const segRects: string[] = [];
  for (let s = 0; s < 5; s++) {
    const sx = 412 + s * 14;
    const isLit = s < activeSegments;
    const segCol = s >= 3 ? "#ff2a2a" : s >= 1 ? "#ffbe0b" : "#00f5d4";
    segRects.push(
      `<rect x="${sx}" y="58" width="11" height="8" rx="2" fill="${isLit ? segCol : "#1e293b"}"/>`
    );
  }

  parts.push(
    // Header across Slot 2
    `<text x="412" y="18" fill="${multColor}" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">MULTIPLIER</text>`,
    `<text x="590" y="18" text-anchor="end" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">LIVE SCORE</text>`,

    // Left Module of Slot 2 (x=412..484): Proximity Multiplier Badge
    `<rect x="410" y="26" width="74" height="28" rx="6" fill="#091326" stroke="${multColor}" stroke-width="1.5"/>`,
    `<text x="447" y="46" text-anchor="middle" fill="${multColor}" font-family="Arial, sans-serif" font-weight="900" font-size="20">x${mult.toFixed(1)}</text>`,
    ...segRects,
    `<text x="412" y="83" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">${
      mult >= 2.0 ? "PROX BOOST!" : "FLY LOW/CLOSE"
    }</text>`,

    // Right Module of Slot 2 (x=492..590): Live Score Counter
    `<text x="590" y="52" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="26">${formatNumber(scoreInt)}</text>`,
    `<text x="590" y="83" text-anchor="end" fill="${
      engine.isNewHighScore ? "#ffbe0b" : "#00f5d4"
    }" font-family="Arial, sans-serif" font-weight="900" font-size="10">${
      engine.phase === "READY"
        ? "READY TO LAUNCH"
        : engine.isNewHighScore
        ? "★ NEW RECORD! ★"
        : "SCORING ACTIVE"
    }</text>`
  );

  // =========================================================================
  // SLOT 3 (x = 600..800): HIGH SCORE & STEERING / BANK ALIGNMENT (DIAL 4)
  // =========================================================================
  const canyonShift = slice.centerX - engine.playerX;
  const normOffset = Math.max(-1, Math.min(1, canyonShift / Math.max(1, slice.floorHalfWidth)));
  const canyonGateX = Math.round(700 + normOffset * 62);
  const rollText =
    Math.abs(engine.roll) < 2
      ? "LEVEL"
      : engine.roll < 0
      ? `${Math.round(Math.abs(engine.roll))}° L`
      : `${Math.round(engine.roll)}° R`;

  parts.push(
    // Header across Slot 3
    `<text x="612" y="18" fill="#ffd166" font-family="Arial, sans-serif" font-weight="900" font-size="10" letter-spacing="1">HIGH SCORE</text>`,
    `<text x="790" y="18" text-anchor="end" fill="#00f5d4" font-family="Arial, sans-serif" font-weight="900" font-size="10">BANK ${rollText}</text>`,

    // High Score Prominent Readout (y=26..54)
    `<text x="612" y="48" fill="#ffd166" font-family="Arial, sans-serif" font-weight="900" font-size="24">${formatNumber(highInt)}</text>`,

    // Mini rotating wingsuit flyer on right side of Slot 3 (cx=754, cy=38)
    `<g transform="translate(754, 38) rotate(${engine.roll.toFixed(1)}) scale(0.32)">`,
    renderBirdmanSprite(engine),
    `</g>`,

    // Canyon Centerline Alignment Gauge (y=58..68, x=612..788)
    `<rect x="612" y="58" width="176" height="9" rx="4" fill="#0f172a" stroke="#334155" stroke-width="1"/>`,
    `<rect x="${canyonGateX - 16}" y="57" width="32" height="11" rx="3" fill="none" stroke="#00f5d4" stroke-width="1.8"/>`,
    `<circle cx="700" cy="62.5" r="4.5" fill="#ffbe0b" stroke="#ffffff" stroke-width="1.2"/>`,

    // Bottom label
    `<text x="612" y="83" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="800" font-size="9.5">DIAL 4: STEER CANYON GATE</text>`
  );

  return parts.join("");
}

/**
 * Slices out a single 200x100 Stream Deck + Touch Strip segment for dial column `col` (0..3)
 * from the unified 800x100 panoramic Touch Strip dashboard.
 */
export function renderTouchStripSlotSvg(
  col: number,
  engine: CanyonGameEngine,
  masterStripBody?: string
): string {
  const clampedCol = Math.max(0, Math.min(3, col));
  const body = masterStripBody ?? buildMasterTouchStripSvgBody(engine);
  const vx = clampedCol * TOUCH_SLOT_W;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TOUCH_SLOT_W}" height="${TOUCH_STRIP_TOTAL_H}" viewBox="${vx} 0 ${TOUCH_SLOT_W} ${TOUCH_STRIP_TOTAL_H}">${body}</svg>`;
}
