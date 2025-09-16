#!/usr/bin/env bash
set -e

# 源 SVG 路径（修改为你的 svg 路径）
SRC_SVG="${1:-./icon.svg}"

if [ ! -f "$SRC_SVG" ]; then
  echo "SVG not found: $SRC_SVG"
  exit 2
fi

OUT_DIR="./icon/icon.iconset"
OUT_ICNS="./icon/icon.icns"

rm -rf "$OUT_DIR" "$OUT_ICNS"
mkdir -p "$OUT_DIR"

# 需要的尺寸（包含 @2x）
sizes=(16 32 64 128 256 512 1024)

# helper to render using available tool
render_png() {
  local size=$1
  local out=$2
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$size" -h "$size" "$SRC_SVG" -o "$out"
  elif command -v inkscape >/dev/null 2>&1; then
    inkscape "$SRC_SVG" --export-type=png --export-width="$size" --export-height="$size" --export-filename="$out"
  elif command -v convert >/dev/null 2>&1; then
    # ImageMagick (may rasterize with default DPI)
    convert -background none "$SRC_SVG" -resize "${size}x${size}" "$out"
  else
    echo "No SVG rasterizer found. Please install librsvg (rsvg-convert) or inkscape or imagemagick."
    exit 3
  fi
}

# Generate files for iconset. Filenames required by iconutil:
# icon_16x16.png, icon_16x16@2x.png (32x32), icon_32x32.png, icon_32x32@2x.png ...
for sz in "${sizes[@]}"; do
  # normal
  name="icon_${sz}x${sz}.png"
  render_png "$sz" "$OUT_DIR/$name"
  # @2x (double)
  dbl=$((sz * 2))
  name2="icon_${sz}x${sz}@2x.png"
  render_png "$dbl" "$OUT_DIR/$name2"
done

# Some legacy names required by iconutil (16/32/128/256/512 + @2x)
# iconutil will accept the iconset folder with these files present.

# Create icns
if command -v iconutil >/dev/null 2>&1; then
  iconutil -c icns "$OUT_DIR" -o "$OUT_ICNS"
  echo "Generated: $OUT_ICNS"
else
  echo "iconutil not found (this script must run on macOS). Iconset directory created at: $OUT_DIR"
  echo "Run: iconutil -c icns $OUT_DIR -o $OUT_ICNS"
fi