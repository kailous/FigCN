// modules/systemProxy.js
const { ipcMain, app } = require("electron");
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");

const execFileP = promisify(execFile);
const proxyBackupFile = path.join(app.getPath("userData"), "proxy-backup.json");

const isMac = () => process.platform === "darwin";

function escAppleScript(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
async function runAsAdminBatch(shellCmds /* string[] */) {
  const joined = shellCmds.join(" ; ");
  const osa = `do shell script "${escAppleScript(joined)}" with administrator privileges`;
  await execFileP("osascript", ["-e", osa]);
}

async function listNetworkServices() {
  const { stdout } = await execFileP("networksetup", ["-listallnetworkservices"]);
  return stdout.split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("An asterisk"));
}
async function readServiceProxy(service) {
  const get = async (flag) => {
    try { const { stdout } = await execFileP("networksetup", [flag, service]); return stdout; }
    catch { return ""; }
  };
  const web = await get("-getwebproxy");
  const sec = await get("-getsecurewebproxy");
  const auto = await get("-getautoproxyurl");
  const autostate = await get("-getautoproxystate");
  return { web, sec, auto, autostate };
}
async function backupCurrentProxy() {
  const services = await listNetworkServices();
  const data = {};
  for (const s of services) data[s] = await readServiceProxy(s);
  fs.mkdirSync(path.dirname(proxyBackupFile), { recursive: true });
  fs.writeFileSync(proxyBackupFile, JSON.stringify({ ts: Date.now(), data }, null, 2));
}

function buildSetCommandsForService(service, host, port) {
  const svc = `"${service.replace(/"/g, '\\"')}"`;
  return [
    `networksetup -setautoproxystate ${svc} off`,
    `networksetup -setwebproxy ${svc} ${host} ${port}`,
    `networksetup -setwebproxystate ${svc} on`,
    `networksetup -setsecurewebproxy ${svc} ${host} ${port}`,
    `networksetup -setsecurewebproxystate ${svc} on`,
  ];
}
function buildRestoreCommandsForService(service, snap) {
  const svc = `"${service.replace(/"/g, '\\"')}"`;
  const cmds = [];

  const webOn = /Enabled:\s+Yes/i.test(snap.web || "");
  const wHost = (snap.web?.match(/Server:\s+(.+)/i) || [,""])[1].trim();
  const wPort = (snap.web?.match(/Port:\s+(\d+)/i) || [,""])[1].trim();

  const secOn = /Enabled:\s+Yes/i.test(snap.sec || "");
  const sHost = (snap.sec?.match(/Server:\s+(.+)/i) || [,""])[1].trim();
  const sPort = (snap.sec?.match(/Port:\s+(\d+)/i) || [,""])[1].trim();

  const autoOn = /Yes/i.test(snap.autostate || "");
  const autoURL = (snap.auto?.match(/URL:\s+(.+)/i) || [,""])[1]?.trim();

  if (webOn && wHost && wPort) {
    cmds.push(`networksetup -setwebproxy ${svc} ${wHost} ${wPort}`);
    cmds.push(`networksetup -setwebproxystate ${svc} on`);
  } else {
    cmds.push(`networksetup -setwebproxystate ${svc} off`);
  }
  if (secOn && sHost && sPort) {
    cmds.push(`networksetup -setsecurewebproxy ${svc} ${sHost} ${sPort}`);
    cmds.push(`networksetup -setsecurewebproxystate ${svc} on`);
  } else {
    cmds.push(`networksetup -setsecurewebproxystate ${svc} off`);
  }
  if (autoOn && autoURL) {
    cmds.push(`networksetup -setautoproxyurl ${svc} "${autoURL.replace(/"/g, '\\"')}"`);
    cmds.push(`networksetup -setautoproxystate ${svc} on`);
  } else {
    cmds.push(`networksetup -setautoproxystate ${svc} off`);
  }
  return cmds;
}

module.exports = function registerSysProxy({ sendLog }) {
  ipcMain.handle("set-system-proxy", async (_evt, { host, port }) => {
    if (!isMac()) throw new Error("当前仅支持 macOS 系统代理设置。");
    if (!host || !port) throw new Error("缺少代理地址或端口。");

    await backupCurrentProxy();
    const services = await listNetworkServices();
    const cmds = [];
    for (const s of services) {
      if (!s.startsWith("*")) cmds.push(...buildSetCommandsForService(s, host, port));
    }
    await runAsAdminBatch(cmds); // 只弹一次授权
    sendLog?.("[系统代理] 设置完成。\n");
    return true;
  });

  ipcMain.handle("restore-system-proxy", async () => {
    if (!isMac()) throw new Error("当前仅支持 macOS 系统代理设置。");
    if (!fs.existsSync(proxyBackupFile)) throw new Error("没有找到备份，无法恢复。");

    const snap = JSON.parse(fs.readFileSync(proxyBackupFile, "utf8"));
    const data = snap.data || {};
    const services = await listNetworkServices();
    const cmds = [];
    for (const s of services) {
      if (data[s]) cmds.push(...buildRestoreCommandsForService(s, data[s]));
    }
    if (cmds.length) await runAsAdminBatch(cmds);
    sendLog?.("[系统代理] 已恢复。\n");
    return true;
  });
};