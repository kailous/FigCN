// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// 模块
const config = require("./modules/config");
const mitm = require("./modules/mitm");
const sysProxy = require("./modules/sysProxy");
const upstream = require("./modules/upstreamDetect");

let mainWindow = null;

function resPath(...p) {
  return path.join(process.resourcesPath || "", ...p);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: resPath("icon.icns"),
    width: 960,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile("static/index.html");
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", async () => { try { await mitm.stop(); } catch {} });

// ========== IPC 绑定（保持你原有的频道名不变） ==========
// 配置
ipcMain.handle("load-config", async () => config.loadConfig());
ipcMain.handle("save-config", async (_e, cfg) => config.saveConfig(cfg));

// mitm 启停
ipcMain.handle("start-mitm", async (_e, cfg) => {
  return mitm.start(cfg, (line) => mainWindow?.webContents.send("mitm-log", line));
});
ipcMain.handle("stop-mitm", async () => mitm.stop());

// 上游侦测
ipcMain.handle("auto-detect-upstream", async (_e, testUrl) =>
  upstream.autoDetectUpstream(testUrl)
);

// 系统代理
ipcMain.handle("set-system-proxy", async (_e, { host, port }) =>
  sysProxy.setSystemProxy(host, port)
);
ipcMain.handle("restore-system-proxy", async () =>
  sysProxy.restoreSystemProxy()
);