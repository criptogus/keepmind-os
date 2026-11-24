#!/bin/sh
# Installs the KeepMind OS desktop app on macOS without an Apple Developer ID.
#
#   curl -fsSL https://raw.githubusercontent.com/criptogus/keepmind-os/main/scripts/install-mac.sh | sh
#   ... | sh -s -- 0.6.4      installs a specific version
#
# Why this works: the app is ad-hoc signed, not notarized. Gatekeeper only blocks apps that carry the
# com.apple.quarantine flag, which browsers add to downloads. curl does not add it; this script also
# clears it and re-applies the ad-hoc signature locally, so the app opens on the first click.
set -eu

REPO=criptogus/keepmind-os
APP="KeepMind OS.app"
DEST=/Applications

[ "$(uname -s)" = Darwin ] || { echo "This installer is for macOS." >&2; exit 1; }

VERSION=${1:-}
if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=20" |
    grep -o '"tag_name": *"desktop-v[0-9.]*"' | head -1 | sed 's/.*desktop-v//; s/"//') || true
fi
if [ -z "$VERSION" ]; then
  # The API can be rate limited; the releases page names the same tags.
  VERSION=$(curl -fsSL "https://github.com/$REPO/releases" |
    grep -o 'releases/tag/desktop-v[0-9.]*' | head -1 | sed 's/.*desktop-v//') || true
fi
[ -n "$VERSION" ] || { echo "Could not find the latest version." >&2; exit 1; }

BASE="https://github.com/$REPO/releases/download/desktop-v$VERSION"
DMG="KeepMind_OS_${VERSION}_universal.dmg"
TMP=$(mktemp -d)
trap 'hdiutil detach "$TMP/mnt" -quiet 2>/dev/null || true; rm -rf "$TMP"' EXIT

echo "Downloading KeepMind OS $VERSION..."
curl -fL --progress-bar -o "$TMP/$DMG" "$BASE/$DMG"
if curl -fsSL -o "$TMP/$DMG.sha256" "$BASE/$DMG.sha256" 2>/dev/null; then
  WANT=$(awk '{print $1}' "$TMP/$DMG.sha256")
  GOT=$(shasum -a 256 "$TMP/$DMG" | awk '{print $1}')
  [ "$WANT" = "$GOT" ] || { echo "Checksum mismatch, aborting." >&2; exit 1; }
  echo "Checksum OK."
fi

hdiutil attach "$TMP/$DMG" -nobrowse -quiet -mountpoint "$TMP/mnt"
SRC=$(find "$TMP/mnt" -maxdepth 1 -name '*.app' | head -1)
[ -n "$SRC" ] || { echo "No app found in the DMG." >&2; exit 1; }

osascript -e 'tell application "KeepMind OS" to quit' >/dev/null 2>&1 || true
SUDO=''
[ -w "$DEST" ] || SUDO=sudo
$SUDO rm -rf "$DEST/$APP"
$SUDO ditto "$SRC" "$DEST/$APP"
$SUDO xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true
$SUDO codesign --force --deep --sign - "$DEST/$APP" >/dev/null 2>&1 || true

echo "Installed KeepMind OS $VERSION in $DEST."
open "$DEST/$APP"
