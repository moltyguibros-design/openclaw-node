#!/usr/bin/env node
/**
 * mesh-agent-role-outputs.test.js — audit mesh-core#13, the worker half.
 * The real solo path of mesh-agent (executeTask) in a real git workspace, with
 * NATS faked and a stub provider that writes files into its worktree.
 *
 * Both completion paths sent `artifacts: []`, so the daemon's required_outputs
 * check had nothing to look at, and it could not read file contents anyway: the
 * worktree exists only on the worker. The worker now reports the files it
 * changed and checks the role's required_outputs there, content_check
 * included, sending the verdict as result.role_validation.
 *
 * Run: node --test test/mesh-agent-role-outputs.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-role-outputs-'));
const WORKSPACE = path.join(TMP, 'workspace');
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: WORKSPACE,
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  MESH_LEASE_DIR: path.join(TMP, 'leases'),
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: path.join(TMP, 'obs.db'),
  OPENCLAW_STATE_DB: path.join(TMP, 'state.db'),
  MESH_MEMORY_RECALL: 'off',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
});

// A role that requires a test file and a marker inside it; ROLE_DIRS reads $HOME/.openclaw/roles.
fs.mkdirSync(path.join(TMP, '.openclaw', 'roles'), { recursive: true });
fs.writeFileSync(path.join(TMP, '.openclaw', 'roles', 'needs-tests.yaml'), [
  'id: needs-tests',
  'name: Needs tests',
  'required_outputs:',
  '  - type: file_match',
  '    pattern: "test/**"',
  '    description: "a test file"',
  '  - type: content_check',
  '    pattern: "test/**"',
  '    check: "assert"',
  '    description: "the test asserts something"',
  '',
].join('\n'));

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { registerProvider } = require('../lib/llm-providers.js');
const agent = require('../bin/mesh-agent.js');

const sc = StringCodec();
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();

// Writes each `path=content` pair of task.stub_files into the worktree it is given.
registerProvider('files-stub', {
  binary: process.execPath,
  buildArgs(prompt, model, task, targetDir) {
    const script = "const fs=require('fs'),p=require('path');for(const [f,c] of JSON.parse(process.argv[2])){fs.mkdirSync(p.dirname(p.join(process.argv[1],f)),{recursive:true});fs.writeFileSync(p.join(process.argv[1],f),c)}process.stdout.write('wrote files')";
    return ['-e', script, targetDir, JSON.stringify(task.stub_files)];
  },
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function freshWorkspace() {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.rmSync(process.env.MESH_WORKTREE_BASE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  git(WORKSPACE, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(WORKSPACE, 'README'), 'base\n');
  git(WORKSPACE, 'add', '.');
  git(WORKSPACE, 'commit', '-q', '-m', 'base');
}

/** Answers every owner call; captures the mesh.tasks.complete payload and answers it pending_review. */
function fakeDaemon() {
  const seen = {};
  agent.__test.setContext({
    nc: {
      isClosed: () => false,
      async flush() {},
      async request(subject, data) {
        const payload = JSON.parse(sc.decode(data));
        seen[subject] = payload;
        const reply = subject === 'mesh.tasks.complete' ? { task_id: payload.task_id, status: 'pending_review' } : {};
        return { data: sc.encode(JSON.stringify({ ok: true, data: reply })) };
      },
    },
  });
  return seen;
}

function task(id, files, role = 'needs-tests') {
  return {
    task_id: id, title: 'add the reset path', description: 'add it', budget_minutes: 5,
    llm_provider: 'files-stub', stub_files: files, role, scope: [], lease_token: 'lease-test',
  };
}

describe('the worker checks a role\'s required outputs where the files exist', () => {
  beforeEach(freshWorkspace);

  it('reports the files it changed and a passing verdict', async () => {
    const seen = fakeDaemon();
    await agent.__test.executeTask(task('R-1', [['src/reset.js', 'x'], ['test/reset.test.js', "assert.ok(1)"]]));
    const { result } = seen['mesh.tasks.complete'];
    assert.deepEqual([...result.artifacts].sort(), ['src/reset.js', 'test/reset.test.js']);
    assert.deepEqual(result.role_validation, { role: 'needs-tests', passed: true, issues: [] });
  });

  it('fails file_match when no output matches', async () => {
    const seen = fakeDaemon();
    await agent.__test.executeTask(task('R-2', [['src/reset.js', 'x']]));
    const { result } = seen['mesh.tasks.complete'];
    assert.deepEqual(result.artifacts, ['src/reset.js']);
    assert.equal(result.role_validation.passed, false);
    assert.match(result.role_validation.issues.join('\n'), /a test file: No output file matches pattern: test\/\*\*/);
  });

  it('fails content_check by reading the file in the worktree', async () => {
    const seen = fakeDaemon();
    await agent.__test.executeTask(task('R-3', [['test/reset.test.js', '// todo']]));
    const { result } = seen['mesh.tasks.complete'];
    assert.equal(result.role_validation.passed, false);
    assert.deepEqual(result.role_validation.issues, ['[required_output] the test asserts something: Required content "assert" not found in test/** files']);
  });

  it('sends no verdict for a task without a role, and still lists its files', async () => {
    const seen = fakeDaemon();
    await agent.__test.executeTask(task('R-4', [['notes.md', 'n']], null));
    const { result } = seen['mesh.tasks.complete'];
    assert.deepEqual(result.artifacts, ['notes.md']);
    assert.equal(result.role_validation, undefined);
  });
});
