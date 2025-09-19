# FigCN

Figma 汉化代理助手（Electron + mitmproxy）

## 构建指南

### 1. 克隆项目

```bash
git clone https://github.com/kailous/FigCN.git
cd FigCN
```

### 2. 安装依赖

```bash
npm install
```

### 3. 准备 mitmproxy 二进制

macOS 版本已经包含 `vendor/mitmproxy.app`。如需构建 Windows 安装包，请：

1. 从 [mitmproxy 官方网站](https://mitmproxy.org/downloads/) 下载对应版本的 `mitmproxy-*-windows.zip`；
2. 解压后将内容放入 `vendor/mitmproxy-win64/`（保持 `mitmdump.exe` 位于该目录或其子目录中）。

> 如果目录为空，构建出的 Windows 应用会回退到系统环境变量中的 `mitmdump.exe`。

### 4. 构建命令

| 目标平台 | 构建命令 | 输出说明 |
| --- | --- | --- |
| macOS (Apple Silicon) | `npm run dist:mac:arm64` | 生成 `arm64` 的 DMG/ZIP |
| macOS (Intel) | `npm run dist:mac:intel` | 生成 `x64` 的 DMG/ZIP |
| macOS (双架构) | `npm run dist:mac:all` | 顺序构建 `arm64` 与 `x64` |
| Windows (x64) | `npm run dist:win` | 生成 NSIS 安装器与 ZIP |

> **提示**：macOS 安装包需在 macOS 主机上构建；Windows 安装器建议在 Windows 环境执行，以便正确签名并包含系统特定依赖。

### 5. 测试汉化

```bash
curl -s -x http://localhost:8080 -I "https://www.figma.com/webpack-artifacts/assets/figma_app-d2f511861c52ac4d.min.en.json.br" \
  | grep -qi '^server: GitHub.com' \
  && echo "汉化成功\n如果界面没有生效，请尝试清理缓存。" \
  || echo "汉化失败\n请检查是否启动代理，并正确地应用了系统代理设置。"
```
