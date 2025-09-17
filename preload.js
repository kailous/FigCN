// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mitm", {
  loadConfig: () => ipcRenderer.invoke("load-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  // === 新增：查询系统代理（只读）
  getSystemProxy: () => ipcRenderer.invoke("get-system-proxy"),
  installCA: () => ipcRenderer.invoke('install-mitm-ca'),
  openKeychainAccess: () => ipcRenderer.invoke('open-keychain-access'),
  checkCA: () => ipcRenderer.invoke('check-mitm-ca'),

  start: (cfg) => ipcRenderer.invoke("start-mitm", cfg),
  stop: () => ipcRenderer.invoke("stop-mitm"),

  // 自动探测上游代理（默认针对 Figma 求解）
  autoDetectUpstream: (testUrl) =>
    ipcRenderer.invoke("auto-detect-upstream", testUrl || "https://www.figma.com/"),

  // 订阅日志；返回取消订阅函数
  onLog: (handler) => {
    const listener = (_event, line) => handler(line);
    ipcRenderer.on("mitm-log", listener);
    return () => ipcRenderer.removeListener("mitm-log", listener);
  },

  // 系统代理
  setSystemProxy: (host, port) => ipcRenderer.invoke("set-system-proxy", { host, port }),
  restoreSystemProxy: () => ipcRenderer.invoke("restore-system-proxy"),
});

// ---- 新增：桥接托盘菜单 -> 渲染器 ----
contextBridge.exposeInMainWorld("menu", {
  onStart: (cb) => ipcRenderer.on("ui:menu:start", () => cb?.()),
  onStop: (cb) => ipcRenderer.on("ui:menu:stop", () => cb?.()),
  onInstallCA: (cb) => ipcRenderer.on("ui:menu:install-ca", () => cb?.()),
});