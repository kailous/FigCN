// scripts/afterPack.js
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function safeChmod(p, mode) {
  try { fs.chmodSync(p, mode); } catch {}
}
function deQuarantine(p) {
  try { execFileSync("xattr", ["-dr", "com.apple.quarantine", p]); } catch {}
}

exports.default = async function afterPack(context) {
  const resources = context.appOutDir
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.packager.info.projectDir, "dist", "tmp", "Resources");

  const mitmApp = path.join(resources, "mitmproxy.app");
  const mitmDump = path.join(mitmApp, "Contents", "MacOS", "mitmdump");
  const mitmProxy = path.join(mitmApp, "Contents", "MacOS", "mitmproxy");
  const mitmWeb = path.join(mitmApp, "Contents", "MacOS", "mitmweb");

  // 去掉隔离标记，避免运行时被 Gatekeeper 秒杀（SIGKILL）
  deQuarantine(mitmApp);

  // 确保可执行位
  safeChmod(mitmDump, 0o755);
  safeChmod(mitmProxy, 0o755);
  safeChmod(mitmWeb, 0o755);

  // 也给注入脚本一个一致的权限
  safeChmod(path.join(resources, "figcn_injector.py"), 0o644);

  console.log("[afterPack] mitmproxy.app de-quarantined & binaries chmod +x");
};