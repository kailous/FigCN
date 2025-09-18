// main.js
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

// 模块（保持你现有模块接口）
const config = require("./modules/config");
const mitm = require("./modules/mitm");
const sysProxy = require("./modules/sysProxy");
const upstream = require("./modules/upstreamDetect");
const certManager = require("./modules/certManager");

// 先把 app 注入给需要用 userData 的模块
sysProxy.init(app);
certManager.register(ipcMain, app);

let mainWindow = null;
let tray = null;
let isQuiting = false;

function resPath(...p) {
  return path.join(process.resourcesPath || "", ...p);
}
function getAsset(...p) {
  // 优先：app.asar 内文件（打进 build.files 的）
  const inAsar = path.join(__dirname, ...p);
  if (fs.existsSync(inAsar)) return inAsar;
  // 其次：Resources 目录（extraResources/或打包后的资源）
  const inRes = resPath(...p);
  if (fs.existsSync(inRes)) return inRes;
  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // 打包后窗口图标可省略；macOS 用 bundle icon
    icon: getAsset("icon", "icon.icns") || undefined,
    width: 960,
    height: 700,
    show: false, // 菜单栏常驻：由托盘控制显示
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile("static/index.html");

  // 点击关闭：仅隐藏窗口，不退出
  mainWindow.on("close", (e) => {
    if (isQuiting) return;
    e.preventDefault();
    mainWindow.hide();
  });

  // 点击显示时聚焦
  mainWindow.on("show", () => mainWindow?.focus());
}

// 创建托盘图标
function createTray() {
  try {
    // 1) 先找模板图（建议：18x18 & 36x36 黑色 + 透明背景）
    let imgPath = getAsset("icon", "trayTemplate.png");
    let img;
    if (imgPath) {
      img = nativeImage.createFromPath(imgPath);
      if (!img.isEmpty()) {
        img.setTemplateImage(true); // 自动适配明/暗
      }
    }

    // 2) 回退到应用 icns（不要 setTemplateImage）
    if (!img || img.isEmpty()) {
      imgPath = getAsset("icon", "icon.icns");
      if (imgPath) img = nativeImage.createFromPath(imgPath);
    }

    // 3) 兜底：生成一个小点，保证不空白
    if (!img || img.isEmpty()) {
      const dot = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAQAAAD8x0bcAAAAD0lEQVR4AWP4z8DAwMAAAHYABo2oYHkAAAAASUVORK5CYII=", "base64");
      img = nativeImage.createFromBuffer(dot);
      img.setTemplateImage(true);
    }

    tray = new Tray(img);
    // 防止被 GC
    global.__trayRef = tray;

    const ctx = Menu.buildFromTemplate([
      { label: "打开窗口", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { type: "separator" },
      { label: "启动代理", click: () => mainWindow?.webContents.send("ui:menu:start") },
      { label: "停止代理", click: () => mainWindow?.webContents.send("ui:menu:stop") },
      { type: "separator" },
      { label: "退出", click: () => { isQuiting = true; app.quit(); } },
    ]);
    tray.setToolTip("FigCN(Beta)");
    tray.setContextMenu(ctx);

    // 点击托盘切换显示/隐藏
    tray.on("click", () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) mainWindow.hide();
      else { mainWindow.show(); mainWindow.focus(); }
    });
    tray.on("double-click", () => {
      if (!mainWindow) return;
      mainWindow.show();
      mainWindow.focus();
    });
  } catch (e) {
    console.warn("createTray failed:", e);
  }
}

// 单实例锁（防重复打开）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 启动
app.whenReady().then(() => {
  // 运行时隐藏 Dock（需要菜单栏常驻体验）
  if (process.platform === "darwin" && app.dock) {
    try { app.dock.hide(); } catch {}
  }

  createWindow();
  createTray();
});

// macOS：Dock/菜单栏激活时带回窗口
app.on("activate", () => {
  if (!mainWindow) createWindow();
  else { mainWindow.show(); mainWindow.focus(); }
});

// 在退出时先尝试停止 mitm
app.on("before-quit", async () => {
  isQuiting = true;
  try { await mitm.stop(); } catch {}
});

// 不在最后窗口关闭时退出（保持菜单栏常驻）
app.on("window-all-closed", () => {
  // macOS 常驻托盘，不退出；其他平台可退出
  if (process.platform !== "darwin") app.quit();
});

// ========== IPC 绑定 ==========
// 配置读写
ipcMain.handle("load-config", async () => config.loadConfig());
ipcMain.handle("save-config", async (_e, cfg) => config.saveConfig(cfg));

// mitm 启停（使用 vendor/mitmproxy.app 内置二进制）
ipcMain.handle("start-mitm", async (_e, cfg) => {
  return mitm.start(cfg, (line) => mainWindow?.webContents.send("mitm-log", line));
});
ipcMain.handle("stop-mitm", async () => mitm.stop());

// 上游侦测（返回 { upstream, error }）
ipcMain.handle("auto-detect-upstream", async (_e, testUrl) =>
  upstream.autoDetectUpstream(testUrl)
);

// 系统代理（设置 / 恢复 / 查询）
ipcMain.handle("set-system-proxy", async (_e, { host, port }) =>
  sysProxy.setSystemProxy(host, port)
);
ipcMain.handle("restore-system-proxy", async () =>
  sysProxy.restoreSystemProxy()
);
ipcMain.handle("get-system-proxy", async () => sysProxy.getSystemProxy());

// 供托盘菜单触发（如需）
ipcMain.on("ui:tray:show", () => { mainWindow?.show(); mainWindow?.focus(); });
// 版本号 IPC
ipcMain.handle("get-version", async () => {
  return app.getVersion(); // 来自 Info.plist 的 CFBundleShortVersionString
});
// 导出（如需在其他模块 require main）
module.exports = { resPath };