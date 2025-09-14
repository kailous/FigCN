// 小工具
const $ = (sel) => document.querySelector(sel);
const appendLog = (t) => {
  const ta = $("#log");
  ta.value += t.endsWith("\n") ? t : t + "\n";
  ta.scrollTop = ta.scrollHeight;
};

// 订阅后端日志
window.mitm.onLog((line) => appendLog(line));

// 把表单状态 -> 配置对象
function readFormToConfig(baseCfg) {
  const cfg = { ...(baseCfg || {}) };
  cfg.listenHost = $("#listenHost").value.trim() || "127.0.0.1";
  cfg.port = Number($("#port").value) || 8080;
  cfg.mode = $("#mode").value || "regular";
  cfg.extraArgs = $("#extraArgs").value || "";

  // 上游代理开关逻辑
  const enabled = $("#upstreamToggle").checked;
  const val = $("#upstreamInput").value.trim();
  cfg.upstream = enabled && val ? val : ""; // 只有勾选且非空才传给后端
  return cfg;
}

// 配置 -> 表单
function writeConfigToForm(cfg) {
  $("#listenHost").value = cfg.listenHost || "127.0.0.1";
  $("#port").value = cfg.port ?? 8080;
  $("#mode").value = cfg.mode || "regular";
  $("#extraArgs").value = cfg.extraArgs || "";

  const enabled = Boolean(cfg.upstream && cfg.upstream.trim());
  $("#upstreamToggle").checked = enabled;
  $("#upstreamInput").value = cfg.upstream || "";
  $("#upstreamInput").disabled = !enabled;
  $("#btnDetect").disabled = !enabled;
}

// 初始化：加载配置并写入表单
let bootCfg = null;
(async () => {
  bootCfg = await window.mitm.loadConfig();
  writeConfigToForm(bootCfg);
})();

// 事件：开关上游代理
$("#upstreamToggle").addEventListener("change", async () => {
  const on = $("#upstreamToggle").checked;
  $("#upstreamInput").disabled = !on;
  $("#btnDetect").disabled = !on;

  // 同步保存：如果关掉则清空 upstream
  const cfg = await window.mitm.loadConfig();
  if (!on) cfg.upstream = "";
  await window.mitm.saveConfig(on ? cfg : { ...cfg, upstream: "" });
});

// 事件：侦测上游代理（自动写回）
$("#btnDetect").addEventListener("click", async () => {
  $("#btnDetect").disabled = true;
  appendLog("[AutoDetect] 正在侦测系统/PAC/常见端口…");
  const { upstream, error } = await window.mitm.autoDetectUpstream("https://www.figma.com/");
  $("#btnDetect").disabled = false;

  if (upstream) {
    $("#upstreamInput").value = upstream; // 自动填入
    appendLog(`[AutoDetect] 发现上游代理：${upstream}`);
    // 顺便保存配置（保持勾选状态）
    const cfg = await window.mitm.loadConfig();
    await window.mitm.saveConfig({ ...cfg, upstream });
  } else {
    appendLog(`[AutoDetect] 未发现可用上游${error ? "：" + error : ""}`);
  }
});

// 事件：启动
$("#btnStart").addEventListener("click", async () => {
  const current = await window.mitm.loadConfig();
  const cfg = readFormToConfig(current);

  // 简单校验（如果启用上游则校验协议）
  if ($("#upstreamToggle").checked) {
    const u = cfg.upstream;
    if (u && !/^(https?|socks[45]?):\/\//i.test(u)) {
      alert("上游代理地址需要以 http://、https://、socks5:// 或 socks4:// 开头");
      return;
    }
  }

  try {
    await window.mitm.saveConfig(cfg); // 启动前保存
    const ok = await window.mitm.start(cfg);
    if (ok) appendLog("[Start] 代理已启动。");
  } catch (e) {
    appendLog("[Start] 启动失败：" + e);
    alert("启动失败，详见日志。");
  }
});

// 事件：停止
$("#btnStop").addEventListener("click", async () => {
  await window.mitm.stop();
  appendLog("[Stop] 代理已停止。");
});

// 事件：保存配置
$("#btnSave").addEventListener("click", async () => {
  const current = await window.mitm.loadConfig();
  const cfg = readFormToConfig(current);
  await window.mitm.saveConfig(cfg);
  appendLog("[Config] 已保存。");
});

// 事件：重新载入配置
$("#btnReload").addEventListener("click", async () => {
  const cfg = await window.mitm.loadConfig();
  writeConfigToForm(cfg);
  appendLog("[Config] 已从文件加载。");
});