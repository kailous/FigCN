// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// 模块
const config = require("./modules/config");
const mitm = require("./modules/mitm");
const sysProxy = require("./modules/sysProxy");
const upstream = require("./modules/upstreamDetect");
const certManager = require("./modules/certManager");

// 先把 app 注入给需要用 userData 的模块
sysProxy.init(app);
certManager.register(ipcMain, app);

let mainWindow = null;

function resPath(...p) {
  return path.join(process.resourcesPath || "", ...p);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // 可去掉 icon 这行；macOS 会用打包的 bundle icon
    // icon: resPath("icon.icns"),
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

// ========== IPC 绑定 ==========
// 配置
ipcMain.handle("load-config", async () => config.loadConfig());
ipcMain.handle("save-config", async (_e, cfg) => config.saveConfig(cfg));

// mitm 启/停（使用 vendor/mitmproxy.app 内置二进制）
ipcMain.handle("start-mitm", async (_e, cfg) => {
  return mitm.start(cfg, (line) => mainWindow?.webContents.send("mitm-log", line));
});
ipcMain.handle("stop-mitm", async () => mitm.stop());

// 上游侦测（返回 { upstream, error }）
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
// === 新增：查询系统代理（只读）
ipcMain.handle("get-system-proxy", async () => sysProxy.getSystemProxy());