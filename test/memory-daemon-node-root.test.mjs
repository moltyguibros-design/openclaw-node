/**
 * memory-daemon-node-root.test.mjs — a node run with its own OPENCLAW_HOME
 * (bin/spawn-node.mjs) keeps the LLM-queue snapshot and its flush's vault notes
 * under that root. Both used to resolve under ~/.openclaw, so a spawned node
 * overwrote the main node's queue snapshot and wrote notes into its vault.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { repo, daemonFixture, transcript, runDaemon, daemonLog, removeFixture } from './helpers/memory-daemon-harness.mjs';

const EXTRACTION = {
  entities: [{ name: 'Node Root Vault', type: 'concept', salience: 0.9 }],
  decisions: [{ decision: 'Keep each spawned node in its own root', rationale: 'two daemons must not share files', confidence: 0.9 }],
  themes: [{ label: 'node isolation', hierarchy: ['infrastructure'] }],
  friction_signals: [],
  relationships: [],
  action_types: [],
};

// An LLM server in its own process (the daemon run below blocks this one),
// answering both the Ollama-native and the OpenAI-compatible chat routes.
async function startLlm(fx) {
  const script = path.join(fx.root, 'llm.mjs');
  fs.writeFileSync(script, `
    import http from 'node:http';
    const content = ${JSON.stringify(JSON.stringify(EXTRACTION))};
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(req.url === '/api/chat'
          ? { message: { content }, done_reason: 'stop', prompt_eval_count: 1, eval_count: 1 }
          : { choices: [{ message: { content }, finish_reason: 'stop' }], usage: {} }));
      });
    });
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `);
  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const [chunk] = await once(child.stdout, 'data');
  return { url: `http://127.0.0.1:${String(chunk).trim()}`, stop: () => child.kill() };
}

for (const [label, nativeApi] of [['Ollama-native API', 'true'], ['OpenAI-compatible API', 'false']]) {
  test(`under OPENCLAW_HOME the flush writes its notes into the node root vault (${label})`, async () => {
    const fx = daemonFixture();
    const llm = await startLlm(fx);
    try {
      transcript(fx, 'aaaa1111', 10);
      runDaemon(fx, `await daemon.runRequestedFlush([{ sessionId: 'aaaa1111', state: 'ACTIVE' }], config);`, {
        USE_LLM_EXTRACTION: 'true',
        LLM_BASE_URL: llm.url,
        LLM_NATIVE_API: nativeApi,
        LLM_MODEL: 'test-model',
      });
      assert.match(daemonLog(fx), /nats-triggered flush \[llm\] aaaa1111:/);
      const vault = path.join(fx.node, 'obsidian-local');
      const notes = fs.readdirSync(vault, { recursive: true }).filter((f) => f.endsWith('.md'));
      assert.ok(notes.some((f) => f.startsWith('sessions')), `no session note in the node vault: ${notes}`);
      assert.ok(notes.some((f) => f.startsWith('decisions')), `no decision note in the node vault: ${notes}`);
      assert.equal(fs.existsSync(path.join(fx.root, 'home', '.openclaw', 'obsidian-local')), false, 'the main node vault was written');
    } finally {
      llm.stop();
      removeFixture(fx);
    }
  });
}

test('the LLM-queue snapshot follows OPENCLAW_HOME, and stays in ~/.openclaw without it', () => {
  const fx = daemonFixture();
  try {
    const home = path.join(fx.root, 'home');
    const where = (env) => spawnSync(process.execPath, ['--input-type=module', '-e',
      "const q = await import('./lib/ollama-queue.mjs'); q.exportStateSnapshot(); console.log(q.QUEUE_STATE_PATH);"],
    { cwd: repo, env: { PATH: process.env.PATH, HOME: home, ...env }, encoding: 'utf8' });
    const spawned = where({ OPENCLAW_HOME: fx.node });
    assert.equal(spawned.status, 0, spawned.stderr);
    assert.equal(spawned.stdout.trim(), path.join(fx.node, 'workspace', '.tmp', 'ollama-queue-state.json'));
    assert.ok(fs.existsSync(spawned.stdout.trim()));
    assert.equal(fs.existsSync(path.join(home, '.openclaw')), false, 'the spawned node wrote the main node snapshot');

    const main = where({});
    assert.equal(main.stdout.trim(), path.join(home, '.openclaw', 'workspace', '.tmp', 'ollama-queue-state.json'));
  } finally {
    removeFixture(fx);
  }
});
