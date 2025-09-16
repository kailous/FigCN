// modules/mitmLauncher.js
const { ipcMain } = require("electron");
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { promisify } = require("util");
const { resPath, getVenvDir, getScriptPath, ensureExecutable, q } = require("./paths");
const { defaultConfig } = require("./config");

const execFileP = promisify(execFile);

let mitmProc = null;
let stopTimer = null;

function cmdExists(cmd) {
  const bin = process.platform === "win32" ? "where" : "which";
  return execFileP(bin, [cmd]).then(({ stdout }) => Boolean(stdout?.trim())).catch(() => false);
}

function buildArgs(conf, injectorPath) {
  const args = [];
  if (conf.upstream && conf.upstream.trim()) {
    args.push("--mode", `upstream:${conf.upstream.trim()}`);
  }
  if (conf.listenHost) args.push("--listen-host", String(conf.listenHost));
  if (conf.port) args.push("-p", String(conf.port));

  // 更详细日志 + keepserving
  args.push("--set", "keepserving=true");
  args.push("--set", "termlog_verbosity=debug", "--set", "flow_detail=2");
  args.push("--verbose");

  // 仅拦 *.figma.com 和 kailous.github.io
  args.push("--set", "allow_hosts=^(.+\\.)?figma\\.com(:443)?$|^kailous\\.github\\.io(:443)?$");

  if (injectorPath) {
    args.push("-s", injectorPath);
  }

  if (conf.extraArgs && conf.extraArgs.trim()) {
    const extra = conf.extraArgs.match(/\S+|"([^"]*)"/g)?.map((p) => p.replace(/^"|"$/g, "")) || [];
    args.push(...extra);
  }
  return args;
}

function launch(sendLog, conf) {
  const venvDir = getVenvDir();
  if (!venvDir) throw new Error("未找到 Resources/venv，请确认 extraResources 已包含 venv。");

  const BIN = path.join(venvDir, "bin");
  const PY = path.join(BIN, "python3");
  const DUMP = path.join(BIN, "mitmdump");
  const DUMP_MODULE = "mitmproxy.tools.dump";
  const injector = getScriptPath("figcn_injector.py");

  if (injector) sendLog?.(`[脚本] 已加载：${injector}\n`);
  sendLog?.(`[检查] 进程架构: ${process.arch} | 平台: ${process.platform}\n`);

  const args = buildArgs(conf, injector);

  // 环境
  const opts = {
    cwd: process.resourcesPath,
    env: {
      ...process.env,
      PATH: `${BIN}:${process.env.PATH || ""}`,
      // 若打包了 Python.framework，可在 afterPack 里把 DYLD_FRAMEWORK_PATH 指向 Resources/Frameworks
      DYLD_FRAMEWORK_PATH: path.join(process.resourcesPath, "..", "Frameworks"),
      PYTHONNOUSERSITE: "1",
    },
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  };

  // 多种启动方式兜底
  const plans = [];
  if (fs.existsSync(DUMP) && ensureExecutable(DUMP)) plans.push({ cmd: DUMP, argv: args });
  if (fs.existsSync(PY) && ensureExecutable(PY)) plans.push({ cmd: PY, argv: ["-m", DUMP_MODULE, ...args] });

  // 系统兜底
  plans.push({ cmd: "python3", argv: ["-m", DUMP_MODULE, ...args] });
  plans.push({ cmd: "mitmdump", argv: args });

  async function runNext(i = 0) {
    if (i >= plans.length) throw new Error("所有启动方法均失败，请在终端手动运行上面命令以获得更多诊断信息。");

    const { cmd, argv } = plans[i];
    const echo = `$ ${q(cmd)} ${argv.map(q).join(" ")}\n`;
    sendLog?.(echo);

    try {
      mitmProc = spawn(cmd, argv, opts);
    } catch (e) {
      sendLog?.(`[启动错误] ${String(e)}\n`);
      return runNext(i + 1);
    }

    mitmProc.stdout.on("data", (d) => sendLog?.(d.toString()));
    mitmProc.stderr.on("data", (d) => sendLog?.(d.toString()));
    mitmProc.on("error", (err) => sendLog?.(`[启动错误] ${String(err)}\n`));
    mitmProc.on("exit", (code, signal) => {
      sendLog?.(`\n[mitm 退出] code=${code} signal=${signal}\n`);
      mitmProc = null;
    });

    // 观察过快退出的情况（被系统拦/库找不到等）
    setTimeout(() => {
      if (!mitmProc) return; // 已经退出
      // 如果 300ms 内就退出，尝试下一个 plan
      // 这里通过 'exit' 回调里会把 mitmProc=null
    }, 300);
  }

  return runNext(0);
}

function gracefulQuit(sendLog) {
  if (!mitmProc) return false;
  try { mitmProc.kill("SIGINT"); } catch {}
  // 3s 后还没退出则强杀
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    if (mitmProc && !mitmProc.killed) {
      try { mitmProc.kill("SIGKILL"); } catch {}
      sendLog?.("[诊断] 强制结束 mitm 进程。\n");
    }
  }, 3000);
  return true;
}

module.exports = function registerMitm({ sendLog }) {
  ipcMain.handle("start-mitm", async (_evt, cfg) => {
    if (mitmProc) throw new Error("mitm 已在运行");
    const conf = { ...defaultConfig(), ...(cfg || {}) };

    // 简单校验上游格式
    if (conf.upstream && !/^(https?|socks5?|socks4?):\/\//i.test(conf.upstream)) {
      throw new Error("上游代理地址需要以 http(s):// 或 socks4/5:// 开头");
    }

    // 打印关键路径
    const venv = getVenvDir();
    const py = venv ? path.join(venv, "bin", "python3") : "(未找到)";
    const dump = venv ? path.join(venv, "bin", "mitmdump") : "(未找到)";
    if (venv) {
      const okPy = fs.existsSync(py) && ensureExecutable(py) ? "存在 (可执行)" : "缺失";
      const okDump = fs.existsSync(dump) && ensureExecutable(dump) ? "存在 (可执行)" : "缺失";
      sendLog?.(`[检查] ${py} ${okPy}\n`);
      sendLog?.(`[检查] ${dump} ${okDump}\n`);
    }

    try {
      await launch(sendLog, conf);
      sendLog?.("[Start] 代理已启动。\n");
      return true;
    } catch (e) {
      sendLog?.(`[启动错误] ${String(e)}\n`);
      throw e;
    }
  });

  ipcMain.handle("stop-mitm", async () => gracefulQuit(sendLog));
};

// 导出给 main.js 在 before-quit 时调用
module.exports.gracefulQuit = () => gracefulQuit(() => {});