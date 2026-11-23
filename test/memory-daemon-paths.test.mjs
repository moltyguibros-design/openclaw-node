/**
 * memory-daemon-paths.test.mjs — the memory daemon keeps its node state under
 * OPENCLAW_HOME, so spawn-node trees run separate daemons on one machine.
 *
 * The documented "three nodes on one machine" recipe set OPENCLAW_HOME, which
 * the daemon never read: its config, state.db, .knowledge.db and watcher.jsonl
 * followed os.homedir(), so all three daemons shared one set of files.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { memoryDaemonPaths } from '../lib/memory-daemon-paths.mjs';
import { consolidationCommand, runCommand } from '../bin/spawn-node.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('memory daemon paths', () => {
  it('without OPENCLAW_HOME: the paths the daemon always used', () => {
    const p = memoryDaemonPaths({}, '/home/op');
    assert.equal(p.root, '/home/op/.openclaw');
    assert.equal(p.workspace, null, 'the daemon keeps the workspace it is installed in');
    assert.equal(p.config, '/home/op/.openclaw/config/daemon.json');
    assert.equal(p.transcriptSources, '/home/op/.openclaw/config/transcript-sources.json');
    assert.equal(p.stateDb, '/home/op/.openclaw/state.db');
    assert.equal(p.knowledgeDb, '/home/op/.openclaw/workspace/.knowledge.db');
    assert.equal(p.graphCacheDb, '/home/op/.openclaw/graph-cache.db');
    assert.equal(p.watcherLog, '/home/op/.openclaw/watcher.jsonl');
    assert.equal(p.injectPort, 7893);
  });

  it('OPENCLAW_HOME owns every node path, MEMORY_INJECT_PORT the port', () => {
    const p = memoryDaemonPaths({ OPENCLAW_HOME: '/n/alpha', MEMORY_INJECT_PORT: '7901' }, '/home/op');
    for (const [key, value] of Object.entries(p)) {
      if (key === 'injectPort') continue;
      assert.ok(value.startsWith('/n/alpha'), `${key} escaped the node root: ${value}`);
    }
    assert.equal(p.workspace, '/n/alpha/workspace');
    assert.equal(p.stateDb, '/n/alpha/state.db');
    assert.equal(p.injectPort, 7901);
    assert.equal(memoryDaemonPaths({ OPENCLAW_HOME: '/n/alpha', OPENCLAW_WORKSPACE: '/w' }).workspace, '/w');
  });

  it('a spawned node flushes into its own root vault; the default node keeps the vault resolution it had', () => {
    assert.equal(memoryDaemonPaths({}, '/home/op').vault, null, 'unset: getVaultPath keeps resolving env, obsidian-sync.json, ~/.openclaw/obsidian-local');
    assert.equal(memoryDaemonPaths({ OPENCLAW_HOME: '/n/alpha' }).vault, '/n/alpha/obsidian-local', 'the vault spawn-node lays out');
    assert.equal(memoryDaemonPaths({ OPENCLAW_HOME: '/n/alpha', OBSIDIAN_VAULT_PATH: '/v' }).vault, '/v', 'an explicit vault still wins');
  });

  it('memory-daemon.mjs derives no node path from the home directory itself', () => {
    const src = fs.readFileSync(path.join(ROOT, 'workspace-bin', 'memory-daemon.mjs'), 'utf8');
    assert.match(src, /memoryDaemonPaths\(\)/);
    assert.doesNotMatch(src, /['"`]\.openclaw/, 'a ~/.openclaw path is hardcoded instead of read from memoryDaemonPaths');
    for (const call of ['createExtractionStore()', 'new SessionStore()', 'createHyperAgentStore()', 'runStoreHealthProbes()']) {
      assert.ok(!src.includes(call), `${call} falls back to its own ~/.openclaw default`);
    }
  });

  it('spawn-node prints a run line with the node root, bus URL and its own inject port', () => {
    assert.equal(runCommand({ nodeRoot: '/n/bravo', id: 'bravo', port: 7901, natsUrl: 'nats://localhost:4223' }),
      'OPENCLAW_HOME=/n/bravo OPENCLAW_NODE_ID=bravo OPENCLAW_NATS=nats://localhost:4223 MEMORY_INJECT_PORT=7901 node workspace-bin/memory-daemon.mjs');
  });

  // The daemon runs no consolidation cycle, and the installed timer cycles
  // only ~/.openclaw: a spawned node needs its own scheduler on its root.
  it('spawn-node also prints the consolidation scheduler on the same root, id and bus', () => {
    assert.equal(consolidationCommand({ nodeRoot: '/n/bravo', id: 'bravo', natsUrl: 'nats://localhost:4223' }),
      'OPENCLAW_HOME=/n/bravo OPENCLAW_NODE_ID=bravo OPENCLAW_NATS=nats://localhost:4223 node bin/consolidation-scheduler.mjs --daemon');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-node-cli-'));
    try {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'spawn-node.mjs'), '--id', 'bravo', '--base-dir', path.join(base, 'openclaw-')],
        { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const root = path.join(base, 'openclaw-bravo');
      assert.ok(r.stdout.includes(`OPENCLAW_HOME=${root} OPENCLAW_NODE_ID=bravo `) && r.stdout.includes(' node workspace-bin/memory-daemon.mjs'), r.stdout);
      assert.ok(r.stdout.includes(`OPENCLAW_HOME=${root} OPENCLAW_NODE_ID=bravo OPENCLAW_NATS=`) && r.stdout.includes(' node bin/consolidation-scheduler.mjs --daemon'), r.stdout);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
