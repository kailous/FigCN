# FigCN 使用帮助

本文档介绍 FigCN（Figma 汉化代理助手）的功能、使用方法以及常见问题排查指南，帮助你在 macOS 与 Windows 平台上高效部署和维护本工具。

## 1. 项目简介

- FigCN 基于 Electron 与 mitmproxy，通过本地代理劫持 Figma 桌面端/网页端的静态资源，替换为社区维护的中文文案。
- 应用提供托盘常驻的可视化控制面板，可一键启动/停止代理、自动配置系统代理、安装根证书并查看运行日志。
- 同时支持 macOS（Apple Silicon 与 Intel）与 Windows（x64/arm64）平台；Windows 构建需额外引入官方 mitmproxy 可执行文件。

## 2. 环境要求与准备

| 项目 | 最低要求 |
| --- | --- |
| 操作系统 | macOS 12+，或 Windows 10 及以上（x64/arm64） |
| Node.js | 推荐 18 LTS 或更新版本（用于开发/构建） |
| npm | 随 Node.js 提供 |
| mitmproxy | macOS 版本已内置；Windows 需手动下载 `mitmproxy-*-windows.zip` 并解压到 `vendor/mitmproxy-win64/` |
| Electron 运行权限 | macOS 首次运行可能需要允许运行未签名应用，或使用 `xattr -dr com.apple.quarantine <App>.app` 清除隔离标记 |

## 3. 快速入门（终端安装包）

1. 从发布页或自行构建获取 FigCN 安装包。
2. 安装并启动应用，系统托盘会出现 FigCN 图标，主窗口默认隐藏，可通过托盘菜单 → “打开窗口”呼出。
3. 在控制面板中确认监听地址（默认 `127.0.0.1:8080`），点击“启动代理”。
4. 若尚未信任 mitmproxy 证书，点击“生成并安装证书”。macOS 需按提示输入一次系统密码，Windows 可能出现 UAC 弹窗。
5. FigCN 会自动备份并设置系统代理。打开 Figma 客户端或网页端，界面应切换为中文。若未生效，请尝试清除 Figma 缓存或执行界面底部的测试命令。

## 4. 控制面板功能说明

### 4.1 代理控制

- `启动代理`：根据表单配置拉起内置 `mitmdump`，加载 `figcn_injector.py` 脚本完成汉化注入。
- `停止代理`：停止 mitmproxy 进程，并尝试恢复之前备份的系统代理设置。
- 日志窗口实时显示 mitmproxy 输出、系统代理操作、上游侦测结果等。

### 4.2 上游代理

- 勾选“启用上游代理”可将 FigCN 作为二级代理，将流量转发至本地或远程代理服务器。
- 支持协议：`http://`、`https://`、`socks5://`、`socks4://`。
- “自动侦测”会优先尝试解析系统 PAC 或代理设置，其次探测常见端口（7890/8889 等），适配常见科学上网工具。
- 为避免循环代理，FigCN 会阻止在系统代理已经指向自身时启用上游，需先停止并恢复系统代理再操作。

### 4.3 系统代理管理

- 启动时自动调用 `networksetup`（macOS）或注册表/`netsh`（Windows）备份当前代理配置并切换到 FigCN 监听地址。
- 停止时回滚到备份配置；如果备份失败或曾手工改动，可通过“恢复系统代理”按钮再次尝试。
- `isSystemProxyPointingTo` 能力保障上游配置不会自我引用，避免死循环。

### 4.4 证书管理

- FigCN 会检测 `~/.mitmproxy/mitmproxy-ca-cert.cer` 是否存在，不存在时提示先启动代理并访问 `https://mitm.it` 生成证书。
- macOS：优先安装到 `login` 钥匙串，失败后自动请求管理员权限安装到 `System`。若仍失败，会弹出详细的手动操作步骤。
- Windows：优先使用 `certutil -addstore root`，如需管理员权限会自动通过 PowerShell `Start-Process -Verb RunAs` 提示。
- 帮助面板提供“打开钥匙串访问”辅助用户手动信任。

### 4.5 托盘与快捷操作

- 托盘菜单包含“打开窗口”“启动代理”“停止代理”“退出”等快捷项。
- 单击图标切换显示/隐藏主窗口，双击强制显示并聚焦。
- macOS 上应用会隐藏 Dock 图标，仅通过托盘驻留。

## 5. 工作原理概览

- `vendor/mitmproxy.app` / `vendor/mitmproxy-win64` 提供跨平台 mitmproxy 可执行文件，Electron 主进程通过 `modules/mitm.js` 启动 `mitmdump`。
- `figcn_injector.py` 注入脚本在 HTTP 代理层替换 Figma 官方资源为本地翻译 JSON，保持客户端原生体验。
- 配置文件 `mitm-config.json` 会保存在用户数据目录（macOS：`~/Library/Application Support/FigCN/`；Windows：`%APPDATA%\FigCN\`），记录监听地址、端口与上游设置。
- 环境变量 `MITMDUMP_PATH` 可覆盖内置可执行文件，用于自定义 mitmproxy 版本或调试。

## 6. 构建与打包

1. **安装依赖**
   ```bash
   git clone https://github.com/kailous/FigCN.git
   cd FigCN
   npm install
   ```
2. **准备依赖资源**
   - macOS：仓库内已经包含 `vendor/mitmproxy.app`。
   - Windows：下载官方 zip，解压后保持 `mitmdump.exe`、`mitmproxy.exe`、`mitmweb.exe` 位于 `vendor/mitmproxy-win64/` 根目录。
3. **构建命令**
   - `npm run dist`：根据宿主系统自动构建。macOS 上默认先产出双架构 DMG/ZIP，再构建 Windows x64/arm64 NSIS/ZIP（需要 wine+mono 支撑 NSIS）；若暂时不需要 Windows 包，可设置 `SKIP_WINDOWS_BUILD=1`。
   - `npm run dist:mac:arm64` / `npm run dist:mac:intel`：分别构建单一架构的 macOS 包。
   - `npm run dist:mac:all`：按顺序运行上述两个命令。
   - `npm run dist:win`：在 Windows 平台直接生成 x64/arm64 的安装器和 zip。
4. **输出**
   - macOS：`dist/FigCN(Beta)-<version>-mac-<arch>.(dmg|zip)`。
   - Windows：`dist/FigCN(Beta)-<version>-win-<arch>.(exe|zip)`。

> 提示：在 macOS 上构建 Windows 安装器需要安装 wine、mono 与 `makensis`，否则 electron-builder 会报错；如无环境可通过 `SKIP_WINDOWS_BUILD=1 npm run dist` 跳过。

## 7. 常见问题 FAQ

**Q1：启动后 Figma 仍是英文？**  
确认系统代理已指向 FigCN 监听端口，证书已安装并信任，浏览器或客户端缓存已清除。可在日志中查看是否有 `汉化成功` 的测试输出。

**Q2：macOS 提示“无法验证开发者”或 Gatekeeper 拦截？**  
删减 `mitmproxy.app` 内容会破坏签名，可在完成瘦身后使用 `codesign --deep --force --sign - <App>.app` 自签，或用开发者证书重新签名。

**Q3：证书安装失败怎么办？**  
查看日志中的错误提示，根据提示手动打开钥匙串访问/证书管理器导入 `~/.mitmproxy/mitmproxy-ca-cert.cer`，并设为受信任根。

**Q4：端口被占用或无法启动 mitmproxy？**  
检查是否有其他服务占用配置端口，可修改端口并重新启动。若日志报 `bind: Address already in use`，说明端口冲突。

**Q5：启用上游后网络断开？**  
确保填写的上游地址协议正确且目标代理可用，可在终端执行 `curl -x <上游> https://www.google.com --head` 验证。

**Q6：如何自定义翻译内容？**  
在 `figcn_injector.py` 中修改拦截逻辑或替换缓存资源，修改后重启代理即可生效。建议保留原始文件备份。

## 8. 故障排查流程

1. **查看日志**：面板日志会记录 mitmproxy 输出、证书与系统代理操作，是定位问题的首选渠道。
2. **验证系统代理**：点击“停止代理并恢复系统代理”后重新启动，或在终端运行 `scutil --proxy`（macOS）/`reg query`（Windows）确认是否匹配 `127.0.0.1:8080`。
3. **检测证书**：访问 `https://mitm.it`，如果页面可正常访问且提示已安装证书，说明证书链无误。
4. **确认上游可用性**：若开启了上游代理，可利用 `curl` 或浏览器测试上游服务是否畅通。
5. **查看网络安全软件**：部分杀毒/防火墙会阻止本地 mitm 行为，可尝试添加白名单或临时关闭测试。

## 9. 安全与隐私说明

- FigCN 在本地运行，不向外部服务器发送任何敏感配置；所有用户配置默认保存在 `app.getPath("userData")` 目录。
- mitmproxy 仅对 Figma 域名进行劫持（代码中通过 `allow_hosts` 限制），不会拦截其他网站。
- 使用 FigCN 会对 TLS 流量进行中间人解密，请勿在公共或不信任环境中共享证书或以管理员权限运行来路不明的脚本。

## 10. 反馈与贡献

- Bug 反馈与功能需求可通过 GitHub Issues 提交，附带日志截图有助于快速定位问题。
- 欢迎贡献翻译、改进注入脚本或优化构建流程。提交 PR 前请执行 `npm run lint`（如仓库提供）以及基础功能自测。
- 如需定制功能或企业内部部署，可在 Issue 中说明需求，或提供补丁以供参考。

祝你使用愉快！
