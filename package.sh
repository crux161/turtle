#!/bin/sh
set -e

cd "$(dirname "$0")"

APP_PATH="release/mac-arm64/Turtle.app"
DMG_PATH="release/mac-arm64/Turtle-v1.dmg"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: $APP_PATH not found. Run the build first." >&2
  exit 1
fi

# Remove previous DMG if it exists (create-dmg won't overwrite)
rm -f "$DMG_PATH"

create-dmg \
  --volname "Turtle" \
  --volicon "resources/icons/turtle.icns" \
  --background "resources/bg.png" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 100 \
  --icon "Turtle.app" 150 190 \
  --hide-extension "Turtle.app" \
  --app-drop-link 450 190 \
  "$DMG_PATH" \
  "$APP_PATH"
