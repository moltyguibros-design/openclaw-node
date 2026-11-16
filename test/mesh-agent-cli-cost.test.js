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
});
