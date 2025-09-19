// modules/certManager.js
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";

// 证书默认路径（mitmproxy 会把 CA 放在 ~/.mitmproxy）
function getDefaultCertPath(app) {
  const home = process.env.HOME || app.getPath("home");
  return path.join(home, ".mitmproxy", "mitmproxy-ca-cert.cer");
}

// 把证书安装到 login keychain（通常不需要管理员密码）
async function installToLogin(certPath) {
  // 新系统 login keychain 文件名一般为 login.keychain-db
  const loginKeychain = path.join(
    process.env.HOME || "",
    "Library",
    "Keychains",
    "login.keychain-db"
  );

  // 如果这个文件不存在，security 仍可识别 "login" 别名，这里兜底处理
  const keychainArg = fs.existsSync(loginKeychain) ? loginKeychain : "login.keychain";
  await execFileP("security", [
    "add-trusted-cert",
    "-d",
    "-r",
    "trustRoot",
    "-k",
    keychainArg,
    certPath,
  ]);
  return {
    ok: true,
    installedTo: "login",
    message: "证书已安装到 login 钥匙串，并设为受信任根。",
    certPath,
  };
}

// 通过 osascript 请求管理员权限安装到 System keychain（会弹密码框）
async function installToSystemWithOSA(certPath) {
  const sysCmd = `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath.replace(/"/g, '\\"')}"`;
  const osa = `do shell script "${sysCmd.replace(/"/g, '\\"')}" with administrator privileges`;
  await execFileP("osascript", ["-e", osa], { timeout: 120000 });
  return {
    ok: true,
    installedTo: "system",
    message: "证书已安装到 System 钥匙串。",
    certPath,
  };
}

// 打开钥匙串访问（用于引导用户手动信任）
async function openKeychainAccess() {
  await execFileP("open", ["-a", "Keychain Access"]);
}

// macOS 手动安装/信任的提示文本
function buildMacManualSteps(certPath) {
  return [
    "自动安装失败，请手动安装并信任证书：",
    "1. 打开“钥匙串访问”（Keychain Access）",
    `2. 在左上角选择“登录（login）”或“系统（System）”钥匙串`,
    `3. 菜单“文件” -> “导入项目...”，选择：${certPath}`,
    '4. 导入后双击该证书，展开 “信任（Trust）”，将 “使用此证书时（When using this certificate）” 改为 “始终信任（Always Trust）”，保存（可能需要输入密码）',
    "5. 重启浏览器/应用以生效。",
  ].join("\n");
}

function buildWindowsManualSteps(certPath) {
  return [
    "自动安装失败，请尝试以下手动步骤：",
    "1. 按 Win 键输入 `certmgr.msc` 并回车，打开证书管理器。",
    "2. 在左侧展开“受信任的根证书颁发机构” -> “证书”。",
    `3. 在右侧空白处点击右键，选择“所有任务” -> “导入…”，然后选择：${certPath}`,
    "4. 按导入向导提示完成安装，必要时同意 UAC 弹窗。",
    "5. 重新启动浏览器或相关应用以生效。",
  ].join("\n");
}

async function installOnWindows(certPath) {
  try {
    await execFileP("certutil", ["-addstore", "root", certPath]);
    return {
      ok: true,
      installedTo: "windows-root",
      message: "证书已导入到 Windows 受信任的根证书颁发机构。",
      certPath,
    };
  } catch (err) {
    try {
      const escaped = certPath.replace(/`/g, "``").replace(/'/g, "''");
      const ps =
        `Start-Process -FilePath certutil.exe -ArgumentList '-addstore','root','${escaped}' -Verb RunAs -WindowStyle Hidden -Wait`;
      await execFileP(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        { timeout: 120000 }
      );
      return {
        ok: true,
        installedTo: "windows-root",
        message: "已尝试以管理员权限安装证书，如提示被拒绝请手动安装。",
        certPath,
      };
    } catch (err2) {
      return {
        ok: false,
        installedTo: null,
        message:
          "自动安装失败：\n" +
          `certutil 错误：${String(err).trim()}\n\n` +
          `提权安装失败：${String(err2).trim()}\n\n` +
          buildWindowsManualSteps(certPath),
        certPath,
      };
    }
  }
}

// 暴露给 main.js 的注册函数
function register(ipcMain, app) {
  // 安装并信任 mitmproxy CA
  ipcMain.handle("install-mitm-ca", async () => {
    const certPath = getDefaultCertPath(app);
    if (!fs.existsSync(certPath)) {
      return {
        ok: false,
        installedTo: null,
        message:
          `未发现证书文件：${certPath}\n` +
          "请先启动一次代理并访问 https://mitm.it 下载安装，或让 mitmproxy 生成 CA 后再重试。",
        certPath,
      };
    }

    if (isWindows) {
      return installOnWindows(certPath);
    }

    if (!isMac) {
      return {
        ok: false,
        installedTo: null,
        message: "当前平台暂不支持自动安装证书，请手动信任 mitmproxy 证书。",
        certPath,
      };
    }

    // 先尝试 login keychain（最不打扰用户）
    try {
      return await installToLogin(certPath);
    } catch (eLogin) {
      // 再尝试 System keychain（需要管理员密码弹框）
      try {
        return await installToSystemWithOSA(certPath);
      } catch (eSys) {
        // 全部失败，返回清晰提示+手动步骤
        return {
          ok: false,
          installedTo: null,
          message:
            "自动安装失败：\n" +
            `login keychain 错误：${String(eLogin)}\n\n` +
            `system keychain 错误：${String(eSys)}\n\n` +
            buildMacManualSteps(certPath),
          certPath,
        };
      }
    }
  });

  // 打开 Keychain Access（前端可在失败时提供按钮调用）
  ipcMain.handle("open-keychain-access", async () => {
    if (!isMac) {
      return { ok: false, message: "仅支持在 macOS 上打开钥匙串访问。" };
    }
    try {
      await openKeychainAccess();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  });

  // 简单校验证书文件是否存在（用于前端显示状态）
  ipcMain.handle("check-mitm-ca", async () => {
    const certPath = getDefaultCertPath(app);
    return { exists: fs.existsSync(certPath), certPath };
  });
}

module.exports = { register };