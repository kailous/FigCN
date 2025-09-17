// renderer.js — 精简版（移除 mode / extraArgs / btnSave / btnReload）

// 小工具
const $ = (sel) => document.querySelector(sel);
const appendLog = (t) => {
  const ta = $("#log");
  if (!ta) return;
  ta.value += t.endsWith("\n") ? t : t + "\n";
  ta.scrollTop = ta.scrollHeight;
};

// 订阅后端日志（如果有）
if (window.mitm?.onLog) {
  window.mitm.onLog((line) => appendLog(line));
}

// 只读判断：系统代理是否指向 host:port
function isSelfProxy(sysProxy, host, port) {
  if (!sysProxy || !host || !port) return false;
  const eq = (h, p) => h === host && Number(p) === Number(port);
  const hitHttp  = sysProxy.http?.enabled  && eq(sysProxy.http.host,  sysProxy.http.port);
  const hitHttps = sysProxy.https?.enabled && eq(sysProxy.https.host, sysProxy.https.port);
  return Boolean(hitHttp || hitHttps);
}

// 把表单状态 -> 配置对象（不包含 mode/extraArgs）
function readFormToConfig(baseCfg) {
  const cfg = { ...(baseCfg || {}) };
  cfg.listenHost = ($("#listenHost")?.value || "").trim() || "127.0.0.1";
  cfg.port = Number($("#port")?.value || 8080);

  const enabled = $("#upstreamToggle")?.checked;
  const val = ($("#upstreamInput")?.value || "").trim();
  cfg.upstream = enabled && val ? val : "";

  // 保持兼容字段（空）
  cfg.extraArgs = "";
  cfg.mode = "regular";
  return cfg;
}

// 配置 -> 表单（精简）
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

// 开关上游代理
$("#upstreamToggle")?.addEventListener("change", async () => {
  const on = $("#upstreamToggle").checked;
  if ($("#upstreamInput")) $("#upstreamInput").disabled = !on;
  if ($("#btnDetect")) $("#btnDetect").disabled = !on;

  if (!window.mitm?.loadConfig || !window.mitm?.saveConfig) return;
  const cfg = await window.mitm.loadConfig();

  if (!on) {
    // 关闭：清空上游并保存
    await window.mitm.saveConfig({ ...cfg, upstream: "" });
    return;
  }

  // 勾选：先检查系统代理是否指向本机监听（避免自指环路）
  try {
    if (window.mitm?.getSystemProxy) {
      const sysProxy = await window.mitm.getSystemProxy();
      const host = ($("#listenHost")?.value || cfg.listenHost || "127.0.0.1").trim();
      const port = Number($("#port")?.value || cfg.port || 8080);
      if (isSelfProxy(sysProxy, host, port)) {
        // 回滚 UI 状态
        $("#upstreamToggle").checked = false;
        if ($("#upstreamInput")) $("#upstreamInput").disabled = true;
        if ($("#btnDetect")) $("#btnDetect").disabled = true;

        appendLog("[上游代理] 当前系统代理已指向本机监听端口，避免自指环路。请先关闭系统代理或点击“停止”自动恢复，再勾选上游代理。");
        alert("当前系统代理已指向本机监听端口，避免自指环路。\n请先关闭系统代理或点击“停止”自动恢复，再勾选上游代理。");
        return;
      }
    }
  } catch (e) {
    // 查询失败不致命，继续进行侦测
    appendLog("[上游] 检查系统代理失败：" + String(e));
  }

  // 自动侦测上游代理并保存
  if (window.mitm?.autoDetectUpstream) {
    appendLog("[AutoDetect] 正在侦测系统/PAC/常见端口…");
    try {
      const { upstream, error } = await window.mitm.autoDetectUpstream("https://www.figma.com/");
      if (upstream) {
        if ($("#upstreamInput")) $("#upstreamInput").value = upstream;
        appendLog(`[AutoDetect] 发现上游代理：${upstream}`);
        await window.mitm.saveConfig({ ...cfg, upstream });
      } else {
        appendLog(`[AutoDetect] 未发现可用上游${error ? "：" + error : ""}`);
        // 没发现上游也要保存“开启但值为空”的状态吗？这里不强制保存，留在输入框由用户填
      }
    } catch (e) {
      appendLog(`[AutoDetect] 失败：${String(e)}`);
    }
  }
});

// 侦测上游代理（自动写回并保存）
$("#btnDetect")?.addEventListener("click", async () => {
  if (!window.mitm?.autoDetectUpstream || !window.mitm?.loadConfig || !window.mitm?.saveConfig) return;
  $("#btnDetect").disabled = true;
  appendLog("[AutoDetect] 正在侦测系统/PAC/常见端口…");
  try {
    const { upstream, error } = await window.mitm.autoDetectUpstream("https://www.figma.com/");
    if (upstream) {
      if ($("#upstreamInput")) $("#upstreamInput").value = upstream;
      appendLog(`[AutoDetect] 发现上游代理：${upstream}`);
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

// 启动：保存配置 -> 启动 mitm -> 启动成功后自动设置系统代理（若有接口）
$("#btnStart")?.addEventListener("click", async () => {
  if (!window.mitm?.start || !window.mitm?.loadConfig || !window.mitm?.saveConfig) return;

  const current = await window.mitm.loadConfig();
  const cfg = readFormToConfig(current);

  // 校验上游协议
  if ($("#upstreamToggle")?.checked) {
    const u = cfg.upstream;
    if (u && !/^(https?|socks5?|socks4?):\/\//i.test(u)) {
      alert("上游代理地址需要以 http://、https://、socks5:// 或 socks4:// 开头");
      return;
    }
  }

  try {
    await window.mitm.saveConfig(cfg);
    const ok = await window.mitm.start(cfg);
    if (ok) appendLog("[Start] 代理已启动。");

    // 自动设置系统代理为本机监听地址（若后端暴露接口）
    if (window.mitm?.setSystemProxy) {
      const host = cfg.listenHost || "127.0.0.1";
      const port = Number(cfg.port || 8080);
      appendLog(`[系统代理] 正在设置为 ${host}:${port}（可能需要一次授权）...`);
      try {
        await window.mitm.setSystemProxy(host, port);
        appendLog("[系统代理] 设置完成。");
      } catch (e) {
        appendLog("[系统代理] 设置失败：" + String(e));
      }
    }
  } catch (e) {
    appendLog("[Start] 启动失败：" + e);
    alert("启动失败，详见日志。");
  }
});

// 停止：停止 mitm -> 自动恢复系统代理（若后端暴露接口）
$("#btnStop")?.addEventListener("click", async () => {
  if (!window.mitm?.stop) return;
  try {
    await window.mitm.stop();
  } finally {
    appendLog("[Stop] 代理已停止。");

    if (window.mitm?.restoreSystemProxy) {
      appendLog("[系统代理] 正在恢复此前备份的系统代理设置...");
      try {
        await window.mitm.restoreSystemProxy();
        appendLog("[系统代理] 已恢复。");
      } catch (e) {
        appendLog("[系统代理] 恢复失败：" + String(e));
      }
    }
  }
});

// 如果你保留了手动按钮（兼容），仍支持手动设置/恢复
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

document.getElementById("btnInstallCA")?.addEventListener("click", async () => {
  try {
    appendLog("[证书] 正在生成并安装根证书（需要一次系统授权）...");
    const res = await window.mitm.installCA();
    appendLog(`[证书] 安装完成：${res.caFile}`);
  } catch (e) {
    appendLog("[证书] 安装失败：" + String(e));
  }
});