/**
 * mesh-worktree-hygiene.test.mjs — integrations plan step 5.4.
 *
 * Two destructive paths in bin/mesh-agent.js:
 *
 *   createWorktree fell back to rm -rf whenever `git worktree remove` failed,
 *   and that command fails exactly when the path is NOT a worktree of this
 *   repo — the case where deleting it destroys something we do not own.
 *
 *   cleanupWorktree ran `git branch -D`, discarding unmerged commits silently.
 *
 * Everything here runs against real git repositories, because the question is
 * what git actually reports, not what a stub says it reports.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let root, workspace, agent;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const commit = (cwd, msg) => {
  git(cwd, 'add', '-A');
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg], { cwd });
};

before(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wt-hygiene-'));
  workspace = path.join(root, 'workspace');
  mkdirSync(workspace);
  git(workspace, 'init', '-q');
  writeFileSync(path.join(workspace, 'a.txt'), 'base\n');
  commit(workspace, 'init');

  process.env.MESH_WORKSPACE = workspace;
  process.env.MESH_WORKTREE_BASE = path.join(root, 'worktrees');
  process.env.MESH_NO_MERGE = '1';
  agent = require('../bin/mesh-agent.js');
});
after(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.MESH_WORKSPACE;
  delete process.env.MESH_WORKTREE_BASE;
});

describe('worktreeGitdir', () => {
  it('reads the gitdir target from a real worktree marker', () => {
    const wt = path.join(root, 'probe-wt');
    git(workspace, 'worktree', 'add', '-q', '-b', 'probe', wt);
    const target = agent.worktreeGitdir(wt);
    assert.ok(target, 'a worktree has a .git file naming its admin dir');
    assert.match(target, /\.git[/\\]worktrees[/\\]probe-wt$/);
    git(workspace, 'worktree', 'remove', '--force', wt);
  });

  it('returns null for a plain directory and for a real clone', () => {
    const plain = path.join(root, 'plain');
    mkdirSync(plain, { recursive: true });
    writeFileSync(path.join(plain, 'notes.txt'), 'someone real work\n');
    assert.equal(agent.worktreeGitdir(plain), null);

    const clone = path.join(root, 'clone');
    mkdirSync(clone);
    git(clone, 'init', '-q');
    assert.equal(agent.worktreeGitdir(clone), null, 'a repository has a .git DIRECTORY, not a marker file');
  });
});

describe('isOwnWorktree', () => {
  it('is true for a worktree of this workspace', () => {
    const wt = path.join(root, 'mine');
    git(workspace, 'worktree', 'add', '-q', '-b', 'mine', wt);
    assert.equal(agent.isOwnWorktree(wt, workspace), true);
    git(workspace, 'worktree', 'remove', '--force', wt);
  });

  it('is false for a worktree belonging to a DIFFERENT repository', () => {
    const other = path.join(root, 'other-repo');
    mkdirSync(other);
    git(other, 'init', '-q');
    writeFileSync(path.join(other, 'x.txt'), 'x\n');
    commit(other, 'init');
    const foreign = path.join(root, 'foreign-wt');
    git(other, 'worktree', 'add', '-q', '-b', 'foreign', foreign);

    assert.equal(agent.worktreeGitdir(foreign) !== null, true, 'it IS a worktree');
    assert.equal(agent.isOwnWorktree(foreign, workspace), false, 'but not one of ours — never delete it');
    git(other, 'worktree', 'remove', '--force', foreign);
  });

  it('is false for a plain directory of real files', () => {
    const plain = path.join(root, 'plain2');
    mkdirSync(plain, { recursive: true });
    writeFileSync(path.join(plain, 'work.txt'), 'unsaved work\n');
    assert.equal(agent.isOwnWorktree(plain, workspace), false);
  });
});

describe('createWorktree refuses to delete what it cannot identify', () => {
  it('fails closed when the task path holds a foreign directory, leaving it intact', () => {
    const base = process.env.MESH_WORKTREE_BASE;
    const squatted = path.join(base, 'T-squat');
    mkdirSync(squatted, { recursive: true });
    const precious = path.join(squatted, 'precious.txt');
    writeFileSync(precious, 'not ours to delete\n');

    const result = agent.createWorktree('T-squat');
    assert.equal(result, null, 'creation fails closed rather than clearing the path');
    assert.equal(existsSync(precious), true, 'the directory it could not identify is still there');
  });

  it('still creates a worktree on a clean path', () => {
    const created = agent.createWorktree('T-clean');
    assert.ok(created, 'the normal path is unaffected');
    assert.equal(agent.isOwnWorktree(created, workspace), true);
    git(workspace, 'worktree', 'remove', '--force', created);
    execFileSync('git', ['branch', '-D', 'mesh/T-clean'], { cwd: workspace, stdio: 'ignore' });
  });
});

describe('cleanupWorktree keeps a branch that still holds commits', () => {
  const branchExists = (b) => {
    try { git(workspace, 'rev-parse', '--verify', `refs/heads/${b}`); return true; } catch { return false; }
  };

  it('deletes a branch with nothing on it', () => {
    const wt = agent.createWorktree('T-empty');
    agent.cleanupWorktree(wt, false);
    assert.equal(branchExists('mesh/T-empty'), false, 'an empty branch is noise; it goes');
  });

  it('keeps a branch whose commits exist nowhere else, even when asked to delete', () => {
    const wt = agent.createWorktree('T-work');
    writeFileSync(path.join(wt, 'result.txt'), 'the worker output\n');
    commit(wt, 'worker output');
    const sha = git(wt, 'rev-parse', 'HEAD').trim();

    agent.cleanupWorktree(wt, false);

    assert.equal(existsSync(wt), false, 'the worktree directory is still removed');
    assert.equal(branchExists('mesh/T-work'), true, 'but the only copy of the work survives');
    assert.equal(git(workspace, 'rev-parse', 'refs/heads/mesh/T-work').trim(), sha);
    execFileSync('git', ['branch', '-D', 'mesh/T-work'], { cwd: workspace, stdio: 'ignore' });
  });

  it('honours keep=true without consulting git at all', () => {
    const wt = agent.createWorktree('T-keep');
    agent.cleanupWorktree(wt, true);
    assert.equal(branchExists('mesh/T-keep'), true);
    execFileSync('git', ['branch', '-D', 'mesh/T-keep'], { cwd: workspace, stdio: 'ignore' });
  });
});
