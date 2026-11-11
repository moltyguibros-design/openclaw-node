import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'session-search.mjs');

describe('session-search CLI default knowledge DB', () => {
  let cwdDir;
  let homeDir;

  before(() => {
    cwdDir = mkdtempSync(join(tmpdir(), 'session-search-cwd-'));
    homeDir = mkdtempSync(join(tmpdir(), 'session-search-home-'));
  });

  after(() => {
    rmSync(cwdDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('uses the workspace DB, not <cwd>/.knowledge.db', () => {
    const env = { ...process.env, HOME: homeDir };
    delete env.KNOWLEDGE_DB;
    delete env.KNOWLEDGE_ROOT;
    const r = spawnSync(process.execPath, [SCRIPT, 'nats', '--fts'], { cwd: cwdDir, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(cwdDir, '.knowledge.db')), false);
    assert.equal(existsSync(join(homeDir, '.openclaw', 'workspace', '.knowledge.db')), true);
  });
});
