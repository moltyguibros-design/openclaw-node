import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVOLVE = path.join(REPO, 'workspace-bin', 'evolve');

// evolve has no .py suffix and runs main() only under __main__, so git_commit is
// reached by loading the file as a module and pointing WORKSPACE at a throwaway repo.
const PY = `
import importlib.machinery, importlib.util, json, sys
from pathlib import Path
loader = importlib.machinery.SourceFileLoader('evolve', sys.argv[1])
m = importlib.util.module_from_spec(importlib.util.spec_from_loader('evolve', loader))
loader.exec_module(m)
ws = Path(sys.argv[2])
m.WORKSPACE = ws
fitness = {'score': 0.5, 'grade': 'C', 'window_days': 7}
print(json.dumps(m.git_commit(ws / 'SOUL.md', ['t'], fitness, 'claude-opus-4-6')))
`;

describe('evolve git_commit — commits only the genome, labelled with what was measured', () => {
  let tmp, ws, env;
  const git = (...args) => execFileSync('git', args, { cwd: ws, env, encoding: 'utf8' }).trim();

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-commit-'));
    ws = path.join(tmp, 'ws');
    fs.mkdirSync(path.join(tmp, 'home'));
    fs.mkdirSync(ws);
    // A minimal env: a GIT_DIR/GIT_INDEX_FILE inherited from a hook would aim git at the real repo.
    env = {
      PATH: process.env.PATH,
      HOME: path.join(tmp, 'home'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'evolve-test',
      GIT_AUTHOR_EMAIL: 'evolve-test@example.invalid',
      GIT_COMMITTER_NAME: 'evolve-test',
      GIT_COMMITTER_EMAIL: 'evolve-test@example.invalid',
    };
    git('init', '-q');
    fs.writeFileSync(path.join(ws, 'SOUL.md'), 'v1\n');
    fs.writeFileSync(path.join(ws, 'other.txt'), 'v1\n');
    git('add', 'SOUL.md', 'other.txt');
    git('commit', '-q', '-m', 'seed');
    fs.writeFileSync(path.join(ws, 'SOUL.md'), 'v2\n');
    fs.writeFileSync(path.join(ws, 'other.txt'), 'v2\n');
    git('add', 'other.txt');
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('leaves unrelated staged files out of the evolve commit and names the real model', () => {
    const r = spawnSync('python3', ['-I', '-B', '-c', PY, EVOLVE, ws], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout), true, r.stderr);

    assert.equal(git('show', '--name-only', '--format=', 'HEAD'), 'SOUL.md');
    assert.equal(git('diff', '--cached', '--name-only'), 'other.txt', 'the staged file rode along in the commit');

    const msg = git('log', '-1', '--format=%B');
    assert.match(msg, /^evolve\(soul\): "t"$/m);
    assert.match(msg, /^Fitness at mutation: 0\.500 \[C\] over 7d$/m);
    assert.match(msg, /^Co-Authored-By: claude-opus-4-6 <noreply@anthropic\.com>$/m);
    assert.doesNotMatch(msg, /Sonnet 4\.6|→/);
  });
});
