# Canyon Wingsuit 3D — Elgato Stream Deck + Plugin

3rd-person procedural 3D wingsuit game for **Elgato Stream Deck +** (8 LCD keys in a 4×2 grid + Touch Strip + 4 rotary encoders).

## Quick Install (macOS or Windows)

### Option A: Double-Click the Packaged Installer
Double-click [`com.slyon.canyon-wingsuit.streamDeckPlugin`](./com.slyon.canyon-wingsuit.streamDeckPlugin) in the root of this repository (or download it from [https://canyon.theslyon.com/com.slyon.canyon-wingsuit.streamDeckPlugin?v=1.0.3](https://canyon.theslyon.com/com.slyon.canyon-wingsuit.streamDeckPlugin?v=1.0.3)).

### Option B: Direct Copy Script (Cleanest when updating an existing install)
- **macOS**:
  ```bash
  chmod +x ./scripts/install-mac.sh
  ./scripts/install-mac.sh
  ```
  *(Copies `com.slyon.canyon-wingsuit.sdPlugin` directly to `~/Library/Application Support/com.elgato.StreamDeck/Plugins/` — restart the Elgato Stream Deck app afterward).*
- **Windows (PowerShell)**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\install-plugin.ps1
  ```

## Gameplay & Controls
- **8 LCD Keys (4×2 Grid)**: Place **Canyon 3D Viewport Tile (Key)** on all 8 keys to form the panoramic 3D canyon display. Press any key to reset.
- **4 Rotary Dials & Touch Strip**: Place **Canyon Flight Dial & HUD** on all 4 dials:
  - **Start Scoring**: Turn any dial to drop in and start scoring.
  - **Leftmost Dial (Dial 1)**: Pitch Up / Down. Turning **up** climbs out of the canyon and slows you down—if your airspeed drops to `65 MPH`, your **parachute pops out**, you float to the canyon floor, and scoring ends. Turning **down** dives faster into the canyon—if you hit the canyon floor or walls, **CARNAGE** erupts and scoring ends.
  - **Rightmost Dial (Dial 4)**: Steer Left / Right. The birdman stays centered in the middle of the display while the winding 3D canyon path adjusts and tilts around him. The further you fly, the faster you go!

## Customizing the Birdman Sprite
The 3rd-person birdman SVG is isolated in [`src/game/birdman-sprite.ts`](./src/game/birdman-sprite.ts). After editing it, run:
```bash
npm install
npm run build
```
