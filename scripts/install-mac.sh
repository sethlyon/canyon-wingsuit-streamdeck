#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="com.slyon.canyon-wingsuit.sdPlugin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/../$PLUGIN_NAME" && pwd)"
TARGET_DIR="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/$PLUGIN_NAME"

echo "Installing $PLUGIN_NAME to:"
echo "  $TARGET_DIR"

mkdir -p "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins"
rm -rf "$TARGET_DIR"
cp -R "$SOURCE_DIR" "$TARGET_DIR"

echo "Done! Restart the Elgato Stream Deck app on your Mac to load Canyon Wingsuit 3D (v1.0.3)."
