// main.js
const { app, BrowserWindow } = require("electron");
const path = require("path");

// —— 日志发射器（给 renderer 的 log 面板用）
let mainWindow = null;
const sendLog = (line) => mainWindow?.webContents.send("mitm-log", line);

// —— 模块化的 IPC 注册
const registerConfig = require("./modules/config");
const registerMitm = require("./modules/mitmLauncher");
const registerUpstream = require("./modules/upstreamDetector");
const registerSysProxy = require("./modules/systemProxy");

function createWindow() {
  mainWindow = new BrowserWindow({
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

app.whenReady().then(() => {
  createWindow();

  // 注册各子模块（把 sendLog 传进去，内部会自己注册 IPC）
  registerConfig({ sendLog });
  registerMitm({ sendLog });
  registerUpstream({ sendLog });
  registerSysProxy({ sendLog });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  // 尝试优雅停止 mitm
  try {
    require("./modules/mitmLauncher").gracefulQuit?.();
  } catch {}
});