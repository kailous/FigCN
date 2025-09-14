// scripts/afterPack.js
const path = require("path");
const { execFileSync } = require("child_process");
const fs = require("fs");

function isTextShebang(p) {
  try {
    const fd = fs.openSync(p, "r");
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf.toString() === "#!";
  } catch { return false; }
}

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const appName = context.packager.appInfo.productFilename;
  const macAppContents = path.join(appOutDir, `${appName}.app`, "Contents");
  const resourcesDir = path.join(macAppContents, "Resources");

  // 我们把 venv 放在 Resources/venv
  const venvDir = path.join(resourcesDir, "venv");
  const binDir  = path.join(venvDir, "bin");
  const pyPath  = path.join(binDir, "python3");

  // 1) 修正 bin/* 的 shebang，指向 Resources/venv/bin/python3
  if (fs.existsSync(binDir) && fs.existsSync(pyPath)) {
    for (const name of fs.readdirSync(binDir)) {
      const p = path.join(binDir, name);
      try {
        const st = fs.lstatSync(p);
        if (!st.isFile()) continue;

        // 只处理文本 shebang
        if (isTextShebang(p)) {
          const content = fs.readFileSync(p, "utf8");
          const lines = content.split(/\r?\n/);
          // 总是覆盖第一行 shebang
          lines[0] = `#!${pyPath}`;
          fs.writeFileSync(p, lines.join("\n"), { mode: 0o755 });
        }

        // 确保可执行位
        fs.chmodSync(p, 0o755);
        try { execFileSync("xattr", ["-dr", "com.apple.quarantine", p]); } catch {}
      } catch (e) {
        console.warn("[afterPack] patch shebang failed:", p, e?.message || e);
      }
    }
  }

  // 2) 给 python/mitmdump 也处理一下隔离标记（保险起见）
  const binCandidates = [
    path.join(binDir, "mitmdump"),
    path.join(binDir, "mitmproxy"),
    path.join(binDir, "python3"),
    path.join(binDir, "python")
  ];
  for (const f of binCandidates) {
    if (fs.existsSync(f)) {
      try {
        fs.chmodSync(f, 0o755);
        try { execFileSync("xattr", ["-dr", "com.apple.quarantine", f]); } catch {}
        console.log("[afterPack] fixed exec:", f);
      } catch (e) {
        console.warn("[afterPack] chmod/xattr failed:", f, e?.message || e);
      }
    }
  }

  // 3) 规则脚本/配置文件去隔离（我们已把它们放 Resources/ 下）
  const extra = [
    path.join(resourcesDir, "figcn_injector.py"),
    path.join(resourcesDir, "figcn_rules.yaml")
  ];
  for (const p of extra) {
    if (fs.existsSync(p)) {
      try { execFileSync("xattr", ["-dr", "com.apple.quarantine", p]); } catch {}
    }
  }

  console.log("[afterPack] resources:", resourcesDir);
  console.log("[afterPack] venv:", venvDir);
};