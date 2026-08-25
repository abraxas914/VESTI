#!/usr/bin/env bash
# 生成工具栏猫头鹰字形：深色猫头鹰 + 浅色描边，浅色/深色工具栏都看得清。
# Chrome 的 action 只认 default_icon。生成时 ImageMagick 7.1.x。
set -euo pipefail
cd "$(dirname "$0")/.."
src="assets/icon.png"
light="#F4F1EA"
dark="#1C1917"
if ! command -v magick >/dev/null 2>&1; then
  echo "需要 ImageMagick magick" >&2
  exit 1
fi

make_contrast() {
  local size="$1"
  local work=$((size * 4))
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  magick "$src" -background none -resize "${work}x${work}" "$tmp/src.png"
  magick "$tmp/src.png" -colorspace sRGB -fill "$dark" -colorize 100 "$tmp/owl.png"
  magick "$tmp/src.png" -alpha extract -morphology Dilate Disk:4 \
    -background "$light" -alpha shape "$tmp/halo.png"
  magick "$tmp/halo.png" "$tmp/owl.png" -compose Over -composite "$tmp/comp.png"
  magick "$tmp/comp.png" -background none -resize "${size}x${size}" \
    -unsharp 0x0.5+0.7+0.02 "assets/icon-theme-contrast-${size}.png"
}

for size in 16 32 48 64 128; do
  make_contrast "$size"
done
echo "Wrote toolbar icons under assets/"
