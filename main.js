// main.js  —— 极简（内置 mitmproxy.app / mitmdump）
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

let mainWindow = null;
let mitmProc = null;

function resPath(...p) {
  return path.join(process.resourcesPath || "", ...p);
}

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

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { try { if (mitmProc) mitmProc.kill("SIGINT"); } catch {} });

// ---------------- 配置读写（保持你原有的键名，mode/extraArgs 可留空） ----------------
const CONFIG_FILE = path.join(app.getPath("userData"), "mitm-config.json");
function defaultConfig() {
  return {
    listenHost: "127.0.0.1",
    port: 8080,
    upstream: "",
    extraArgs: "",
  };
}
ipcMain.handle("load-config", async () => {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {}
  return defaultConfig();
});
ipcMain.handle("save-config", async (_e, cfg) => {
  const merged = { ...defaultConfig(), ...(cfg || {}) };
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf8");
  return true;
});

// ---------------- 启动/停止 mitm（仅使用内置 mitmproxy.app） ----------------
function q(a) { return /\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a; }

ipcMain.handle("start-mitm", async (_evt, cfg) => {
  if (mitmProc) throw new Error("mitm 已在运行");
  const conf = { ...defaultConfig(), ...(cfg || {}) };

  // 1) 计算内置 mitmdump 路径
  const mitmBin = resPath("mitmproxy.app", "Contents", "MacOS", "mitmdump");
  if (!fs.existsSync(mitmBin)) throw new Error("内置 mitmdump 不存在，请确认已把 mitmproxy.app 放进 extraResources。");

  // 2) 脚本路径（你的注入脚本/规则）
  const injector = resPath("figcn_injector.py");
  if (!fs.existsSync(injector)) throw new Error("缺少 figcn_injector.py");

  // 3) 组装参数（保持你之前的逻辑）
  const args = [];
  if (conf.upstream && conf.upstream.trim()) args.push("--mode", `upstream:${conf.upstream.trim()}`);
  if (conf.listenHost) args.push("--listen-host", String(conf.listenHost));
  if (conf.port) args.push("-p", String(conf.port));

  args.push("--set", "keepserving=true");
  args.push("--set", "termlog_verbosity=debug", "--set", "flow_detail=2");
  args.push("--verbose");
  args.push("--set", "allow_hosts=^(.+\\.)?figma\\.com(:443)?$|^kailous\\.github\\.io(:443)?$");
  args.push("-s", injector);

  if (conf.extraArgs && conf.extraArgs.trim()) {
    const extra = conf.extraArgs.match(/\S+|"([^"]*)"/g)?.map(p => p.replace(/^"|"$/g, "")) || [];
    args.push(...extra);
  }

  const echo = `$ ${q(mitmBin)} ${args.map(q).join(" ")}\n`;
  mainWindow?.webContents.send("mitm-log", echo);
  mainWindow?.webContents.send("mitm-log", "[Start] 代理已启动。\n");

  // 4) 直接启动内置 mitmdump
  mitmProc = spawn(mitmBin, args, {
    cwd: process.resourcesPath,
    env: { ...process.env },
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
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

// ---------------- 系统代理（沿用你现有 preload 的 IPC 名称） ----------------
// 你已有 renderer & preload 侧调用，无需改 preload（仍用 set-system-proxy / restore-system-proxy）
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

const proxyBackupFile = path.join(app.getPath("userData"), "proxy-backup.json");
function escAppleScript(s){ return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"'); }
async function runAsAdminBatch(cmds){
  const osa = `do shell script "${escAppleScript(cmds.join(" ; "))}" with administrator privileges`;
  await execFileP("osascript", ["-e", osa]);
}
async function listServices(){
  const { stdout } = await execFileP("networksetup", ["-listallnetworkservices"]);
  return stdout.split("\n").map(s=>s.trim()).filter(s=>s && !s.startsWith("An asterisk"));
}
async function get(flag, service){
  try { const { stdout } = await execFileP("networksetup", [flag, service]); return stdout; } catch { return ""; }
}
async function snapService(svc){
  return {
    web:  await get("-getwebproxy", svc),
    sec:  await get("-getsecurewebproxy", svc),
    auto: await get("-getautoproxyurl", svc),
    autostate: await get("-getautoproxystate", svc),
  };
}
ipcMain.handle("set-system-proxy", async (_e, {host, port})=>{
  if (process.platform!=="darwin") throw new Error("仅支持 macOS");
  if (!host||!port) throw new Error("缺少参数");
  const svcs = await listServices();
  const snap = {};
  for (const s of svcs) snap[s]=await snapService(s);
  fs.mkdirSync(path.dirname(proxyBackupFile), {recursive:true});
  fs.writeFileSync(proxyBackupFile, JSON.stringify({ts:Date.now(), data:snap}, null, 2));
  const cmds=[];
  for (const s of svcs){
    const q = `"${s.replace(/"/g,'\\"')}"`;
    cmds.push(
      `networksetup -setautoproxystate ${q} off`,
      `networksetup -setwebproxy ${q} ${host} ${port}`,
      `networksetup -setwebproxystate ${q} on`,
      `networksetup -setsecurewebproxy ${q} ${host} ${port}`,
      `networksetup -setsecurewebproxystate ${q} on`,
    );
  }
  await runAsAdminBatch(cmds);
  return true;
});
ipcMain.handle("restore-system-proxy", async ()=>{
  if (process.platform!=="darwin") throw new Error("仅支持 macOS");
  if (!fs.existsSync(proxyBackupFile)) throw new Error("没有备份");
  const { data } = JSON.parse(fs.readFileSync(proxyBackupFile,"utf8"));
  const svcs = await listServices();
  const cmds=[];
  for (const s of svcs){
    const q = `"${s.replace(/"/g,'\\"')}"`;
    const snap = data[s]||{};
    const webOn = /Enabled:\s+Yes/i.test(snap.web||"");
    const wHost = (snap.web?.match(/Server:\s+(.+)/i)||[, ""])[1].trim();
    const wPort = (snap.web?.match(/Port:\s+(\d+)/i)||[, ""])[1].trim();
    const secOn = /Enabled:\s+Yes/i.test(snap.sec||"");
    const sHost = (snap.sec?.match(/Server:\s+(.+)/i)||[, ""])[1].trim();
    const sPort = (snap.sec?.match(/Port:\s+(\d+)/i)||[, ""])[1].trim();
    const autoOn = /Yes/i.test(snap.autostate||"");
    const autoURL = (snap.auto?.match(/URL:\s+(.+)/i)||[, ""])[1].trim();

    if (webOn && wHost && wPort){ cmds.push(`networksetup -setwebproxy ${q} ${wHost} ${wPort}`, `networksetup -setwebproxystate ${q} on`); }
    else { cmds.push(`networksetup -setwebproxystate ${q} off`); }

    if (secOn && sHost && sPort){ cmds.push(`networksetup -setsecurewebproxy ${q} ${sHost} ${sPort}`, `networksetup -setsecurewebproxystate ${q} on`); }
    else { cmds.push(`networksetup -setsecurewebproxystate ${q} off`); }

    if (autoOn && autoURL){ cmds.push(`networksetup -setautoproxyurl ${q} "${autoURL.replace(/"/g,'\\"')}"`, `networksetup -setautoproxystate ${q} on`); }
    else { cmds.push(`networksetup -setautoproxystate ${q} off`); }
  }
  if (cmds.length) await runAsAdminBatch(cmds);
  return true;
});