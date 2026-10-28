import streamDeck from "@elgato/streamdeck";
import {
  CanyonDialAction,
  CanyonViewportAction,
  gameCoordinator
} from "./game/controller.js";

streamDeck.logger.setLevel("info");

// Enable compatibility with Stream Deck 6.5+ (prevents v3 SDK from throwing ERR_NOT_SUPPORTED when MinimumVersion < 7.1)
streamDeck.settings.useLegacySettingsBehavior = true;

// Register the 4x2 Key Grid Viewport action and the 4-Dial Touch Strip action
streamDeck.actions.registerAction(new CanyonViewportAction());
streamDeck.actions.registerAction(new CanyonDialAction());

// Connect to Elgato Stream Deck and load persisted high score
streamDeck.connect().then(() => {
  return gameCoordinator.init();
});
