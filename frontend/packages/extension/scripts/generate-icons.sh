#!/usr/bin/env bash
#
# Regenerate the extension's PNG icons from the master logo.
#
# The master is icons/logo.svg — the single source of truth for the
# Inkwell brand mark. Chrome extension icons must be raster (PNG), so this
# script rasterises the SVG to the sizes the manifest references. The PNGs
# are committed; run this only after editing logo.svg.
#
# Requires librsvg (`rsvg-convert`):
#   macOS:  brew install librsvg
#   Debian: apt-get install librsvg2-bin
#
# Usage:  frontend/packages/extension/scripts/generate-icons.sh
set -euo pipefail

cd "$(dirname "$0")/.."
src="icons/logo.svg"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "error: rsvg-convert not found — install librsvg (see this script's header)." >&2
  exit 1
fi

for size in 16 32 48 128; do
  rsvg-convert -w "$size" -h "$size" "$src" -o "icons/icon-$size.png"
  echo "wrote icons/icon-$size.png"
done

echo "done — ${src} → 4 PNG sizes."
