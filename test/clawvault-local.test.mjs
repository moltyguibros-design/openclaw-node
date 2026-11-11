import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrapper = path.join(repo, 'workspace-bin/clawvault-local');

describe('clawvault-local binary resolution', () => {
  let root;
  before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-local-')); });
  after(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const fakeClawvault = (dir, prefix) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'clawvault'), `#!/bin/sh\nprintf '${prefix}%s ' "$@"\n`, { mode: 0o755 });
  };

  const run = (ws, pathDirs, args) => spawnSync('bash', [wrapper, ...args], {
    env: { OPENCLAW_WORKSPACE: ws, HOME: ws, PATH: [...pathDirs, '/usr/bin', '/bin'].join(':') },
    encoding: 'utf8',
    timeout: 10000,
  });

  it('falls back to a clawvault on PATH when .npm-global has none', () => {
    const ws = path.join(root, 'path-only');
    const fakeBin = path.join(root, 'path-only-bin');
    fs.mkdirSync(ws);
    fakeClawvault(fakeBin, '');
    const r = run(ws, [fakeBin], ['status']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `status --vault ${ws}/memory-vault `);
  });

  it('prefers the workspace .npm-global copy over one on PATH', () => {
    const ws = path.join(root, 'both');
    const fakeBin = path.join(root, 'both-bin');
    fakeClawvault(path.join(ws, '.npm-global/bin'), 'local:');
    fakeClawvault(fakeBin, 'path:');
    const r = run(ws, [fakeBin], ['status']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^local:status /);
  });

  it('exits 127 with a clear message when clawvault is nowhere', () => {
    const ws = path.join(root, 'none');
    fs.mkdirSync(ws);
    const r = run(ws, [], ['status']);
    assert.equal(r.status, 127);
    assert.match(r.stderr, /clawvault not found/);
  });
});
