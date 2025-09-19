// modules/mitm.js
// 启动 mitmproxy

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { defaultConfig } = require("./config");

let proc = null;

function resPath(...p) {
  const guesses = [];
  if (process.resourcesPath) guesses.push(path.join(process.resourcesPath, ...p));
  guesses.push(path.join(__dirname, ...p));
  for (const g of guesses) {
    if (fs.existsSync(g)) return g;
  }
  return guesses[0];
}

function q(a) {
  return /\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

function normalizePath(p) {
  if (!p) return null;
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function resolveBundledMitmBinary() {
  const custom = process.env.MITMDUMP_PATH;
  if (custom && fs.existsSync(custom)) {
    return { bin: normalizePath(custom), source: "env" };
  }

  const platform = process.platform;
  if (platform === "darwin") {
    const macBin = resPath("mitmproxy.app", "Contents", "MacOS", "mitmdump");
    if (fs.existsSync(macBin)) {
      return { bin: normalizePath(macBin), source: "bundled-mac" };
    }
    throw new Error(
      "内置 mitmdump 不存在，请确认已在 vendor 目录放置 mitmproxy.app 后再打包。"
    );
  }

  if (platform === "win32") {
    const winCandidates = [
      resPath("mitmproxy-win64", "mitmdump.exe"),
      resPath("mitmproxy-win64", "mitmdump", "mitmdump.exe"),
      resPath("mitmdump.exe"),
    ];
    for (const candidate of winCandidates) {
      if (candidate && fs.existsSync(candidate)) {
        return { bin: normalizePath(candidate), source: "bundled-win" };
      }
    }
    return { bin: "mitmdump.exe", source: "system" };
  }

  // Linux 或其他平台：尝试使用资源目录内的 mitmdump；失败时回退系统 PATH。
  const local = resPath("mitmdump");
  if (local && fs.existsSync(local)) {
    return { bin: normalizePath(local), source: "bundled" };
  }
  return { bin: "mitmdump", source: "system" };
}

async function start(cfg, onLog /* (line) => void */) {
  if (proc) throw new Error("mitm 已在运行");
  const conf = { ...defaultConfig(), ...(cfg || {}) };

  // 1) 计算 mitmdump 路径（macOS 使用内置 .app，Windows 尝试内置 exe，其他平台回退到系统 PATH）
  const mitm = resolveBundledMitmBinary();
  const mitmBin = mitm.bin;

  if (mitm.source === "system") {
    onLog?.(`[提示] 未找到内置 mitmdump，尝试使用系统路径中的 ${mitmBin}。\\n`);
  }

  // 2) 注入脚本
  const injector = resPath("figcn_injector.py");
  if (!fs.existsSync(injector)) throw new Error("缺少 figcn_injector.py");

  // 3) 参数
  const args = [];
  if (conf.upstream && conf.upstream.trim()) args.push("--mode", `upstream:${conf.upstream.trim()}`);
  if (conf.listenHost) args.push("--listen-host", String(conf.listenHost));
  if (conf.port) args.push("-p", String(conf.port));

  args.push("--set", "keepserving=true"); // 保持服务运行，不退出
  args.push("--set", "termlog_verbosity=error"); // 只打印错误日志
  args.push("--set", "flow_detail=0"); // 不打印详细的请求响应详情
  // args.push("--quiet"); // 不打印详细日志
  args.push("--set", "allow_hosts=^(.+\\.)?figma\\.com(:443)?$|^kailous\\.github\\.io(:443)?$");
  args.push("-s", injector); // 注入脚本

  if (conf.extraArgs && conf.extraArgs.trim()) {
    const extra = conf.extraArgs.match(/\S+|"([^"]*)"/g)?.map(p => p.replace(/^"|"$/g, "")) || [];
    args.push(...extra);
  }

  const echo = `$ ${q(mitmBin)} ${args.map(q).join(" ")}\n`;
  onLog?.(echo);
  onLog?.("[Start] 代理已启动。\n");

  // 4) 启动
  const spawnCwd = mitm.source === "system"
    ? process.resourcesPath || process.cwd()
    : path.dirname(mitmBin);

  const spawnOpts = {
    cwd: spawnCwd,
    env: { ...process.env },
    shell: false,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  };

  proc = spawn(mitmBin, args, spawnOpts);

  proc.stdout.on("data", d => onLog?.(d.toString()));
  proc.stderr.on("data", d => onLog?.(d.toString()));
  proc.on("error", err => onLog?.(`[启动错误] ${String(err)}\n`));
  proc.on("exit", (code, signal) => {
    onLog?.(`\n[mitm 退出] code=${code} signal=${signal}\n`);
    proc = null;
  });

  return true;
}

async function stop() {
  if (!proc) return false;
  try {
    if (process.platform === "win32") proc.kill();
    else proc.kill("SIGINT");
  } catch {}
  proc = null;
  return true;
}

module.exports = { start, stop };