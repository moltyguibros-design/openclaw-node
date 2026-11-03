import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../cli.js', import.meta.url));

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-cli-status-')));
  const f = { root, pkg: path.join(root, 'package'), complete: false };
  for (const directory of ['package', 'package/bin', 'home', 'node-root', 'tmp', 'caller', 'tools', 'empty-tools']) {
    fs.mkdirSync(path.join(root, directory), { mode: 0o700 });
  }
  fs.writeFileSync(path.join(f.pkg, 'cli.js'), fs.readFileSync(cli), { mode: 0o755 });
  fs.writeFileSync(path.join(f.pkg, 'package.json'), '{"type":"commonjs"}\n', { mode: 0o600 });
  fs.symlinkSync('/bin/bash', path.join(root, 'tools', 'bash'));
  f.marker = path.join(root, 'child-marker.txt');
  f.env = {
    PATH: path.join(root, 'tools'), HOME: path.join(root, 'home'),
    TMPDIR: path.join(root, 'tmp'), OPENCLAW_ROOT: path.join(root, 'node-root'),
    REPO_DIR: 'owned-repo-sentinel', OWNED_CLI_MARKER: f.marker,
  };
  t.after(() => {
    if (f.complete) fs.rmSync(root, { recursive: true, force: true });
    else t.diagnostic(`Failed owned CLI fixture retained: ${root}`);
  });
  return f;
}

function childProgram(f, mesh) {
  if (mesh) {
    fs.writeFileSync(path.join(f.pkg, 'bin', 'openclaw-node-init.js'), `
const fs = require('node:fs');
fs.writeFileSync(process.env.OWNED_CLI_MARKER,
  ['mesh', process.cwd(), process.env.REPO_DIR, ...process.argv.slice(2)].join('\\n') + '\\n');
if (process.env.OWNED_OUTCOME === 'signal') process.kill(process.pid, 'SIGTERM');
else process.exit(process.env.OWNED_OUTCOME === 'seven' ? 7 : 0);
`, { mode: 0o600 });
  } else {
    fs.writeFileSync(path.join(f.pkg, 'install.sh'), `
printf '%s\\n' full "$PWD" "$REPO_DIR" "$@" > "$OWNED_CLI_MARKER"
case "$OWNED_OUTCOME" in
  signal) kill -TERM "$$" ;;
  seven) exit 7 ;;
  zero) exit 0 ;;
esac
`, { mode: 0o600 });
  }
}

async function runCli(t, f, args, outcome = 'zero', noBash = false) {
  const child = spawn(process.execPath, [path.join(f.pkg, 'cli.js'), ...args], {
    cwd: path.join(f.root, 'caller'), detached: true,
    env: { ...f.env, OWNED_OUTCOME: outcome, ...(noBash ? { PATH: path.join(f.root, 'empty-tools') } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', startError, killError, timedOut = false;
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  child.once('error', error => { startError = error; });
  const timer = setTimeout(() => {
    timedOut = true;
    if (Number.isSafeInteger(child.pid)) {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') killError = error; }
    }
  }, 10_000);
  const result = await new Promise(resolve => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  fs.writeFileSync(path.join(f.root, 'launcher-result.json'), JSON.stringify({
    ...result, pid: child.pid, timedOut, stdout, stderr,
    startError: startError?.code, killError: killError?.code,
  }, null, 2) + '\n', { mode: 0o600 });
  assert.equal(startError, undefined, stderr);
  assert.equal(killError, undefined);
  let residual = false;
  try { process.kill(-child.pid, 0); residual = true; }
  catch (error) { assert.equal(error.code, 'ESRCH'); }
  if (residual) {
    process.kill(-child.pid, 'SIGKILL');
    assert.fail(`Owned CLI process group survived launcher close: ${child.pid}`);
  }
  assert.equal(timedOut, false, `Owned CLI deadline expired; evidence: ${f.root}`);
  assert.equal(result.signal, null, stderr);
  t.diagnostic(JSON.stringify({ ...result, pid: child.pid, owned_group_absent: true }));
  return { ...result, stdout, stderr };
}

for (const [route, mesh] of [['full', false], ['mesh', true]]) {
  for (const [outcome, expected] of [['zero', 0], ['seven', 7], ['signal', 1]]) {
    test(`${route} CLI preserves ${outcome} child outcome`, async t => {
      const f = fixture(t);
      childProgram(f, mesh);
      const args = [...(mesh ? ['--mesh-only'] : []), '--update', 'value with spaces'];
      const result = await runCli(t, f, args, outcome);
      assert.equal(result.code, expected, result.stderr);
      assert.deepEqual(fs.readFileSync(f.marker, 'utf8').trimEnd().split('\n'), [
        route, mesh ? path.join(f.root, 'caller') : f.pkg,
        mesh ? 'owned-repo-sentinel' : f.pkg, '--update', 'value with spaces',
      ]);
      f.complete = true;
    });
  }

  test(`${route} CLI refuses a missing target without starting a child`, async t => {
    const f = fixture(t);
    const result = await runCli(t, f, mesh ? ['--mesh-only'] : []);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /not found/);
    assert.equal(fs.existsSync(f.marker), false);
    f.complete = true;
  });
}

test('full CLI refuses a Bash spawn error instead of reporting success', async t => {
  const f = fixture(t);
  childProgram(f, false);
  const result = await runCli(t, f, [], 'zero', true);
  assert.equal(result.code, 1);
  assert.equal(fs.existsSync(f.marker), false);
  f.complete = true;
});
