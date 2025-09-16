// scripts/afterPack.js
// 仅做必要的权限修正，确保内置 mitmproxy.app 的可执行文件有 +x。
const fs = require("fs");
const path = require("path");

function chmodIfExists(p) {
  try {
    if (fs.existsSync(p)) {
      fs.chmodSync(p, 0o755);
      console.log("[afterPack] chmod +x:", p);
    }
  } catch (e) {
    console.warn("[afterPack] chmod failed:", p, e.message);
  }
}

// 递归给 MacOS 目录下的可执行文件加权限
function chmodExecutablesIn(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isFile()) {
      chmodIfExists(p);
    }
  }
}

exports.default = async function afterPack(context) {
  const resourcesDir = context.appOutDir
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.electronPlatformName === "darwin" ? "dist/mac-arm64" : "dist", "Contents", "Resources");

  console.log("[afterPack] resources:", resourcesDir);

  // 内置 mitmproxy.app 路径
  const mitmApp = path.join(resourcesDir, "mitmproxy.app");
  const mitmMacOSDir = path.join(mitmApp, "Contents", "MacOS");

  // 关键：给 mitmproxy.app 的二进制加可执行
  chmodExecutablesIn(mitmMacOSDir);

  // 你的注入脚本也确保可读（可不加；这里保持一行记录）
  const injector = path.join(resourcesDir, "figcn_injector.py");
  try {
    if (fs.existsSync(injector)) {
      fs.chmodSync(injector, 0o644);
      console.log("[afterPack] set 644:", injector);
    }
  } catch (e) {
    console.warn("[afterPack] injector chmod failed:", e.message);
  }

  // 提示：如需在分发前去除隔离标记，可手动执行（不在打包阶段自动跑）：
  //   xattr -dr com.apple.quarantine "<App>.app"
};