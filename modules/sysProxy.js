// modules/sysProxy.js
// 系统代理（macOS / Windows）
// - macOS 通过 networksetup + osascript 提权批处理
// - Windows 通过修改 HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
// - 只读查询：macOS 使用 scutil --proxy，Windows 读取注册表

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);
const fs = require("fs");
const path = require("path");

const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const WINDOWS_PROXY_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

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

async function queryWindowsProxyRaw() {
  const snapshot = {
    ProxyEnable: null,
    ProxyServer: null,
    ProxyOverride: null,
    AutoConfigURL: null,
    AutoDetect: null,
  };
  const { stdout } = await execFileP("reg", ["query", WINDOWS_PROXY_KEY]);
  stdout.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^(?:\s*)(ProxyEnable|ProxyServer|ProxyOverride|AutoConfigURL|AutoDetect)\s+REG_\S+\s+(.+)$/i);
    if (m) {
      const key = m[1];
      snapshot[key] = m[2].trim();
    }
  });
  return snapshot;
}

function parseWindowsDword(value, fallback = 0) {
  if (typeof value !== "string") return fallback;
  const hex = value.match(/^0x([0-9a-f]+)/i);
  if (hex) {
    return Number.parseInt(hex[1], 16);
  }
  const num = Number(value);
  return Number.isNaN(num) ? fallback : num;
}

function parseHostPort(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  try {
    const url = new URL(`http://${trimmed}`);
    const host = url.hostname;
    const port = url.port ? Number(url.port) : undefined;
    return { host, port: Number.isNaN(port) ? undefined : port };
  } catch {
    const idx = trimmed.lastIndexOf(":");
    if (idx > 0) {
      const host = trimmed.slice(0, idx).trim();
      const port = Number(trimmed.slice(idx + 1).trim());
      return { host, port: Number.isNaN(port) ? undefined : port };
    }
    return { host: trimmed, port: undefined };
  }
}

function parseWindowsProxyServers(raw) {
  const res = {};
  if (!raw) return res;
  const segments = String(raw)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  let defaultEntry = null;
  for (const seg of segments) {
    const eq = seg.indexOf("=");
    if (eq >= 0) {
      const key = seg.slice(0, eq).trim().toLowerCase();
      const entry = parseHostPort(seg.slice(eq + 1));
      if (entry && key) res[key] = entry;
    } else if (!defaultEntry) {
      defaultEntry = parseHostPort(seg);
    }
  }
  if (!defaultEntry) {
    defaultEntry = res.http || res.https || null;
  }
  if (defaultEntry) res.default = defaultEntry;
  return res;
}
function getBackupFile() {
  if (!electronApp) throw new Error("sysProxy.init(app) 未调用");
  return path.join(electronApp.getPath("userData"), "proxy-backup.json");
}

/* =========================
 * 只读查询（不会弹密码）
 * ========================= */
async function getSystemProxy() {
  if (isMac) {
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

  if (isWindows) {
    try {
      const raw = await queryWindowsProxyRaw();
      const enabled = parseWindowsDword(raw.ProxyEnable, 0) === 1;
      const proxies = parseWindowsProxyServers(raw.ProxyServer);
      const httpInfo = proxies.http || proxies.default || null;
      const httpsInfo = proxies.https || proxies.http || proxies.default || null;
      const http = {
        enabled: enabled && Boolean(httpInfo?.host),
        host: httpInfo?.host || "",
        port: httpInfo?.port,
      };
      const https = {
        enabled: enabled && Boolean(httpsInfo?.host),
        host: httpsInfo?.host || "",
        port: httpsInfo?.port,
      };
      const pacUrl = (raw.AutoConfigURL || "").trim();
      const pac = {
        enabled: Boolean(pacUrl),
        url: pacUrl,
      };
      return { ok: true, http, https, pac };
    } catch (e) {
      return { ok: false, reason: String(e), http: {}, https: {}, pac: {} };
    }
  }

  return { ok: false, reason: "unsupported", http: {}, https: {}, pac: {} };
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
  if (!host || !port) throw new Error("缺少代理地址或端口");

  if (isMac) {
    const svcs = await listServices();
    const snap = {};
    for (const s of svcs) snap[s] = await snapService(s);

    const backupFile = getBackupFile();
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.writeFileSync(
      backupFile,
      JSON.stringify({ ts: Date.now(), platform: "darwin", data: snap }, null, 2)
    );

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

  if (isWindows) {
    const snapshot = await queryWindowsProxyRaw();
    const backupFile = getBackupFile();
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.writeFileSync(
      backupFile,
      JSON.stringify({ ts: Date.now(), platform: "win32", data: snapshot }, null, 2)
    );

    const address = `${host}:${port}`;
    await execFileP("reg", [
      "add",
      WINDOWS_PROXY_KEY,
      "/v",
      "ProxyEnable",
      "/t",
      "REG_DWORD",
      "/d",
      "1",
      "/f",
    ]);
    await execFileP("reg", [
      "add",
      WINDOWS_PROXY_KEY,
      "/v",
      "ProxyServer",
      "/t",
      "REG_SZ",
      "/d",
      address,
      "/f",
    ]);
    await execFileP("reg", [
      "add",
      WINDOWS_PROXY_KEY,
      "/v",
      "AutoDetect",
      "/t",
      "REG_DWORD",
      "/d",
      "0",
      "/f",
    ]).catch(() => {});
    await execFileP("reg", [
      "delete",
      WINDOWS_PROXY_KEY,
      "/v",
      "AutoConfigURL",
      "/f",
    ]).catch(() => {});
    return true;
  }

  throw new Error("当前平台暂不支持自动设置系统代理");
}

async function restoreSystemProxy() {
  const backupFile = getBackupFile();
  if (!fs.existsSync(backupFile)) throw new Error("没有备份");

  const backup = JSON.parse(fs.readFileSync(backupFile, "utf8"));
  const platform = backup.platform || (isMac ? "darwin" : isWindows ? "win32" : null);
  const data = backup.data || backup;

  if (isMac) {
    if (platform && platform !== "darwin") {
      throw new Error("备份文件来自其它平台，无法在当前系统恢复。");
    }
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
        cmds.push(
          `networksetup -setautoproxyurl ${q} "${autoURL.replace(/"/g, '\\"')}"`,
          `networksetup -setautoproxystate ${q} on`
        );
      } else {
        cmds.push(`networksetup -setautoproxystate ${q} off`);
      }
    }

    if (cmds.length) await runAsAdminBatch(cmds);
    return true;
  }

  if (isWindows) {
    if (platform && platform !== "win32") {
      throw new Error("备份文件来自其它平台，无法在当前系统恢复。");
    }
    const snapshot = data || {};
    const enable = parseWindowsDword(snapshot.ProxyEnable, 0);
    await execFileP("reg", [
      "add",
      WINDOWS_PROXY_KEY,
      "/v",
      "ProxyEnable",
      "/t",
      "REG_DWORD",
      "/d",
      String(enable),
      "/f",
    ]);

    if (snapshot.ProxyServer && String(snapshot.ProxyServer).trim()) {
      await execFileP("reg", [
        "add",
        WINDOWS_PROXY_KEY,
        "/v",
        "ProxyServer",
        "/t",
        "REG_SZ",
        "/d",
        String(snapshot.ProxyServer).trim(),
        "/f",
      ]);
    } else {
      await execFileP("reg", [
        "delete",
        WINDOWS_PROXY_KEY,
        "/v",
        "ProxyServer",
        "/f",
      ]).catch(() => {});
    }

    if (snapshot.ProxyOverride && String(snapshot.ProxyOverride).trim()) {
      await execFileP("reg", [
        "add",
        WINDOWS_PROXY_KEY,
        "/v",
        "ProxyOverride",
        "/t",
        "REG_SZ",
        "/d",
        String(snapshot.ProxyOverride).trim(),
        "/f",
      ]);
    } else {
      await execFileP("reg", [
        "delete",
        WINDOWS_PROXY_KEY,
        "/v",
        "ProxyOverride",
        "/f",
      ]).catch(() => {});
    }

    if (snapshot.AutoConfigURL && String(snapshot.AutoConfigURL).trim()) {
      await execFileP("reg", [
        "add",
        WINDOWS_PROXY_KEY,
        "/v",
        "AutoConfigURL",
        "/t",
        "REG_SZ",
        "/d",
        String(snapshot.AutoConfigURL).trim(),
        "/f",
      ]);
    } else {
      await execFileP("reg", [
        "delete",
        WINDOWS_PROXY_KEY,
        "/v",
        "AutoConfigURL",
        "/f",
      ]).catch(() => {});
    }

    if (snapshot.AutoDetect != null) {
      const detect = parseWindowsDword(snapshot.AutoDetect, 1);
      await execFileP("reg", [
        "add",
        WINDOWS_PROXY_KEY,
        "/v",
        "AutoDetect",
        "/t",
        "REG_DWORD",
        "/d",
        String(detect),
        "/f",
      ]);
    } else {
      await execFileP("reg", [
        "delete",
        WINDOWS_PROXY_KEY,
        "/v",
        "AutoDetect",
        "/f",
      ]).catch(() => {});
    }

    return true;
  }

  throw new Error("当前平台暂不支持自动恢复系统代理");
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