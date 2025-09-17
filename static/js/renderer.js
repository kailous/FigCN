// renderer.js — 精简 + 托盘菜单支持

const $ = (sel) => document.querySelector(sel);
const appendLog = (t) => {
  const ta = $("#log");
  if (!ta) return;
  ta.value += t.endsWith("\n") ? t : t + "\n";
  ta.scrollTop = ta.scrollHeight;
};

// 日志订阅
window.mitm?.onLog?.((line) => appendLog(line));

// 表单 <-> 配置
function readFormToConfig(baseCfg) {
  const cfg = { ...(baseCfg || {}) };
  cfg.listenHost = ($("#listenHost")?.value || "").trim() || "127.0.0.1";
  cfg.port = Number($("#port")?.value || 8080);

  const enabled = $("#upstreamToggle")?.checked;
  const val = ($("#upstreamInput")?.value || "").trim();
  cfg.upstream = enabled && val ? val : "";

  cfg.extraArgs = "";
  cfg.mode = "regular";
  return cfg;
}

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

// 初始化
let bootCfg = null;
(async () => {
  if (!window.mitm?.loadConfig) return;
  bootCfg = await window.mitm.loadConfig();
  writeConfigToForm(bootCfg);
})();

// —— 开关上游：保存/清空 upstream，控制输入可用 ——
// 另外：如果当前系统代理就是本 app 的监听地址，阻止开启并提示（避免自引用死循环）
$("#upstreamToggle")?.addEventListener("change", async () => {
  const on = $("#upstreamToggle").checked;
  if ($("#upstreamInput")) $("#upstreamInput").disabled = !on;
  if ($("#btnDetect")) $("#btnDetect").disabled = !on;

  if (!window.mitm?.loadConfig || !window.mitm?.saveConfig) return;

  if (on && window.mitm?.getSystemProxy) {
    try {
      const sys = await window.mitm.getSystemProxy(); // {services:[{web:{enabled,host,port}, secure:{...}}]}
      const host = ($("#listenHost")?.value || "127.0.0.1").trim();
      const port = Number($("#port")?.value || 8080);
      const isSelf = (sys?.services || []).some(svc => {
        const w = svc.web || {};
        const s = svc.secure || {};
        return (w.enabled && w.host === host && Number(w.port) === port) ||
               (s.enabled && s.host === host && Number(s.port) === port);
      });
      if (isSelf) {
        $("#upstreamToggle").checked = false;
        if ($("#upstreamInput")) $("#upstreamInput").disabled = true;
        if ($("#btnDetect")) $("#btnDetect").disabled = true;
        appendLog("[上游] 检测到系统代理已指向本程序监听端口，请先『停止代理并恢复系统代理』后再开启上游。");
        alert("检测到系统代理已指向本程序监听端口。\n请先停止代理并恢复系统代理，再开启『上游代理』以避免循环代理。");
        return;
      }
      // 自动侦测一次
      $("#btnDetect")?.click();
    } catch { /* 忽略侦测错误 */ }
  }

  const cfg = await window.mitm.loadConfig();
  await window.mitm.saveConfig(on ? cfg : { ...cfg, upstream: "" });
});

// —— 侦测上游 —— 自动写回 upstream
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

// —— 抽成可复用函数（按钮 & 托盘菜单共用）——
async function doStartProxy() {
  if (!window.mitm?.start || !window.mitm?.loadConfig || !window.mitm?.saveConfig) return;

  const current = await window.mitm.loadConfig();
  const cfg = readFormToConfig(current);

  // 上游协议校验
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

    // 自动设置系统代理
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
}

async function doStopProxy() {
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
}

async function doInstallCA() {
  try {
    appendLog("[证书] 正在生成并安装根证书（需要一次系统授权）...");
    const res = await window.mitm.installCA();
    appendLog(`[证书] 安装完成：${res.caFile}`);
  } catch (e) {
    appendLog("[证书] 安装失败：" + String(e));
  }
}

// —— 按钮绑定 —— 
$("#btnStart")?.addEventListener("click", doStartProxy);
$("#btnStop")?.addEventListener("click", doStopProxy);
document.getElementById("btnInstallCA")?.addEventListener("click", doInstallCA);

// —— 托盘菜单绑定 —— 
window.menu?.onStart(() => doStartProxy());
window.menu?.onStop(() => doStopProxy());
window.menu?.onInstallCA(() => doInstallCA());

// —— 兼容：手动设置/恢复按钮（如保留）
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