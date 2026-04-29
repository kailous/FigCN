# FigCN (Rust)

Figma 汉化代理 — 纯 Rust 单文件实现。

> 将 Figma 英文界面自动替换为社区维护的中文翻译，仅需一个 5MB 的二进制文件。

## 对比

| 维度 | 原版 (Electron + mitmproxy) | Rust 版 |
|---|---|---|
| 体积 | ~80MB+ | **5.4MB** |
| 外部依赖 | Node.js + Python + mitmproxy | **零** |
| 启动速度 | ~3s | **~50ms** |
| 内存占用 | ~150MB | **~10MB** |

## 快速开始

```bash
# 编译
cargo build --release

# 1. 首次使用：生成并安装 CA 证书
./target/release/figcn cert generate
./target/release/figcn cert install

# 2. 启动代理（自动检测上游代理 + 设置系统代理，Ctrl+C 停止并自动恢复）
./target/release/figcn start

# 3. 清理 Figma 缓存并重启 Figma
./target/release/figcn cache clear
```

## 智能代理检测

FigCN 启动时会**自动检测**本地是否运行了 Clash / V2Ray / Surge 等代理工具：

- ✅ 检测到 → 自动通过上游代理转发（无需手动 `--upstream`）
- ❌ 未检测到 → 直连模式

也可以手动指定：

```bash
figcn start --upstream http://127.0.0.1:7897
```

## 安全退出保障

FigCN 在以下所有场景都会**自动恢复系统代理**：

| 场景 | 保障机制 |
|---|---|
| Ctrl+C | SIGINT 信号捕获 → 恢复代理 |
| `figcn stop` | SIGTERM → 优雅停止 → 恢复代理 |
| 关闭 Terminal 窗口 | SIGHUP 信号捕获 → 恢复代理 |
| 进程崩溃 / 强杀 | 下次启动自动检测残留 PID → 恢复代理 |
| 手动恢复 | `figcn proxy restore` |

## 全部命令

```
figcn start                                    # 启动代理（自动检测上游）
figcn start --port 9090                        # 自定义端口
figcn start --upstream http://127.0.0.1:7890   # 手动指定上游代理
figcn start --no-sys-proxy                     # 不自动设置系统代理
figcn stop                                     # 停止正在运行的代理
figcn status                                   # 查看运行状态

figcn cert generate    # 生成 CA 证书
figcn cert install     # 安装到系统钥匙串
figcn cert path        # 查看证书路径

figcn proxy set        # 手动设置系统代理
figcn proxy restore    # 恢复系统代理
figcn proxy status     # 查看代理状态

figcn cache clear      # 清理 Figma 缓存
```

## .app 打包

```bash
bash scripts/bundle_app.sh
# 输出到 dist/FigCN.app，双击即可运行
```

## 工作原理

FigCN 启动一个本地 HTTPS MITM 代理，拦截 Figma 对语言包的请求并替换为中文版本：

| 原始请求 | 替换为 |
|---|---|
| `figma_app-*.min.en.json` | GitHub Pages 上的 `zh.json` |
| `auth_iframe-*.min.en.json` | `auth_iframe-zh.json` |
| `community-*.min.en.json` | `community-zh.json` |

其他所有流量透传，不做任何修改。

## 证书安全

- CA 证书存储在 `~/.figcn/` 目录
- 仅用于拦截 Figma 相关流量
- 所有处理在本地完成，不向外部发送任何数据
