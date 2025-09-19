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
  const platform = context.electronPlatformName;
  let resourcesDir;

  if (context.appOutDir) {
    if (platform === "darwin") {
      resourcesDir = path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        "Contents",
        "Resources"
      );
    } else {
      resourcesDir = path.join(context.appOutDir, "resources");
    }
  } else {
    if (platform === "darwin") {
      resourcesDir = path.join(
        "dist",
        "mac-arm64",
        `${context.packager?.appInfo?.productFilename || "FigCN"}.app`,
        "Contents",
        "Resources"
      );
    } else {
      resourcesDir = path.join("dist", "resources");
    }
  }

  console.log("[afterPack] resources:", resourcesDir);

  if (platform === "darwin") {
    const mitmApp = path.join(resourcesDir, "mitmproxy.app");
    const mitmMacOSDir = path.join(mitmApp, "Contents", "MacOS");
    chmodExecutablesIn(mitmMacOSDir);
  }

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