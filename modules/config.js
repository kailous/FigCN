// modules/config.js
const { ipcMain, app } = require("electron");
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(app.getPath("userData"), "mitm-config.json");
const defaultConfig = () => ({
  mode: "regular",
  listenHost: "127.0.0.1",
  port: 8080,
  upstream: "",
  scripts: "",
  extraArgs: "",
  mitmPath: "",
  mitmWebPath: "",
});

module.exports = function registerConfig({ sendLog }) {
  ipcMain.handle("load-config", async () => {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      }
    } catch (e) {
      sendLog?.(`[Config] 读取失败：${e}\n`);
    }
    return defaultConfig();
  });

  ipcMain.handle("save-config", async (_evt, cfg) => {
    const merged = { ...defaultConfig(), ...(cfg || {}) };
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf8");
    sendLog?.("[Config] 已保存。\n");
    return true;
  });
};

// 给其他模块复用
module.exports.defaultConfig = defaultConfig;
module.exports.CONFIG_FILE = CONFIG_FILE;