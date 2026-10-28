import streamDeck, {
  action,
  DialAction,
  DialDownEvent,
  DialRotateEvent,
  KeyAction,
  KeyDownEvent,
  SingletonAction,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent
} from "@elgato/streamdeck";
import { CanyonGameEngine } from "./engine.js";
import {
  buildMasterSceneSvgBody,
  renderKeyTileSvg,
  renderTouchStripSlotSvg,
  svgToDataUri
} from "./renderer.js";

type EmptySettings = Record<string, any>;

type GlobalGameSettings = {
  highScore?: number;
};

class CanyonGameCoordinator {
  public readonly engine: CanyonGameEngine;
  private visibleKeys = new Map<string, KeyAction<EmptySettings>>();
  private visibleDials = new Map<string, DialAction<EmptySettings>>();
  private loopTimer: NodeJS.Timeout | null = null;
  private lastTickTime = Date.now();
  private isRendering = false;

  constructor() {
    this.engine = new CanyonGameEngine((newHighScore) => {
      void this.saveHighScore(newHighScore);
    });
  }

  public async init(): Promise<void> {
    try {
      const settings = await streamDeck.settings.getGlobalSettings<GlobalGameSettings>();
      if (typeof settings?.highScore === "number") {
        this.engine.setHighScore(settings.highScore);
      }
    } catch (err) {
      streamDeck.logger.error("Failed to load global high score:", err);
    }
  }

  private async saveHighScore(highScore: number): Promise<void> {
    try {
      await streamDeck.settings.setGlobalSettings<GlobalGameSettings>({ highScore });
    } catch (err) {
      streamDeck.logger.error("Failed to save global high score:", err);
    }
  }

  public registerKey(keyAction: KeyAction<EmptySettings>): void {
    this.visibleKeys.set(keyAction.id, keyAction);
    const coords = keyAction.coordinates ?? { column: 0, row: 0 };
    const masterBody = buildMasterSceneSvgBody(this.engine);
    const tileSvg = renderKeyTileSvg(masterBody, coords.column, coords.row);
    void keyAction.setImage(svgToDataUri(tileSvg));
    this.ensureLoopState();
  }

  public unregisterKey(actionId: string): void {
    this.visibleKeys.delete(actionId);
    this.ensureLoopState();
  }

  public registerDial(dialAction: DialAction<EmptySettings>): void {
    this.visibleDials.set(dialAction.id, dialAction);
    const col = dialAction.coordinates?.column ?? 0;
    const hudSvg = renderTouchStripSlotSvg(col, this.engine);
    void dialAction.setFeedback({
      canvas: svgToDataUri(hudSvg)
    });
    this.ensureLoopState();
  }

  public unregisterDial(actionId: string): void {
    this.visibleDials.delete(actionId);
    this.ensureLoopState();
  }

  private ensureLoopState(): void {
    const hasActiveControls = this.visibleKeys.size > 0 || this.visibleDials.size > 0;
    if (hasActiveControls && !this.loopTimer) {
      this.lastTickTime = Date.now();
      this.loopTimer = setInterval(() => {
        void this.tick();
      }, 60);
    } else if (!hasActiveControls && this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.isRendering) return;
    this.isRendering = true;

    try {
      const now = Date.now();
      const dt = Math.min(0.1, Math.max(0.016, (now - this.lastTickTime) / 1000));
      this.lastTickTime = now;

      this.engine.step(dt);

      const promises: Promise<unknown>[] = [];

      const masterBody = buildMasterSceneSvgBody(this.engine);

      // 1. Render 4x2 LCD Key Grid tiles (Mountains extending up from Touch Strip + Top Row HUD)
      if (this.visibleKeys.size > 0) {
        for (const keyAction of this.visibleKeys.values()) {
          const coords = keyAction.coordinates ?? { column: 0, row: 0 };
          const tileSvg = renderKeyTileSvg(masterBody, coords.column, coords.row);
          promises.push(keyAction.setImage(svgToDataUri(tileSvg)));
        }
      }

      // 2. Render Stream Deck + Touch Strip segments (4 x 200x100 with Wingman in center!)
      if (this.visibleDials.size > 0) {
        for (const dialAction of this.visibleDials.values()) {
          const col = dialAction.coordinates?.column ?? 0;
          const hudSvg = renderTouchStripSlotSvg(col, this.engine, masterBody);
          promises.push(
            dialAction.setFeedback({
              canvas: svgToDataUri(hudSvg)
            })
          );
        }
      }

      await Promise.allSettled(promises);
    } catch (err) {
      streamDeck.logger.error("Tick render error:", err);
    } finally {
      this.isRendering = false;
    }
  }
}

export const gameCoordinator = new CanyonGameCoordinator();

@action({ UUID: "com.slyon.canyon-wingsuit.viewport" })
export class CanyonViewportAction extends SingletonAction<EmptySettings> {
  public override onWillAppear(ev: WillAppearEvent<EmptySettings>): void {
    if (ev.action.isKey()) {
      gameCoordinator.registerKey(ev.action);
    } else if (ev.action.isDial()) {
      gameCoordinator.registerDial(ev.action);
    }
  }

  public override onWillDisappear(ev: WillDisappearEvent<EmptySettings>): void {
    gameCoordinator.unregisterKey(ev.action.id);
    gameCoordinator.unregisterDial(ev.action.id);
  }

  public override onKeyDown(_ev: KeyDownEvent<EmptySettings>): void {
    gameCoordinator.engine.resetToReady();
  }

  public override onDialRotate(ev: DialRotateEvent<EmptySettings>): void {
    const col = ev.payload.coordinates?.column ?? 0;
    const ticks = ev.payload.ticks;
    if (col <= 1) {
      gameCoordinator.engine.onPitchDialRotate(ticks);
    } else {
      gameCoordinator.engine.onSteerDialRotate(ticks);
    }
  }

  public override onDialDown(_ev: DialDownEvent<EmptySettings>): void {
    gameCoordinator.engine.resetToReady();
  }

  public override onTouchTap(_ev: TouchTapEvent<EmptySettings>): void {
    gameCoordinator.engine.resetToReady();
  }
}

@action({ UUID: "com.slyon.canyon-wingsuit.dial" })
export class CanyonDialAction extends SingletonAction<EmptySettings> {
  public override onWillAppear(ev: WillAppearEvent<EmptySettings>): void {
    if (ev.action.isKey()) {
      gameCoordinator.registerKey(ev.action);
    } else if (ev.action.isDial()) {
      gameCoordinator.registerDial(ev.action);
    }
  }

  public override onWillDisappear(ev: WillDisappearEvent<EmptySettings>): void {
    gameCoordinator.unregisterKey(ev.action.id);
    gameCoordinator.unregisterDial(ev.action.id);
  }

  public override onKeyDown(_ev: KeyDownEvent<EmptySettings>): void {
    gameCoordinator.engine.resetToReady();
  }

  public override onDialRotate(ev: DialRotateEvent<EmptySettings>): void {
    const col = ev.payload.coordinates?.column ?? 0;
    const ticks = ev.payload.ticks;
    if (col <= 1) {
      gameCoordinator.engine.onPitchDialRotate(ticks);
    } else {
      gameCoordinator.engine.onSteerDialRotate(ticks);
    }
  }

  public override onDialDown(_ev: DialDownEvent<EmptySettings>): void {
    gameCoordinator.engine.resetToReady();
  }

  public override onTouchTap(_ev: TouchTapEvent<EmptySettings>): void {
    gameCoordinator.engine.resetToReady();
  }
}
