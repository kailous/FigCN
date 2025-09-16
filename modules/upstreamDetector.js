// modules/upstreamDetector.js
const { ipcMain } = require("electron");
const os = require("os");
const http = require("http");
const https = require("https");
const net = require("net");

async function resolveFromPAC(pacUrl, testUrl, createPacResolver) {
  const fetchText = (url) =>
    new Promise((resolve, reject) => {
      const h = url.startsWith("https:") ? https : http;
      h.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchText(res.headers.location));
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      }).on("error", reject);
    });

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
  return null;
}

function probeHttpProxy(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.write(
        "CONNECT www.google.com:443 HTTP/1.1\r\nHost: www.google.com:443\r\n\r\n",
      );
    });
    const to = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("error", () => {
      clearTimeout(to);
      resolve(false);
    });
    socket.once("data", (buf) => {
      clearTimeout(to);
      const ok = /^HTTP\/\d\.\d 200/i.test(String(buf));
      socket.destroy();
      resolve(ok);
    });
  });
}

async function getSystemProxyCandidate(testUrl, createPacResolver) {
  if (os.platform() === "darwin") {
    const { execFile } = require("child_process");
    const { promisify } = require("util");
    const execFileP = promisify(execFile);
    try {
      const { stdout } = await execFileP("scutil", ["--proxy"]);
      const kv = {};
      stdout.split("\n").forEach((line) => {
        const m = line.match(/^\s*(\S+)\s*:\s*(.+)\s*$/);
        if (m) kv[m[1]] = m[2];
      });
      if (kv.ProxyAutoConfigEnable === "1" && kv.ProxyAutoConfigURLString && createPacResolver) {
        const pac = await resolveFromPAC(kv.ProxyAutoConfigURLString.trim(), testUrl, createPacResolver);
        if (pac) return pac;
      }
      if (kv.HTTPSEnable === "1" && kv.HTTPSProxy && kv.HTTPSPort)
        return `http://${kv.HTTPSProxy}:${kv.HTTPSPort}`;
      if (kv.HTTPEnable === "1" && kv.HTTPProxy && kv.HTTPPort)
        return `http://${kv.HTTPProxy}:${kv.HTTPPort}`;
    } catch {}
  }
  return null;
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
    } catch {}
  }
  return null;
}

module.exports = function registerUpstream({ sendLog }) {
  ipcMain.handle("auto-detect-upstream", async (_evt, testUrl) => {
    let createPacResolver = null;
    try {
      createPacResolver = require("pac-resolver"); // 仅在需要时加载
    } catch {}

    try {
      const sys = await getSystemProxyCandidate(testUrl || "https://www.figma.com/", createPacResolver);
      if (sys) {
        sendLog?.(`[AutoDetect] 发现系统代理：${sys}\n`);
        return { upstream: sys };
      }
      const local = await probeLocalCandidates();
      if (local) {
        sendLog?.(`[AutoDetect] 发现本地常用端口代理：${local}\n`);
        return { upstream: local };
      }
      sendLog?.("[AutoDetect] 未发现可用上游\n");
      return { upstream: null };
    } catch (e) {
      sendLog?.(`[AutoDetect] 失败：${String(e)}\n`);
      return { upstream: null, error: String(e) };
    }
  });
};