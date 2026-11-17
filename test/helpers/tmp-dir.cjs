/**
 * tmp-dir.cjs — temp dirs a test file creates and is guaranteed to remove.
 *
 * Removal runs on process exit, not in a test's own cleanup, so it happens
 * even when an assertion throws first and for dirs created at module load,
 * before any hook exists. node --test runs each file in its own process.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dirs = new Set();
let hooked = false;

function tmpDir(prefix) {
  if (!hooked) {
    hooked = true;
    process.once('exit', () => {
      for (const dir of dirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort at exit */ }
      }
    });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.add(dir);
  return dir;
}

module.exports = { tmpDir };
