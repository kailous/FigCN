// scripts/makeVenvPack.js
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "venv");
const DST = path.join(__dirname, "..", "venv_pack");

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFilePreserveX(src, dst) {
  const st = fs.statSync(src);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  // 保持可执行位
  if ((st.mode & 0o111) !== 0) fs.chmodSync(dst, 0o755);
}

function copyDeRef(src, dst) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) {
    const real = fs.realpathSync(src);
    // 递归到真实文件/目录
    const rst = fs.statSync(real);
    if (rst.isDirectory()) {
      for (const name of fs.readdirSync(real)) {
        copyDeRef(path.join(real, name), path.join(dst, name));
      }
    } else {
      copyFilePreserveX(real, dst);
    }
    return;
  }
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyDeRef(path.join(src, name), path.join(dst, name));
    }
    return;
  }
  copyFilePreserveX(src, dst);
}

function fixShebang(file, pythonPath) {
  try {
    if (!fs.existsSync(file)) return;
    const buf = fs.readFileSync(file);
    const text = buf.toString("utf8");
    const lines = text.split(/\r?\n/);
    if (!lines.length) return;
    if (lines[0].startsWith("#!")) {
      // 强制绑定到我们应用内的 venv python
      lines[0] = `#!${pythonPath}`;
      fs.writeFileSync(file, lines.join("\n"), { mode: 0o755 });
    }
  } catch (e) {
    console.warn("fixShebang failed:", file, e.message);
  }
}

function cleanPyCache(root) {
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    const p = path.join(root, name);
    const st = fs.lstatSync(p);
    if (st.isDirectory()) {
      if (name === "__pycache__") {
        rmrf(p);
      } else {
        cleanPyCache(p);
      }
    }
  }
}

(function main() {
  if (!fs.existsSync(SRC)) {
    console.log("[makeVenvPack] skip: venv not found.");
    process.exit(0);
  }
  rmrf(DST);
  console.log("[makeVenvPack] copy venv -> venv_pack (de-referencing symlinks)...");
  copyDeRef(SRC, DST);

  const bin = path.join(DST, "bin");
  const python = path.join(bin, "python3");

  // 把关键脚本 shebang 固定到内置 python
  ["python", "python3", "mitmdump", "mitmproxy", "pip", "pip3"].forEach((f) =>
    fixShebang(path.join(bin, f), python)
  );

  // 清理 __pycache__
  console.log("[makeVenvPack] remove __pycache__ ...");
  cleanPyCache(DST);

  console.log("[makeVenvPack] done.");
})();