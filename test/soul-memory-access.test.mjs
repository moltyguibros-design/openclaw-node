/**
 * soul-memory-access.test.mjs — clawvault-access-control enforces each soul's declared
 * capabilities.json permissions.memory, and clawvault-local asks it in a soul's context.
 *
 * The script only checked that capabilities.json existed and applied its own hard-coded
 * rules, contradicting the data (it denied lore-writer's declared handoffs readwrite), and
 * nothing in the memory pipeline called it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSoulMemoryAccess } from '../lib/soul-memory-access.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOULS = join(ROOT, 'souls');
const CLI = join(ROOT, 'workspace-bin', 'clawvault-access-control');
const LOCAL = join(ROOT, 'workspace-bin', 'clawvault-local');

const check = (soulId, category, action, soulsDir = SOULS) => checkSoulMemoryAccess({ soulId, category, action, soulsDir }).granted;

describe('the rule follows each soul\'s permissions.memory', () => {
  it('shared and handoffs grant what is declared, nothing more', () => {
    assert.equal(check('lore-writer', 'handoffs', 'write'), true, 'declared handoffs readwrite');
    assert.equal(check('lore-writer', 'shared', 'read'), true);
    assert.equal(check('lore-writer', 'shared', 'write'), false, 'declared shared read only');
    assert.equal(check('identity-architect', 'shared', 'write'), true, 'declared shared readwrite');
  });

  it('private memory is limited to the declared list', () => {
    assert.equal(check('blockchain-auditor', 'private/blockchain-auditor', 'write'), true);
    assert.equal(check('blockchain-auditor', 'private/lore-writer', 'read'), false);
  });

  it('fails closed on an unknown soul, category, action or a malformed id', () => {
    assert.equal(check('nobody', 'shared', 'read'), false);
    assert.equal(check('lore-writer', 'secrets', 'read'), false);
    assert.equal(check('lore-writer', 'shared', 'delete'), false);
    assert.equal(check('../souls/lore-writer', 'shared', 'read'), false);
    assert.equal(check('lore-writer', 'private/../x', 'read'), false);
  });

  it('the whole vault needs readwrite on shared, handoffs and every soul\'s private memory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'souls-'));
    const soul = (id, memory) => {
      mkdirSync(join(dir, id));
      writeFileSync(join(dir, id, 'capabilities.json'), JSON.stringify({ permissions: { memory } }));
    };
    soul('orchestrator', { shared: 'readwrite', handoffs: 'readwrite', private: ['orchestrator', 'helper'] });
    soul('helper', { shared: 'read', handoffs: 'readwrite', private: ['helper'] });
    assert.equal(check('orchestrator', 'vault', 'write', dir), true);
    assert.equal(check('helper', 'vault', 'write', dir), false);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(check('daedalus', 'vault', 'write'), false, 'the shipped daedalus declares only its own private memory');
  });
});

describe('clawvault-access-control CLI', () => {
  const run = (...args) => spawnSync(CLI, args, { encoding: 'utf8', env: { ...process.env, OPENCLAW_SOULS_DIR: SOULS } });

  it('prints GRANTED and exits 0, or DENIED with the reason and exits 1', () => {
    const granted = run('lore-writer', 'handoffs', 'write');
    assert.equal(granted.status, 0, granted.stdout + granted.stderr);
    assert.equal(granted.stdout.trim(), 'GRANTED');
    const denied = run('blockchain-auditor', 'private/lore-writer', 'read');
    assert.equal(denied.status, 1);
    assert.match(denied.stdout, /^DENIED: blockchain-auditor may not access private\/lore-writer/);
  });
});

describe('clawvault-local in a soul\'s context', () => {
  function local(soulId) {
    const home = mkdtempSync(join(tmpdir(), 'clawvault-local-'));
    const bin = join(home, 'bin');
    mkdirSync(bin);
    const ran = join(home, 'ran');
    writeFileSync(join(bin, 'clawvault'), `#!/bin/sh\necho "$@" > "${ran}"\n`);
    chmodSync(join(bin, 'clawvault'), 0o755);
    const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, OPENCLAW_WORKSPACE: join(home, 'ws'), OPENCLAW_SOULS_DIR: SOULS };
    if (soulId) env.OPENCLAW_SOUL_ID = soulId; else delete env.OPENCLAW_SOUL_ID;
    const r = spawnSync('bash', [LOCAL, 'search', 'x'], { encoding: 'utf8', env });
    const executed = spawnSync('cat', [ran], { encoding: 'utf8' }).status === 0;
    rmSync(home, { recursive: true, force: true });
    return { ...r, executed };
  }

  it('refuses a soul not granted the whole vault, before clawvault runs', () => {
    const r = local('lore-writer');
    assert.equal(r.status, 77);
    assert.match(r.stderr, /DENIED: lore-writer may not use the whole vault/);
    assert.equal(r.executed, false);
  });

  it('without a soul id runs as the orchestrator, as before', () => {
    const r = local(null);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.executed, true);
  });
});
