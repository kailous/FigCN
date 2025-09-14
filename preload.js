const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mitm", {
  loadConfig: () => ipcRenderer.invoke("load-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  start: (cfg) => ipcRenderer.invoke("start-mitm", cfg),
  stop: () => ipcRenderer.invoke("stop-mitm"),
  onLog: (cb) => {
    ipcRenderer.removeAllListeners("mitm-log");
    ipcRenderer.on("mitm-log", (_evt, line) => cb(line));
  }
});