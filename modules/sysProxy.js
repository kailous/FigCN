// modules/sysProxy.js
// 设置系统代理

const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");
const execFileP = promisify(execFile);

const proxyBackupFile = path.join(app.getPath("userData"), "proxy-backup.json");

function escAppleScript(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
async function runAsAdminBatch(cmds) {
  const osa = `do shell script "${escAppleScript(cmds.join(" ; "))}" with administrator privileges`;
  await execFileP("osascript", ["-e", osa]);
}
async function listServices() {
  const { stdout } = await execFileP("networksetup", ["-listallnetworkservices"]);
  return stdout.split("\n").map(s=>s.trim()).filter(s=>s && !s.startsWith("An asterisk"));
}
async function get(flag, service) {
  try { const { stdout } = await execFileP("networksetup", [flag, service]); return stdout; }
  catch { return ""; }
}
async function snapService(svc) {
  return {
    web:  await get("-getwebproxy", svc),
    sec:  await get("-getsecurewebproxy", svc),
    auto: await get("-getautoproxyurl", svc),
    autostate: await get("-getautoproxystate", svc),
  };
}

async function setSystemProxy(host, port) {
  if (process.platform !== "darwin") throw new Error("仅支持 macOS");
  if (!host || !port) throw new Error("缺少参数");

  const svcs = await listServices();
  // 备份
  const snap = {};
  for (const s of svcs) snap[s] = await snapService(s);
  fs.mkdirSync(path.dirname(proxyBackupFile), { recursive: true });
  fs.writeFileSync(proxyBackupFile, JSON.stringify({ ts: Date.now(), data: snap }, null, 2));

  // 设置
  const cmds = [];
  for (const s of svcs) {
    const q = `"${s.replace(/"/g, '\\"')}"`;
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
}

async function restoreSystemProxy() {
  if (process.platform !== "darwin") throw new Error("仅支持 macOS");
  if (!fs.existsSync(proxyBackupFile)) throw new Error("没有备份");

  const { data } = JSON.parse(fs.readFileSync(proxyBackupFile, "utf8"));
  const svcs = await listServices();
  const cmds = [];

  for (const s of svcs) {
    const snap = data[s] || {};
    const q = `"${s.replace(/"/g, '\\"')}"`;

    const webOn = /Enabled:\s+Yes/i.test(snap.web || "");
    const wHost = (snap.web?.match(/Server:\s+(.+)/i) || [, ""])[1].trim();
    const wPort = (snap.web?.match(/Port:\s+(\d+)/i) || [, ""])[1].trim();

    const secOn = /Enabled:\s+Yes/i.test(snap.sec || "");
    const sHost = (snap.sec?.match(/Server:\s+(.+)/i) || [, ""])[1].trim();
    const sPort = (snap.sec?.match(/Port:\s+(\d+)/i) || [, ""])[1].trim();

    const autoOn = /Yes/i.test(snap.autostate || "");
    const autoURL = (snap.auto?.match(/URL:\s+(.+)/i) || [, ""])[1]?.trim();

    if (webOn && wHost && wPort) {
      cmds.push(`networksetup -setwebproxy ${q} ${wHost} ${wPort}`, `networksetup -setwebproxystate ${q} on`);
    } else {
      cmds.push(`networksetup -setwebproxystate ${q} off`);
    }
    if (secOn && sHost && sPort) {
      cmds.push(`networksetup -setsecurewebproxy ${q} ${sHost} ${sPort}`, `networksetup -setsecurewebproxystate ${q} on`);
    } else {
      cmds.push(`networksetup -setsecurewebproxystate ${q} off`);
    }
    if (autoOn && autoURL) {
      cmds.push(`networksetup -setautoproxyurl ${q} "${autoURL.replace(/"/g, '\\"')}"`, `networksetup -setautoproxystate ${q} on`);
    } else {
      cmds.push(`networksetup -setautoproxystate ${q} off`);
    }
  }
  if (cmds.length) await runAsAdminBatch(cmds);
  return true;
}

module.exports = { setSystemProxy, restoreSystemProxy };