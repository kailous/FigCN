// modules/config.js
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(app.getPath("userData"), "mitm-config.json");

function defaultConfig() {
  return {
    listenHost: "127.0.0.1",
    port: 8080,
    upstream: "",
    extraArgs: "",
  };
}

async function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch {}
  return defaultConfig();
}

async function saveConfig(cfg) {
  const merged = { ...defaultConfig(), ...(cfg || {}) };
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf8");
  return true;
}

module.exports = { loadConfig, saveConfig, defaultConfig, CONFIG_FILE };