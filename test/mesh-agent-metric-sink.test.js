#!/usr/bin/env node
/**
 * mesh-agent-metric-sink.test.js — the worker runs a task's metric as argv with
 * no shell, after the shared gate (lib/exec-safety.js validateMetricCommand).
 *
 * The metric used to pass a regex filter and then run under `bash -c` with the
 * agent's full environment. `node -pe …`, `node --no-warnings -e …` and
 * `node ${x:--pe} …` all got through (mesh-core~2#5).
 *
 * Run: node --test test/mesh-agent-metric-sink.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-metric-'));
const WORKTREE = path.join(TMP, 'worktree');
fs.mkdirSync(path.join(TMP, '.openclaw', '.tmp'), { recursive: true });
fs.mkdirSync(WORKTREE, { recursive: true });
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: path.join(TMP, 'obs.db'),
  OPENCLAW_STATE_DB: path.join(TMP, 'state.db'),
  MESH_LLM_PROVIDER: 'claude',
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const agent = require('../bin/mesh-agent.js');

fs.writeFileSync(path.join(WORKTREE, 'show.js'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');
fs.writeFileSync(path.join(WORKTREE, 'fail.js'), 'process.exit(3);\n');

const run = (metric) => agent.__test.evaluateMetric(metric, WORKTREE);

describe('evaluateMetric', () => {
  it('runs the metric as argv: quotes group, globs and words are not expanded', async () => {
    const r = await run(`node show.js 'a b' *.js`);
    assert.equal(r.passed, true, r.output);
    assert.deepEqual(JSON.parse(r.output.trim()), ['a b', '*.js']);
  });

  it('reports a failing metric', async () => {
    assert.equal((await run('node fail.js')).passed, false);
  });

  it('never runs a node eval, however it is spelled', async () => {
    const marker = path.join(WORKTREE, 'pwned');
    for (const m of [
      `node -pe "require('fs').writeFileSync('pwned','')"`,
      `node --no-warnings -e "require('fs').writeFileSync('pwned','')"`,
      `node --input-type=commonjs -e "require('fs').writeFileSync('pwned','')"`,
      `node "-e" "require('fs').writeFileSync('pwned','')"`,
      'node ${x:--pe} 1',
    ]) {
      const r = await run(m);
      assert.equal(r.passed, false, m);
      assert.match(r.output, /blocked by security filter/, m);
      assert.equal(fs.existsSync(marker), false, m);
    }
  });

  it('refuses a script outside the worktree', async () => {
    const outside = path.join(TMP, 'outside.js');
    fs.writeFileSync(outside, 'process.exit(0);\n');
    assert.equal((await run(`node ${outside}`)).passed, false);
    assert.equal((await run('node ../outside.js')).passed, false);
  });
});
