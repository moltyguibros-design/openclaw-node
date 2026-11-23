#!/usr/bin/env node
/**
 * mesh-agent-cli-cost.test.js — a mesh task's cost comes from the claude CLI's
 * own total_cost_usd (`--output-format json`), not from the local price table:
 * runLLM hands downstream consumers the result text only and carries the cost.
 *
 * Run: node --test test/mesh-agent-cli-cost.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cli-cost-'));
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: ':memory:',
  MESH_MEMORY_RECALL: 'off',
});

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS, registerProvider, parseClaudeJsonResult } = require('../lib/llm-providers.js');
const agent = require('../bin/mesh-agent.js');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const RECORD = {
  type: 'result', subtype: 'success', is_error: false, num_turns: 3,
  result: 'Implemented the limiter.\nFOREMAN_VERDICT: PASS',
  session_id: 'abc', total_cost_usd: 0.4321,
  usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 50 },
};
const COST = { inputTokens: 1210, outputTokens: 50, estimatedCostUsd: 0.4321 };

describe('claude provider cost', () => {
  it('asks the CLI for its json result record and parses it', () => {
    const args = PROVIDERS.claude.buildArgs('p', 'sonnet', {}, '/tmp/x');
    assert.equal(args[args.indexOf('--output-format') + 1], 'json');
    assert.equal(PROVIDERS.claude.parseOutput, parseClaudeJsonResult);
  });

  it('parses the result text, the CLI total and the usage', () => {
    assert.deepEqual(parseClaudeJsonResult(JSON.stringify(RECORD)), { text: RECORD.result, cost: COST });
    assert.deepEqual(parseClaudeJsonResult(JSON.stringify([{ type: 'system' }, RECORD])), { text: RECORD.result, cost: COST });
    assert.equal(parseClaudeJsonResult('plain text, no record'), null);
    assert.equal(parseClaudeJsonResult(JSON.stringify(RECORD).slice(0, 40)), null);
  });

  it('runLLM returns the text and the CLI cost to its consumers', async () => {
    registerProvider('cli-cost-stub', {
      binary: process.execPath,
      parseOutput: parseClaudeJsonResult,
      buildArgs() { return ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify(RECORD))})`]; },
    });
    const result = await agent.__test.runLLM('prompt', { task_id: 'COST-1', llm_provider: 'cli-cost-stub', budget_minutes: 1 }, TMP);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, RECORD.result);
    assert.deepEqual(result.cost, COST);
  });

  it('a provider without a result record keeps its raw text and no cost', async () => {
    registerProvider('cli-text-stub', {
      binary: process.execPath,
      buildArgs() { return ['-e', "process.stdout.write('just text')"]; },
    });
    const result = await agent.__test.runLLM('prompt', { task_id: 'COST-2', llm_provider: 'cli-text-stub', budget_minutes: 1 }, TMP);
    assert.equal(result.stdout, 'just text');
    assert.equal(result.cost, null);
  });

  it('runLLM keeps the head and the tail of an output past the 1MB cap and flags it truncated', async () => {
    registerProvider('cli-flood-stub', {
      binary: process.execPath,
      buildArgs() {
        return ['-e', "process.stdout.write('HEAD-MARK\\n'); for (let i = 0; i < 1200; i++) process.stdout.write('x'.repeat(1023) + '\\n'); process.stdout.write('TAIL-MARK\\n')"];
      },
    });
    const result = await agent.__test.runLLM('prompt', { task_id: 'CAP-1', llm_provider: 'cli-flood-stub', budget_minutes: 1 }, TMP);
    assert.equal(result.truncated, true);
    assert.ok(result.stdout.startsWith('HEAD-MARK'));
    assert.ok(result.stdout.trimEnd().endsWith('TAIL-MARK'));
    assert.match(result.stdout, /output truncated: \d+ characters dropped/);
    assert.ok(result.stdout.length < 1024 * 1024 + 200);
  });

  it('a truncated collab output yields no reflection vote', () => {
    const output = '```json\n{"summary":"done","learnings":"","confidence":0.9,"vote":"converged"}\n```';
    assert.equal(agent.__test.parseReflection(output).vote, 'converged');
    const cut = agent.__test.parseReflection(output, { truncated: true });
    assert.equal(cut.parse_failed, true);
    assert.equal(cut.vote, 'parse_error');
  });

  it('a reflection outside a JSON block is a parse failure', () => {
    const r = agent.__test.parseReflection('REFLECTION_START\nSUMMARY: s\nCONFIDENCE: 0.9\nVOTE: converged\nREFLECTION_END');
    assert.equal(r.parse_failed, true);
    assert.equal(r.vote, 'parse_error');
  });

  it('runLLM reports an output under the cap untruncated', async () => {
    const result = await agent.__test.runLLM('prompt', { task_id: 'CAP-2', llm_provider: 'cli-text-stub', budget_minutes: 1 }, TMP);
    assert.equal(result.truncated, false);
  });
});

describe('runLLM through the shared runner (lib/llm-run)', () => {
  it('a CLI that cannot start is classified spawn_failed (127) and reported to the supervisor once', async () => {
    registerProvider('missing-cli-stub', { binary: path.join(TMP, 'no-such-cli'), buildArgs: () => [] });
    const exits = [];
    const supervisor = { attach() {}, workerExited: (e) => exits.push(e) };
    const result = await agent.__test.runLLM('prompt', { task_id: 'RUN-1', llm_provider: 'missing-cli-stub', budget_minutes: 1 }, TMP, supervisor);
    assert.equal(result.exitCode, 127);
    assert.equal(result.outcome, 'spawn_failed');
    assert.match(result.stderr, /ENOENT/);
    assert.deepEqual(exits, [{ exitCode: 127, signal: null }]);
  });

  it('an exit-0 run with no answer is classified empty', async () => {
    registerProvider('silent-cli-stub', { binary: process.execPath, buildArgs: () => ['-e', ''] });
    const result = await agent.__test.runLLM('prompt', { task_id: 'RUN-2', llm_provider: 'silent-cli-stub', budget_minutes: 1 }, TMP);
    assert.equal(result.exitCode, 0);
    assert.equal(result.outcome, 'empty');
  });

  it('a CLI that exits 0 without running the prompt (legacy kimi-cli) is a failed run, not a finished task', async () => {
    const notice = 'kimi-cli is no longer maintained. Please use the new Kimi Code CLI. Install: curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash';
    registerProvider('kimi-legacy-stub', { ...PROVIDERS.kimi, binary: process.execPath, buildArgs: () => ['-e', `console.log(${JSON.stringify(notice)})`] });
    const result = await agent.__test.runLLM('prompt', { task_id: 'RUN-3', llm_provider: 'kimi-legacy-stub', budget_minutes: 1 }, TMP);
    assert.equal(result.outcome, 'refused');
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /legacy kimi-cli/);
  });
});
