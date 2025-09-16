// modules/sysProxy.js
// 系统代理（macOS）
// - 需要提权的修改操作：通过 osascript 一次性批处理
// - 只读查询：scutil --proxy（不会弹密码）

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);
const fs = require("fs");
const path = require("path");

let electronApp = null;
function init(appRef) { electronApp = appRef; }

function escAppleScript(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
async function runAsAdminBatch(shellCmds) {
  // 单次授权，批量执行
  const osa = `do shell script "${escAppleScript(shellCmds.join(" ; "))}" with administrator privileges`;
  await execFileP("osascript", ["-e", osa]);
}

async function listServices() {
  const { stdout } = await execFileP("networksetup", ["-listallnetworkservices"]);
  return stdout.split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("An asterisk"));
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
function getBackupFile() {
  if (!electronApp) throw new Error("sysProxy.init(app) 未调用");
  return path.join(electronApp.getPath("userData"), "proxy-backup.json");
}

/* =========================
 * 只读查询（不会弹密码）
 * ========================= */
async function getSystemProxy() {
  if (process.platform !== "darwin") {
    return { ok: false, reason: "unsupported", http: {}, https: {}, pac: {} };
  }
  try {
    const { stdout } = await execFileP("scutil", ["--proxy"]);
    const kv = {};
    stdout.split("\n").forEach(line => {
      const m = line.match(/^\s*(\S+)\s*:\s*(.+)\s*$/);
      if (m) kv[m[1]] = m[2];
    });
    const http = {
      enabled: kv.HTTPEnable === "1",
      host: kv.HTTPProxy || "",
      port: kv.HTTPPort ? Number(kv.HTTPPort) : undefined,
    };
    const https = {
      enabled: kv.HTTPSEnable === "1",
      host: kv.HTTPSProxy || "",
      port: kv.HTTPSPort ? Number(kv.HTTPSPort) : undefined,
    };
    const pac = {
      enabled: kv.ProxyAutoConfigEnable === "1",
      url: kv.ProxyAutoConfigURLString || "",
    };
    return { ok: true, http, https, pac };
  } catch (e) {
    return { ok: false, reason: String(e), http: {}, https: {}, pac: {} };
  }
}

/** 便捷判断：系统 HTTP/HTTPS 是否指向指定 host:port（两者任一匹配即返回 true） */
async function isSystemProxyPointingTo(host, port) {
  const sp = await getSystemProxy();
  if (!sp.ok) return false;
  const hitHTTP  = sp.http?.enabled  && sp.http.host === host && Number(sp.http.port)  === Number(port);
  const hitHTTPS = sp.https?.enabled && sp.https.host === host && Number(sp.https.port) === Number(port);
  return Boolean(hitHTTP || hitHTTPS);
}

/* =========================
 * 修改系统代理（需要一次授权）
 * ========================= */
async function setSystemProxy(host, port) {
  if (process.platform !== "darwin") throw new Error("仅支持 macOS");
  if (!host || !port) throw new Error("缺少代理地址或端口");

  const svcs = await listServices();
  const snap = {};
  for (const s of svcs) snap[s] = await snapService(s);

  const backupFile = getBackupFile();
  fs.mkdirSync(path.dirname(backupFile), { recursive: true });
  fs.writeFileSync(backupFile, JSON.stringify({ ts: Date.now(), data: snap }, null, 2));

  const cmds = [];
  for (const s of svcs) {
    const q = `"${s.replace(/"/g, '\\"')}"`;
    cmds.push(
      `networksetup -setautoproxystate ${q} off`,
      `networksetup -setwebproxy ${q} ${host} ${port}`,
      `networksetup -setwebproxystate ${q} on`,
      `networksetup -setsecurewebproxy ${q} ${host} ${port}`,
      `networksetup -setsecurewebproxystate ${q} on`
    );
  }
  await runAsAdminBatch(cmds);
  return true;
}

async function restoreSystemProxy() {
  if (process.platform !== "darwin") throw new Error("仅支持 macOS");
  const backupFile = getBackupFile();
  if (!fs.existsSync(backupFile)) throw new Error("没有备份");

  const { data } = JSON.parse(fs.readFileSync(backupFile, "utf8"));
  const svcs = await listServices();
  const cmds = [];

  for (const s of svcs) {
    const q = `"${s.replace(/"/g, '\\"')}"`;
    const snap = data[s] || {};
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

module.exports = {
  init,
  // 只读
  getSystemProxy,
  isSystemProxyPointingTo,
  // 修改
  setSystemProxy,
  restoreSystemProxy,
};