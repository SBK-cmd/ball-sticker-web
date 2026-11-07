#!/bin/bash
# Sign Tools installer for Adobe Illustrator (macOS)
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/SignTools"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/SignTools"
if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "[ERROR] SignTools folder not found next to this file. Unzip first, then run again."
  read -p "Press Enter to close"; exit 1
fi
pgrep -x "Adobe Illustrator" >/dev/null && { echo "[!] Close Illustrator completely (Cmd+Q), then run this again."; read -p "Press Enter"; exit 1; }
for v in 9 10 11 12 13; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
rm -rf "$DEST"; rm -rf "$HOME/Library/Application Support/Adobe/CEP/extensions/ThaiFontPreview"; mkdir -p "$(dirname "$DEST")"
cp -R "$SRC" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
if [ -f "$DEST/CSXS/manifest.xml" ]; then
  echo ""; echo " OK - Sign Tools 1.13.43 installed to: $DEST"
  echo " Restart Illustrator, then open: Window > Extensions > Sign Tools"
else
  echo "[ERROR] Copy failed."
fi
echo ""; read -p "Press Enter to close"
