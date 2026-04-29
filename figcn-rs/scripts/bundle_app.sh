#!/bin/bash
# scripts/bundle_app.sh
# 将 figcn 打包为带 GUI 的 macOS .app

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ICON_SRC="${PROJECT_DIR}/../icon/icon.icns"

APP_NAME="FigCN"
VERSION=$(grep '^version' "${PROJECT_DIR}/Cargo.toml" | head -1 | sed 's/.*"\(.*\)"/\1/')
BUNDLE_ID="com.figcn.proxy"

# ── 编译 Rust 二进制 ──
BINARY="${PROJECT_DIR}/target/release/figcn"
if [ ! -f "$BINARY" ]; then
    echo "⚙️  正在编译 figcn (Rust)..."
    (cd "$PROJECT_DIR" && cargo build --release)
fi

# ── 编译 Swift GUI ──
GUI_SRC="${PROJECT_DIR}/gui/FigCNApp.swift"
GUI_BIN="${PROJECT_DIR}/gui/FigCNGui"
if [ ! -f "$GUI_BIN" ] || [ "$GUI_SRC" -nt "$GUI_BIN" ]; then
    echo "⚙️  正在编译 GUI (Swift)..."
    # 绕过 SwiftBridging module 冲突
    MODULEMAP="/Library/Developer/CommandLineTools/usr/include/swift/module.modulemap"
    if [ -f "$MODULEMAP" ]; then
        sudo mv "$MODULEMAP" "${MODULEMAP}.bak" 2>/dev/null || true
    fi
    swiftc -O -o "$GUI_BIN" "$GUI_SRC" -framework SwiftUI -framework AppKit
    if [ -f "${MODULEMAP}.bak" ]; then
        sudo mv "${MODULEMAP}.bak" "$MODULEMAP" 2>/dev/null || true
    fi
fi

echo "📦 正在打包 ${APP_NAME}.app v${VERSION}..."

# ── 构建 .app 结构 ──
DIST_DIR="${PROJECT_DIR}/dist"
APP_DIR="${DIST_DIR}/${APP_NAME}.app"
CONTENTS="${APP_DIR}/Contents"
MACOS="${CONTENTS}/MacOS"
RESOURCES="${CONTENTS}/Resources"

rm -rf "$APP_DIR"
mkdir -p "$MACOS" "$RESOURCES"

# 复制文件
cp "$BINARY"  "${MACOS}/figcn-bin"    # Rust 后端
cp "$GUI_BIN" "${MACOS}/${APP_NAME}"  # SwiftUI 前端（入口点）
chmod +x "${MACOS}/figcn-bin" "${MACOS}/${APP_NAME}"

# 图标
[ -f "$ICON_SRC" ] && cp "$ICON_SRC" "${RESOURCES}/icon.icns"

# Info.plist
cat > "${CONTENTS}/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key>
    <string>FigCN — Figma 汉化代理</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundleExecutable</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
PLIST

# 去除隔离属性
xattr -cr "$APP_DIR" 2>/dev/null || true

# ── 输出信息 ──
SIZE=$(du -sh "$APP_DIR" | cut -f1)
BIN_SIZE=$(ls -lh "${MACOS}/figcn-bin" | awk '{print $5}')
GUI_SIZE=$(ls -lh "${MACOS}/${APP_NAME}" | awk '{print $5}')

echo ""
echo "✅ 打包完成！"
echo "   应用：${APP_DIR}"
echo "   总大小：${SIZE}"
echo "   后端(Rust)：${BIN_SIZE}  |  前端(Swift)：${GUI_SIZE}"
echo "   版本：${VERSION}"
echo ""
echo "📋 安装："
echo "   cp -r \"${APP_DIR}\" /Applications/"
echo ""
echo "   或双击运行：open \"${APP_DIR}\""
