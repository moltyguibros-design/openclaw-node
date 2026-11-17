import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { routeFile } from '../workspace-bin/obsidian-sync.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace-bin', 'obsidian-sync.mjs');
const TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(path.dirname(SCRIPT), '..', 'config', 'obsidian-sync.json.template'), 'utf8'),
);

function templateConfig(overrides = {}) {
  return {
    ...TEMPLATE,
    enabled: true,
    nodeId: 'n1',
    extraRoots: [],
    ...overrides,
  };
}

function runSync(workspace, config) {
  const cfgPath = path.join(workspace, 'obsidian-sync.json');
  fs.writeFileSync(cfgPath, JSON.stringify(config));
  execFileSync(process.execPath, [SCRIPT], {
    env: { ...process.env, OPENCLAW_WORKSPACE: workspace, OPENCLAW_OBSIDIAN_SYNC_CONFIG: cfgPath, OBSIDIAN_API_KEY: '' },
    stdio: 'pipe',
  });
}

describe('obsidian-sync trust-registry route', () => {
  it('the exact .tmp/trust-registry.json route outranks the **/.tmp/** exclude', () => {
    const config = templateConfig();
    assert.equal(routeFile('.tmp/trust-registry.json', config)?.dest, 'nodes/n1/trust/trust-registry.json');
    assert.equal(routeFile('.tmp/obsidian-sync-state.json', config), null);
    assert.equal(routeFile('memory/.tmp/2026-01-05.md', config), null);
  });

  it('a sync with the template config writes the trust registry into the vault', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-trust-'));
    try {
      fs.mkdirSync(path.join(ws, 'projects', 'arcane-vault'), { recursive: true });
      fs.mkdirSync(path.join(ws, '.tmp'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.tmp', 'trust-registry.json'), '{"peers":{}}\n');
      runSync(ws, templateConfig());
      const trust = path.join(ws, 'projects', 'arcane-vault', 'nodes', 'n1', 'trust', 'trust-registry.json');
      assert.equal(fs.readFileSync(trust, 'utf8'), '{"peers":{}}\n');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
