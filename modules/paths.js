// modules/paths.js
const path = require("path");
const fs = require("fs");

function resPath(...p) {
  return path.join(process.resourcesPath || "", ...p);
}
function getVenvDir() {
  const p = resPath("venv");
  return fs.existsSync(p) ? p : null;
}
function getScriptPath(filename) {
  const p = resPath(filename);
  return fs.existsSync(p) ? p : null;
}
function ensureExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    try {
      fs.chmodSync(p, 0o755);
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
}
const q = (a) => (/\s/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a));

module.exports = { resPath, getVenvDir, getScriptPath, ensureExecutable, q };