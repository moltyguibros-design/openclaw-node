/**
 * trust-peer-role.test.mjs — `openclaw-trust-peer <id> <same key> --role lead`
 * changes the stored bus tier. The registry's trust() returned false for a
 * known key before it looked at the role, so the CLI printed "no-op" and a
 * peer first registered as worker could be promoted only by --remove and
 * re-add, which revoked its bus identity in between.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIdentityRegistry } from '../lib/node-identity.mjs';

const CLI = fileURLToPath(new URL('../bin/openclaw-trust-peer.mjs', import.meta.url));
const KEY = 'A'.repeat(43) + '=';
const tmp = mkdtempSync(join(tmpdir(), 'trust-peer-role-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

describe('openclaw-trust-peer --role on a known peer', () => {
  const dir = join(tmp, 'cli');
  const trustPeer = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, HOME: tmp, OPENCLAW_IDENTITY_DIR: dir },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r.stdout;
  };
  const stored = () => JSON.parse(readFileSync(join(dir, 'identity-registry.json'), 'utf8')).w1;

  it('changes the role when --role names a different one, and keeps it when --role is absent', () => {
    trustPeer('w1', KEY);
    assert.equal(stored().role ?? 'worker', 'worker');

    assert.match(trustPeer('w1', KEY, '--role', 'lead'), /w1: role worker -> lead/);
    assert.equal(stored().role, 'lead');
    assert.equal(stored().pubkey, KEY);

    assert.match(trustPeer('w1', KEY), /already trusted with same pubkey \(no-op\)/);
    assert.equal(stored().role, 'lead');

    assert.match(trustPeer('w1', KEY, '--role', 'lead'), /no-op/);
  });
});

describe('registry.setRole', () => {
  it('updates and persists a known entry, and refuses an unknown id or an unchanged role', () => {
    const path = join(tmp, 'unit', 'identity-registry.json');
    const registry = createIdentityRegistry({ path, mode: 'strict' });
    assert.equal(registry.setRole('nobody', 'lead'), false);
    registry.trust('w2', KEY, 'operator');
    assert.equal(registry.setRole('w2', 'worker'), false);
    assert.equal(registry.setRole('w2', 'lead'), true);
    assert.equal(createIdentityRegistry({ path, mode: 'strict' }).get('w2').role, 'lead');
  });
});
