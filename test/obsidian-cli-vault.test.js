/**
 * obsidian-cli-vault.test.js — workspace-bin/obsidian finds the real vault
 * root and its API key file in obsidian-sync.json, as obsidian-sync.mjs does.
 * It used OBSIDIAN_VAULT_PATH, which the memory pipeline reads as its own
 * subtree inside the vault: setting it for one tool misdirected the other.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-cli-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const fakebin = path.join(tmp, 'bin');
const curlLog = path.join(tmp, 'curl.log');
fs.mkdirSync(fakebin);
fs.writeFileSync(path.join(fakebin, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${curlLog}"\necho authenticated\n`);
fs.chmodSync(path.join(fakebin, 'curl'), 0o755);

const vault = path.join(tmp, 'vault');
const pipeline = path.join(vault, 'nodes', 'n1', 'memory');
fs.mkdirSync(pipeline, { recursive: true });
fs.writeFileSync(path.join(vault, '.obsidian-api-key'), 'vault-key\n');
fs.writeFileSync(path.join(pipeline, '.obsidian-api-key'), 'pipeline-key\n');

function status(config) {
  const cfg = path.join(tmp, `sync-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(cfg, JSON.stringify(config));
  fs.rmSync(curlLog, { force: true });
  const env = {
    ...process.env,
    PATH: `${fakebin}${path.delimiter}${process.env.PATH}`,
    OPENCLAW_OBSIDIAN_SYNC_CONFIG: cfg,
    OPENCLAW_WORKSPACE: path.join(tmp, 'ws'),
    OBSIDIAN_VAULT_PATH: pipeline,
  };
  delete env.OBSIDIAN_API_KEY;
  const r = spawnSync('bash', [path.join(ROOT, 'workspace-bin', 'obsidian'), 'status'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return fs.readFileSync(curlLog, 'utf8');
}

describe('workspace-bin/obsidian vault resolution', () => {
  it('reads the key from the vault root obsidian-sync.json names, not from OBSIDIAN_VAULT_PATH', () => {
    const args = status({ vaultPath: vault });
    assert.match(args, /^Authorization: Bearer vault-key$/m, args);
  });

  it('honours apiKeyFile (workspace-relative, as obsidian-sync.mjs resolves it)', () => {
    fs.mkdirSync(path.join(tmp, 'ws', 'keys'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'ws', 'keys', 'obsidian.key'), 'file-key\n');
    const args = status({ vaultPath: vault, apiKeyFile: 'keys/obsidian.key' });
    assert.match(args, /^Authorization: Bearer file-key$/m, args);
  });
});
