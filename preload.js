// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mitm", {
  loadConfig: () => ipcRenderer.invoke("load-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),

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
});