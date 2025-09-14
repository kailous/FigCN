// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, execFile } = require("child_process");
const os = require("os");
const net = require("net");
const http = require("http");
const https = require("https");
const { promisify } = require("util");
const execFileP = promisify(execFile);

let mainWindow = null;
let mitmProc = null;

function resPath(...p) { return path.join(process.resourcesPath || "", ...p); }
function getVenvDir() { const p = resPath("venv"); return fs.existsSync(p) ? p : null; }
function getScriptPath(filename) { const p = resPath(filename); return fs.existsSync(p) ? p : null; }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960, height: 700,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile("static/index.html");
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

const CONFIG_FILE = path.join(app.getPath("userData"), "mitm-config.json");
function defaultConfig() {
  return { mode: "regular", listenHost: "127.0.0.1", port: 8080, upstream: "", scripts: "", extraArgs: "", mitmPath: "", mitmWebPath: "" };
}
ipcMain.handle("load-config", async () => { try { if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch {} return defaultConfig(); });
ipcMain.handle("save-config", async (_e, cfg) => { const merged = { ...defaultConfig(), ...(cfg || {}) }; fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf8"); return true; });

async function resolveFromPAC(pacUrl, testUrl) {
  const fetchText = (url) => new Promise((resolve, reject) => {
    const h = url.startsWith("https:") ? https : http;
    h.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(fetchText(res.headers.location));
      let data = ""; res.on("data", c => data += c); res.on("end", () => resolve(data));
    }).on("error", reject);
  });
  let createPacResolver; try { createPacResolver = require("pac-resolver"); } catch { return null; }
  const pacText = await fetchText(pacUrl);
  const FindProxyForURL = createPacResolver(pacText);
  const rule = await FindProxyForURL(testUrl || "https://www.figma.com/");
  const firstRaw = (rule || "").split(";")[0].trim(); const FIRST = firstRaw.toUpperCase();
  if (FIRST.startsWith("PROXY ")) return `http://${firstRaw.slice(6).trim()}`;
  if (FIRST.startsWith("HTTPS ")) return `https://${firstRaw.slice(6).trim()}`;
  if (FIRST.startsWith("SOCKS")) { const hp = firstRaw.split(/\s+/)[1]; const ver = FIRST.startsWith("SOCKS5") ? "socks5" : "socks4"; return `${ver}://${hp}`; }
  return null;
}
function probeHttpProxy(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.write("CONNECT www.google.com:443 HTTP/1.1\r\nHost: www.google.com:443\r\n\r\n");
    });
    const to = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once("error", () => { clearTimeout(to); resolve(false); });
    socket.once("data", (buf) => { clearTimeout(to); const ok = /^HTTP\/\d\.\d 200/i.test(String(buf)); socket.destroy(); resolve(ok); });
  });
}
async function getSystemProxyCandidate(testUrl) {
  if (os.platform() === "darwin") {
    try {
      const { stdout } = await execFileP("scutil", ["--proxy"]);
      const kv = {}; stdout.split("\n").forEach(line => { const m = line.match(/^\s*(\S+)\s*:\s*(.+)\s*$/); if (m) kv[m[1]] = m[2]; });
      if (kv.ProxyAutoConfigEnable === "1" && kv.ProxyAutoConfigURLString) { const pac = await resolveFromPAC(kv.ProxyAutoConfigURLString.trim(), testUrl); if (pac) return pac; }
      if (kv.HTTPSEnable === "1" && kv.HTTPSProxy && kv.HTTPSPort) return `http://${kv.HTTPSProxy}:${kv.HTTPSPort}`;
      if (kv.HTTPEnable === "1" && kv.HTTPProxy && kv.HTTPPort) return `http://${kv.HTTPProxy}:${kv.HTTPPort}`;
    } catch {}
  }
  return null;
}
async function probeLocalCandidates() {
  const candidates = ["http://127.0.0.1:7890","http://127.0.0.1:7897","http://127.0.0.1:8889","http://127.0.0.1:1080","http://127.0.0.1:8001"];
  for (const url of candidates) { try { const { hostname, port } = new URL(url); const ok = await probeHttpProxy(hostname, Number(port)); if (ok) return url; } catch {} }
  return null;
}
async function detectUpstreamFor(testUrl = "https://www.figma.com/") {
  const sys = await getSystemProxyCandidate(testUrl); if (sys) return sys;
  const local = await probeLocalCandidates(); if (local) return local;
  return null;
}
ipcMain.handle("auto-detect-upstream", async (_evt, testUrl) => { try { const upstream = await detectUpstreamFor(testUrl); return { upstream }; } catch (e) { return { upstream: null, error: String(e) }; } });

function ensureExecutable(p) { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { try { fs.chmodSync(p, 0o755); fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } } }
async function cmdExists(cmd) { const bin = process.platform === "win32" ? "where" : "which"; try { const { stdout } = await execFileP(bin, [cmd]); return Boolean(stdout && stdout.trim()); } catch { return false; } }

ipcMain.handle("start-mitm", async (_evt, cfg) => {
  if (mitmProc) throw new Error("mitm 已在运行");
  const conf = { ...defaultConfig(), ...(cfg || {}) };

  const args = [];
  if (conf.upstream && conf.upstream.trim()) args.push("--mode", `upstream:${conf.upstream.trim()}`);
  if (conf.listenHost) args.push("--listen-host", String(conf.listenHost));
  if (conf.port) args.push("-p", String(conf.port));

  // 关键：增加 keepserving 与更高日志等级，帮助定位“秒退”
  args.push("--set", "keepserving=true");
  args.push("--set", "termlog_verbosity=debug", "--set", "flow_detail=2");
  args.push("--verbose"); // 等价于 -v

  // 只拦 figma 与语言包域名
  args.push("--set", "allow_hosts=^(.+\\.)?figma\\.com(:443)?$|^kailous\\.github\\.io(:443)?$");

  const injector = getScriptPath("figcn_injector.py");
  if (injector) { args.push("-s", injector); mainWindow?.webContents.send("mitm-log", `[脚本] 已加载：${injector}\n`); }

  if (conf.extraArgs && conf.extraArgs.trim()) {
    const extra = conf.extraArgs.match(/\S+|"([^"]*)"/g)?.map(p=>p.replace(/^"|"$/g,"")) || [];
    args.push(...extra);
  }

  const venvDir = getVenvDir();
  if (!venvDir) throw new Error("未找到 Resources/venv，请确认 extraResources 已包含 venv。");

  const VENV_PY = path.join(venvDir, "bin", "python3");
  const VENV_MITMDUMP = path.join(venvDir, "bin", "mitmdump");
  const DUMP_MODULE = "mitmproxy.tools.dump";

  let launchCmd = null, launchArgs = null;

  // ✅ 新的优先级：先直接跑可执行文件（很多环境更稳），再退回到模块入口
  if (fs.existsSync(VENV_MITMDUMP) && ensureExecutable(VENV_MITMDUMP)) {
    launchCmd = VENV_MITMDUMP;
    launchArgs = args;
  } else if (fs.existsSync(VENV_PY) && ensureExecutable(VENV_PY)) {
    launchCmd = VENV_PY;
    launchArgs = ["-m", DUMP_MODULE, ...args];
  } else if (conf.mitmPath && fs.existsSync(conf.mitmPath)) {
    launchCmd = conf.mitmPath; launchArgs = args;
  } else if (await cmdExists("mitmdump")) {
    launchCmd = "mitmdump"; launchArgs = args;
  } else if (await cmdExists("python3")) {
    launchCmd = "python3"; launchArgs = ["-m", DUMP_MODULE, ...args];
  } else {
    throw new Error("未找到 mitmdump 或 python3。");
  }

  const opts = { cwd: process.resourcesPath, env: { ...process.env }, shell: false };

  const echo = `$ ${launchCmd} ${launchArgs.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}\n`;
  mainWindow?.webContents.send("mitm-log", echo);

  mitmProc = spawn(launchCmd, launchArgs, opts);
  mitmProc.stdout.on("data", d => mainWindow?.webContents.send("mitm-log", d.toString()));
  mitmProc.stderr.on("data", d => mainWindow?.webContents.send("mitm-log", d.toString()));
  mitmProc.on("error", err => mainWindow?.webContents.send("mitm-log", `[启动错误] ${String(err)}\n`));
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