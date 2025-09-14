const $ = (id) => document.getElementById(id);
const consoleEl = $("console");

function appendLog(text) {
  consoleEl.textContent += text;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

async function load() {
  const cfg = await window.mitm.loadConfig();

  $("mode").value = cfg.mode || "regular";
  $("host").value = cfg.listenHost || "0.0.0.0";
  $("port").value = cfg.port ?? 8080;
  $("upstream").value = cfg.upstream || "";
  $("scripts").value = cfg.scripts || "";
  $("extraArgs").value = cfg.extraArgs || "";
  $("mitmPath").value = cfg.mitmPath || "";
  $("mitmWebPath").value = cfg.mitmWebPath || "";

  window.mitm.onLog((line) => appendLog(line));
}

function collectConfig() {
  return {
    mode: $("mode").value,
    listenHost: $("host").value.trim() || "0.0.0.0",
    port: Number($("port").value) || 8080,
    upstream: $("upstream").value.trim(),
    scripts: $("scripts").value.trim(),
    extraArgs: $("extraArgs").value.trim(),
    mitmPath: $("mitmPath").value.trim() || "mitmproxy",
    mitmWebPath: $("mitmWebPath").value.trim() || "mitmweb"
  };
}

$("startBtn").addEventListener("click", async () => {
  appendLog("\n=== 启动 mitmproxy ===\n");
  try {
    await window.mitm.start(collectConfig());
  } catch (e) {
    appendLog("[启动失败] " + e + "\n");
  }
});

$("stopBtn").addEventListener("click", async () => {
  appendLog("\n=== 停止 mitmproxy ===\n");
  try {
    await window.mitm.stop();
  } catch (e) {
    appendLog("[停止失败] " + e + "\n");
  }
});

$("saveBtn").addEventListener("click", async () => {
  try {
    await window.mitm.saveConfig(collectConfig());
    appendLog("[配置已保存]\n");
  } catch (e) {
    appendLog("[保存失败] " + e + "\n");
  }
});

window.addEventListener("DOMContentLoaded", load);