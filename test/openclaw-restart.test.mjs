import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repo, 'bin/openclaw-restart.sh');

// `launchctl list <label>` output: a property-list dict whose last line is `};`.
const RUNNING_DICT = `{
\t"LimitLoadToSessionType" = "Aqua";
\t"Label" = "ai.openclaw.memory-daemon";
\t"OnDemand" = false;
\t"LastExitStatus" = 9;
\t"PID" = 31660;
\t"Program" = "/usr/local/bin/node";
};`;
const STOPPED_DICT = '{\n\t"Label" = "ai.openclaw.memory-daemon";\n\t"LastExitStatus" = 0;\n};';

describe('openclaw-restart.sh --status', () => {
  let root;
  before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-restart-')); });
  after(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const status = (name, launchctlBody) => {
    const stubBin = path.join(root, name);
    fs.mkdirSync(stubBin);
    fs.writeFileSync(path.join(stubBin, 'launchctl'), `#!/bin/sh\n${launchctlBody}\n`, { mode: 0o755 });
    const r = spawnSync('bash', [script, '--status'], {
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };

  it('reads the PID from the launchctl dict when the job is running', () => {
    const out = status('running', `cat <<'EOF'\n${RUNNING_DICT}\nEOF`);
    assert.match(out, /ai\.openclaw\.memory-daemon\s+running \(pid=31660\)/);
  });

  it('reports a registered job with no PID line as not running', () => {
    const out = status('stopped', `cat <<'EOF'\n${STOPPED_DICT}\nEOF`);
    assert.match(out, /ai\.openclaw\.memory-daemon\s+registered \(not running\)/);
  });

  it('reports an unknown label as not registered', () => {
    const out = status('absent', 'exit 1');
    assert.match(out, /ai\.openclaw\.memory-daemon\s+not registered/);
  });
});
