import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveNodeId, resolveNodeId } from '../lib/node-id.js';

describe('node-id — one derivation everywhere (review I13/P10)', () => {
  it('derives the way env.sh does: short hostname, lowercase, non-alnum stripped', () => {
    assert.equal(deriveNodeId("Guillaume's MacBook Pro.local"), 'guillaumesmacbookpro');
    assert.equal(deriveNodeId('box.local'), 'box');
    assert.equal(deriveNodeId('MoltyMacs-Virtual-Machine.local'), 'moltymacs-virtual-machine');
    assert.equal(deriveNodeId('worker-2.tail1234.ts.net'), 'worker-2');
  });

  it('matches the shell rule byte-for-byte on a hostile hostname', () => {
    const host = "Guillaume's MacBook Pro";
    const shell = execFileSync('bash', ['-c', `printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-'`, '_', host], { encoding: 'utf8' });
    assert.equal(deriveNodeId(host), shell);
  });

  it('explicit env wins, in the same order the daemons used', () => {
    assert.equal(resolveNodeId({ OPENCLAW_NODE_ID: 'lead-a', MESH_NODE_ID: 'legacy' }, 'Other.local'), 'lead-a');
    assert.equal(resolveNodeId({ MESH_NODE_ID: 'legacy' }, 'Other.local'), 'legacy');
    assert.equal(resolveNodeId({}, 'Other.local'), 'other');
  });

  it('is never empty', () => {
    assert.equal(resolveNodeId({}, "'''"), 'node');
    assert.equal(resolveNodeId({ OPENCLAW_NODE_ID: '   ' }, ''), 'node');
  });
});

describe('session-start.sh reads the daemon-state file the memory daemon writes', () => {
  const HOOK = fileURLToPath(new URL('../.claude/hooks/session-start.sh', import.meta.url));

  function runHook({ envFile, stateId }) {
    const home = mkdtempSync(join(tmpdir(), 'session-start-home-'));
    const stub = join(home, 'stub-bin');
    mkdirSync(stub);
    writeFileSync(join(stub, 'hostname'),
      '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Guillaumes-MacBook-Pro; else echo Guillaumes-MacBook-Pro.local; fi\n');
    chmodSync(join(stub, 'hostname'), 0o755);
    mkdirSync(join(home, '.openclaw', 'workspace'), { recursive: true });
    if (envFile !== undefined) writeFileSync(join(home, '.openclaw', 'openclaw.env'), envFile);
    writeFileSync(join(home, '.openclaw', 'workspace', `.daemon-state-${stateId}.md`), '## Active Task\nnode-id fixture\n');
    return spawnSync('bash', [HOOK], {
      cwd: home,
      env: { HOME: home, PATH: `${stub}:/usr/bin:/bin` },
      encoding: 'utf8',
    });
  }

  it('derives the id the way env.sh does when nothing is configured', () => {
    const r = runHook({ stateId: 'guillaumes-macbook-pro' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Session state:\n## Active Task\nnode-id fixture/);
  });

  it('prefers the OPENCLAW_NODE_ID persisted in openclaw.env', () => {
    const r = runHook({ envFile: 'OPENCLAW_NATS=nats://127.0.0.1:4222\nOPENCLAW_NODE_ID=lead-a\n', stateId: 'lead-a' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Session state:\n## Active Task\nnode-id fixture/);
  });
});
