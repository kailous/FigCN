// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

let mainWindow = null;
let mitmProc = null;

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
  mainWindow.loadFile("index.html");
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

const CONFIG_FILE = path.join(__dirname, "mitm-config.json");

function defaultConfig() {
  return {
    mode: "regular",          // regular(=mitmdump) | mitmweb
    listenHost: "127.0.0.1",
    port: 8080,
    upstream: "",
    scripts: "",
    extraArgs: "",
    mitmPath: "",
    mitmWebPath: "",
  };
}

ipcMain.handle("load-config", async () => {
  if (fs.existsSync(CONFIG_FILE)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch {}
  }
  return defaultConfig();
});

ipcMain.handle("save-config", async (_evt, cfg) => {
  const merged = { ...defaultConfig(), ...(cfg || {}) };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf8");
  return true;
});

function resolveMitmBinary(conf) {
  const isWin = process.platform === "win32";
  const isWeb = conf.mode === "mitmweb";
  const binName = isWeb ? "mitmweb" : "mitmdump";
  const venvBin = isWin
    ? path.join(__dirname, "venv", "Scripts", `${binName}.exe`)
    : path.join(__dirname, "venv", "bin", binName);
  if (fs.existsSync(venvBin)) return venvBin;
  if (isWeb && conf.mitmWebPath) return conf.mitmWebPath;
  if (!isWeb && conf.mitmPath) return conf.mitmPath;
  return binName; // PATH 兜底
}

ipcMain.handle("start-mitm", async (_evt, cfg) => {
  if (mitmProc) throw new Error("mitm 已在运行");

  const conf = { ...defaultConfig(), ...(cfg || {}) };
  const bin = resolveMitmBinary(conf);
  const args = [];

  // 上游代理（可选）
  if (conf.upstream && conf.upstream.trim()) {
    args.push("--mode", `upstream:${conf.upstream.trim()}`);
  }

  // 绑定
  if (conf.listenHost) args.push("--listen-host", String(conf.listenHost));
  if (conf.port) args.push("-p", String(conf.port));

  // ✅ 允许域名白名单（与您之前 shell 一致）：figma 全子域 + kailous.github.io
  //   注意：spawn 不走 shell，不需要外层引号；正则里的反斜杠在 JS 字符串里要转义
  args.push(
    "--set",
    "allow_hosts=^(.+\\.)?figma\\.com(:443)?$|^kailous\\.github\\.io(:443)?$"
  );

  // 日志等级
  args.push("--set", "termlog_verbosity=info", "--set", "flow_detail=1");

  // 加载拦截插件
  const injector = path.join(__dirname, "figcn_injector.py");
  if (fs.existsSync(injector)) {
    args.push("-s", injector);
  } else {
    mainWindow?.webContents.send("mitm-log", `[提示] 未找到 ${injector}，规则未加载。\n`);
  }

  // 额外脚本与参数
  if (conf.scripts && conf.scripts.trim()) {
    conf.scripts.split(",").map(s => s.trim()).filter(Boolean).forEach(s => args.push("-s", s));
  }
  if (conf.extraArgs && conf.extraArgs.trim()) {
    const extra = conf.extraArgs.match(/\S+|"([^"]*)"/g)?.map(p => p.replace(/^"|"$/g, "")) || [];
    args.push(...extra);
  }

  // 启动
  mitmProc = spawn(bin, args, { cwd: __dirname, env: process.env, shell: false });

  const echo = `$ ${bin} ${args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}\n`;
  mainWindow?.webContents.send("mitm-log", echo);

  mitmProc.stdout.on("data", d => mainWindow?.webContents.send("mitm-log", d.toString()));
  mitmProc.stderr.on("data", d => mainWindow?.webContents.send("mitm-log", d.toString()));
  mitmProc.on("exit", (code, signal) => {
    mainWindow?.webContents.send("mitm-log", `\n[mitm 退出] code=${code} signal=${signal}\n`);
    mitmProc = null;
  });

  return true;
});

ipcMain.handle("stop-mitm", async () => {
  if (!mitmProc) return false;
  try { mitmProc.kill("SIGINT"); } catch {}
  mitmProc = null;
  return true;
});