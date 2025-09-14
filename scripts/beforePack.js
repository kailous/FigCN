// scripts/beforePack.js
const fs = require("fs");
const path = require("path");

function copyDereference(src, dst) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) {
    const real = fs.realpathSync(src);
    const buf = fs.readFileSync(real);
    fs.writeFileSync(dst, buf, { mode: 0o755 });
    return;
  }
  if (st.isDirectory()) {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyDereference(path.join(src, name), path.join(dst, name));
    }
    return;
  }
  // regular file
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  if ((st.mode & 0o111) !== 0) fs.chmodSync(dst, 0o755); // 保持可执行位
}

exports.default = async function beforePack(context) {
  const appDir = context.appDir; // 项目根目录
  const srcVenv = path.join(appDir, "venv");
  const tmpVenv = path.join(appDir, "venv_pack");

  if (!fs.existsSync(srcVenv)) return;

  // 清理旧的 tmp
  if (fs.existsSync(tmpVenv)) fs.rmSync(tmpVenv, { recursive: true, force: true });

  // 递归复制并解引用 symlink
  copyDereference(srcVenv, tmpVenv);

  // 用解引用后的 venv_pack 替换原来的 venv 参与打包
  // 注意：这里只影响打包上下文，不改你本地 venv
  context.packager.info("beforePack: using venv_pack instead of venv");
  context.files = context.files?.map((p) => (p === "venv/**" ? "venv_pack/**" : p));
};