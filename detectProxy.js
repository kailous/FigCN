// detectProxy.js
const { execFile } = require("child_process");
const os = require("os");
const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const { promisify } = require("util");

const execFileP = promisify(execFile);

// 解析 PAC 并针对特定 URL 求解代理
async function resolveFromPAC(pacUrl, testUrl) {
  const getBody = (url) =>
    new Promise((resolve, reject) => {
      const h = url.startsWith("https:") ? https : http;
      h.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(getBody(res.headers.location));
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      }).on("error", reject);
    });

  const pacText = await getBody(pacUrl);
  // 延迟加载以避免可选依赖在没用到时报错
  const createPacResolver = require("pac-resolver");
  const FindProxyForURL = createPacResolver(pacText);
  const rule = await FindProxyForURL(testUrl);
  // 例如: "PROXY 127.0.0.1:7890; DIRECT"
  const first = rule.split(";")[0].trim();
  if (first.toUpperCase().startsWith("PROXY ")) {
    const hp = first.slice(6).trim();
    return `http://${hp}`;
  }
  if (first.toUpperCase().startsWith("HTTPS ")) {
    const hp = first.slice(6).trim();
    return `https://${hp}`;
  }
  if (first.toUpperCase().startsWith("SOCKS")) {
    const hp = first.split(/\s+/)[1];
    // mitmproxy 也支持 socks 上游：socks5://host:port
    const ver = first.toUpperCase().startsWith("SOCKS5") ? "socks5" : "socks4";
    return `${ver}://${hp}`;
  }
  return null;
}

// 验证一个代理（HTTP 类型）：发起 CONNECT，看是否 200
async function probeHttpProxy(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      const payload = "CONNECT www.google.com:443 HTTP/1.1\r\nHost: www.google.com:443\r\n\r\n";
      socket.write(payload);
    });
    const to = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once("error", () => { clearTimeout(to); resolve(false); });
    socket.once("data", (buf) => {
      clearTimeout(to);
      const ok = /^HTTP\/\d\.\d 200/i.test(String(buf));
      socket.destroy();
      resolve(ok);
    });
  });
}

// 从系统读取代理设置（不同平台）
async function getSystemProxyCandidate(testUrl) {
  const platform = os.platform();

  if (platform === "darwin") {
    // macOS: scutil --proxy
    try {
      const { stdout } = await execFileP("scutil", ["--proxy"]);
      const kv = {};
      stdout.split("\n").forEach((line) => {
        const m = line.match(/^\s*(\S+)\s*:\s*(.+)\s*$/);
        if (m) kv[m[1]] = m[2];
      });
      // PAC 优先
      if (kv.ProxyAutoConfigEnable === "1" && kv.ProxyAutoConfigURLString) {
        const pacUrl = kv.ProxyAutoConfigURLString.trim();
        const resolved = await resolveFromPAC(pacUrl, testUrl);
        if (resolved) return resolved;
      }
      // HTTPS 其次
      if (kv.HTTPSEnable === "1" && kv.HTTPSProxy && kv.HTTPSPort) {
        return `http://${kv.HTTPSProxy}:${kv.HTTPSPort}`;
      }
      // HTTP 再次
      if (kv.HTTPEnable === "1" && kv.HTTPProxy && kv.HTTPPort) {
        return `http://${kv.HTTPProxy}:${kv.HTTPPort}`;
      }
    } catch (_) {}
  }

  if (platform === "win32") {
    // Windows: 读注册表（当前用户）
    try {
      const { stdout } = await execFileP("reg", [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      ]);
      const get = (key) => {
        const re = new RegExp(`\\s${key}\\s+REG_\\w+\\s+(.+)`);
        const m = stdout.match(re);
        return m ? m[1].trim() : "";
      };
      const ProxyEnable = get("ProxyEnable");
      const ProxyServer = get("ProxyServer");
      const AutoConfigURL = get("AutoConfigURL");

      // PAC 优先
      if (AutoConfigURL) {
        const resolved = await resolveFromPAC(AutoConfigURL, testUrl);
        if (resolved) return resolved;
      }
      if (ProxyEnable === "0x1" && ProxyServer) {
        // 可能是 "http=host:port;https=host:port" 或 "host:port"
        if (ProxyServer.includes("=")) {
          const map = Object.fromEntries(
            ProxyServer.split(";").map((kv) => {
              const [k, v] = kv.split("=");
              return [k.toLowerCase(), v];
            })
          );
          if (map.https) return `http://${map.https}`;
          if (map.http) return `http://${map.http}`;
        } else {
          return `http://${ProxyServer}`;
        }
      }
    } catch (_) {}
  }

  // Linux 常见：环境变量 / GNOME gsettings
  try {
    const envHttps = process.env.HTTPS_PROXY || process.env.https_proxy;
    const envHttp = process.env.HTTP_PROXY || process.env.http_proxy;
    if (envHttps) return envHttps;
    if (envHttp) return envHttp;
  } catch (_) {}

  // GNOME
  if (platform === "linux") {
    try {
      const { stdout: modeOut } = await execFileP("gsettings", [
        "get",
        "org.gnome.system.proxy",
        "mode",
      ]);
      if (modeOut.includes("'auto'")) {
        const { stdout: pacOut } = await execFileP("gsettings", [
          "get",
          "org.gnome.system.proxy",
          "autoconfig-url",
        ]);
        const pacUrl = pacOut.replace(/^[^\']*\'|\'[^\']*$/g, "").trim();
        if (pacUrl) {
          const resolved = await resolveFromPAC(pacUrl, testUrl);
          if (resolved) return resolved;
        }
      }
      if (modeOut.includes("'manual'")) {
        const { stdout: hp } = await execFileP("gsettings", [
          "get",
          "org.gnome.system.proxy.https",
          "host",
        ]);
        const { stdout: pp } = await execFileP("gsettings", [
          "get",
          "org.gnome.system.proxy.https",
          "port",
        ]);
        const host = hp.replace(/'/g, "").trim();
        const port = parseInt(pp.trim(), 10);
        if (host && port) return `http://${host}:${port}`;
      }
    } catch (_) {}
  }

  return null;
}

// 常见本地代理端口扫描
async function probeLocalCandidates() {
  const candidates = [
    "http://127.0.0.1:7890",
    "http://127.0.0.1:7897",
    "http://127.0.0.1:8889",
    "http://127.0.0.1:1080",
    "http://127.0.0.1:8080", // 小心和本 app 冲突，仅作为末位候选
  ];
  for (const url of candidates) {
    const { hostname, port } = new URL(url);
    const ok = await probeHttpProxy(hostname, Number(port));
    if (ok) return url;
  }
  return null;
}

async function detectUpstreamFor(testUrl = "https://www.figma.com/") {
  // 1) 系统级
  const sys = await getSystemProxyCandidate(testUrl);
  if (sys) return sys;
  // 2) 本地常见端口
  const local = await probeLocalCandidates();
  if (local) return local;
  return null;
}

module.exports = { detectUpstreamFor };