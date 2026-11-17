import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
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

describe('obsidian-sync nested ** routes', () => {
  it('keeps the subdirectories below the pattern prefix', () => {
    const config = templateConfig();
    const jan = routeFile('memory-vault/ledger/observations/2026/01/05.md', config);
    const feb = routeFile('memory-vault/ledger/observations/2026/02/05.md', config);
    assert.equal(jan.dest, 'nodes/n1/observations/2026/01/05.md');
    assert.equal(feb.dest, 'nodes/n1/observations/2026/02/05.md');
    assert.equal(jan.legacyDest, 'nodes/n1/observations/05.md');
    const top = routeFile('memory-vault/ledger/observations/05.md', config);
    assert.equal(top.dest, 'nodes/n1/observations/05.md');
    assert.equal(top.legacyDest, undefined);
    assert.equal(routeFile('memory/2026-01-05.md', config).dest, 'nodes/n1/daily/2026-01-05.md');
  });

  it('a sync writes both same-named notes, re-syncs old state keys and removes the flattened note once', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-nested-'));
    try {
      const vault = path.join(ws, 'projects', 'arcane-vault');
      const obs = path.join(ws, 'memory-vault', 'ledger', 'observations', '2026');
      fs.mkdirSync(path.join(obs, '01'), { recursive: true });
      fs.mkdirSync(path.join(obs, '02'), { recursive: true });
      fs.writeFileSync(path.join(obs, '01', '05.md'), 'january\n');
      fs.writeFileSync(path.join(obs, '02', '05.md'), 'february\n');
      const flattened = path.join(vault, 'nodes', 'n1', 'observations', '05.md');
      fs.mkdirSync(path.dirname(flattened), { recursive: true });
      fs.writeFileSync(flattened, 'stale\n');
      const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
      fs.mkdirSync(path.join(ws, '.tmp'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.tmp', 'obsidian-sync-state.json'), JSON.stringify({
        'memory-vault/ledger/observations/2026/01/05.md': hash(path.join(obs, '01', '05.md')),
        'memory-vault/ledger/observations/2026/02/05.md': hash(path.join(obs, '02', '05.md')),
      }));

      runSync(ws, templateConfig());
      const nodeObs = path.join(vault, 'nodes', 'n1', 'observations', '2026');
      assert.match(fs.readFileSync(path.join(nodeObs, '01', '05.md'), 'utf8'), /\njanuary\n$/);
      assert.match(fs.readFileSync(path.join(nodeObs, '02', '05.md'), 'utf8'), /\nfebruary\n$/);
      assert.equal(fs.existsSync(flattened), false);
      const state = JSON.parse(fs.readFileSync(path.join(ws, '.tmp', 'obsidian-sync-state.json'), 'utf8'));
      assert.equal(state['memory-vault/ledger/observations/2026/01/05.md'], undefined);
      assert.ok(state['memory-vault/ledger/observations/2026/01/05.md=>nodes/n1/observations/2026/01/05.md']);

      fs.writeFileSync(flattened, 'written by hand later\n');
      runSync(ws, templateConfig());
      assert.equal(fs.readFileSync(flattened, 'utf8'), 'written by hand later\n');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
