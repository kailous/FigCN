// 小工具
const $ = (sel) => document.querySelector(sel);
const appendLog = (t) => {
  const ta = $("#log");
  if (!ta) return;
  ta.value += t.endsWith("\n") ? t : t + "\n";
  ta.scrollTop = ta.scrollHeight;
};

// 订阅后端日志
if (window.mitm?.onLog) {
  window.mitm.onLog((line) => appendLog(line));
}

// 把表单状态 -> 配置对象（已去掉 mode/extraArgs）
function readFormToConfig(baseCfg) {
  const cfg = { ...(baseCfg || {}) };
  cfg.listenHost = ($("#listenHost")?.value || "").trim() || "127.0.0.1";
  cfg.port = Number($("#port")?.value || 8080);

  // 上游代理开关逻辑
  const enabled = $("#upstreamToggle")?.checked;
  const val = ($("#upstreamInput")?.value || "").trim();
  cfg.upstream = enabled && val ? val : ""; // 只有勾选且非空才传给后端
  // extraArgs / mode 已移除
  cfg.extraArgs = ""; 
  cfg.mode = "regular";
  return cfg;
}

// 配置 -> 表单（已去掉 mode/extraArgs）
function writeConfigToForm(cfg) {
  if ($("#listenHost")) $("#listenHost").value = cfg.listenHost || "127.0.0.1";
  if ($("#port")) $("#port").value = cfg.port ?? 8080;

  const enabled = Boolean(cfg.upstream && String(cfg.upstream).trim());
  if ($("#upstreamToggle")) $("#upstreamToggle").checked = enabled;
  if ($("#upstreamInput")) {
    $("#upstreamInput").value = cfg.upstream || "";
    $("#upstreamInput").disabled = !enabled;
  }
  if ($("#btnDetect")) $("#btnDetect").disabled = !enabled;
}

// 初始化：加载配置并写入表单
let bootCfg = null;
(async () => {
  if (!window.mitm?.loadConfig) return;
  bootCfg = await window.mitm.loadConfig();
  writeConfigToForm(bootCfg);
})();

// 事件：开关上游代理
$("#upstreamToggle")?.addEventListener("change", async () => {
  const on = $("#upstreamToggle").checked;
  if ($("#upstreamInput")) $("#upstreamInput").disabled = !on;
  if ($("#btnDetect")) $("#btnDetect").disabled = !on;

  // 同步保存：如果关掉则清空 upstream
  if (!window.mitm?.loadConfig || !window.mitm?.saveConfig) return;
  const cfg = await window.mitm.loadConfig();
  await window.mitm.saveConfig(on ? cfg : { ...cfg, upstream: "" });
});

// 事件：侦测上游代理（自动写回）
$("#btnDetect")?.addEventListener("click", async () => {
  if (!window.mitm?.autoDetectUpstream || !window.mitm?.loadConfig || !window.mitm?.saveConfig) return;
  $("#btnDetect").disabled = true;
  appendLog("[AutoDetect] 正在侦测系统/PAC/常见端口…");
  try {
    const { upstream, error } = await window.mitm.autoDetectUpstream("https://www.figma.com/");
    if (upstream) {
      if ($("#upstreamInput")) $("#upstreamInput").value = upstream; // 自动填入
      appendLog(`[AutoDetect] 发现上游代理：${upstream}`);
      // 顺便保存配置（保持勾选状态）
      const cfg = await window.mitm.loadConfig();
      await window.mitm.saveConfig({ ...cfg, upstream });
    } else {
      appendLog(`[AutoDetect] 未发现可用上游${error ? "：" + error : ""}`);
    }
  } catch (e) {
    appendLog(`[AutoDetect] 失败：${String(e)}`);
  } finally {
    $("#btnDetect").disabled = !($("#upstreamToggle")?.checked);
  }
});

// 事件：启动
$("#btnStart")?.addEventListener("click", async () => {
  if (!window.mitm?.start || !window.mitm?.loadConfig || !window.mitm?.saveConfig) return;

  const current = await window.mitm.loadConfig();
  const cfg = readFormToConfig(current);

  // 简单校验（如果启用上游则校验协议）
  if ($("#upstreamToggle")?.checked) {
    const u = cfg.upstream;
    if (u && !/^(https?|socks5?|socks4?):\/\//i.test(u)) {
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
$("#btnStop")?.addEventListener("click", async () => {
  if (!window.mitm?.stop) return;
  try {
    await window.mitm.stop();
  } finally {
    appendLog("[Stop] 代理已停止。");
  }
});

// 事件：保存配置
$("#btnSave")?.addEventListener("click", async () => {
  if (!window.mitm?.loadConfig || !window.mitm?.saveConfig) return;
  const current = await window.mitm.loadConfig();
  const cfg = readFormToConfig(current);
  await window.mitm.saveConfig(cfg);
  appendLog("[Config] 已保存。");
});

// 事件：重新载入配置
$("#btnReload")?.addEventListener("click", async () => {
  if (!window.mitm?.loadConfig) return;
  const cfg = await window.mitm.loadConfig();
  writeConfigToForm(cfg);
  appendLog("[Config] 已从文件加载。");
});

// ========= 新增：系统代理 一键设置/恢复 =========
$("#btnSetSysProxy")?.addEventListener("click", async () => {
  if (!window.mitm?.setSystemProxy) {
    appendLog("[系统代理] 未暴露 setSystemProxy 接口，请检查 preload.js");
    return;
  }
  const host = ($("#listenHost")?.value || "127.0.0.1").trim();
  const port = Number($("#port")?.value || 8080);
  if (!host || !port) return appendLog("[系统代理] 缺少监听地址或端口。");

  try {
    appendLog(`[系统代理] 正在设置为 ${host}:${port}（需要授权）...`);
    await window.mitm.setSystemProxy(host, port);
    appendLog("[系统代理] 设置完成。");
  } catch (e) {
    appendLog("[系统代理] 设置失败：" + String(e));
  }
});

$("#btnRestoreSysProxy")?.addEventListener("click", async () => {
  if (!window.mitm?.restoreSystemProxy) {
    appendLog("[系统代理] 未暴露 restoreSystemProxy 接口，请检查 preload.js");
    return;
  }
  try {
    appendLog("[系统代理] 正在恢复此前备份的系统代理（需要授权）...");
    await window.mitm.restoreSystemProxy();
    appendLog("[系统代理] 已恢复。");
  } catch (e) {
    appendLog("[系统代理] 恢复失败：" + String(e));
  }
});