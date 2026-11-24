/**
 * auto-checkpoint-agent-name.test.mjs — auto-checkpoint reads the dispatch signal the
 * scheduler writes as `${agent name, lowercased}-dispatch.json`. It hard-coded
 * daedalus-dispatch.json, so with OPENCLAW_AGENT_NAME set the signal went unread.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'workspace-bin', 'auto-checkpoint');

function run({ envFile, env = {}, signal }) {
  const home = mkdtempSync(join(tmpdir(), 'auto-checkpoint-'));
  const workspace = join(home, 'workspace');
  mkdirSync(join(workspace, '.tmp'), { recursive: true });
  mkdirSync(join(home, '.openclaw'), { recursive: true });
  if (envFile) writeFileSync(join(home, '.openclaw', 'openclaw.env'), envFile);
  const file = join(workspace, '.tmp', signal);
  writeFileSync(file, JSON.stringify({ taskId: 'T-9', title: 'ship it' }));
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('OPENCLAW_')));
  const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { ...base, HOME: home, OPENCLAW_WORKSPACE: workspace, ...env } });
  const consumed = !existsSync(file);
  rmSync(home, { recursive: true, force: true });
  return { ...r, consumed };
}

describe('auto-checkpoint dispatch signal', () => {
  it('defaults to daedalus-dispatch.json', () => {
    const r = run({ signal: 'daedalus-dispatch.json' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /NEW AUTOTASK FOR DAEDALUS: T-9 — ship it/);
    assert.equal(r.consumed, true);
  });

  it('follows OPENCLAW_AGENT_NAME from openclaw.env, quoted', () => {
    const r = run({ envFile: 'OPENCLAW_NODE_ID=n1\nOPENCLAW_AGENT_NAME="Icarus"\n', signal: 'icarus-dispatch.json' });
    assert.match(r.stdout, /NEW AUTOTASK FOR ICARUS: T-9/);
    assert.equal(r.consumed, true);
  });

  // Mission Control names the signal file it writes from the first copy of a repeated key.
  it('takes the first OPENCLAW_AGENT_NAME when openclaw.env repeats it, as Mission Control does', () => {
    const r = run({ envFile: 'OPENCLAW_AGENT_NAME=Icarus\nOPENCLAW_AGENT_NAME=Old\n', signal: 'icarus-dispatch.json' });
    assert.match(r.stdout, /NEW AUTOTASK FOR ICARUS: T-9/);
    assert.equal(r.consumed, true);
  });

  it('the environment wins over openclaw.env', () => {
    const r = run({ envFile: 'OPENCLAW_AGENT_NAME=Icarus\n', env: { OPENCLAW_AGENT_NAME: 'Talos' }, signal: 'talos-dispatch.json' });
    assert.match(r.stdout, /NEW AUTOTASK FOR TALOS: T-9/);
    assert.equal(r.consumed, true);
  });
});
