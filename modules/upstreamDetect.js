// modules/upstreamDetect.js
const os = require("os");
const http = require("http");
const https = require("https");
const net = require("net");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

const WINDOWS_PROXY_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const h = url.startsWith("https:") ? https : http;
    h.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchText(res.headers.location));
      }
      let data = ""; res.on("data", c => data += c); res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

async function resolveFromPAC(pacUrl, testUrl) {
  let createPacResolver;
  try { createPacResolver = require("pac-resolver"); } catch { return null; }
  try {
    const pacText = await fetchText(pacUrl);
    const FindProxyForURL = createPacResolver(pacText);
    const rule = await FindProxyForURL(testUrl || "https://www.figma.com/");
    const firstRaw = (rule || "").split(";")[0].trim();
    const FIRST = firstRaw.toUpperCase();
    if (FIRST.startsWith("PROXY ")) return `http://${firstRaw.slice(6).trim()}`;
    if (FIRST.startsWith("HTTPS ")) return `https://${firstRaw.slice(6).trim()}`;
    if (FIRST.startsWith("SOCKS")) {
      const hp = firstRaw.split(/\s+/)[1];
      const ver = FIRST.startsWith("SOCKS5") ? "socks5" : "socks4";
      return `${ver}://${hp}`;
    }
  } catch { /* ignore */ }
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
  const platform = os.platform();

  if (platform === "darwin") {
    try {
      const { stdout } = await execFileP("scutil", ["--proxy"]);
      const kv = {};
      stdout.split("\n").forEach((line) => {
        const m = line.match(/^\s*(\S+)\s*:\s*(.+)\s*$/);
        if (m) kv[m[1]] = m[2];
      });
      if (kv.ProxyAutoConfigEnable === "1" && kv.ProxyAutoConfigURLString) {
        const pac = await resolveFromPAC(kv.ProxyAutoConfigURLString.trim(), testUrl);
        if (pac) return pac;
      }
      if (kv.HTTPSEnable === "1" && kv.HTTPSProxy && kv.HTTPSPort) {
        return `http://${kv.HTTPSProxy}:${kv.HTTPSPort}`;
      }
      if (kv.HTTPEnable === "1" && kv.HTTPProxy && kv.HTTPPort) {
        return `http://${kv.HTTPProxy}:${kv.HTTPPort}`;
      }
    } catch { /* ignore */ }
  }

  if (platform === "win32") {
    try {
      const { stdout } = await execFileP("reg", ["query", WINDOWS_PROXY_KEY]);
      let proxyEnable = false;
      let proxyServer = "";
      let autoConfig = "";
      stdout.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^(?:\s*)(ProxyEnable|ProxyServer|AutoConfigURL)\s+REG_\S+\s+(.+)$/i);
        if (m) {
          const key = m[1].toLowerCase();
          const val = m[2].trim();
          if (key === "proxyenable") proxyEnable = /^0x1$/i.test(val) || val === "1";
          if (key === "proxyserver") proxyServer = val;
          if (key === "autoconfigurl") autoConfig = val;
        }
      });
      if (autoConfig) {
        const pac = await resolveFromPAC(autoConfig.trim(), testUrl);
        if (pac) return pac;
      }
      if (proxyEnable && proxyServer) {
        const candidate = normalizeWindowsProxyServer(proxyServer);
        if (candidate) return candidate;
      }
    } catch { /* ignore */ }
  }

  return null;
}

function normalizeWindowsProxyServer(raw) {
  if (!raw) return null;
  const parts = String(raw)
    .split(";")
    .map((seg) => seg.trim())
    .filter(Boolean);
  const map = {};
  let fallback = null;
  for (const seg of parts) {
    const eq = seg.indexOf("=");
    if (eq >= 0) {
      const key = seg.slice(0, eq).trim().toLowerCase();
      const val = seg.slice(eq + 1).trim();
      if (val) map[key] = val;
    } else if (!fallback) {
      fallback = seg;
    }
  }
  const pick = map.https || map.http || fallback || Object.values(map)[0];
  if (!pick) return null;
  if (/^(https?|socks5?|socks4?):\/\//i.test(pick)) return pick;
  return `http://${pick}`;
}

async function probeLocalCandidates() {
  const candidates = [
    "http://127.0.0.1:7890",
    "http://127.0.0.1:7897",
    "http://127.0.0.1:8889",
    "http://127.0.0.1:1080",
    "http://127.0.0.1:8001",
  ];
  for (const url of candidates) {
    try {
      const { hostname, port } = new URL(url);
      const ok = await probeHttpProxy(hostname, Number(port));
      if (ok) return url;
    } catch { /* ignore */ }
  }
  return null;
}

async function autoDetectUpstream(testUrl = "https://www.figma.com/") {
  try {
    const sys = await getSystemProxyCandidate(testUrl);
    if (sys) return { upstream: sys };
    const local = await probeLocalCandidates();
    if (local) return { upstream: local };
    return { upstream: "", error: null };
  } catch (e) {
    return { upstream: "", error: String(e) };
  }
}

module.exports = { autoDetectUpstream };