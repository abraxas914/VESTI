#!/usr/bin/env bash
# 将猫头鹰字形重着色：深色工具栏用浅色、浅色工具栏用深色（action.theme_icons）。
set -euo pipefail
cd "$(dirname "$0")/.."
src="assets/icon.png"
light="#F4F1EA"
dark="#1C1917"
if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick magick is required" >&2
  exit 1
fi
mkdir -p assets
magick "$src" -colorspace sRGB -fill "$light" -colorize 100 "assets/icon-theme-light.png"
magick "$src" -colorspace sRGB -fill "$dark" -colorize 100 "assets/icon-theme-dark.png"
for size in 16 32 48 128; do
  magick "assets/icon-theme-light.png" -background none -resize "${size}x${size}" \
    -unsharp 0x0.6+0.8+0.02 "assets/icon-theme-light-${size}.png"
  magick "assets/icon-theme-dark.png" -background none -resize "${size}x${size}" \
    -unsharp 0x0.6+0.8+0.02 "assets/icon-theme-dark-${size}.png"
done
echo "Wrote toolbar icons under assets/"
