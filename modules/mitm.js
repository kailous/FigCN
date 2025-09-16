// modules/mitm.js
// 启动 mitmproxy

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { defaultConfig } = require("./config");

let proc = null;

function resPath(...p) {
  return path.join(process.resourcesPath || "", ...p);
}

function q(a) {
  return /\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

async function start(cfg, onLog /* (line) => void */) {
  if (proc) throw new Error("mitm 已在运行");
  const conf = { ...defaultConfig(), ...(cfg || {}) };

  // 1) 计算内置 mitmdump 路径（来自 mitmproxy.app）
  const mitmBin = resPath("mitmproxy.app", "Contents", "MacOS", "mitmdump");
  if (!fs.existsSync(mitmBin)) {
    throw new Error("内置 mitmdump 不存在，请确认将 mitmproxy.app 放入 extraResources。");
  }

  // 2) 注入脚本
  const injector = resPath("figcn_injector.py");
  if (!fs.existsSync(injector)) throw new Error("缺少 figcn_injector.py");

  // 3) 参数
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
  onLog?.(echo);
  onLog?.("[Start] 代理已启动。\n");

  // 4) 启动
  proc = spawn(mitmBin, args, {
    cwd: process.resourcesPath,
    env: { ...process.env },
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

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
  try { proc.kill("SIGINT"); } catch {}
  proc = null;
  return true;
}

module.exports = { start, stop };